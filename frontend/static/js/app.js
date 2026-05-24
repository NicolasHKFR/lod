document.addEventListener("DOMContentLoaded", () => {

  // ========== ROUTER ==========
  const pages = document.querySelectorAll(".page");
  const navLinks = document.querySelectorAll(".sidebar-nav a");

  function navigateTo(pageId) {
    pages.forEach(p => p.classList.remove("active"));
    navLinks.forEach(l => l.classList.remove("active"));
    document.querySelectorAll(".sidebar-link").forEach(l => l.classList.remove("active"));
    const page = document.getElementById("page-" + pageId);
    if (page) page.classList.add("active");
    const link = document.querySelector(`.sidebar-nav a[data-page="${pageId}"]`);
    if (link) link.classList.add("active");
    const sideLink = document.querySelector(`.sidebar-link[data-page="${pageId}"]`);
    if (sideLink) sideLink.classList.add("active");
    if (pageId === "history") loadHistoryPage();
    if (pageId === "logs") { loadLogsPage(); loadSystemLogsPage(); }
    if (pageId === "config") loadConfigPage();
    if (pageId === "chat") loadChatPage();
    if (pageId === "dashboard") loadDashboardPage();
    if (pageId === "reports") loadReportsPage();
    if (pageId === "help") loadHelpPage();
  }

  function handleRoute() {
    const hash = window.location.hash.replace("#", "") || "analyze";
    navigateTo(hash);
  }

  navLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      window.location.hash = page;
    });
  });

  document.querySelectorAll(".sidebar-link").forEach(el => {
    el.addEventListener("click", () => {
      const page = el.dataset.page;
      if (page) window.location.hash = page;
    });
  });

  document.getElementById("smart-help-btn").addEventListener("click", async () => {
    try {
      const res = await fetch("/api/readme");
      const data = await res.json();
      chatCaseContext = {
        id: 0,
        control_text: "",
        evidence_text: "",
        status: "",
        confidence_score: 0,
        summary: "",
        readme_context: data.content || "",
      };
      window.location.hash = "chat";
    } catch {
      chatCaseContext = null;
      window.location.hash = "chat";
    }
  });

  window.addEventListener("hashchange", handleRoute);

  // ========== HEALTH ==========
  async function checkHealth() {
    const dot = document.getElementById("health-dot");
    const label = document.getElementById("health-label");
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      const issues = [];
      if (data.llm_connected) dot.className = "health-dot ok";
      else { dot.className = "health-dot degraded"; issues.push("LLM"); }
      if (data.ocr_available === false) issues.push("OCR");
      if (data.pdf_extraction === false) issues.push("PDF");
      if (issues.length) {
        label.textContent = "Missing: " + issues.join(", ");
        dot.title = "Issues: " + issues.join(", ");
      } else {
        label.textContent = "All systems OK";
        dot.title = "LLM, OCR, PDF all available";
      }
    } catch {
      dot.className = "health-dot error";
      label.textContent = "Server Unreachable";
    }
  }

  // ========== ANALYZE PAGE ==========
  const form = document.getElementById("analyze-form");
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("evidence-files");
  const fileList = document.getElementById("file-list");
  const progressContainer = document.getElementById("progress-container");
  const progressFill = document.getElementById("progress-fill");
  const progressStep = document.getElementById("progress-step");
  const resultDiv = document.getElementById("result");
  const errorMsg = document.getElementById("error-msg");
  const endpointSelect = document.getElementById("endpoint-select");
  const batchToggle = document.getElementById("batch-toggle");
  const controlsText = document.getElementById("control-text");
  const controlsLabel = document.getElementById("controls-label");
  const analyzeBtn = document.getElementById("analyze-btn");
  const batchSection = document.getElementById("batch-results");

  let uploadedFiles = [];
  let uploadedFileTexts = [];
  let lastResultData = null;
  let currentDebugData = null;
  let abortController = null;
  let chatCaseContext = null;
  const controlFileInput = document.getElementById("control-file");
  const controlFilePreview = document.getElementById("control-file-preview");
  const connRadios = document.querySelectorAll('input[name="conn-mode"]');
  const ollamaSettings = document.getElementById("ollama-settings");
  const apiSettings = document.getElementById("api-settings");
  const ollamaModel = document.getElementById("ollama-model");

  async function loadEndpoints(selectEl) {
    try {
      const res = await fetch("/api/endpoints");
      if (!res.ok) return;
      const data = await res.json();
      selectEl.innerHTML = data.endpoints
        .map(ep => `<option value="${escapeHtml(ep)}">${escapeHtml(ep)}</option>`)
        .join("");
    } catch {}
  }
  loadEndpoints(endpointSelect);

  // Connection mode toggle
  async function fetchOllamaModels(providerHint) {
    const isOllama = providerHint === "ollama" || document.querySelector('input[name="conn-mode"]:checked')?.value === "ollama";
    const dot = document.getElementById("ollama-status");
    const select = ollamaModel;
    select.innerHTML = '<option value="">Detecting...</option>';
    dot.className = "health-dot";
    dot.title = "Checking...";
    try {
      let url;
      if (isOllama) {
        url = "/api/models?provider=ollama";
      } else {
        const ep = document.getElementById("endpoint-select")?.value || "";
        const baseUrl = ep.replace(/\/v1\/chat\/completions$/, "/v1/models").replace(/\/api\/generate$/, "/api/tags");
        url = "/api/models?provider=openai&url=" + encodeURIComponent(baseUrl);
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.connected && data.models.length) {
        select.innerHTML = data.models
          .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
          .join("");
        dot.className = "health-dot ok";
        dot.title = isOllama ? "Ollama running" : "Endpoint connected";
      } else {
        select.innerHTML = '<option value="">No models found</option>';
        dot.className = "health-dot error";
        dot.title = data.error || "No models available";
      }
    } catch {
      select.innerHTML = '<option value="">Could not reach endpoint</option>';
      dot.className = "health-dot error";
      dot.title = "Not reachable";
    }
  }

  // ========== DEBUG PANEL ==========
  const debugPanel = document.getElementById("debug-panel");
  const debugToggle = document.getElementById("debug-toggle");
  const debugClose = document.getElementById("debug-close");

  debugToggle.addEventListener("click", () => {
    debugPanel.classList.toggle("active");
    debugToggle.classList.toggle("active");
    if (currentDebugData && debugPanel.classList.contains("active")) {
      populateDebugPanel(currentDebugData);
    }
  });

  debugClose.addEventListener("click", () => {
    debugPanel.classList.remove("active");
    debugToggle.classList.remove("active");
  });

  document.querySelectorAll(".debug-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const body = btn.nextElementSibling;
      btn.classList.toggle("open");
      body.classList.toggle("open");
    });
  });

  function populateDebugPanel(data) {
    const statusEl = document.getElementById("debug-raw-status");
    const rawDataEl = document.getElementById("debug-raw-data");
    const promptEl = document.getElementById("debug-prompt");
    const responseEl = document.getElementById("debug-response");
    const evidenceEl = document.getElementById("debug-evidence");
    const controlEl = document.getElementById("debug-control");
    const badge = document.getElementById("debug-badge");

    currentDebugData = data;

    try {
      const keys = data ? Object.keys(data).join(", ") : "null";
      const hasPrompt = data && typeof data.raw_prompt === "string";
      const hasResp = data && typeof data.raw_llm_response === "string";
      statusEl.textContent = "Fields: " + keys + " | raw_prompt: " + hasPrompt + " | raw_llm_response: " + hasResp;
      safeSet(rawDataEl, JSON.stringify(data, null, 2));
    } catch (e) {
      statusEl.textContent = "Status error: " + e.message;
    }

    if (!data) {
      safeSet(promptEl, "(no data object)");
      safeSet(responseEl, "(no data object)");
      safeSet(evidenceEl, "(no data object)");
      safeSet(controlEl, "(no data object)");
      return;
    }

    try {
      if (data.raw_prompt) {
        try {
          const parsed = JSON.parse(data.raw_prompt);
          safeSet(promptEl, JSON.stringify(parsed, null, 2));
          const userPrompt = parsed.prompt || "";
          const ctrlMatch = userPrompt.match(/<CONTROL_DESCRIPTION>([\s\S]*?)<\/CONTROL_DESCRIPTION>/);
          const evMatch = userPrompt.match(/<EVIDENCE>([\s\S]*?)<\/EVIDENCE>/);
          safeSet(controlEl, ctrlMatch ? ctrlMatch[1].trim() : "(not found in prompt)");
          safeSet(evidenceEl, evMatch ? evMatch[1].trim() : "(not found in prompt)");
        } catch (e) {
          safeSet(promptEl, data.raw_prompt);
          safeSet(controlEl, data.control_text || "(not available)");
          safeSet(evidenceEl, data.evidence_text || "(not available)");
        }
      } else {
        safeSet(promptEl, "(not available)");
        safeSet(controlEl, data.control_text || "(not available)");
        safeSet(evidenceEl, data.evidence_text || "(not available)");
      }
      safeSet(responseEl, data.raw_llm_response || "(not available)");
    } catch (e) {
      statusEl.textContent += " | populate error: " + e.message;
    }

    if (badge) badge.style.display = "inline-flex";
  }

  function safeSet(el, val) {
    if (el) el.textContent = val;
  }

  function openDebugPanel() {
    debugPanel.classList.add("active");
    debugToggle.classList.add("active");
  }

  connRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      const isOllama = document.querySelector('input[name="conn-mode"]:checked').value === "ollama";
      ollamaSettings.style.display = isOllama ? "block" : "none";
      apiSettings.style.display = isOllama ? "none" : "block";
      if (isOllama) fetchOllamaModels();
    });
  });
  fetchOllamaModels();

  batchToggle.addEventListener("change", () => {
    if (batchToggle.checked) {
      controlsLabel.textContent = "Controls (separate each with ---)";
      controlsText.placeholder = "Paste multiple LOD1 controls separated by three dashes ---\n\nControl 1 description...\n---\nControl 2 description...";
      analyzeBtn.textContent = "Analyze Batch";
    } else {
      controlsLabel.textContent = "Control Description";
      controlsText.placeholder = "Paste the LOD1 control description and criteria here...";
      analyzeBtn.textContent = "Analyze Evidence";
    }
  });

  controlFileInput.addEventListener("change", async () => {
    const file = controlFileInput.files[0];
    if (!file) { controlFilePreview.classList.remove("active"); controlFilePreview.textContent = ""; return; }
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "pdf") {
      controlFilePreview.textContent = `PDF: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      controlFilePreview.classList.add("active");
      return;
    }
    try {
      const text = await file.text();
      const preview = text.substring(0, 500) + (text.length > 500 ? "..." : "");
      controlFilePreview.innerHTML = `<strong>${escapeHtml(file.name)}</strong> (${(file.size / 1024).toFixed(1)} KB)\n${escapeHtml(preview)}`;
      controlFilePreview.classList.add("active");
    } catch {
      controlFilePreview.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB) — preview unavailable`;
      controlFilePreview.classList.add("active");
    }
  });

  const evidenceWarning = document.getElementById("evidence-warning");
  function updateEvidenceWarning() {
    if (uploadedFiles.length === 0) {
      evidenceWarning.style.display = "flex";
    } else {
      evidenceWarning.style.display = "none";
    }
  }

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    addFiles(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener("change", () => addFiles(Array.from(fileInput.files)));

  function addFiles(files) {
    uploadedFiles = uploadedFiles.concat(files);
    uploadedFileTexts = uploadedFileTexts.concat(files.map(() => null));
    renderFileList();
    updateEvidenceWarning();
  }

  async function loadFilePreview(file, index) {
    const ext = file.name.split(".").pop().toLowerCase();
    if ([ "png", "jpg", "jpeg" ].includes(ext)) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve(`<img src="${e.target.result}" style="max-width:100%;max-height:200px;border-radius:4px;" alt="${file.name}">`);
        };
        reader.onerror = () => resolve("[Image preview unavailable]");
        reader.readAsDataURL(file);
      });
    }
    if (ext === "pdf") return `[PDF: ${file.name} (${(file.size / 1024).toFixed(1)} KB)]`;
    try {
      const text = await file.text();
      return text.substring(0, 300) + (text.length > 300 ? "..." : "");
    } catch {
      return "[Preview unavailable]";
    }
  }

  function renderFileList() {
    if (uploadedFiles.length === 0) {
      fileList.innerHTML = "";
      dropZone.classList.remove("has-files");
      updateEvidenceWarning();
      return;
    }
    dropZone.classList.add("has-files");
    fileList.innerHTML = uploadedFiles.map((f, i) =>
      `<div class="file-item" data-index="${i}">
        <input type="text" class="file-label-input" value="${escapeHtml(f.name)}" data-index="${i}" title="Edit file label">
        <span class="file-meta">(${(f.size / 1024).toFixed(1)} KB)</span>
        <a href="#" data-index="${i}" class="remove-file" style="color:#ef476f;text-decoration:none;">&times;</a>
        <button type="button" class="file-toggle" data-index="${i}">Preview</button>
        <div class="file-preview" data-index="${i}"></div>
      </div>`
    ).join("");

    document.querySelectorAll(".file-label-input").forEach(inp => {
      inp.addEventListener("change", () => {
        const idx = parseInt(inp.dataset.index);
        if (idx >= 0 && idx < uploadedFiles.length) {
          const oldName = uploadedFiles[idx].name;
          const newName = inp.value.trim() || uploadedFiles[idx].name;
          inp.value = newName;
          Object.defineProperty(uploadedFiles[idx], "label", { value: newName, writable: true });
        }
      });
    });

    document.querySelectorAll(".remove-file").forEach(el => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const idx = parseInt(e.target.dataset.index);
        uploadedFiles.splice(idx, 1);
        uploadedFileTexts.splice(idx, 1);
        renderFileList();
      });
    });

    document.querySelectorAll(".file-toggle").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const idx = parseInt(e.target.dataset.index);
        const previewDiv = document.querySelector(`.file-preview[data-index="${idx}"]`);
        const isOpen = previewDiv.classList.toggle("open");
        e.target.textContent = isOpen ? "Hide" : "Preview";
        if (isOpen && !previewDiv.innerHTML.trim()) {
          previewDiv.innerHTML = "Loading...";
          previewDiv.innerHTML = await loadFilePreview(uploadedFiles[idx], idx);
        }
      });
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMsg.classList.remove("active");
    resultDiv.classList.remove("active");
    batchSection.style.display = "none";

    const controlTextValue = controlsText.value;
    const controlFile = document.getElementById("control-file").files[0];

    if (!controlTextValue.trim() && !controlFile) {
      showError("Provide control description as text or a file.");
      return;
    }

    if (uploadedFiles.length === 0 && !confirm("No evidence files uploaded. The LLM will receive no evidence to evaluate. Continue?")) {
      return;
    }

    const isOllama = document.querySelector('input[name="conn-mode"]:checked').value === "ollama";
    const formData = new FormData();
    if (controlTextValue.trim()) formData.append("control_text", controlTextValue);
    if (controlFile) formData.append("control_file", controlFile);
    uploadedFiles.forEach(f => formData.append("evidence_files", f));
    if (isOllama) {
      formData.append("endpoint_url", "http://localhost:11434/api/generate");
      formData.append("model_name", ollamaModel.value);
      formData.append("provider", "ollama");
    } else {
      formData.append("endpoint_url", endpointSelect.value);
      formData.append("provider", currentConfig?.provider || "ollama");
      if (currentConfig?.api_key && currentConfig.api_key !== "***") {
        formData.append("api_key", currentConfig.api_key);
      }
    }

    analyzeBtn.disabled = true;
    abortController = new AbortController();
    const cancelBtn = document.getElementById("cancel-btn");
    cancelBtn.style.display = "inline-block";

    try {
      if (compareToggle.checked) {
        await submitCompare(formData);
      } else if (batchToggle.checked) {
        await submitBatch(formData);
      } else {
        await submitStream(formData);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        showError("Cancelled by user.");
      } else {
        throw err;
      }
    }

    analyzeBtn.disabled = false;
    cancelBtn.style.display = "none";
    abortController = null;
  });

  document.getElementById("cancel-btn").addEventListener("click", () => {
    if (abortController) {
      abortController.abort();
      progressContainer.classList.remove("active");
    }
  });

  async function submitCompare(formData) {
    const checkedModels = Array.from(compareModels.querySelectorAll("input:checked")).map(c => c.value);
    if (!checkedModels.length) {
      showError("Select at least one model to compare.");
      return;
    }
    progressContainer.classList.add("active");
    progressFill.style.width = "0%";
    setProgress(`Comparing ${checkedModels.length} model(s)...`, 10);

    const results = [];
    for (let i = 0; i < checkedModels.length; i++) {
      if (abortController?.signal.aborted) throw new DOMException("Aborted", "AbortError");
      setProgress(`Analyzing with ${checkedModels[i]} (${i + 1}/${checkedModels.length})...`, Math.round((i / checkedModels.length) * 80) + 10);
      const fd = new FormData(formData);
      fd.set("model_name", checkedModels[i]);
      try {
        const timeoutMs = (parseInt(document.getElementById("cfg-timeout")?.value) || 60) * 1000 + 5000;
        const timeoutId = setTimeout(() => abortController?.abort(), timeoutMs);
        const res = await fetch("/api/analyze", {
          method: "POST", body: fd,
          signal: abortController?.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Model ${checkedModels[i]} failed (${res.status})`);
        const data = await res.json();
        data.model = checkedModels[i];
        results.push(data);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        results.push({ model: checkedModels[i], status: "ERROR", error: err.message });
      }
    }

    if (abortController?.signal.aborted) throw new DOMException("Aborted", "AbortError");
    progressFill.style.width = "100%";
    showCompareResults(results);
    progressContainer.classList.remove("active");
  }

  function showCompareResults(results) {
    resultDiv.classList.add("active");
    document.getElementById("override-section").style.display = "none";
    document.getElementById("export-section").style.display = "none";

    const container = resultDiv.querySelector(".compare-results") || (() => {
      const div = document.createElement("div");
      div.className = "compare-results";
      resultDiv.insertBefore(div, document.getElementById("override-section"));
      return div;
    })();

    container.innerHTML = "<h4 style='margin-bottom:12px;font-size:14px;'>Model Comparison</h4>";
    const table = document.createElement("table");
    table.className = "compare-table";
    table.innerHTML = `
      <thead><tr>
        <th>Model</th>
        <th>Status</th>
        <th>Confidence</th>
        <th>Summary</th>
      </tr></thead>
      <tbody>
        ${results.map(r => {
          const cls = r.status === "ERROR" ? "badge-error" : "badge-" + (r.status || "").toLowerCase();
          return `<tr>
            <td><strong>${escapeHtml(r.model || "?")}</strong></td>
            <td><span class="badge ${cls}" style="font-size:11px;padding:2px 8px;">${r.status === "ERROR" ? "ERROR" : statusIcon(r.status) + " " + r.status}</span></td>
            <td>${r.confidence_score != null ? r.confidence_score + "%" : "-"}</td>
            <td style="font-size:12px;">${r.summary ? escapeHtml(r.summary.substring(0, 120)) : "-"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    `;
    container.appendChild(table);
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitStream(formData) {
    progressContainer.classList.add("active");
    progressFill.style.width = "0%";
    setProgress("Initializing...", 5);

    try {
      const timeoutMs = (parseInt(document.getElementById("cfg-timeout")?.value) || 60) * 1000 + 10000;
      const timeoutId = setTimeout(() => abortController?.abort(), timeoutMs);
      const res = await fetch("/api/analyze/stream", { method: "POST", body: formData, signal: abortController?.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (abortController?.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6));

          if (payload.step === "extracting") {
            setProgress(payload.message, 30);
          } else if (payload.step === "analyzing") {
            setProgress(payload.message, 70);
          } else if (payload.step === "result") {
            progressFill.style.width = "100%";
            showResult(payload.data);
          } else if (payload.step === "error") {
            throw new Error(payload.message);
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      showError(err.message);
    } finally {
      progressContainer.classList.remove("active");
    }
  }

  async function submitBatch(formData) {
    progressContainer.classList.add("active");
    progressFill.style.width = "0%";
    setProgress("Processing batch...", 10);

    try {
      const timeoutMs = (parseInt(document.getElementById("cfg-timeout")?.value) || 60) * 1000 + 10000;
      const timeoutId = setTimeout(() => abortController?.abort(), timeoutMs);
      const res = await fetch("/api/analyze/batch", { method: "POST", body: formData, signal: abortController?.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error (${res.status})`);
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          if (abortController?.signal.aborted) throw new DOMException("Aborted", "AbortError");
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = JSON.parse(line.slice(6));
            if (payload.step === "progress") {
              setProgress(payload.message, payload.percent);
            } else if (payload.step === "result") {
              progressFill.style.width = "100%";
              showBatchResults(payload.data.results);
            } else if (payload.step === "error") {
              throw new Error(payload.message);
            }
          }
        }
      } else {
        const data = await res.json();
        progressFill.style.width = "100%";
        showBatchResults(data.results);
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      showError(err.message);
    } finally {
      progressContainer.classList.remove("active");
    }
  }

  function setProgress(msg, pct) {
    progressFill.style.width = pct + "%";
    progressStep.innerHTML = `<span class="current">${escapeHtml(msg)}</span>`;
  }

  function showResult(data) {
    lastResultData = data;
    populateDebugPanel(data);
    openDebugPanel();
    document.getElementById("result-status").className = `badge badge-${data.status.toLowerCase()}`;
    document.getElementById("result-status").textContent = statusIcon(data.status) + " " + data.status;
    document.getElementById("result-confidence").innerHTML = `Confidence: <strong>${data.confidence_score}%</strong>`;

    const findingsEl = document.getElementById("result-findings");
    const findingsContent = (data.findings && data.findings.length)
      ? data.findings.map(f => `<li>${escapeHtml(f)}</li>`).join("")
      : "<li>No specific findings recorded.</li>";
    findingsEl.innerHTML = findingsContent;
    const findingsToggle = document.getElementById("result-findings-toggle");
    if (findingsToggle) {
      const count = data.findings ? data.findings.length : 0;
      findingsToggle.textContent = `Findings (${count})`;
      findingsToggle.dataset.open = "true";
      document.getElementById("result-findings-content")?.classList.add("open");
    }

    const gapsEl = document.getElementById("result-gaps");
    const gapsContent = (data.gaps_identified && data.gaps_identified.length)
      ? data.gaps_identified.map(g => `<li>${escapeHtml(g)}</li>`).join("")
      : "<li>No gaps identified.</li>";
    gapsEl.innerHTML = gapsContent;
    const gapsToggle = document.getElementById("result-gaps-toggle");
    if (gapsToggle) {
      const count = data.gaps_identified ? data.gaps_identified.length : 0;
      gapsToggle.textContent = `Gap Analysis (${count})`;
      gapsToggle.dataset.open = "true";
      document.getElementById("result-gaps-content")?.classList.add("open");
    }

    const summaryEl = document.getElementById("result-summary");
    if (data.summary) {
      summaryEl.textContent = data.summary;
      summaryEl.style.display = "block";
    } else {
      summaryEl.style.display = "none";
    }

    const warnEl = document.getElementById("result-warnings");
    if (data.warnings && data.warnings.length) {
      warnEl.innerHTML = data.warnings.map(w => '<div class="warning-item">&#x26A0; ' + escapeHtml(w) + '</div>').join("");
      warnEl.style.display = "block";
    } else {
      warnEl.style.display = "none";
    }

    document.getElementById("override-section").style.display = "block";
    document.getElementById("override-btn").dataset.submissionId = data.id;
    document.getElementById("override-status").value = data.status;
    document.getElementById("prompt-version").textContent = data.prompt_version ? `Prompt v${data.prompt_version}` : "";
    document.getElementById("download-csv").dataset.submissionId = data.id;
    document.getElementById("download-html").dataset.submissionId = data.id;
    document.getElementById("chat-about-btn").dataset.submissionId = data.id;
    document.getElementById("print-result").dataset.submissionId = data.id;
    document.getElementById("export-section").style.display = "block";

    resultDiv.classList.add("active");
    resultDiv.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showBatchResults(results) {
    batchSection.style.display = "block";
    const tbody = document.getElementById("batch-body");
    tbody.innerHTML = results.map(r => {
      const cls = "badge-" + r.status.toLowerCase();
      return `<tr>
        <td>${escapeHtml(r.control_preview)}${r.control_preview && r.control_preview.length >= 100 ? "..." : ""}</td>
        <td><span class="badge ${cls}">${r.status}</span></td>
        <td>${r.confidence_score}%</td>
      </tr>`;
    }).join("");
    batchSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.getElementById("ev-toggle").addEventListener("click", (e) => {
    e.preventDefault();
    const content = document.getElementById("ev-content");
    const isOpen = content.classList.toggle("open");
    e.target.textContent = isOpen ? "Hide extracted text" : "Show extracted text";
  });

  // Result section collapsible toggles
  document.querySelectorAll("#result-findings-toggle, #result-gaps-toggle").forEach(toggle => {
    toggle.addEventListener("click", () => {
      const isOpen = toggle.dataset.open !== "false";
      toggle.dataset.open = isOpen ? "false" : "true";
      const contentId = toggle.id.replace("-toggle", "-content");
      const content = document.getElementById(contentId);
      if (content) content.classList.toggle("open");
    });
  });

  document.getElementById("override-btn").addEventListener("click", async () => {
    const btn = document.getElementById("override-btn");
    const id = btn.dataset.submissionId;
    const newStatus = document.getElementById("override-status").value;
    const reason = document.getElementById("override-reason").value;
    const formData = new FormData();
    formData.append("new_status", newStatus);
    formData.append("reason", reason);
    try {
      const res = await fetch(`/api/override/${id}`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Override failed");
      const data = await res.json();
      showResult({ ...data, findings: lastResultData?.findings || [], gaps_identified: lastResultData?.gaps_identified || [] });
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById("print-result").addEventListener("click", () => window.print());

  function showError(msg) {
    document.getElementById("error-msg").textContent = msg;
    document.getElementById("error-msg").classList.add("active");
  }

  // ========== HISTORY PAGE ==========
  const histSearch = document.getElementById("hist-search");
  const histStatus = document.getElementById("hist-status");
  const histDateFrom = document.getElementById("hist-date-from");
  const histDateTo = document.getElementById("hist-date-to");
  const histBody = document.getElementById("hist-body");
  const detailOverlay = document.getElementById("detail-overlay");
  const detailContent = document.getElementById("detail-content");
  const detailClose = document.getElementById("detail-close");

  async function loadHistoryPage() {
    try {
      const params = new URLSearchParams();
      if (histSearch.value.trim()) params.set("search", histSearch.value.trim());
      if (histStatus.value) params.set("status", histStatus.value);
      if (histDateFrom.value) params.set("date_from", histDateFrom.value + "T00:00:00");
      if (histDateTo.value) params.set("date_to", histDateTo.value + "T23:59:59");
      const url = `/api/history${params.toString() ? "?" + params.toString() : ""}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      renderDashboard(data.submissions);
      histBody.innerHTML = data.submissions.map(s => {
        const cls = "badge-" + s.status.toLowerCase();
        return `<tr data-id="${s.id}">
          <td>${s.id}</td>
          <td>${escapeHtml(s.control_text.substring(0, 120))}${s.control_text.length > 120 ? "..." : ""}</td>
          <td><span class="badge ${cls}">${s.status}</span></td>
          <td>${s.confidence_score != null ? s.confidence_score + "%" : "-"}</td>
          <td>${new Date(s.created_at).toLocaleString()}</td>
        </tr>`;
      }).join("");

      histBody.querySelectorAll("tr").forEach(row => {
        row.addEventListener("click", () => showDetail(row.dataset.id));
      });
    } catch {}
  }

  function renderDashboard(submissions) {
    const card = document.getElementById("dashboard-card");
    const grid = document.getElementById("dashboard-grid");
    if (!submissions.length) { card.style.display = "none"; return; }
    card.style.display = "block";

    const total = submissions.length;
    const compliant = submissions.filter(s => s.status === "COMPLIANT").length;
    const nonCompliant = submissions.filter(s => s.status === "NON-COMPLIANT").length;
    const inconclusive = submissions.filter(s => s.status === "INCONCLUSIVE").length;
    const avgConf = submissions.reduce((sum, s) => sum + (s.confidence_score || 0), 0) / total;

    grid.innerHTML = `
      <div class="stat-card"><span class="stat-value" style="color:#06d6a0;">${compliant}</span><span class="stat-label">Compliant</span></div>
      <div class="stat-card"><span class="stat-value" style="color:#ef476f;">${nonCompliant}</span><span class="stat-label">Non-Compliant</span></div>
      <div class="stat-card"><span class="stat-value" style="color:#ffd166;">${inconclusive}</span><span class="stat-label">Inconclusive</span></div>
      <div class="stat-card"><span class="stat-value">${avgConf.toFixed(0)}%</span><span class="stat-label">Avg Confidence</span></div>
      <div class="stat-card bar-chart">
        <div class="bar bar-compliant" style="width:${total ? (compliant / total * 100).toFixed(0) : 0}%;">${compliant}</div>
        <div class="bar bar-noncompliant" style="width:${total ? (nonCompliant / total * 100).toFixed(0) : 0}%;">${nonCompliant}</div>
        <div class="bar bar-inconclusive" style="width:${total ? (inconclusive / total * 100).toFixed(0) : 0}%;">${inconclusive}</div>
      </div>
    `;
  }

  [histSearch, histStatus, histDateFrom, histDateTo].forEach(el => {
    if (el) el.addEventListener("change", loadHistoryPage);
  });
  if (histSearch) histSearch.addEventListener("input", loadHistoryPage);

  async function showDetail(id) {
    try {
      const res = await fetch(`/api/submit/${id}`);
      if (!res.ok) return;
      const s = await res.json();
      const cls = "badge-" + s.status.toLowerCase();
      detailContent.innerHTML = `
        <div class="status-row">
          <span class="badge ${cls}">${statusIcon(s.status)} ${s.status}</span>
          <span class="confidence">Confidence: <strong>${s.confidence_score}%</strong></span>
          <span class="version-badge">${s.prompt_version ? "Prompt v" + s.prompt_version : ""}</span>
        </div>
        <div class="section-title">Control Description</div>
        <p style="font-size:13px;white-space:pre-wrap;">${escapeHtml(s.control_text)}</p>
        <div class="section-title">Evidence Text</div>
        <p style="font-size:13px;white-space:pre-wrap;background:#f8f9fc;padding:8px;border-radius:4px;">${escapeHtml(s.evidence_text || "N/A")}</p>
        ${s.summary ? `<div class="summary-box">${escapeHtml(s.summary)}</div>` : ""}
        <div class="section-title">Findings</div>
        <ul class="findings">${s.findings.length ? s.findings.map(f => "<li>" + escapeHtml(f) + "</li>").join("") : "<li>None</li>"}</ul>
        <div class="section-title">Gap Analysis</div>
        <ul class="gaps">${s.gaps.length ? s.gaps.map(g => "<li>" + escapeHtml(g) + "</li>").join("") : "<li>None</li>"}</ul>
        <div class="section-title">Raw LLM Response</div>
        <div class="raw-response">${escapeHtml(s.raw_llm_response || "N/A")}</div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-secondary debug-inspect" data-entry='${escapeHtml(JSON.stringify(s))}'>Inspect in Debug Panel</button>
          <a href="/api/export/${s.id}?format=csv" class="btn btn-sm btn-secondary" target="_blank">CSV</a>
          <a href="/api/export/${s.id}?format=html" class="btn btn-sm btn-secondary" target="_blank">HTML</a>
          <button class="btn btn-sm btn-secondary" data-chat-id="${s.id}" data-chat-control="${escapeHtml(s.control_text)}" data-chat-evidence="${escapeHtml(s.evidence_text || "")}" data-chat-status="${escapeHtml(s.status)}" data-chat-confidence="${s.confidence_score}" data-chat-summary="${escapeHtml(s.summary || "")}">Chat about this case</button>
          <button class="btn btn-sm btn-secondary" onclick="window.print()">Print</button>
        </div>
      `;
      populateDebugPanel(s);
      openDebugPanel();
      detailOverlay.classList.add("active");
    } catch {}
  }

  detailClose.addEventListener("click", () => detailOverlay.classList.remove("active"));
  detailOverlay.addEventListener("click", (e) => {
    if (e.target === detailOverlay) detailOverlay.classList.remove("active");
  });

  // ========== LOGS PAGE ==========
  async function loadLogsPage() {
    const container = document.getElementById("logs-container");
    try {
      const res = await fetch("/api/logs");
      if (!res.ok) { container.innerHTML = "<p style='color:#ef476f;'>Failed to load logs.</p>"; return; }
      const data = await res.json();
      if (!data.logs.length) { container.innerHTML = "<p style='color:#888;font-size:13px;'>No log entries yet.</p>"; return; }
      container.innerHTML = data.logs.map(entry => {
        if (entry.type === "submission") {
          const cls = "badge-" + entry.status.toLowerCase();
          return `<div class="log-entry" data-type="submission" data-id="${entry.id}">
            <div class="log-header">
              <span><span class="log-type log-type-submission">Submission #${entry.id}</span> <span class="badge ${cls}" style="font-size:11px;">${entry.status}</span></span>
              <span class="log-time">${new Date(entry.created_at).toLocaleString()}</span>
            </div>
            <div class="log-preview">${escapeHtml(entry.control_text.substring(0, 150))}${entry.control_text.length > 150 ? "..." : ""}</div>
            <div class="log-detail">
              ${entry.summary ? `<div class="summary-box">${escapeHtml(entry.summary)}</div>` : ""}
              <div class="section-title">Findings</div>
              <ul class="findings">${entry.findings.length ? entry.findings.map(f => "<li>" + escapeHtml(f) + "</li>").join("") : "<li>None</li>"}</ul>
              <div class="section-title">Gaps</div>
              <ul class="gaps">${entry.gaps.length ? entry.gaps.map(g => "<li>" + escapeHtml(g) + "</li>").join("") : "<li>None</li>"}</ul>
              <div class="section-title">Raw LLM Response</div>
              <div class="raw-response">${escapeHtml(entry.raw_llm_response || "N/A")}</div>
              <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-secondary debug-inspect" data-entry='${escapeHtml(JSON.stringify(entry))}'>Inspect in Debug Panel</button>
                <a href="/api/export/${entry.id}?format=csv" class="btn btn-sm btn-secondary" target="_blank">Download CSV</a>
              </div>
            </div>
          </div>`;
        } else {
          return `<div class="log-entry" data-type="override">
            <div class="log-header">
              <span><span class="log-type log-type-override">Override</span> Submission #${entry.submission_id}: <span class="badge badge-${entry.original_status.toLowerCase()}" style="font-size:11px;">${entry.original_status}</span> &rarr; <span class="badge badge-${entry.new_status.toLowerCase()}" style="font-size:11px;">${entry.new_status}</span></span>
              <span class="log-time">${new Date(entry.created_at).toLocaleString()}</span>
            </div>
            <div class="log-preview">${entry.reason ? "Reason: " + escapeHtml(entry.reason) : "No reason provided"}</div>
          </div>`;
        }
      }).join("");

      container.querySelectorAll(".log-entry[data-type='submission']").forEach(el => {
        el.addEventListener("click", () => {
          el.querySelector(".log-detail").classList.toggle("open");
        });
      });
      container.querySelectorAll(".log-entry[data-type='submission'] .debug-inspect").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const entry = JSON.parse(btn.dataset.entry);
          populateDebugPanel(entry);
          openDebugPanel();
        });
      });
    } catch {
      container.innerHTML = "<p style='color:#ef476f;'>Error loading logs.</p>";
    }
  }

  // ========== TABS (Logs page) ==========
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    const bar = btn.closest(".tab-bar");
    if (!bar) return;
    bar.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    const parent = bar.parentElement;
    parent.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    const content = parent.querySelector(".tab-" + tab);
    if (content) content.classList.add("active");
  });

  // ========== SYSTEM LOG VIEWER ==========
  let syslogRefreshTimer = null;
  let syslogScrollPaused = false;

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".syslog-filter");
    if (!btn) return;
    btn.parentElement.querySelectorAll(".syslog-filter").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadSystemLogsPage();
  });

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  const debouncedSyslogSearch = debounce(() => loadSystemLogsPage(), 300);

  document.addEventListener("input", (e) => {
    if (e.target.id === "syslog-search") debouncedSyslogSearch();
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "syslog-refresh-toggle") {
      if (e.target.checked) startSyslogAutoRefresh();
      else stopSyslogAutoRefresh();
    }
  });

  document.addEventListener("scroll", (e) => {
    const container = e.target.closest(".syslog-container");
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    syslogScrollPaused = !atBottom;
  }, true);

  function startSyslogAutoRefresh() {
    stopSyslogAutoRefresh();
    syslogRefreshTimer = setInterval(() => {
      const tab = document.querySelector(".tab-system");
      if (!tab || !tab.classList.contains("active")) return;
      if (!document.getElementById("syslog-refresh-toggle").checked) return;
      loadSystemLogsPage(true);
    }, 3000);
  }

  function stopSyslogAutoRefresh() {
    if (syslogRefreshTimer) { clearInterval(syslogRefreshTimer); syslogRefreshTimer = null; }
  }

  async function loadSystemLogsPage(silent) {
    const container = document.getElementById("syslog-container");
    if (!container) return;
    const level = document.querySelector(".syslog-filter.active");
    const levelVal = level ? level.dataset.level : "";
    const searchVal = document.getElementById("syslog-search").value;
    const params = new URLSearchParams({ lines: "500" });
    if (levelVal) params.set("level", levelVal);
    if (searchVal) params.set("search", searchVal);
    try {
      const wasAtBottom = !syslogScrollPaused;
      const prevScrollTop = container.scrollTop;
      const prevScrollHeight = container.scrollHeight;

      const res = await fetch("/api/logs/recent?" + params.toString());
      if (!res.ok) {
        if (!silent) container.innerHTML = "<p style='color:#ef476f;'>Failed to load system logs.</p>";
        return;
      }
      const data = await res.json();
      const stats = document.getElementById("syslog-stats");
      stats.textContent = `Showing ${data.returned} / ${data.total_lines} total lines`;

      if (!data.entries.length) {
        container.innerHTML = "<p style='color:#718096;'>No matching log entries.</p>";
        return;
      }

      container.innerHTML = data.entries.map((line, i) => {
        const lvlClass = line.match(/\[(ERROR|WARNING|INFO|DEBUG)\]/);
        const cls = lvlClass ? "syslog-lvl-" + lvlClass[1] : "";
        return `<div class="syslog-entry ${cls}"><span class="syslog-line-num">${i+1}</span>${escapeHtml(line)}</div>`;
      }).join("");

      if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
      } else {
        container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
      }
    } catch {
      if (!silent) container.innerHTML = "<p style='color:#ef476f;'>Error loading system logs.</p>";
    }
    startSyslogAutoRefresh();
  }

  // ========== CHAT PAGE ==========
  const chatModelSelect = document.getElementById("chat-model-select");
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const chatSendBtn = document.getElementById("chat-send-btn");
  const chatClearBtn = document.getElementById("chat-clear-btn");

  async function loadChatPage() {
    await populateChatModels();
    if (chatCaseContext) {
      if (chatCaseContext.readme_context) {
        chatMessages.innerHTML = `
          <div class="chat-msg chat-msg-system">
            <div class="chat-msg-role">Smart Help</div>
            <div class="chat-msg-text">I have the full user manual loaded. Ask me anything about how to use this tool.</div>
          </div>`;
      } else {
        chatMessages.innerHTML = `
          <div class="chat-msg chat-msg-system">
            <div class="chat-msg-role">Case #${chatCaseContext.id}</div>
            <div class="chat-msg-text">
              Discussing: ${escapeHtml((chatCaseContext.control_text || "").substring(0, 200))}${(chatCaseContext.control_text || "").length > 200 ? "..." : ""}
              ${chatCaseContext.status ? `<br><br>Previous assessment: <strong>${chatCaseContext.status}</strong> (${chatCaseContext.confidence_score}% confidence)` : ""}
              ${chatCaseContext.summary ? `<br>Summary: ${escapeHtml(chatCaseContext.summary.substring(0, 200))}` : ""}
            </div>
          </div>`;
      }
    }
  }

  async function populateChatModels() {
    try {
      const res = await fetch("/api/models?provider=ollama");
      const data = await res.json();
      if (!data.connected || !data.models.length) {
        chatModelSelect.innerHTML = '<option value="">No models found (Ollama running?)</option>';
        return;
      }
      const current = chatModelSelect.value;
      chatModelSelect.innerHTML = '<option value="">Select model...</option>' +
        data.models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
      if (current) chatModelSelect.value = current;
    } catch {
      chatModelSelect.innerHTML = '<option value="">Could not reach Ollama</option>';
    }
  }

  chatSendBtn.addEventListener("click", sendChatMessage);

  chatInput.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendChatMessage();
    }
  });

  chatClearBtn.addEventListener("click", () => {
    chatCaseContext = null;
    chatMessages.innerHTML = `
      <div class="chat-msg chat-msg-system">
        <div class="chat-msg-role">System</div>
        <div class="chat-msg-text">Conversation cleared. Send a new message.</div>
      </div>`;
    chatInput.value = "";
  });

  async function sendChatMessage() {
    const prompt = chatInput.value.trim();
    const model = chatModelSelect.value;
    if (!prompt) return;
    if (!model) {
      addChatMessage("System", "Please select a model first.", "system");
      return;
    }

    addChatMessage("You", prompt, "user");
    chatInput.value = "";
    chatSendBtn.disabled = true;

    const msgDiv = addChatMessage(model, "Thinking...", "assistant");
    const textDiv = msgDiv.querySelector(".chat-msg-text");

    const params = { prompt, model };
    if (currentConfig?.provider === "openai") {
      params.provider = "openai";
      if (currentConfig?.api_key && currentConfig.api_key !== "***") {
        params.api_key = currentConfig.api_key;
      }
    }
    if (chatCaseContext) {
      if (chatCaseContext.readme_context) {
        params.system = `You are a help assistant for the LOD1 Validator tool. Here is the user manual:\n\n${chatCaseContext.readme_context}\n\nAnswer the user's questions based on this manual. Be concise and helpful.`;
      } else {
        params.system = `You are discussing a LOD1 compliance assessment case (Case #${chatCaseContext.id}).\n\nControl Description:\n${chatCaseContext.control_text}\n\nEvidence:\n${chatCaseContext.evidence_text || "No evidence provided."}\n\nPrevious Assessment: ${chatCaseContext.status} (${chatCaseContext.confidence_score}% confidence)${chatCaseContext.summary ? "\nExecutive Summary: " + chatCaseContext.summary : ""}`;
      }
    }

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });

      if (!res.ok) {
        textDiv.textContent = `Error: Server returned ${res.status}`;
        chatSendBtn.disabled = false;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.response) {
            fullText = payload.response;
            textDiv.textContent = fullText;
          } else if (payload.error) {
            textDiv.textContent = "Error: " + payload.error;
          }
        }
      }
    } catch (err) {
      textDiv.textContent = "Error: " + err.message;
    }

    chatSendBtn.disabled = false;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addChatMessage(role, text, cls) {
    const div = document.createElement("div");
    div.className = "chat-msg chat-msg-" + (cls || "assistant");
    div.innerHTML = `<div class="chat-msg-role">${escapeHtml(role)}</div><div class="chat-msg-text">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  }

  // ========== DASHBOARD PAGE ==========
  async function loadDashboardPage() {
    try {
      const res = await fetch("/api/history?limit=1000");
      if (!res.ok) return;
      const data = await res.json();
      const subs = data.submissions || [];

      const total = subs.length;
      const compliant = subs.filter(s => s.status === "COMPLIANT").length;
      const nonCompliant = subs.filter(s => s.status === "NON-COMPLIANT").length;
      const inconclusive = subs.filter(s => s.status === "INCONCLUSIVE").length;
      const avgConf = total ? (subs.reduce((s, x) => s + (x.confidence_score || 0), 0) / total).toFixed(0) : 0;

      document.getElementById("dash-overview").innerHTML = `
        <div class="stat-card"><span class="stat-value" style="color:#4361ee;">${total}</span><span class="stat-label">Total Submissions</span></div>
        <div class="stat-card"><span class="stat-value" style="color:#06d6a0;">${compliant}</span><span class="stat-label">Compliant</span></div>
        <div class="stat-card"><span class="stat-value" style="color:#ef476f;">${nonCompliant}</span><span class="stat-label">Non-Compliant</span></div>
        <div class="stat-card"><span class="stat-value" style="color:#ffd166;">${inconclusive}</span><span class="stat-label">Inconclusive</span></div>
        <div class="stat-card"><span class="stat-value">${avgConf}%</span><span class="stat-label">Avg Confidence</span></div>
        <div class="stat-card"><span class="stat-value">${total ? ((compliant / total) * 100).toFixed(0) : 0}%</span><span class="stat-label">Compliance Rate</span></div>
      `;

      // Trend: group by date
      const trendMap = {};
      subs.forEach(s => {
        const d = (s.created_at || "").substring(0, 10);
        if (!d) return;
        if (!trendMap[d]) trendMap[d] = { total: 0, compliant: 0 };
        trendMap[d].total++;
        if (s.status === "COMPLIANT") trendMap[d].compliant++;
      });
      const trendDates = Object.keys(trendMap).sort().slice(-14);
      const trendHtml = trendDates.map(d => {
        const t = trendMap[d];
        const pct = t.total ? ((t.compliant / t.total) * 100).toFixed(0) : 0;
        const barH = Math.max(4, parseInt(pct) * 0.8);
        return `<div class="trend-bar-wrapper"><div class="trend-bar" style="height:${barH}px;"></div><div class="trend-label">${d.slice(5)}</div><div class="trend-value">${pct}%</div></div>`;
      }).join("");
      document.getElementById("dash-trend-chart").innerHTML = trendHtml || "<p style='color:#888;font-size:13px;'>Not enough data for trend.</p>";

      // Donut chart (CSS)
      const donut = document.getElementById("dash-donut");
      const totalPct = total || 1;
      const c = (compliant / totalPct) * 100;
      const nc = (nonCompliant / totalPct) * 100;
      const ic = (inconclusive / totalPct) * 100;
      donut.innerHTML = `<svg viewBox="0 0 40 40" style="width:120px;height:120px;">
        <circle r="15.9" cx="20" cy="20" fill="none" stroke="#e2e8f0" stroke-width="4"/>
        <circle r="15.9" cx="20" cy="20" fill="none" stroke="#06d6a0" stroke-width="4" stroke-dasharray="${c} ${100 - c}" stroke-dashoffset="25" transform="rotate(-90 20 20)"/>
        <circle r="15.9" cx="20" cy="20" fill="none" stroke="#ef476f" stroke-width="4" stroke-dasharray="${nc} ${100 - nc}" stroke-dashoffset="${25 - c * 3.6}" transform="rotate(-90 20 20)"/>
        <circle r="15.9" cx="20" cy="20" fill="none" stroke="#ffd166" stroke-width="4" stroke-dasharray="${ic} ${100 - ic}" stroke-dashoffset="${25 - (c + nc) * 3.6}" transform="rotate(-90 20 20)"/>
        <text x="20" y="22" text-anchor="middle" font-size="6" font-weight="700" fill="currentColor">${avgConf}%</text>
      </svg>`;
      document.getElementById("dash-legend").innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
          <div><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#06d6a0;margin-right:6px;"></span>Compliant: ${compliant}</div>
          <div><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#ef476f;margin-right:6px;"></span>Non-Compliant: ${nonCompliant}</div>
          <div><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#ffd166;margin-right:6px;"></span>Inconclusive: ${inconclusive}</div>
        </div>`;

      // Top failing
      const failing = subs.filter(s => s.status === "NON-COMPLIANT").sort((a, b) => (a.confidence_score || 0) - (b.confidence_score || 0)).slice(0, 10);
      document.getElementById("dash-failing-body").innerHTML = failing.length ? failing.map(s => `
        <tr><td>${s.id}</td><td>${escapeHtml((s.control_text || "").substring(0, 100))}</td><td>${s.confidence_score || "-"}%</td><td>${new Date(s.created_at).toLocaleDateString()}</td></tr>
      `).join("") : "<tr><td colspan='4' style='color:#888;'>No non-compliant submissions.</td></tr>";
    } catch {}
  }

  // ========== REPORTS PAGE ==========
  let reportsData = [];

  async function loadReportsPage() {
    try {
      const res = await fetch("/api/history?limit=500");
      if (!res.ok) return;
      const data = await res.json();
      reportsData = data.submissions || [];
      const tbody = document.getElementById("reports-body");
      tbody.innerHTML = reportsData.map(s => {
        const cls = "badge-" + s.status.toLowerCase();
        return `<tr>
          <td><input type="checkbox" class="reports-checkbox" value="${s.id}"></td>
          <td>${s.id}</td>
          <td>${escapeHtml((s.control_text || "").substring(0, 100))}</td>
          <td><span class="badge ${cls}" style="font-size:11px;padding:2px 8px;">${s.status}</span></td>
          <td>${s.confidence_score || "-"}%</td>
          <td>${new Date(s.created_at).toLocaleDateString()}</td>
        </tr>`;
      }).join("");
      updateReportsCount();
    } catch {}
  }

  function updateReportsCount() {
    const checked = document.querySelectorAll(".reports-checkbox:checked").length;
    document.getElementById("reports-count").textContent = `${checked} selected`;
  }

  document.addEventListener("change", (e) => {
    if (e.target.matches(".reports-checkbox")) updateReportsCount();
  });

  document.getElementById("reports-select-all").addEventListener("change", function() {
    document.querySelectorAll(".reports-checkbox").forEach(cb => cb.checked = this.checked);
    updateReportsCount();
  });

  document.getElementById("reports-generate-btn").addEventListener("click", () => {
    const checked = Array.from(document.querySelectorAll(".reports-checkbox:checked"));
    if (!checked.length) { alert("Select at least one submission."); return; }
    const ids = checked.map(cb => cb.value).join(",");
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/reports/consolidated";
    form.target = "_blank";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "submission_ids";
    input.value = ids;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  });

  // ========== HELP PAGE ==========
  async function loadHelpPage() {
    const container = document.getElementById("help-content");
    container.innerHTML = "Loading user manual...";
    try {
      const res = await fetch("/api/readme");
      if (!res.ok) { container.innerHTML = "<p style='color:#ef476f;'>Failed to load user manual.</p>"; return; }
      const data = await res.json();
      if (data.content) {
        container.innerHTML = simpleMarkdown(data.content);
      } else {
        container.innerHTML = "<p>User manual not available.</p>";
      }
    } catch {
      container.innerHTML = "<p style='color:#ef476f;'>Error loading user manual.</p>";
    }
  }

  function simpleMarkdown(text) {
    const lines = text.split("\n");
    let html = "";
    let inCodeBlock = false;
    let codeBuf = [];
    let inTable = false;
    let tableBuf = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("```")) {
        if (inCodeBlock) {
          html += `<pre class="help-code">${codeBuf.join("\n")}</pre>`;
          codeBuf = [];
          inCodeBlock = false;
        } else {
          if (inTable) { html += tableBuf.join("") + "</tbody></table>"; inTable = false; tableBuf = []; }
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) { codeBuf.push(escapeHtml(line)); continue; }

      const trimmed = line.trim();

      if (trimmed.startsWith("# ")) {
        if (inTable) { html += tableBuf.join("") + "</tbody></table>"; inTable = false; tableBuf = []; }
        html += `<h1>${escapeHtml(trimmed.slice(2))}</h1>`;
      } else if (trimmed.startsWith("## ")) {
        if (inTable) { html += tableBuf.join("") + "</tbody></table>"; inTable = false; tableBuf = []; }
        html += `<h2>${escapeHtml(trimmed.slice(3))}</h2>`;
      } else if (trimmed.startsWith("### ")) {
        if (inTable) { html += tableBuf.join("") + "</tbody></table>"; inTable = false; tableBuf = []; }
        html += `<h3>${escapeHtml(trimmed.slice(4))}</h3>`;
      } else if (trimmed.startsWith("---")) {
        if (inTable) { html += tableBuf.join("") + "</tbody></table>"; inTable = false; tableBuf = []; }
        html += `<hr>`;
      } else if (trimmed.startsWith("> ")) {
        if (inTable) { html += tableBuf.join("") + "</tbody></table>"; inTable = false; tableBuf = []; }
        html += `<blockquote>${renderInline(trimmed.slice(2))}</blockquote>`;
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        if (inTable) { html += tableBuf.join("") + "</tbody></table>"; inTable = false; tableBuf = []; }
        html += `<li>${renderInline(trimmed.slice(2))}</li>`;
      } else if (/^\d+\.\s/.test(trimmed)) {
        if (inTable) { html += tableBuf.join("") + "</tbody></table>"; inTable = false; tableBuf = []; }
        html += `<li>${renderInline(trimmed.replace(/^\d+\.\s/, ""))}</li>`;
      } else if (trimmed.startsWith("|")) {
        if (!inTable) { inTable = true; tableBuf = ['<table class="help-table"><thead><tr>']; }
        const cells = trimmed.split("|").filter(c => c.trim());
        if (cells.every(c => /^[-:]+$/.test(c.trim()))) {
          tableBuf = ['<table class="help-table"><tbody>'];
        } else {
          const tag = tableBuf[0].includes("<thead>") ? "th" : "td";
          tableBuf.push("<tr>" + cells.map(c => `<${tag}>${renderInline(c.trim())}</${tag}>`).join("") + "</tr>");
        }
      } else if (trimmed === "" && inTable) {
        html += tableBuf.join("") + "</tbody></table>";
        inTable = false;
        tableBuf = [];
      } else if (trimmed === "") {
        html += "<p></p>";
      } else {
        if (inTable) { html += tableBuf.join("") + "</tbody></table>"; inTable = false; tableBuf = []; }
        html += `<p>${renderInline(trimmed)}</p>`;
      }
    }
    if (inCodeBlock) html += `<pre class="help-code">${codeBuf.join("\n")}</pre>`;
    if (inTable) html += tableBuf.join("") + "</tbody></table>";
    return html;
  }

  function renderInline(str) {
    let s = escapeHtml(str);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`(.+?)`/g, "<code class='help-inline-code'>$1</code>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }

  // ========== CONFIG PAGE ==========
  let currentConfig = {};

  async function loadConfigPage() {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) return;
      currentConfig = await res.json();
      document.getElementById("cfg-provider").value = currentConfig.provider || "ollama";
      document.getElementById("cfg-api-key").value = currentConfig.api_key && currentConfig.api_key !== "***" ? currentConfig.api_key : "";
      toggleApiKeyField();
      document.getElementById("cfg-model").value = currentConfig.model || "";
      document.getElementById("cfg-timeout").value = currentConfig.timeout || 60;
      document.getElementById("cfg-max-tokens").value = currentConfig.max_tokens || 6000;
      renderEndpointList(currentConfig.endpoints || []);
    } catch {}
  }

  function toggleApiKeyField() {
    const field = document.getElementById("cfg-api-key-field");
    field.style.display = document.getElementById("cfg-provider").value === "openai" ? "block" : "none";
  }

  document.getElementById("cfg-provider").addEventListener("change", toggleApiKeyField);

  function renderEndpointList(endpoints) {
    const list = document.getElementById("endpoint-list");
    list.innerHTML = endpoints.map((ep, i) =>
      `<div class="endpoint-row">
        <input type="text" class="ep-input" value="${escapeHtml(ep)}" data-index="${i}">
        <button type="button" class="btn-remove" data-index="${i}">&times;</button>
      </div>`
    ).join("");
    list.querySelectorAll(".btn-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const inputs = list.querySelectorAll(".ep-input");
        if (inputs.length <= 1) return;
        const idx = parseInt(btn.dataset.index);
        inputs[idx].parentElement.remove();
      });
    });
  }

  document.getElementById("add-endpoint-btn").addEventListener("click", () => {
    const list = document.getElementById("endpoint-list");
    const row = document.createElement("div");
    row.className = "endpoint-row";
    row.innerHTML = `<input type="text" class="ep-input" value="http://"><button type="button" class="btn-remove">&times;</button>`;
    row.querySelector(".btn-remove").addEventListener("click", () => {
      if (document.querySelectorAll(".ep-input").length > 1) row.remove();
    });
    list.appendChild(row);
  });

  document.getElementById("save-config-btn").addEventListener("click", async () => {
    const inputs = document.querySelectorAll(".ep-input");
    const endpoints = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
    const payload = {
      model: document.getElementById("cfg-model").value.trim(),
      timeout: parseInt(document.getElementById("cfg-timeout").value) || 60,
      max_tokens: parseInt(document.getElementById("cfg-max-tokens").value) || 6000,
      provider: document.getElementById("cfg-provider").value,
      api_key: document.getElementById("cfg-api-key").value.trim(),
      endpoints: endpoints,
    };
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      currentConfig = await res.json();
      const success = document.getElementById("config-success");
      success.classList.add("active");
      setTimeout(() => success.classList.remove("active"), 3000);
      renderEndpointList(currentConfig.endpoints);
    } catch (err) {
      document.getElementById("config-error").textContent = err.message;
      document.getElementById("config-error").classList.add("active");
    }
  });

  document.getElementById("reset-config-btn").addEventListener("click", loadConfigPage);

  // ========== DATABASE CLEAR ==========
  const dbClearInput = document.getElementById("db-clear-confirm");
  const dbClearBtn = document.getElementById("db-clear-btn");
  const dbClearSuccess = document.getElementById("db-clear-success");
  const dbClearError = document.getElementById("db-clear-error");

  dbClearInput.addEventListener("input", () => {
    dbClearBtn.disabled = dbClearInput.value !== "DELETE";
  });

  dbClearBtn.addEventListener("click", async () => {
    dbClearSuccess.classList.remove("active");
    dbClearError.classList.remove("active");
    dbClearSuccess.textContent = "";
    dbClearError.textContent = "";
    dbClearBtn.disabled = true;
    try {
      const res = await fetch("/api/database", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear database");
      dbClearSuccess.textContent = "All data cleared successfully.";
      dbClearSuccess.classList.add("active");
      dbClearInput.value = "";
      dbClearBtn.disabled = true;
    } catch (err) {
      dbClearError.textContent = err.message;
      dbClearError.classList.add("active");
      dbClearBtn.disabled = false;
      dbClearInput.value = "";
    }
  });

  // ========== KEYBOARD SHORTCUTS ==========
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      debugPanel.classList.remove("active");
      debugToggle.classList.remove("active");
      detailOverlay.classList.remove("active");
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      const activePage = document.querySelector(".page.active");
      if (activePage && activePage.id === "page-analyze" && !analyzeBtn.disabled) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit"));
      }
    }
  });

  // ========== TOKEN COUNTER ==========
  const tokenDisplay = document.getElementById("token-count");

  function updateTokenEstimate() {
    const controlLen = controlsText.value.length;
    const totalFiles = uploadedFiles.reduce((sum, f) => sum + f.size, 0);
    const estTokens = Math.ceil((controlLen + totalFiles * 0.25) / 4);
    if (tokenDisplay) {
      tokenDisplay.textContent = `Est. tokens: ${estTokens.toLocaleString()}`;
      if (estTokens > 6000) tokenDisplay.style.color = "#ef476f";
      else tokenDisplay.style.color = "#888";
    }
  }

  controlsText.addEventListener("input", updateTokenEstimate);

  // ========== TEMPLATE LIBRARY ==========
  const templateSelect = document.getElementById("template-select");
  const saveTemplateBtn = document.getElementById("save-template-btn");
  const deleteTemplateBtn = document.getElementById("delete-template-btn");

  function loadTemplates() {
    try {
      const templates = JSON.parse(localStorage.getItem("lod_templates") || "{}");
      templateSelect.innerHTML = '<option value="">Load template...</option>';
      Object.entries(templates).forEach(([name, text]) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        templateSelect.appendChild(opt);
      });
    } catch {}
  }

  templateSelect.addEventListener("change", () => {
    if (!templateSelect.value) return;
    try {
      const templates = JSON.parse(localStorage.getItem("lod_templates") || "{}");
      if (templates[templateSelect.value]) {
        controlsText.value = templates[templateSelect.value];
        updateTokenEstimate();
      }
    } catch {}
  });

  saveTemplateBtn.addEventListener("click", () => {
    const name = prompt("Template name:");
    if (!name || !controlsText.value.trim()) return;
    try {
      const templates = JSON.parse(localStorage.getItem("lod_templates") || "{}");
      templates[name] = controlsText.value;
      localStorage.setItem("lod_templates", JSON.stringify(templates));
      loadTemplates();
    } catch {}
  });

  deleteTemplateBtn.addEventListener("click", () => {
    if (!templateSelect.value) return;
    try {
      const templates = JSON.parse(localStorage.getItem("lod_templates") || "{}");
      delete templates[templateSelect.value];
      localStorage.setItem("lod_templates", JSON.stringify(templates));
      templateSelect.value = "";
      loadTemplates();
    } catch {}
  });

  loadTemplates();

  // ========== SHARED UTILITIES ==========
  function statusIcon(s) {
    return s === "COMPLIANT" ? "\uD83D\uDFE9" : s === "NON-COMPLIANT" ? "\uD83D\uDFE5" : "\uD83D\uDFE8";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Global handler for Inspect in Debug Panel buttons (dynamic content)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".debug-inspect");
    if (btn && btn.dataset.entry) {
      try {
        const entry = JSON.parse(btn.dataset.entry);
        populateDebugPanel(entry);
        openDebugPanel();
      } catch {}
    }
    // Chat about this case (dynamic content)
    const chatBtn = e.target.closest("[data-chat-id]");
    if (chatBtn) {
      e.preventDefault();
      chatCaseContext = {
        id: parseInt(chatBtn.dataset.chatId),
        control_text: chatBtn.dataset.chatControl,
        evidence_text: chatBtn.dataset.chatEvidence,
        status: chatBtn.dataset.chatStatus,
        confidence_score: parseFloat(chatBtn.dataset.chatConfidence) || 0,
        summary: chatBtn.dataset.chatSummary,
      };
      window.location.hash = "chat";
    }
  });

  // Fix download CSV click (use closure for dataset)
  document.getElementById("download-csv").addEventListener("click", function() {
    if (this.dataset.submissionId) {
      window.open(`/api/export/${this.dataset.submissionId}?format=csv`, "_blank");
    }
  });

  document.getElementById("download-html").addEventListener("click", function() {
    if (this.dataset.submissionId) {
      window.open(`/api/export/${this.dataset.submissionId}?format=html`, "_blank");
    }
  });

  document.getElementById("chat-about-btn").addEventListener("click", function() {
    if (this.dataset.submissionId && lastResultData) {
      chatCaseContext = {
        id: parseInt(this.dataset.submissionId),
        control_text: lastResultData.control_text || document.getElementById("control-text").value,
        evidence_text: lastResultData.evidence_text || "",
        status: lastResultData.status,
        confidence_score: lastResultData.confidence_score || 0,
        summary: lastResultData.summary || "",
      };
      window.location.hash = "chat";
    }
  });

  // Poll Ollama status every 30 seconds
  setInterval(() => {
    if (document.getElementById("page-analyze").classList.contains("active")) {
      const isOllama = document.querySelector('input[name="conn-mode"]:checked').value === "ollama";
      if (isOllama) fetchOllamaModels();
    }
  }, 30000);

  // ========== DARK MODE ==========
  const darkModeToggle = document.getElementById("dark-mode-toggle");
  const darkModeIcon = document.getElementById("dark-mode-icon");
  const darkModeLabel = document.getElementById("dark-mode-label");

  function applyDark(enabled) {
    if (enabled) {
      document.documentElement.classList.add("dark");
      darkModeIcon.textContent = "\u2600\uFE0F";
      darkModeLabel.textContent = "Light Mode";
    } else {
      document.documentElement.classList.remove("dark");
      darkModeIcon.textContent = "\uD83C\uDF19";
      darkModeLabel.textContent = "Dark Mode";
    }
    localStorage.setItem("lod_dark", enabled ? "1" : "0");
  }

  darkModeToggle.addEventListener("click", () => {
    const isDark = document.documentElement.classList.contains("dark");
    applyDark(!isDark);
  });

  // Restore dark mode preference
  if (localStorage.getItem("lod_dark") === "1") {
    applyDark(true);
  }

  // ========== MULTI-MODEL COMPARISON ==========
  const compareToggle = document.getElementById("compare-toggle");
  const compareModels = document.getElementById("compare-models");

  compareToggle.addEventListener("change", () => {
    compareModels.style.display = compareToggle.checked ? "flex" : "none";
    if (compareToggle.checked) populateCompareModels();
  });

  async function populateCompareModels() {
    try {
      const res = await fetch("/api/models?provider=ollama");
      const data = await res.json();
      if (!data.connected || !data.models.length) return;
      compareModels.innerHTML = data.models.map((m, i) =>
        `<label style="font-weight:400;font-size:12px;display:flex;align-items:center;gap:4px;">
          <input type="checkbox" value="${escapeHtml(m)}" ${i === 0 ? "checked" : ""}> ${escapeHtml(m)}
        </label>`
      ).join("");
    } catch {}
  }

  // ========== INIT ==========
  checkHealth();
  handleRoute();
});
