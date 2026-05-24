# LOD1 Control Evidence Validator

Automates the validation of Line of Defense 1 (LOD1) Technology Risk Management controls by comparing evidence documents against control descriptions using a local LLM (Ollama).

---

## Quick Start

### Prerequisites

- **Python 3.10+** — [python.org](https://python.org)
- **Ollama** — [ollama.com](https://ollama.com) with a model pulled (e.g. `ollama pull llama3:8b`)

### Option A: Windows Installer (Recommended)

```bat
install.bat
```

Run **as Administrator** for full setup (shortcuts, Tesseract OCR install).  
Follow the prompts — it will create a virtual environment, install dependencies, optionally install Tesseract OCR, and create shortcuts.

Then:

```bat
start.bat
```

Open **http://127.0.0.1:8000**

### Option B: Docker

```bash
docker compose up -d
```

Open **http://127.0.0.1:8000**

### Option C: Manual

```bat
python -m venv venv
venv\Scripts\activate
pip install -r backend\requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**

---

## User Guide

### Analyze Page

The main page for running assessments. Two inputs are required:

#### 1. Control Description

The **control criteria** — the rule or requirement the LLM should evaluate against.

| Method | How |
|---|---|
| Type directly | Paste into the text area |
| Upload file | Use the "Control file" upload (.txt, .md, .pdf) |
| Load template | Select a saved template from the dropdown above the textarea |

> ⚠️ **Important:** This is the **control criteria document**, not your evidence.  
> If you upload a document here, its text becomes the control description.

#### 2. Evidence Files

The **files to evaluate** — logs, screenshots, approvals, etc.

- Drag & drop files into the evidence zone, or click to browse
- A **"REQUIRED"** badge indicates these are mandatory
- A warning appears if you try to submit without evidence files
- Supported formats: `.pdf` `.png` `.jpg` `.csv` `.txt` `.log`
- File names are editable inline — click the label to rename
- Click **Preview** on any file to see its text or image thumbnail

#### Token Counter

Below the control textarea, a dynamic **estimated token count** updates on every keystroke. It turns red if the estimate exceeds 6000 tokens.

#### Understanding the two upload areas

| Area | Purpose | What happens |
|---|---|---|
| **Control file** (below textarea) | Upload the **control criteria** as a file | Replaces the typed text |
| **Evidence drop zone** (bottom) | Upload the **evidence to evaluate** | Sent to the LLM for assessment |

If you accidentally upload your document as a "Control file", the LLM will see your document as the criteria and receive **no evidence** — producing NON-COMPLIANT every time.

#### Connection Mode

- **Local Ollama** — uses Ollama running on your machine (default, recommended). Model dropdown auto-populates from running Ollama instance.
- **Remote API** — uses a custom endpoint from the endpoints list (configured on the Configuration page).

#### Batch Mode

Check **"Batch mode"** to evaluate multiple controls at once.  
Separate each control with `---` on its own line. Progress streams per-control.

#### Multi-Model Comparison

Check **"Compare models"** to run the same control + evidence against multiple Ollama models. Results are shown in a side-by-side table with status, confidence, and summary per model. Models run sequentially to avoid overwhelming Ollama.

#### Running the Assessment

Click **"Analyze Evidence"**. Progress is shown in real-time:

1. **Extracting** — text is extracted from uploaded files (in parallel)
2. **Analyzing** — the LLM processes the control + evidence
3. **Result** — the assessment card appears

A **Cancel** button appears during analysis to abort in-flight requests.

### Results Page

After analysis, the result card shows:

- **Status Badge** — COMPLIANT (green) / NON-COMPLIANT (red) / INCONCLUSIVE (yellow)
- **Confidence Score** — 0-100%
- **Executive Summary** — 1-2 sentence LLM summary
- **Extraction Warnings** — yellow box if any files failed to extract
- **Findings** — evidence points supporting the conclusion (collapsible with count)
- **Gap Analysis** — missing or insufficient elements (collapsible with count)
- **Override** — manually change the status (recorded in audit trail)
- **Export** — Download CSV, Download HTML Report, or Print
- **Chat about this case** — opens the Chat page with the current case context pre-loaded

### Debug Inspector Panel

Click **"🔍 Debug"** in the sidebar to open the right-side inspector panel.  
Auto-opens after each analysis. Contains:

| Section | Content |
|---|---|
| **Raw Server Response** | Full JSON object from the backend |
| **Prompt Sent to LLM** | Complete system + user prompt payload (expandable) |
| **Raw LLM Response** | Raw JSON returned by the LLM (expandable) |
| **Extracted Evidence** | Evidence text parsed from the prompt |
| **Control Description** | Control text parsed from the prompt |

The first two sections are open by default. Use this to troubleshoot what was actually sent to and received from the LLM.

You can also populate the Debug Inspector from **History** or **Logs** by clicking **"Inspect in Debug Panel"** on any submission.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Submit the form (Analyze page) |
| `Esc` | Close debug panel or detail overlay |

### Help & Smart Help

Click **"❓ Help"** in the sidebar to view the full user manual rendered in-app.  
Click **"🤖 Smart Help"** to open the Chat page with the user manual loaded as context — ask questions interactively.

### Dark Mode

Toggle dark/light theme from the bottom of the sidebar. Preference is persisted in localStorage.

### Dashboard Page

Compliance analytics overview:
- **6 stat cards** — Total Submissions, Compliant, Non-Compliant, Inconclusive, Average Confidence, Compliance Rate
- **Compliance Trend** — 14-day bar chart of daily compliance percentage
- **Status Distribution** — SVG donut chart with legend (green/red/yellow segments)
- **Top Non-Compliant Controls** — table of up to 10 worst-performing controls sorted by confidence (ascending)

### History Page

Browse past assessments with search, status filter, and date range.  
Click any row for full details including the raw LLM response, export buttons, and **"Inspect in Debug Panel"** and **"Chat about this case"** buttons.

### Reports Page

Generate consolidated HTML reports from multiple submissions:
- **Select-all** checkbox and selected count display
- Click **"Generate Consolidated Report"** to produce an HTML document with:
  - Aggregate stats (total, compliant/non-compliant/inconclusive counts, average confidence)
  - Per-submission breakdown table (ID, control, status, confidence, summary, findings, gaps)

### Chat Page

Direct chat with available Ollama models:
- **Model selector** dropdown populated live from running Ollama
- **Scrollable message history** with user/assistant/system message styles
- **Textarea input** + Send button (`Ctrl+Enter` also sends)
- **SSE streaming** — response text appears incrementally
- **Clear** button to reset conversation

**Chat about a case:** From result cards and History detail overlays, click **"Chat about this case"** to pre-load the case context (control description, evidence, previous assessment) as the system prompt. The context persists until you click Clear.

### Configuration Page

| Field | Default | Description |
|---|---|---|
| Model Name | `llama3:8b-instruct-q8_0` | LLM model to use |
| LLM Timeout | 60 seconds | Max wait for LLM response |
| Max Tokens | 6000 | Token limit for evidence text |
| Endpoints | `localhost:11434` | Custom API endpoint URLs (add/remove rows) |

**Danger Zone:** At the bottom of the page, a red-bordered card allows clearing all data. Type "DELETE" to enable the button, then click to empty the submissions and overrides tables. This is irreversible.

### Help Page

Shows the full user manual (this document) rendered in-app. Click **"❓ Help"** in the sidebar to open it. Markdown is rendered with headings, code blocks, tables, lists, and links.

### Smart Help

Click **"🤖 Smart Help"** in the sidebar to start an interactive chat with the LLM using the user manual as context. Ask questions like "How do I reset the database?" or "What file formats are supported?" and the LLM will answer based on the manual content. Uses the same model selected on the Chat page.

---

## Troubleshooting

### "Always getting NON-COMPLIANT"

The most likely cause: **you uploaded your document as a Control file instead of as Evidence**.

Check the **Debug Inspector** panel after running an analysis:
- If **"Extracted Evidence"** shows "No evidence provided." or "[Empty content]", the LLM received no evidence → upload your files to the **Evidence drop zone** (the large dashed area at the bottom), not the Control file upload.

### Extraction Warnings

A yellow warning box in the results means some files couldn't be read:
- **"[Empty content]"** — file was uploaded but no text could be extracted
- **"[Could not extract text]"** — extraction raised an error

**For PDFs:** PyMuPDF extracts text layers automatically. If the PDF is scanned (image-only), Tesseract OCR is required.  
**For images:** Tesseract OCR is required. Install it via `install.bat` or manually from [UB-Mannheim/tesseract](https://github.com/UB-Mannheim/tesseract/releases).  
**For text files:** Ensure the file is UTF-8 encoded.

### Debug Inspector shows "(not available)" for Prompt

This means the LLM analysis didn't complete successfully. Check the progress bar for error messages and verify Ollama is running (`ollama list` in a terminal).

### Health Status in Sidebar

The bottom of the sidebar shows system health:
- **"All systems OK"** — LLM, OCR, and PDF extraction are all available
- **"Missing: OCR"** — Tesseract is not installed (image/PDF OCR won't work)
- **"Missing: LLM"** — Ollama is not running
- **"Server Unreachable"** — the backend is not running

---

## Deployment Options

### Windows (install.bat)

The `install.bat` script handles everything:

```
install.bat                     # Install
install.bat /uninstall          # Uninstall
```

What it does:
- Checks Python 3.10+ is installed
- Creates a virtual environment (`venv\`)
- Installs all Python dependencies
- Optionally downloads and installs Tesseract OCR (silent install)
- Initializes the SQLite database
- Creates Start Menu and Desktop shortcuts (admin only)

### Docker

```bash
docker compose up -d
```

Starts both the app (port 8000) and Ollama (port 11434).  
The app auto-connects to Ollama via the internal Docker network.

---

## Project Structure

```
lod/
├── spec.txt                        # Full specification document
├── README.md                       # This file
├── endpoints.txt                   # User-editable API endpoint list
├── start.bat                       # Windows launcher
├── install.bat                     # Windows installer/uninstaller
├── Dockerfile                      # Container build
├── docker-compose.yml              # App + Ollama orchestration
├── .github/workflows/ci.yml       # CI pipeline (lint, test, build)
├── backend/
│   ├── app.py                      # FastAPI entry point (lifespan pattern)
│   ├── config.py                   # Environment-based configuration
│   ├── requirements.txt            # Python dependencies
│   ├── requirements-dev.txt        # Test dependencies (pytest, pytest-cov)
│   ├── alembic.ini                 # Alembic migration config
│   ├── alembic/
│   │   ├── env.py                  # Alembic environment
│   │   ├── script.py.mako          # Migration template
│   │   └── versions/
│   │       └── 0001_initial.py     # Initial schema
│   ├── lod_audit.db               # SQLite database (auto-created)
│   ├── uploads/                    # Temporary file uploads
│   ├── database/
│   │   ├── models.py               # SQLAlchemy: Submission, Override
│   │   └── crud.py                 # Database operations
│   ├── ingestion/
│   │   └── extractor.py            # File text extraction + magic-byte detection
│   ├── engine/
│   │   ├── prompt_builder.py       # System prompt + prompt construction
│   │   └── ollama_client.py        # LLM client + retry + response parsing
│   ├── api/
│   │   ├── schemas.py              # Pydantic request/response models
│   │   └── routes.py               # All API endpoints
│   └── tests/
│       ├── conftest.py             # Fixtures (temporary SQLite DB)
│       ├── test_ollama_client.py   # Unit tests for LLM client
│       ├── test_prompt_builder.py  # Unit tests for prompt builder
│       ├── test_crud.py            # Unit tests for database operations
│       └── test_routes.py          # Integration tests for API routes
└── frontend/
    ├── templates/
    │   └── index.html              # Full single-page UI (9 pages + debug panel)
    └── static/
        ├── css/style.css           # All styles (layout, dark mode, dashboard, etc.)
        └── js/app.js               # SPA router + all page logic
```

---

## FAQ

**Q: Why do I always get NON-COMPLIANT even for simple checks?**

A: Two possible reasons:
1. **Wrong upload area** — you may be putting evidence in the "Control file" upload instead of the "Evidence" drop zone. The LLM then sees no evidence and marks it as non-compliant.
2. **The prompt was previously biased** — earlier versions used "Technology Risk Management Auditor" language that defaulted to fault-finding. This has been fixed in the current version (v2.0). Run `pip install -r backend/requirements.txt` to update.

**Q: What file formats are supported?**

A: `.txt` `.md` `.pdf` `.csv` `.log` `.png` `.jpg` `.jpeg`

**Q: Do I need Tesseract OCR?**

A: Only for images (.png, .jpg) and scanned PDFs (no text layer). For regular text files and text-based PDFs, Tesseract is not required.

**Q: Does any data leave my machine?**

A: No. All processing is local. The LLM runs via Ollama on your machine. No data is sent to external services.

**Q: How do I change the LLM model?**

A: Go to the Configuration page and change the "Model Name" field, or set the `MODEL_NAME` environment variable.

**Q: The health indicator says "Missing: OCR"**

A: Tesseract OCR is not installed. Run `install.bat` as Administrator and answer "Y" when asked about installing Tesseract, or download it manually from [UB-Mannheim/tesseract](https://github.com/UB-Mannheim/tesseract/releases).

**Q: How do I reset the database?**

A: Go to the Configuration page, scroll to the **Danger Zone** at the bottom, type "DELETE" in the confirmation field, and click "Clear All Data". Alternatively, delete `backend/lod_audit.db` — it will be recreated automatically on the next startup.

**Q: Can I use a remote LLM API instead of local Ollama?**

A: Yes. On the Analyze page, select "Remote API" mode and choose an endpoint from the dropdown. Endpoints are configured on the Configuration page or in `endpoints.txt`.

**Q: How do I create a consolidated report?**

A: Go to the Reports page, check the submissions you want to include, and click "Generate Consolidated Report". An HTML document with aggregate stats and per-submission breakdown will download.

**Q: How do I chat about a specific assessment?**

A: Click **"Chat about this case"** on any result card or History detail overlay. The Chat page will open with the case context (control, evidence, previous assessment) pre-loaded as the system prompt.
