import { buildExportPayload, canonicalHash } from "../export/exporter.js";
import { getSettings } from "../shared/storage.js";

function show(id) {
  for (const sec of ["scan-empty", "scanning", "scanned", "scan-failed"]) {
    const el = document.getElementById(sec);
    if (el) el.style.display = sec === id ? "block" : "none";
  }
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

async function pollUntilScanned(tabId, { intervalMs = 200, timeoutMs = 5000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, intervalMs));
    const s = await chrome.runtime
      .sendMessage({ type: "GET_FINDINGS", tabId })
      .catch(() => null);
    if (s && s.status !== "scanning") return s;
  }
  return null;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    show("scan-empty");
    return;
  }

  // Wire retry-btn early — it's used whenever scan-failed is shown, which
  // happens from multiple code paths (initial poll, post-click poll).
  document.getElementById("retry-btn")?.addEventListener("click", async () => {
    chrome.runtime.sendMessage({ type: "TRIGGER_SCAN", tabId: tab.id });
    show("scanning");
    const final = await pollUntilScanned(tab.id);
    if (final) renderScanned(tab, final);
    else show("scan-failed");
  });

  const state = await chrome.runtime
    .sendMessage({ type: "GET_FINDINGS", tabId: tab.id })
    .catch(() => null);

  if (state && state.status === "scanning") {
    show("scanning");
    const final = await pollUntilScanned(tab.id);
    if (final) renderScanned(tab, final);
    else show("scan-failed");
    return;
  }

  if (!state) {
    show("scan-empty");
    document.getElementById("scan-btn").addEventListener("click", async () => {
      chrome.runtime.sendMessage({ type: "TRIGGER_SCAN", tabId: tab.id });
      show("scanning");
      const final = await pollUntilScanned(tab.id);
      if (final) renderScanned(tab, final);
      else show("scan-failed");
    });
    return;
  }

  renderScanned(tab, state);
}

function renderScanned(tab, state) {
  show("scanned");

  const dot = document.getElementById("dot");
  const statusText = document.getElementById("status-text");
  const { byTier, sigMatches, findings, total } = state;

  if (total === 0) {
    dot.className = "dot green";
    statusText.textContent = "No suspicious characters found.";
  } else {
    dot.className = "dot " + (byTier.T1 > 0 || sigMatches.length > 0 ? "red" : "amber");
    statusText.textContent = total + " invisible character" + (total !== 1 ? "s" : "") + " found";
  }

  document.getElementById("tier-counts").textContent =
    "T1: " + byTier.T1 + "  T2: " + byTier.T2 + "  T3: " + byTier.T3;

  const sigContainer = document.getElementById("sig-matches");
  clearChildren(sigContainer);
  if (sigMatches.length > 0) {
    const strong = document.createElement("strong");
    strong.textContent = "Patterns:";
    sigContainer.appendChild(strong);
    sigContainer.appendChild(document.createTextNode(" "));
    sigMatches.forEach((m, i) => {
      if (i > 0) sigContainer.appendChild(document.createTextNode(", "));
      const code = document.createElement("code");
      code.textContent = m.id;
      sigContainer.appendChild(code);
    });
  }

  const list = document.getElementById("findings-list");
  clearChildren(list);
  if (findings && findings.length > 0) {
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const h of ["#", "Codepoint", "Tier", "Context"]) {
      const th = document.createElement("th");
      th.textContent = h;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const f of findings.slice(0, 200)) {
      const tr = document.createElement("tr");
      const tdId = document.createElement("td"); tdId.textContent = f.id; tr.appendChild(tdId);
      const tdCp = document.createElement("td"); tdCp.textContent = "U+" + f.codepoint.toString(16).toUpperCase().padStart(4, "0"); tr.appendChild(tdCp);
      const tdTier = document.createElement("td"); tdTier.textContent = f.tier; tr.appendChild(tdTier);
      const tdCtx = document.createElement("td"); tdCtx.textContent = (f.contextBefore ?? "") + "\u2026"; tr.appendChild(tdCtx);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    list.appendChild(table);
  }

  document.getElementById("btn-toggle").addEventListener("click", () => {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_MARKERS" });
  });

  document.getElementById("btn-export").addEventListener("click", async () => {
    const exportSettings = await getSettings();
    const docHash = await chrome.tabs.sendMessage(tab.id, { type: "GET_DOC_HASH" }).catch(() => "");
    const payload = buildExportPayload(
      { url: tab.url, title: tab.title, documentHash: docHash },
      findings,
      sigMatches,
      { redactUrls: exportSettings.export_redact_urls, stripContext: exportSettings.export_strip_context }
    );
    payload.integrity.findings_hash_sha256 = await canonicalHash(findings);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "usent-report-" + new URL(tab.url).hostname + "-" + new Date().toISOString().slice(0, 19).replace(/:/g, "-") + ".json";
    a.click();
    URL.revokeObjectURL(blobUrl);
  });

  document.getElementById("rescan-btn").addEventListener("click", () => {
    chrome.tabs.sendMessage(tab.id, { type: "RESCAN" });
  });
}

init();
