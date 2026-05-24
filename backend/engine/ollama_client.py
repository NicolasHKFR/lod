import json
import urllib.request
import urllib.error

from pydantic import ValidationError

from backend.config import OLLAMA_URL, MODEL_NAME, LLM_TIMEOUT, MAX_TOKENS, LLM_PROVIDER, API_KEY
from backend.engine.prompt_builder import build_full_payload, build_openai_payload
from backend.api.schemas import LLMOutput
from backend.logger import get_logger

logger = get_logger(__name__)


def _estimate_tokens(text: str) -> int:
    return len(text) // 4


def _truncate(text: str, max_tokens: int) -> str:
    if _estimate_tokens(text) <= max_tokens:
        return text
    chars_per_token = 4
    max_chars = max_tokens * chars_per_token
    head_chars = int(max_chars * 0.6)
    tail_chars = int(max_chars * 0.3)
    head = text[:head_chars]
    tail = text[-tail_chars:] if tail_chars > 0 else ""
    return f"{head}\n\n[...truncated at approximately {max_tokens} tokens...]\n\n{tail}"


def call_llm(
    control_text: str,
    evidence_text: str,
    endpoint_url: str = None,
    model_name: str = None,
    provider: str = None,
    api_key: str = None,
) -> dict:
    provider = (provider or LLM_PROVIDER).lower()
    if provider == "openai":
        return _call_openai(control_text, evidence_text, endpoint_url, model_name, api_key)
    return _call_ollama(control_text, evidence_text, endpoint_url, model_name)


def _call_ollama(
    control_text: str,
    evidence_text: str,
    endpoint_url: str = None,
    model_name: str = None,
) -> dict:
    url = endpoint_url or OLLAMA_URL
    truncated_evidence = _truncate(evidence_text, MAX_TOKENS)
    payload = build_full_payload(control_text, truncated_evidence)
    payload["model"] = model_name or MODEL_NAME

    for attempt in range(2):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        raw = _do_request(req)
        if raw is None:
            raise
        logger.info(f"LLM raw response ({len(raw)} chars)")

        result = _parse_response(raw)

        if result["status"] != "INCONCLUSIVE" or attempt == 1:
            result["_raw"] = raw
            result["_raw_prompt"] = json.dumps(payload, indent=2)
            return result

        logger.info("Retrying LLM call with stricter format instruction")
        payload["options"]["temperature"] = 0.0
        payload["prompt"] += "\n\nIMPORTANT: Return ONLY valid JSON. No explanations, no markdown."

    result["_raw"] = raw
    result["_raw_prompt"] = json.dumps(payload, indent=2)
    return result


def _call_openai(
    control_text: str,
    evidence_text: str,
    endpoint_url: str = None,
    model_name: str = None,
    api_key: str = None,
) -> dict:
    url = endpoint_url or OLLAMA_URL
    truncated_evidence = _truncate(evidence_text, MAX_TOKENS)
    payload = build_openai_payload(control_text, truncated_evidence)
    payload["model"] = model_name or MODEL_NAME

    headers = {"Content-Type": "application/json"}
    key = api_key or API_KEY
    if key:
        headers["Authorization"] = f"Bearer {key}"

    for attempt in range(2):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        raw = _do_request(req)
        if raw is None:
            raise
        logger.info(f"LLM raw response ({len(raw)} chars)")

        try:
            resp_json = json.loads(raw)
            content = resp_json["choices"][0]["message"]["content"]
        except (KeyError, IndexError, json.JSONDecodeError) as e:
            logger.warning(f"Failed to parse OpenAI response: {e}", exc_info=True)
            content = raw

        result = _parse_response(content)

        if result["status"] != "INCONCLUSIVE" or attempt == 1:
            result["_raw"] = content
            result["_raw_prompt"] = json.dumps(payload, indent=2)
            return result

        logger.info("Retrying LLM call with stricter format instruction")
        payload["temperature"] = 0.0
        payload["messages"].append({
            "role": "user",
            "content": "IMPORTANT: Return ONLY valid JSON. No explanations, no markdown.",
        })

    result["_raw"] = content
    result["_raw_prompt"] = json.dumps(payload, indent=2)
    return result


def _do_request(req: urllib.request.Request) -> str | None:
    try:
        resp = urllib.request.urlopen(req, timeout=LLM_TIMEOUT)
        return resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        logger.error(f"LLM HTTP error: {e.code} {e.reason}", exc_info=True)
        return None
    except urllib.error.URLError as e:
        logger.error(f"LLM connection error: {e.reason}", exc_info=True)
        return None


def _parse_response(raw: str) -> dict:
    try:
        resp_json = json.loads(raw)
        response_text = resp_json.get("response", raw)
    except json.JSONDecodeError:
        response_text = raw

    cleaned = response_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].strip()
    if cleaned.startswith("{"):
        closing = cleaned.rfind("}")
        if closing != -1:
            cleaned = cleaned[: closing + 1]

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return _fallback()

    try:
        validated = LLMOutput(**parsed)
        return validated.model_dump()
    except ValidationError:
        status = parsed.get("status", "INCONCLUSIVE")
        if status not in ("COMPLIANT", "NON-COMPLIANT", "INCONCLUSIVE"):
            status = "INCONCLUSIVE"
        return {
            "status": status,
            "confidence_score": parsed.get("confidence_score", 0),
            "findings": parsed.get("findings", []),
            "gaps_identified": parsed.get("gaps_identified", []),
        }


def _fallback() -> dict:
    return {
        "status": "INCONCLUSIVE",
        "confidence_score": 0,
        "findings": [],
        "gaps_identified": ["Could not parse LLM response as JSON"],
    }
