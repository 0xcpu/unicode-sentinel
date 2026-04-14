// tests/scan-flow.test.js
//
// End-to-end correctness tests for the scan → signature pipeline as composed
// in content.js. Specifically guards against:
//
//   C3 regression: When inline markers are enabled, scanElement() replaces text
//   nodes with bracket-wrapped marker spans, mutating el.textContent. If
//   setScannedText is called AFTER that mutation, signature matchers would see
//   "‹FE00›‹FE01›..." (ASCII brackets) instead of the raw T1 codepoints, and
//   GW-DECODE-02 (8+ consecutive T1) would silently never fire.
//
// We simulate the scan flow with a lightweight shim: (a) capture el.textContent
// BEFORE calling buildFragment (the pre-fix bug); (b) verify that shim's output
// would now trigger GW-DECODE-02 on 8+ consecutive T1 codepoints.

import { scanText } from "../src/content/scanner.js";
import { buildFragment } from "../src/content/marker.js";
import { matchSignatures } from "../src/shared/signatures.js";
import {
  setScannedText, getScannedText, resetScannedText,
} from "../src/content/content-state.js";

beforeEach(() => {
  resetScannedText();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

function mkPreWithText(text) {
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode(text));
  document.body.appendChild(pre);
  return pre;
}

test("C3 regression: setScannedText must capture text BEFORE marker injection", () => {
  // A code block with 8 consecutive T1 variation selectors — this should trigger GW-DECODE-02.
  const raw = "x" + "\uFE00".repeat(8) + "y";
  const pre = mkPreWithText(raw);

  // Baseline sanity: matchSignatures on raw text fires GW-DECODE-02.
  expect(matchSignatures(raw).some(m => m.id === "GW-DECODE-02")).toBe(true);

  // Simulate the CORRECT flow: capture textContent, then apply markers, then store.
  const originalText = pre.textContent;
  const findings = scanText(pre.firstChild.textContent);
  const frag = buildFragment(pre.firstChild, findings, { groupThreshold: 4 });
  pre.replaceChild(frag, pre.firstChild);
  setScannedText(1, originalText);

  // After marker injection, el.textContent is bracket-wrapped.
  const bracketified = pre.textContent;
  expect(bracketified).not.toBe(originalText);
  expect(bracketified).not.toContain("\uFE00");

  // The scanned-text mirror used by matchSignatures must be the ORIGINAL text,
  // not the bracketified DOM text.
  expect(getScannedText()).toBe(originalText);
  expect(matchSignatures(getScannedText()).some(m => m.id === "GW-DECODE-02")).toBe(true);

  // And the bug: if we'd stored post-mutation textContent, the signature would NOT fire.
  const buggyStored = pre.textContent;
  expect(matchSignatures(buggyStored).some(m => m.id === "GW-DECODE-02")).toBe(false);
});

test("C3 regression: multi-block scan stores each element's original text", () => {
  // Two blocks, each with 8 T1 chars. Either alone should trigger GW-DECODE-02.
  const rawA = "\uFE00".repeat(8);
  const rawB = "codePointAt(0) && 0xFE00";
  const preA = mkPreWithText(rawA);
  const preB = mkPreWithText(rawB);

  // Simulate correct scan flow for both.
  for (const [el, id] of [[preA, 1], [preB, 2]]) {
    const originalText = el.textContent;
    const findings = scanText(el.firstChild.textContent);
    if (findings.length > 0) {
      const frag = buildFragment(el.firstChild, findings, { groupThreshold: 4 });
      el.replaceChild(frag, el.firstChild);
    }
    setScannedText(id, originalText);
  }

  // getScannedText should contain both original texts intact.
  const combined = getScannedText();
  expect(combined).toContain(rawA); // 8 T1 chars preserved
  expect(combined).toContain(rawB);

  // And GW-DECODE-02 still fires (from block A) even though the DOM has been rewritten.
  expect(matchSignatures(combined).some(m => m.id === "GW-DECODE-02")).toBe(true);
});

test("no false positives: clean text in scanned-text mirror does not trigger signatures", () => {
  setScannedText(1, "function add(a, b) { return a + b; }");
  expect(matchSignatures(getScannedText())).toEqual([]);
});
