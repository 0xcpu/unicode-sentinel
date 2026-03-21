export async function canonicalHash(data) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function buildExportPayload(page, findings, signatures, opts = {}) {
  const { redactUrls = false, stripContext = false } = opts;
  const byTier = { T1: 0, T2: 0, T3: 0 };
  for (const f of findings) byTier[f.tier] = (byTier[f.tier] ?? 0) + 1;

  const exportedFindings = findings.map(f => {
    const entry = {
      id: f.id,
      codepoint: `U+${f.codepoint.toString(16).toUpperCase().padStart(4, "0")}`,
      codepoint_name: f.codepointName ?? "",
      category: f.category,
      tier: f.tier,
      offset_in_text_node: f.offsetInTextNode,
      element_selector: f.elementSelector,
      line_number_estimate: f.lineNumberEstimate ?? null,
    };
    if (!stripContext) {
      entry.context_before = f.contextBefore ?? "";
      entry.context_after = f.contextAfter ?? "";
    }
    return entry;
  });

  let pageUrl = page.url;
  if (redactUrls) {
    try { pageUrl = new URL(page.url).hostname; } catch { pageUrl = ""; }
  }

  return {
    version: "1.0",
    generator: "unicode-sentinel",
    generator_version: "0.1.0",
    timestamp_utc: new Date().toISOString(),
    page: { url: pageUrl, title: page.title, document_hash_sha256: page.documentHash ?? "" },
    summary: {
      total_findings: findings.length,
      by_tier: byTier,
      signature_matches: signatures.map(s => s.id),
    },
    findings: exportedFindings,
    signatures: signatures.map(s => ({
      id: s.id,
      description: s.description,
      matched_element: s.matchedElement ?? "",
      matched_text_preview: s.matchedTextPreview ?? "",
    })),
    integrity: {
      findings_hash_sha256: "",
      note: "Verify by re-serialising findings with canonical JSON (sorted keys, no whitespace) and computing SHA-256.",
    },
  };
}
