// tests/exporter.test.js
import { buildExportPayload, canonicalHash } from "../src/export/exporter.js";
import { jest } from "@jest/globals";

const PAGE = { url: "https://github.com/x/y/commit/abc", title: "abc \xB7 x/y", documentHash: "aabbcc" };
const FINDINGS = [{
  id: 1, codepoint: 0xfe00, tier: "T1", category: "variation-selector",
  elementSelector: "pre > code", contextBefore: "foo(", contextAfter: ")",
  offsetInTextNode: 5, lineNumberEstimate: 12
}];
const SIGS = [{ id: "GW-DECODE-01", description: "Glassworm", matchedElement: "pre", matchedTextPreview: "codePointAt..." }];

test("export has required top-level keys", () => {
  const r = buildExportPayload(PAGE, FINDINGS, SIGS, {});
  for (const k of ["version", "generator", "timestamp_utc", "page", "summary", "findings", "signatures", "integrity"]) {
    expect(r).toHaveProperty(k);
  }
});
test("version is 1.0", () => {
  expect(buildExportPayload(PAGE, FINDINGS, SIGS, {}).version).toBe("1.0");
});
test("summary counts match findings", () => {
  const r = buildExportPayload(PAGE, FINDINGS, SIGS, {});
  expect(r.summary.total_findings).toBe(1);
  expect(r.summary.by_tier.T1).toBe(1);
  expect(r.summary.by_tier.T2).toBe(0);
});
test("redactUrls replaces full URL with hostname", () => {
  const r = buildExportPayload(PAGE, FINDINGS, SIGS, { redactUrls: true });
  expect(r.page.url).toBe("github.com");
});
test("stripContext removes context_before/after", () => {
  const r = buildExportPayload(PAGE, FINDINGS, SIGS, { stripContext: true });
  expect(r.findings[0]).not.toHaveProperty("context_before");
  expect(r.findings[0]).not.toHaveProperty("context_after");
});
test("context preserved by default", () => {
  const r = buildExportPayload(PAGE, FINDINGS, SIGS, {});
  expect(r.findings[0].context_before).toBe("foo(");
});
test("codepoint formatted as U+XXXX", () => {
  const r = buildExportPayload(PAGE, FINDINGS, SIGS, {});
  expect(r.findings[0].codepoint).toBe("U+FE00");
});
test("canonicalHash returns lowercase hex string", async () => {
  // Polyfill TextEncoder for jsdom if missing
  if (typeof globalThis.TextEncoder === "undefined") {
    const { TextEncoder } = await import("util");
    globalThis.TextEncoder = TextEncoder;
  }
  const mockDigest = jest.fn().mockResolvedValue(new Uint8Array(32).fill(0xab));
  if (!globalThis.crypto) {
    globalThis.crypto = {};
  }
  globalThis.crypto.subtle = { digest: mockDigest };
  const hash = await canonicalHash([{ a: 1 }]);
  expect(typeof hash).toBe("string");
  expect(hash).toMatch(/^[a-f0-9]+$/);
});
