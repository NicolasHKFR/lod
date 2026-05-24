import json
import os
import csv
import io
import tempfile
import asyncio
import contextvars
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import StreamingResponse, Response

from backend.config import ROOT_DIR, UPLOAD_DIR, MAX_FILE_SIZE, load_endpoints, save_endpoints, MODEL_NAME, LLM_TIMEOUT, MAX_TOKENS, PROMPT_VERSION, LLM_PROVIDER, API_KEY
from backend.ingestion.extractor import extract_text
from backend.engine.ollama_client import call_llm as call_ollama, _truncate, _build_multipart, _parse_forge_response
from backend.database import crud
from backend.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()

os.makedirs(UPLOAD_DIR, exist_ok=True)


async def _read_upload(file: UploadFile) -> tuple[str, bytes]:
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File '{file.filename}' exceeds max size")
    logger.debug("Read upload %s (%d bytes)", file.filename, len(content))
    return (file.filename or "unknown", content)


def _extract_bytes(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    try:
        tmp.write(content)
        tmp.close()
        text = extract_text(tmp.name)
        logger.debug("Extracted %s -> %d chars", filename, len(text))
        return text or ""
    finally:
        os.unlink(tmp.name)


def _process_control(control_text: str, evidence_parts: list, endpoint_url: str, model_name: str = None, provider: str = None, api_key: str = None):
    evidence_text = "\n\n".join(evidence_parts) if evidence_parts else "No evidence provided."
    truncated_evidence = _truncate(evidence_text, MAX_TOKENS)
    result = call_ollama(control_text, evidence_text, endpoint_url=endpoint_url, model_name=model_name, provider=provider, api_key=api_key)
    raw_response = result.pop("_raw", "")
    raw_prompt = result.pop("_raw_prompt", "")
    summary = result.get("summary", "")
    submission_id = crud.save_submission(
        control_text=control_text,
        evidence_text=truncated_evidence,
        status=result["status"],
        confidence_score=result["confidence_score"],
        findings=result.get("findings", []),
        gaps=result.get("gaps_identified", []),
        raw_prompt=raw_prompt,
        raw_llm_response=raw_response,
        prompt_version=PROMPT_VERSION,
        summary=summary,
    )
    warnings = []
    for part in evidence_parts:
        if "[Empty content]" in part or "[Could not extract text]" in part:
            filename = part.split(" ---")[0].strip("- \n")
            warnings.append(f"Could not extract text from: {filename}")
    if not evidence_parts:
        warnings.append("No evidence files were uploaded.")
    return {
        "id": submission_id,
        "status": result["status"],
        "confidence_score": result["confidence_score"],
        "findings": result.get("findings", []),
        "gaps_identified": result.get("gaps_identified", []),
        "summary": summary,
        "raw_prompt": raw_prompt,
        "raw_llm_response": raw_response,
        "warnings": warnings,
    }


@router.post("/analyze")
async def analyze(
    control_text: str = Form(""),
    control_file: UploadFile = File(None),
    evidence_files: list[UploadFile] = File(default=[]),
    endpoint_url: str = Form(""),
    model_name: str = Form(""),
    provider: str = Form(""),
    api_key: str = Form(""),
):
    control = control_text
    if control_file and control_file.filename:
        fn, content = await _read_upload(control_file)
        text = _extract_bytes(fn, content)
        if text:
            control = text

    if not control or not control.strip():
        raise HTTPException(400, "Control description is required (text or file)")

    selected_endpoint = endpoint_url.strip() or load_endpoints()[0]
    selected_model = model_name.strip() or None
    evidence_parts = []
    evidence_data = []
    for f in evidence_files:
        if f.filename:
            try:
                fn, content = await _read_upload(f)
                evidence_data.append((fn, content))
            except Exception as e:
                logger.warning(f"Failed to read {f.filename}: {e}")
                evidence_parts.append(f"--- {f.filename} ---\n[Could not extract text]")

    for fn, content in evidence_data:
        try:
            text = _extract_bytes(fn, content)
        except Exception as e:
            logger.warning(f"Failed to extract {fn}: {e}")
            evidence_parts.append(f"--- {fn} ---\n[Could not extract text]")
            continue
        if text:
            evidence_parts.append(f"--- {fn} ---\n{text}")
        else:
            evidence_parts.append(f"--- {fn} ---\n[Empty content]")

    loop = asyncio.get_event_loop()
    ctx = contextvars.copy_context()
    result = await loop.run_in_executor(None, lambda: ctx.run(_process_control, control, evidence_parts, selected_endpoint, selected_model, provider, api_key))
    return result


@router.post("/analyze/stream")
async def analyze_stream(
    control_text: str = Form(""),
    control_file: UploadFile = File(None),
    evidence_files: list[UploadFile] = File(default=[]),
    endpoint_url: str = Form(""),
    model_name: str = Form(""),
    provider: str = Form(""),
    api_key: str = Form(""),
):
    evidence_data = []
    for f in evidence_files:
        if f.filename:
            try:
                fn, content = await _read_upload(f)
                evidence_data.append((fn, content))
            except Exception as e:
                logger.warning(f"Failed to read {f.filename}: {e}")

    control_override = None
    if control_file and control_file.filename:
        fn, content = await _read_upload(control_file)
        control_override = _extract_bytes(fn, content) or None

    async def event_stream():
        control = control_override if control_override is not None else control_text

        if control_file and control_file.filename:
            yield f"data: {json.dumps({'step': 'extracting', 'message': f'Reading control file: {control_file.filename}'})}\n\n"

        if not control or not control.strip():
            yield f"data: {json.dumps({'step': 'error', 'message': 'Control description is required'})}\n\n"
            return

        selected_endpoint = endpoint_url.strip() or load_endpoints()[0]
        selected_model = model_name.strip() or None
        evidence_parts = []
        total = len(evidence_data)

        loop = asyncio.get_event_loop()

        if total:
            yield f"data: {json.dumps({'step': 'extracting', 'message': f'Extracting {total} file(s)...'})}\n\n"
            for fn, content in evidence_data:
                try:
                    text = _extract_bytes(fn, content)
                except Exception as e:
                    logger.warning(f"Failed to extract {fn}: {e}")
                    evidence_parts.append(f"--- {fn} ---\n[Could not extract text]")
                    continue
                if text:
                    evidence_parts.append(f"--- {fn} ---\n{text}")
                else:
                    evidence_parts.append(f"--- {fn} ---\n[Empty content]")

        yield f"data: {json.dumps({'step': 'analyzing', 'message': 'Sending to LLM...'})}\n\n"

        try:
            ctx = contextvars.copy_context()
            result = await loop.run_in_executor(None, lambda: ctx.run(_process_control, control, evidence_parts, selected_endpoint, selected_model, provider, api_key))
            yield f"data: {json.dumps({'step': 'result', 'data': result})}\n\n"
        except Exception as e:
            logger.error(f"LLM call failed: {e}", exc_info=True)
            yield f"data: {json.dumps({'step': 'error', 'message': f'LLM service error: {e}'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/analyze/batch")
async def analyze_batch(
    controls_text: str = Form(""),
    controls_file: UploadFile = File(None),
    evidence_files: list[UploadFile] = File(default=[]),
    endpoint_url: str = Form(""),
    model_name: str = Form(""),
    provider: str = Form(""),
    api_key: str = Form(""),
    sse: str = Form("true"),
):
    evidence_parts = []
    evidence_data = []
    for f in evidence_files:
        if f.filename:
            try:
                fn, content = await _read_upload(f)
                evidence_data.append((fn, content))
            except Exception as e:
                logger.warning(f"Failed to read {f.filename}: {e}")
                evidence_parts.append(f"--- {f.filename} ---\n[Could not extract text]")

    for fn, content in evidence_data:
        try:
            text = _extract_bytes(fn, content)
        except Exception as e:
            logger.warning(f"Failed to extract {fn}: {e}")
            evidence_parts.append(f"--- {fn} ---\n[Could not extract text]")
            continue
        if text:
            evidence_parts.append(f"--- {fn} ---\n{text}")

    if controls_file and controls_file.filename:
        fn, content = await _read_upload(controls_file)
        controls_text = _extract_bytes(fn, content) or ""

    if not controls_text or not controls_text.strip():
        raise HTTPException(400, "Controls text is required for batch mode")

    blocks = [b.strip() for b in controls_text.split("---") if b.strip()]
    if not blocks:
        raise HTTPException(400, "No control blocks found. Separate each control with ---")

    selected_endpoint = endpoint_url.strip() or load_endpoints()[0]
    selected_model = model_name.strip() or None

    loop = asyncio.get_event_loop()

    async def batch_stream():
        outcomes = []
        total = len(blocks)
        for idx, block in enumerate(blocks):
            pct = int((idx / total) * 90) + 5
            preview = block[:80].replace("\n", " ")
            yield f"data: {json.dumps({'step': 'progress', 'message': f'Processing control {idx + 1} of {total}: {preview}', 'percent': pct})}\n\n"
            try:
                ctx = contextvars.copy_context()
                result = await loop.run_in_executor(None, lambda: ctx.run(_process_control, block, evidence_parts, selected_endpoint, selected_model, provider, api_key))
                result["control_preview"] = block[:100]
                outcomes.append(result)
            except Exception as e:
                outcomes.append({"status": "ERROR", "control_preview": block[:100], "error": str(e), "confidence_score": 0, "warnings": []})
        yield f"data: {json.dumps({'step': 'result', 'data': {'results': outcomes}})}\n\n"

    if sse == "true":
        return StreamingResponse(batch_stream(), media_type="text/event-stream")
    return {"results": outcomes}


@router.post("/override/{submission_id}")
async def override(submission_id: int, new_status: str = Form(...), reason: str = Form("")):
    sub = crud.get_submission(submission_id)
    if not sub:
        raise HTTPException(404, "Submission not found")
    original_status = sub.status
    updated = crud.save_override(submission_id, original_status, new_status, reason)
    if not updated:
        raise HTTPException(500, "Failed to save override")
    return {"id": submission_id, "status": new_status, "original_status": original_status}


@router.get("/endpoints")
async def get_endpoints():
    return {"endpoints": load_endpoints()}


@router.get("/health")
async def health():
    import urllib.request
    llm_ok = False
    try:
        req = urllib.request.Request(
            load_endpoints()[0],
            data=json.dumps({"model": "", "prompt": "test"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=2)
        llm_ok = True
    except Exception:
        logger.debug("Health check: Ollama probe failed", exc_info=True)
        llm_ok = False
    db_ok = False
    try:
        crud.get_session()
        db_ok = True
    except Exception:
        db_ok = False
    ocr_ok = False
    try:
        from backend.ingestion.extractor import _find_tesseract
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = _find_tesseract()
        pytesseract.get_tesseract_version()
        ocr_ok = True
    except Exception:
        ocr_ok = False
    pdf_ok = False
    try:
        import fitz
        pdf_ok = True
    except Exception:
        pdf_ok = False
    return {
        "status": "ok" if (llm_ok or db_ok) else "degraded",
        "llm_connected": llm_ok,
        "db_connected": db_ok,
        "ocr_available": ocr_ok,
        "pdf_extraction": pdf_ok,
    }


@router.get("/readme")
async def get_readme():
    readme_path = os.path.join(ROOT_DIR, "README.md")
    if os.path.isfile(readme_path):
        with open(readme_path, "r", encoding="utf-8") as f:
            return {"content": f.read()}
    return {"content": "# User Manual\n\nNot available."}


@router.get("/ollama/tags")
async def ollama_tags(url: str = Query("")):
    import urllib.request
    target = url.strip() or "http://localhost:11434/api/tags"
    is_openai = "/v1/models" in target
    try:
        req = urllib.request.Request(target, method="GET")
        resp = urllib.request.urlopen(req, timeout=5)
        body = json.loads(resp.read().decode("utf-8"))
        if is_openai:
            models = [m["id"] for m in body if "id" in m] if isinstance(body, list) else [m.get("id") for m in body.get("data", []) if m.get("id")]
        else:
            models = [m["name"] for m in body.get("models", [])]
        return {"models": models, "connected": True}
    except Exception as e:
        return {"models": [], "connected": False, "error": str(e)}


@router.get("/models")
async def list_models(url: str = Query(""), provider: str = Query("")):
    import urllib.request
    use_provider = (provider or LLM_PROVIDER).lower()
    if use_provider in ("openai", "forge"):
        target = url.strip() or "http://localhost:11434/v1/models"
        headers = {"Content-Type": "application/json"}
        key = API_KEY
        if key:
            headers["Authorization"] = f"Bearer {key}"
    else:
        target = url.strip() or "http://localhost:11434/api/tags"
        headers = {}
    try:
        req = urllib.request.Request(target, headers=headers, method="GET")
        resp = urllib.request.urlopen(req, timeout=5)
        body = json.loads(resp.read().decode("utf-8"))
        if use_provider in ("openai", "forge"):
            raw = body.get("data", body) if isinstance(body, dict) else body
            models = [m["id"] for m in raw if isinstance(m, dict) and "id" in m]
        else:
            models = [m["name"] for m in body.get("models", [])]
        return {"models": models, "connected": True}
    except Exception as e:
        return {"models": [], "connected": False, "error": str(e)}


@router.get("/history")
async def history(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
):
    if date_from:
        date_from = datetime.fromisoformat(date_from)
    if date_to:
        date_to = datetime.fromisoformat(date_to)
    submissions = crud.get_all_submissions(
        limit=limit, offset=offset, search=search, status=status,
        date_from=date_from, date_to=date_to,
    )
    items = []
    for s in submissions:
        items.append({
            "id": s.id,
            "control_text": s.control_text[:200] if s.control_text else "",
            "status": s.status,
            "confidence_score": s.confidence_score,
            "findings": json.loads(s.findings) if s.findings else [],
            "gaps": json.loads(s.gaps) if s.gaps else [],
            "summary": s.summary,
            "prompt_version": s.prompt_version,
            "created_at": s.created_at.isoformat() if s.created_at else "",
        })
    return {"submissions": items}


@router.get("/submit/{submission_id}")
async def get_submission(submission_id: int):
    s = crud.get_submission(submission_id)
    if not s:
        raise HTTPException(404, "Submission not found")
    return {
        "id": s.id,
        "control_text": s.control_text,
        "evidence_text": s.evidence_text,
        "status": s.status,
        "confidence_score": s.confidence_score,
        "findings": json.loads(s.findings) if s.findings else [],
        "gaps": json.loads(s.gaps) if s.gaps else [],
        "summary": s.summary,
        "raw_prompt": s.raw_prompt,
        "raw_llm_response": s.raw_llm_response,
        "prompt_version": s.prompt_version,
        "created_at": s.created_at.isoformat() if s.created_at else "",
    }


@router.get("/export/{submission_id}")
async def export(submission_id: int, format: str = Query("csv")):
    s = crud.get_submission(submission_id)
    if not s:
        raise HTTPException(404, "Submission not found")

    findings = json.loads(s.findings) if s.findings else []
    gaps = json.loads(s.gaps) if s.gaps else []

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Field", "Value"])
        writer.writerow(["ID", s.id])
        writer.writerow(["Status", s.status])
        writer.writerow(["Confidence Score", s.confidence_score])
        writer.writerow(["Control", s.control_text[:500]])
        writer.writerow(["Findings", "; ".join(findings)])
        writer.writerow(["Gaps", "; ".join(gaps)])
        writer.writerow(["Prompt Version", s.prompt_version or ""])
        writer.writerow(["Created", s.created_at.isoformat() if s.created_at else ""])
        csv_content = output.getvalue()
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=submission_{s.id}.csv"},
        )

    elif format == "html":
        findings = json.loads(s.findings) if s.findings else []
        gaps = json.loads(s.gaps) if s.gaps else []
        status_class = s.status.lower().replace("-", "-")
        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Assessment Report #{s.id}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; line-height: 1.6; }}
  h1 {{ font-size: 22px; border-bottom: 2px solid #4361ee; padding-bottom: 8px; }}
  .badge {{ display: inline-block; padding: 4px 14px; border-radius: 20px; font-weight: 700; font-size: 14px; }}
  .badge-compliant {{ background: #d4f5e9; color: #0a5e3e; }}
  .badge-non-compliant {{ background: #fce4ec; color: #a31432; }}
  .badge-inconclusive {{ background: #fff3cd; color: #856404; }}
  .section {{ margin: 20px 0; }}
  .section-title {{ font-weight: 600; font-size: 14px; margin-bottom: 6px; color: #4361ee; }}
  .summary {{ background: #f0f4ff; border-left: 4px solid #4361ee; padding: 12px 16px; border-radius: 6px; }}
  .meta {{ color: #888; font-size: 13px; }}
  ul {{ padding-left: 20px; }}
  .findings li {{ color: #0a5e3e; }}
  .gaps li {{ color: #a31432; }}
  pre {{ background: #f4f6f9; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto; }}
</style></head>
<body>
<h1>LOD1 Assessment Report #{s.id}</h1>
<p class="meta">Date: {s.created_at.strftime('%Y-%m-%d %H:%M') if s.created_at else 'N/A'} | Prompt v{s.prompt_version or 'N/A'}</p>
<div class="section">
  <span class="badge badge-{status_class}">{s.status}</span>
  <span style="margin-left:12px;font-size:18px;font-weight:700;">Confidence: {s.confidence_score}%</span>
</div>
{s.summary and f'<div class="section"><div class="section-title">Executive Summary</div><div class="summary">{_escape_html(s.summary)}</div></div>' or ''}
<div class="section"><div class="section-title">Control Description</div><pre>{_escape_html(s.control_text[:2000])}</pre></div>
<div class="section"><div class="section-title">Findings</div><ul class="findings">{"".join(f"<li>{_escape_html(f)}</li>" for f in findings) or "<li>None listed</li>"}</ul></div>
<div class="section"><div class="section-title">Gap Analysis</div><ul class="gaps">{"".join(f"<li>{_escape_html(g)}</li>" for g in gaps) or "<li>None listed</li>"}</ul></div>
{s.evidence_text and f'<div class="section"><div class="section-title">Evidence Text</div><pre>{_escape_html(s.evidence_text[:1500])}</pre></div>' or ''}
<div class="section"><div class="section-title">Raw LLM Response</div><pre>{_escape_html(s.raw_llm_response[:3000]) if s.raw_llm_response else "N/A"}</pre></div>
</body></html>"""
        return Response(
            content=html_content,
            media_type="text/html",
            headers={"Content-Disposition": f"attachment; filename=report_{s.id}.html"},
        )

    raise HTTPException(400, f"Unsupported export format: {format}")


def _escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


@router.post("/chat")
async def chat(
    prompt: str = Form(...),
    model: str = Form(""),
    system: str = Form(""),
    endpoint_url: str = Form(""),
    provider: str = Form(""),
    api_key: str = Form(""),
):
    try:
        import uuid
        import urllib.request
        url = endpoint_url.strip() or load_endpoints()[0]
        selected_model = model.strip() or MODEL_NAME
        use_provider = (provider or LLM_PROVIDER).lower()
        key = api_key or API_KEY

        if use_provider == "openai":
            headers = {"Content-Type": "application/json"}
            if key:
                headers["Authorization"] = f"Bearer {key}"
            messages = []
            if system.strip():
                messages.append({"role": "system", "content": system.strip()})
            messages.append({"role": "user", "content": prompt})
            payload = {
                "model": selected_model,
                "messages": messages,
                "stream": False,
                "temperature": 0.7,
            }
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        elif use_provider == "forge":
            text_input = f"{system.strip()}\n\n{prompt}" if system.strip() else prompt
            boundary = uuid.uuid4().hex
            body = _build_multipart(body_parts=[
                ("text_input", text_input),
                ("files", None),
            ], boundary=boundary)
            headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
            if key:
                headers["Authorization"] = f"Bearer {key}"
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        else:
            payload = {
                "model": selected_model,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.7},
            }
            if system.strip():
                payload["system"] = system.strip()
            headers = {"Content-Type": "application/json"}
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        resp = urllib.request.urlopen(req, timeout=LLM_TIMEOUT)
        body = resp.read().decode("utf-8")

        if use_provider == "openai":
            try:
                resp_json = json.loads(body)
                text = resp_json["choices"][0]["message"]["content"]
            except (KeyError, IndexError, json.JSONDecodeError):
                text = body
        elif use_provider == "forge":
            text = _parse_forge_response(body)
        else:
            try:
                resp_json = json.loads(body)
                text = resp_json.get("response", body)
            except json.JSONDecodeError:
                text = body

        return {"response": text.strip(), "model": selected_model}
    except Exception as e:
        logger.error(f"Chat LLM call failed: {e}", exc_info=True)
        raise HTTPException(502, f"Chat LLM call failed: {e}")


@router.post("/chat/stream")
async def chat_stream(
    prompt: str = Form(...),
    model: str = Form(""),
    system: str = Form(""),
    endpoint_url: str = Form(""),
    provider: str = Form(""),
    api_key: str = Form(""),
):
    async def event_stream():
        try:
            import uuid
            import urllib.request
            url = endpoint_url.strip() or load_endpoints()[0]
            selected_model = model.strip() or MODEL_NAME
            use_provider = (provider or LLM_PROVIDER).lower()
            key = api_key or API_KEY

            if use_provider == "openai":
                headers = {"Content-Type": "application/json"}
                if key:
                    headers["Authorization"] = f"Bearer {key}"
                messages = []
                if system.strip():
                    messages.append({"role": "system", "content": system.strip()})
                messages.append({"role": "user", "content": prompt})
                payload = {
                    "model": selected_model,
                    "messages": messages,
                    "stream": False,
                    "temperature": 0.7,
                }
                data = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            elif use_provider == "forge":
                text_input = f"{system.strip()}\n\n{prompt}" if system.strip() else prompt
                boundary = uuid.uuid4().hex
                body = _build_multipart(body_parts=[
                    ("text_input", text_input),
                    ("files", None),
                ], boundary=boundary)
                headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
                if key:
                    headers["Authorization"] = f"Bearer {key}"
                req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            else:
                payload = {
                    "model": selected_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.7},
                }
                if system.strip():
                    payload["system"] = system.strip()
                headers = {"Content-Type": "application/json"}
                data = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(url, data=data, headers=headers, method="POST")

            resp = urllib.request.urlopen(req, timeout=LLM_TIMEOUT)
            body = resp.read().decode("utf-8")

            if use_provider == "openai":
                try:
                    resp_json = json.loads(body)
                    text = resp_json["choices"][0]["message"]["content"]
                except (KeyError, IndexError, json.JSONDecodeError):
                    text = body
            elif use_provider == "forge":
                text = _parse_forge_response(body)
            else:
                try:
                    resp_json = json.loads(body)
                    text = resp_json.get("response", body)
                except json.JSONDecodeError:
                    text = body

            yield f"data: {json.dumps({'response': text.strip(), 'model': selected_model})}\n\n"
        except Exception as e:
            logger.error(f"Chat stream LLM call failed: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/logs")
async def get_logs(limit: int = Query(100), offset: int = Query(0)):
    submissions = crud.get_all_submissions(limit=limit, offset=offset)
    items = []
    for s in submissions:
        entry = {
            "type": "submission",
            "id": s.id,
            "control_text": s.control_text,
            "evidence_text": s.evidence_text,
            "status": s.status,
            "confidence_score": s.confidence_score,
            "findings": json.loads(s.findings) if s.findings else [],
            "gaps": json.loads(s.gaps) if s.gaps else [],
            "summary": s.summary,
            "raw_prompt": s.raw_prompt,
            "raw_llm_response": s.raw_llm_response,
            "prompt_version": s.prompt_version,
            "created_at": s.created_at.isoformat() if s.created_at else "",
        }
        items.append(entry)
        if s.overrides:
            for ov in s.overrides:
                items.append({
                    "type": "override",
                    "submission_id": s.id,
                    "original_status": ov.original_status,
                    "new_status": ov.new_status,
                    "reason": ov.reason,
                    "created_at": ov.created_at.isoformat() if ov.created_at else "",
                })
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"logs": items}


@router.get("/logs/recent")
async def get_recent_logs(
    lines: int = Query(200, ge=10, le=5000),
    level: str = Query("", pattern="^(|DEBUG|INFO|WARNING|ERROR|CRITICAL)$"),
    search: str = Query(""),
    correlation_id: str = Query(""),
):
    log_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs", "app.log")
    if not os.path.isfile(log_file):
        return {"entries": []}

    with open(log_file, "r", encoding="utf-8", errors="replace") as f:
        all_lines = f.readlines()

    total = len(all_lines)
    tail = all_lines[-lines:] if lines < total else all_lines

    if level:
        padded = f" [{level:<7}] "
        tail = [ln for ln in tail if padded in ln]
    if search:
        tail = [ln for ln in tail if search.lower() in ln.lower()]
    if correlation_id:
        needle = f"[{correlation_id}]"
        tail = [ln for ln in tail if needle in ln]

    return {"entries": tail, "total_lines": total, "returned": len(tail)}


@router.get("/config")
async def get_config():
    return {
        "model": MODEL_NAME,
        "timeout": LLM_TIMEOUT,
        "max_tokens": MAX_TOKENS,
        "provider": LLM_PROVIDER,
        "api_key": "***" if API_KEY else "",
        "endpoints": load_endpoints(),
    }


@router.post("/config")
async def update_config(data: dict):
    global MODEL_NAME, LLM_TIMEOUT, MAX_TOKENS, LLM_PROVIDER, API_KEY

    if "model" in data:
        MODEL_NAME = data["model"]
    if "timeout" in data:
        LLM_TIMEOUT = int(data["timeout"])
    if "max_tokens" in data:
        MAX_TOKENS = int(data["max_tokens"])
    if "provider" in data and data["provider"] in ("ollama", "openai", "forge"):
        LLM_PROVIDER = data["provider"]
    if "api_key" in data:
        API_KEY = data["api_key"]
    if "endpoints" in data and isinstance(data["endpoints"], list):
        save_endpoints([e.strip() for e in data["endpoints"] if e.strip()])

    return {
        "model": MODEL_NAME,
        "timeout": LLM_TIMEOUT,
        "max_tokens": MAX_TOKENS,
        "provider": LLM_PROVIDER,
        "api_key": "***" if API_KEY else "",
        "endpoints": load_endpoints(),
    }


@router.delete("/database")
async def clear_database():
    ok = crud.clear_database()
    if not ok:
        raise HTTPException(500, "Failed to clear database")
    return {"status": "cleared"}


# ========== EVIDENCE LIBRARY ==========

@router.post("/evidence/upload")
async def upload_evidence(
    file: UploadFile = File(...),
    tags: str = Form(""),
):
    path = os.path.join(UPLOAD_DIR, "evidence")
    os.makedirs(path, exist_ok=True)
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File exceeds max size")
    filename = f"{int(datetime.now().timestamp())}_{file.filename}"
    filepath = os.path.join(path, filename)
    with open(filepath, "wb") as f:
        f.write(content)
    ext = Path(file.filename).suffix.lower()
    text = ""
    if ext in (".txt", ".md", ".csv", ".log"):
        text = content.decode("utf-8", errors="replace")
    elif ext == ".pdf":
        import fitz
        doc = fitz.open(stream=content, filetype="pdf")
        text = "".join(page.get_text() for page in doc)
    elif ext in (".png", ".jpg", ".jpeg"):
        try:
            from backend.ingestion.extractor import _find_tesseract
            import pytesseract
            pytesseract.pytesseract.tesseract_cmd = _find_tesseract()
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(content))
            text = pytesseract.image_to_string(img)
        except:
            text = "[OCR unavailable]"
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    ev = crud.save_evidence(
        filename=filename,
        original_filename=file.filename,
        file_size=len(content),
        mime_type=file.content_type or "",
        extracted_text=text,
        tags=tag_list,
    )
    return {
        "id": ev.id,
        "filename": ev.original_filename,
        "file_size": ev.file_size,
        "tags": tag_list,
        "created_at": ev.created_at.isoformat() if ev.created_at else "",
    }


@router.get("/evidence")
async def list_evidence(search: str = Query(""), tag: str = Query(""), limit: int = Query(100), offset: int = Query(0)):
    items = crud.get_all_evidence(search=search or None, tag=tag or None, limit=limit, offset=offset)
    return {
        "evidence": [
            {
                "id": e.id,
                "filename": e.original_filename,
                "file_size": e.file_size,
                "mime_type": e.mime_type,
                "tags": json.loads(e.tags) if e.tags else [],
                "created_at": e.created_at.isoformat() if e.created_at else "",
                "text_preview": (e.extracted_text or "")[:200],
            }
            for e in items
        ]
    }


@router.get("/evidence/{evidence_id}")
async def get_evidence(evidence_id: int):
    e = crud.get_evidence(evidence_id)
    if not e:
        raise HTTPException(404, "Evidence not found")
    return {
        "id": e.id,
        "filename": e.original_filename,
        "file_size": e.file_size,
        "mime_type": e.mime_type,
        "extracted_text": e.extracted_text or "",
        "tags": json.loads(e.tags) if e.tags else [],
        "created_at": e.created_at.isoformat() if e.created_at else "",
    }


@router.delete("/evidence/{evidence_id}")
async def delete_evidence(evidence_id: int):
    e = crud.get_evidence(evidence_id)
    if not e:
        raise HTTPException(404, "Evidence not found")
    filepath = os.path.join(UPLOAD_DIR, "evidence", e.filename)
    if os.path.isfile(filepath):
        os.unlink(filepath)
    ok = crud.delete_evidence(evidence_id)
    if not ok:
        raise HTTPException(500, "Failed to delete evidence")
    return {"status": "deleted"}


@router.post("/evidence/{evidence_id}/tags")
async def update_evidence_tags(evidence_id: int, tags: str = Form(...)):
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    ev = crud.update_evidence_tags(evidence_id, tag_list)
    if not ev:
        raise HTTPException(404, "Evidence not found")
    return {"id": ev.id, "tags": tag_list}


# ========== CONSOLIDATED REPORTS ==========

@router.post("/reports/consolidated")
async def consolidated_report(submission_ids: str = Form(...)):
    ids = [int(x.strip()) for x in submission_ids.split(",") if x.strip()]
    if not ids:
        raise HTTPException(400, "No submission IDs provided")
    submissions = []
    for sid in ids:
        s = crud.get_submission(sid)
        if s:
            submissions.append(s)
    if not submissions:
        raise HTTPException(404, "No submissions found")
    total = len(submissions)
    compliant = sum(1 for s in submissions if s.status == "COMPLIANT")
    non_compliant = sum(1 for s in submissions if s.status == "NON-COMPLIANT")
    inconclusive = sum(1 for s in submissions if s.status == "INCONCLUSIVE")
    avg_conf = sum(s.confidence_score or 0 for s in submissions) / total
    rows = ""
    for s in submissions:
        findings = json.loads(s.findings) if s.findings else []
        gaps = json.loads(s.gaps) if s.gaps else []
        status_class = s.status.lower().replace("-", "-")
        rows += f"""<tr>
            <td>#{s.id}</td>
            <td>{_escape_html((s.control_text or "")[:120])}</td>
            <td><span class="badge badge-{status_class}" style="font-size:11px;padding:2px 8px;">{s.status}</span></td>
            <td>{s.confidence_score or "-"}%</td>
            <td style="font-size:12px;">{_escape_html(s.summary or "")[:100]}</td>
            <td style="font-size:12px;"><ul style="margin:0;padding-left:16px;">{"".join(f"<li>{_escape_html(f)}</li>" for f in findings[:3])}</ul></td>
            <td style="font-size:12px;"><ul style="margin:0;padding-left:16px;">{"".join(f"<li>{_escape_html(g)}</li>" for g in gaps[:3])}</ul></td>
        </tr>"""
    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Consolidated Report</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 1200px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; line-height: 1.6; }}
  h1 {{ font-size: 22px; border-bottom: 2px solid #4361ee; padding-bottom: 8px; }}
  h2 {{ font-size: 16px; margin-top: 24px; }}
  .stats {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }}
  .stat-card {{ text-align: center; padding: 16px; background: #f4f6f9; border-radius: 8px; }}
  .stat-value {{ font-size: 28px; font-weight: 700; }}
  .stat-label {{ font-size: 11px; color: #888; text-transform: uppercase; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }}
  th, td {{ text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }}
  th {{ font-weight: 600; color: #555; text-transform: uppercase; font-size: 11px; }}
  .badge {{ display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }}
  .badge-compliant {{ background: #d4f5e9; color: #0a5e3e; }}
  .badge-non-compliant {{ background: #fce4ec; color: #a31432; }}
  .badge-inconclusive {{ background: #fff3cd; color: #856404; }}
  ul {{ margin: 0; padding-left: 16px; }}
</style></head>
<body>
<h1>Consolidated LOD1 Assessment Report</h1>
<p style="color:#888;font-size:13px;">{total} submission(s) | Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}</p>
<div class="stats">
  <div class="stat-card"><div class="stat-value" style="color:#06d6a0;">{compliant}</div><div class="stat-label">Compliant</div></div>
  <div class="stat-card"><div class="stat-value" style="color:#ef476f;">{non_compliant}</div><div class="stat-label">Non-Compliant</div></div>
  <div class="stat-card"><div class="stat-value" style="color:#ffd166;">{inconclusive}</div><div class="stat-label">Inconclusive</div></div>
  <div class="stat-card"><div class="stat-value">{avg_conf:.0f}%</div><div class="stat-label">Avg Confidence</div></div>
</div>
<h2>Per-Submission Breakdown</h2>
<table><thead><tr><th>ID</th><th>Control</th><th>Status</th><th>Conf.</th><th>Summary</th><th>Findings</th><th>Gaps</th></tr></thead><tbody>{rows}</tbody></table>
</body></html>"""
    return Response(
        content=html,
        media_type="text/html",
        headers={"Content-Disposition": "attachment; filename=consolidated_report.html"},
    )
