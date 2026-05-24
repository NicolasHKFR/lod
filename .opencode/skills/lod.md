# LOD1 Control Evidence Validator

Internal web tool that validates LOD1 (Line of Defense 1) Technology Risk Management controls using a local LLM (Ollama) or any OpenAI-compatible API (Forge, LiteLLM, etc.). Users upload control descriptions + evidence files; the LLM assesses compliance with a structured JSON verdict.

---

## Quick Start

```powershell
install.bat        # One-time: venv + deps + optional Tesseract
start.bat          # Launch: uvicorn backend.app:app at http://127.0.0.1:8000
# OR
docker compose up -d
```

**Run tests:** `pytest backend\tests -v`  
**Run specific:** `pytest backend\tests\test_ollama_client.py -v`

---

## Key Files

| File | Purpose |
|---|---|
| `backend/app.py` | FastAPI entry: lifespan (DB init), request middleware (correlation IDs + timing), static mount, SPA at `/` |
| `backend/config.py` | Env-var config: `OLLAMA_URL`, `MODEL_NAME`, `LLM_TIMEOUT`, `MAX_TOKENS`, `LLM_PROVIDER`, `API_KEY`, etc. |
| `backend/logger.py` | Rotating file handler (10 MB × 5) + stderr. ContextVar-based correlation IDs. `LOG_LEVEL` env var. |
| `backend/api/routes.py` | All 23+ route handlers (analyze, chat, config, health, history, logs, etc.) |
| `backend/engine/ollama_client.py` | `call_llm()` dispatches to `_call_ollama()` or `_call_openai()` based on `provider` kwarg |
| `backend/engine/prompt_builder.py` | System prompt v2.0 (COMPLIANT-biased). `build_openai_messages()` for Chat Completions format. |
| `backend/database/models.py` | SQLAlchemy: `Submission`, `Override`, `StoredEvidence` (dead code) |
| `backend/database/crud.py` | Lazy engine + session. `save_submission`, `get_submission`, `get_all_submissions`, `save_override`, `delete_all_data` |
| `backend/ingestion/extractor.py` | Magic-byte detection, PyMuPDF for PDFs, Tesseract OCR for images |
| `frontend/templates/index.html` | Single-page UI: 7 pages (Analyze, Dashboard, History, Logs, Reports, Chat, Config) + Help + Debug panel |
| `frontend/static/js/app.js` | SPA router, SSE streaming, debug inspector, keyboard shortcuts, dark mode, charts |
| `frontend/static/css/style.css` | All styles including dark mode (`html.dark`) |

---

## Provider Architecture

**Ollama (default):**
- URL: `http://localhost:11434/api/generate`
- Payload: `{model, system, prompt, format: "json", stream: false, options: {temperature, top_p}}`
- Response: `{"response": "..."}` → extracts `response` field, parses JSON

**OpenAI-Compatible (Forge, LiteLLM, etc.):**
- URL: Any `/v1/chat/completions` endpoint
- Payload: `{model, messages: [{role: "system", ...}, {role: "user", ...}], response_format: {type: "json_object"}, temperature, top_p}`
- Auth: `Authorization: Bearer <api_key>` header
- Response: `{"choices": [{"message": {"content": "..."}}]}` → extracts `choices[0].message.content`

**Config:** Set via Config page in UI or `LLM_PROVIDER` env var (`ollama` / `openai`). API key stored in `API_KEY` env var.

**Model detection:** `GET /api/models?provider=ollama|openai&url=...` — hits `/api/tags` or `/v1/models`.

---

## Logging System

- **File:** `backend/logs/app.log` (rotating: 10 MB × 5 backups)
- **Format:** `2025-01-15 10:30:00 [INFO   ] [abc123def456] backend.api.routes: message`
- **Correlation ID:** Per-request 12-char hex set via middleware, propagated to thread pool via `contextvars.copy_context().run()`
- **Level:** `LOG_LEVEL` env var (default `INFO`). Set to `DEBUG` for verbose output.
- **Middleware:** Logs every request at DEBUG (entry) and INFO (exit with status + duration ms)
- **UI:** Logs page has Audit Trail tab (submissions/overrides) and System Logs tab (tails `app.log` with level/search filters)

---

## Important Gotchas

1. **Evidence vs Control confusion** — The most common user mistake. Uploading evidence into the "Control file" field replaces the typed description, producing NON-COMPLIANT because the LLM sees zero evidence.
2. **Evidence truncation matches DB** — When evidence exceeds `MAX_TOKENS`, it's truncated (first 60% + last 30%). The truncated text is stored in DB so the audit trail matches what the LLM saw.
3. **LLM retry logic** — If JSON parsing fails on first attempt, retries with `temperature=0.0` and stricter instruction. If both fail, result is `INCONCLUSIVE`.
4. **Injection protection** — `</` is escaped to `<\/` in user input to prevent XML-tag injection into the system prompt.
5. **Single-page frontend** — No framework or build step. All HTML in `index.html`, CSS in `style.css`, JS in `app.js`. Changes go directly into those files.
6. **No authentication** — Internal tool only. No login, no CSRF. Data never leaves the machine (unless a remote API endpoint is configured).
7. **Clear DB requires typing "DELETE"** — Config page Danger Zone has a two-step confirmation. No accidental data loss.
8. **Context propagation** — `_process_control` runs in `run_in_executor` thread pool. Correlation IDs must be propagated via `contextvars.copy_context().run()` — all 3 call sites do this.
9. **`python_multipart` warning** — "Skipping data after last boundary" is benign, from browser trailing form data.
10. **`__del__` is NOT used** — Never use `__del__` for cleanup; use `finally` blocks or context managers.

---

## Common Debugging Steps

1. Check `backend/logs/app.log` for errors and correlation IDs
2. Check `GET /api/health` — verifies DB, OCR, LLM reachability
3. Check `GET /api/models?provider=ollama` — verifies models are detected
4. Verify Ollama is running: `ollama list` or check `http://localhost:11434/api/tags`
5. For remote API issues, check the endpoint URL and API key in Config page
6. Set `LOG_LEVEL=DEBUG` before starting for verbose request traces
7. First analysis after startup is slow (~2s) due to cold Python imports
