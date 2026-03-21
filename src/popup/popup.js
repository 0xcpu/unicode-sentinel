import { buildExportPayload, canonicalHash } from "../export/exporter.js";
import { getSettings } from "../shared/storage.js";

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await chrome.runtime.sendMessage({ type: "GET_FINDINGS", tabId: tab.id });

  const dot = document.getElementById("dot");
  const statusText = document.getElementById("status-text");

  if (!state || state.total === 0) {
    dot.className = "dot green";
    statusText.textContent = "No suspicious characters found.";
    return;
  }

  const { byTier, sigMatches } = state;
  dot.className = "dot " + (byTier.T1 > 0 || sigMatches.length > 0 ? "red" : "amber");
  statusText.textContent = state.total + " invisible character" + (state.total !== 1 ? "s" : "") + " found";
  document.getElementById("tier-counts").textContent = "T1: " + byTier.T1 + "  T2: " + byTier.T2 + "  T3: " + byTier.T3;

  if (sigMatches.length > 0) {
    const container = document.getElementById("sig-matches");
    const strong = document.createElement("strong");
    strong.textContent = "Patterns:";
    container.appendChild(strong);
    container.appendChild(document.createTextNode(" "));
    sigMatches.forEach((m, i) => {
      if (i > 0) {
        container.appendChild(document.createTextNode(", "));
      }
      const code = document.createElement("code");
      code.textContent = m.id;
      container.appendChild(code);
    });
  }

  const findings = await chrome.tabs.sendMessage(tab.id, { type: "GET_FULL_FINDINGS" }).catch(() => []);

  if (findings && findings.length > 0) {
    const table = document.createElement("table");

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const headers = ["#", "Codepoint", "Tier", "Context"];
    for (const h of headers) {
      const th = document.createElement("th");
      th.textContent = h;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const f of findings.slice(0, 200)) {
      const tr = document.createElement("tr");

      const tdId = document.createElement("td");
      tdId.textContent = f.id;
      tr.appendChild(tdId);

      const tdCp = document.createElement("td");
      tdCp.textContent = "U+" + f.codepoint.toString(16).toUpperCase().padStart(4, "0");
      tr.appendChild(tdCp);

      const tdTier = document.createElement("td");
      tdTier.textContent = f.tier;
      tr.appendChild(tdTier);

      const tdCtx = document.createElement("td");
      tdCtx.textContent = (f.contextBefore ?? "") + "\u2026";
      tr.appendChild(tdCtx);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    document.getElementById("findings-list").appendChild(table);
  }

  document.getElementById("btn-toggle").addEventListener("click", () => {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_MARKERS" });
  });

  document.getElementById("btn-export").addEventListener("click", async () => {
    const settings = await getSettings();
    const docHash = await chrome.tabs.sendMessage(tab.id, { type: "GET_DOC_HASH" }).catch(() => "");
    const payload = buildExportPayload(
      { url: tab.url, title: tab.title, documentHash: docHash },
      findings,
      sigMatches,
      { redactUrls: settings.export_redact_urls, stripContext: settings.export_strip_context }
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
}

init();
