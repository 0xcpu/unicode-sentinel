export const DEFAULTS = {
  scan_scope: "code_blocks",
  banner_threshold_t3: 4,
  inline_markers_enabled: true,
  group_threshold: 4,
  tier_overrides: {},
  export_redact_urls: false,
  export_strip_context: false,
  signature_ruleset_url: "",
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function setSetting(key, value) {
  await chrome.storage.sync.set({ [key]: value });
}
