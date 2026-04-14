// tests/content-state.test.js
//
// Tests for content script state helpers extracted as pure functions.
// DOM and Chrome API interactions are not tested here — those are
// integration concerns.

import {
  assignFindingIds, resetIdCounter,
  setScannedText, getScannedText, removeScannedText, resetScannedText,
} from "../src/content/content-state.js";

beforeEach(() => {
  resetIdCounter();
  resetScannedText();
});

test("assignFindingIds: assigns sequential IDs starting at 1", () => {
  const findings = [
    { codepoint: 0xfe00, tier: "T1" },
    { codepoint: 0x202e, tier: "T2" },
  ];
  const result = assignFindingIds(findings, 1);
  expect(result[0].id).toBe(1);
  expect(result[1].id).toBe(2);
  expect(result[0].elementId).toBe(1);
  expect(result[1].elementId).toBe(1);
});

test("assignFindingIds: IDs continue across calls", () => {
  assignFindingIds([{ tier: "T1" }], 1);
  const result = assignFindingIds([{ tier: "T2" }], 2);
  expect(result[0].id).toBe(2);
  expect(result[0].elementId).toBe(2);
});

test("assignFindingIds: empty array returns empty array", () => {
  expect(assignFindingIds([], 1)).toEqual([]);
});

test("no duplicate IDs across 100 calls", () => {
  const allIds = new Set();
  for (let i = 0; i < 100; i++) {
    const result = assignFindingIds([{ tier: "T1" }, { tier: "T2" }], i);
    for (const f of result) {
      expect(allIds.has(f.id)).toBe(false);
      allIds.add(f.id);
    }
  }
  expect(allIds.size).toBe(200);
});

test("setScannedText: accumulates text keyed by elementId", () => {
  setScannedText(1, "function foo() {");
  setScannedText(2, "var bar = 1;");
  expect(getScannedText()).toBe("function foo() {\nvar bar = 1;");
});

test("setScannedText: second call with same elementId overwrites (upsert)", () => {
  setScannedText(1, "old text");
  setScannedText(2, "keep this");
  setScannedText(1, "new text");
  expect(getScannedText()).toBe("new text\nkeep this");
});

test("removeScannedText: removes text for a given elementId", () => {
  setScannedText(1, "one");
  setScannedText(2, "two");
  removeScannedText(1);
  expect(getScannedText()).toBe("two");
});

test("removeScannedText: no-op for unknown elementId", () => {
  setScannedText(1, "hello");
  removeScannedText(99);
  expect(getScannedText()).toBe("hello");
});

test("no false negatives: all set text included in result", () => {
  const texts = ["alpha \uFE00", "beta \u202E", "gamma \u00AD"];
  texts.forEach((t, i) => setScannedText(i, t));
  const combined = getScannedText();
  for (const t of texts) {
    expect(combined).toContain(t);
  }
});

test("no false positives: getScannedText returns empty string initially", () => {
  expect(getScannedText()).toBe("");
});

// S5 (Settings Reload): The chrome.storage.onChanged listener in content.js
// updates the local `settings` object when keys change. This cannot be
// automatically tested in jsdom because it requires the Chrome extension API.
//
// Manual verification:
// 1. Load extension, navigate to a page with code blocks
// 2. Open options page, change `inline_markers_enabled` to false
// 3. Trigger a new scan (scroll to unobserved code block or SPA navigation)
// 4. Confirm new code blocks do NOT get inline markers
// 5. Change setting back to true, confirm new code blocks get markers again
