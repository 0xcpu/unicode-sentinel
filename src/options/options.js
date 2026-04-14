import { getSettings, setSetting } from "../shared/storage.js";

async function init() {
  const s = await getSettings();
  document.getElementById("scan_scope").value = s.scan_scope;
  document.getElementById("banner_threshold_t3").value = s.banner_threshold_t3;
  document.getElementById("group_threshold").value = s.group_threshold;
  document.getElementById("inline_markers_enabled").checked = s.inline_markers_enabled;
  document.getElementById("export_redact_urls").checked = s.export_redact_urls;
  document.getElementById("export_strip_context").checked = s.export_strip_context;
  document.getElementById("signature_ruleset_url").value = s.signature_ruleset_url;

  document.getElementById("save-btn").addEventListener("click", async () => {
    const updates = {
      scan_scope: document.getElementById("scan_scope").value,
      banner_threshold_t3: parseInt(document.getElementById("banner_threshold_t3").value, 10),
      group_threshold: parseInt(document.getElementById("group_threshold").value, 10),
      inline_markers_enabled: document.getElementById("inline_markers_enabled").checked,
      export_redact_urls: document.getElementById("export_redact_urls").checked,
      export_strip_context: document.getElementById("export_strip_context").checked,
      signature_ruleset_url: document.getElementById("signature_ruleset_url").value.trim(),
    };
    for (const [k, v] of Object.entries(updates)) await setSetting(k, v);
    const msg = document.getElementById("saved-msg");
    msg.style.display = "inline";
    setTimeout(() => (msg.style.display = "none"), 2000);
  });
}

init();
