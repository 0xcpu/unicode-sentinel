// tests/background.test.js
//
// We test the background worker's state logic in isolation by extracting
// its message handling into pure functions. The Chrome API surface
// (chrome.runtime, chrome.action, chrome.tabs) is mocked.

import {
  handleMessage, getTabState, resetAllState, resetTabState, onTabUpdated,
  markTabUnsupported,
} from "../src/background/background.js";

beforeEach(() => {
  resetAllState();
});

function fakeSender(tabId) {
  return { tab: { id: tabId } };
}

test("FINDINGS_BATCH: first batch creates tab state with findings", () => {
  const findings = [
    { id: 1, codepoint: 0xfe00, tier: "T1", category: "variation-selector", elementId: 1 },
    { id: 2, codepoint: 0x202e, tier: "T2", category: "bidi-override", elementId: 1 },
  ];
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: findings, sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  const state = getTabState(10);
  expect(state.findings).toHaveLength(2);
  expect(state.total).toBe(2);
  expect(state.byTier).toEqual({ T1: 1, T2: 1, T3: 0 });
  expect(state.sigMatches).toEqual([]);
  expect(typeof state.lastUpdated).toBe("number");
});

test("FINDINGS_BATCH: second batch appends to existing findings", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T1", elementId: 1 }], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 2, tier: "T2", elementId: 2 }], sigMatches: [], elementId: 2 },
    fakeSender(10)
  );
  const state = getTabState(10);
  expect(state.findings).toHaveLength(2);
  expect(state.total).toBe(2);
  expect(state.byTier).toEqual({ T1: 1, T2: 1, T3: 0 });
});

test("FINDINGS_BATCH: sigMatches updated to latest", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T1", elementId: 1 }], sigMatches: [{ id: "GW-DECODE-01" }], elementId: 1 },
    fakeSender(10)
  );
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 2, tier: "T1", elementId: 2 }], sigMatches: [{ id: "GW-DECODE-01" }, { id: "GW-DECODE-02" }], elementId: 2 },
    fakeSender(10)
  );
  const state = getTabState(10);
  expect(state.sigMatches).toHaveLength(2);
});

test("FINDINGS_BATCH: empty batch still updates sigMatches and timestamp", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [], sigMatches: [{ id: "ZW-BULK-01" }], elementId: 1 },
    fakeSender(10)
  );
  const state = getTabState(10);
  expect(state.findings).toHaveLength(0);
  expect(state.total).toBe(0);
  expect(state.sigMatches).toHaveLength(1);
});

test("FINDINGS_BATCH: separate tabs have independent state", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T1", elementId: 1 }], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T2", elementId: 1 }, { id: 2, tier: "T3", elementId: 1 }], sigMatches: [], elementId: 1 },
    fakeSender(20)
  );
  expect(getTabState(10).total).toBe(1);
  expect(getTabState(20).total).toBe(2);
});

test("no false positives: FINDINGS_BATCH with no findings produces zero total", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  expect(getTabState(10).total).toBe(0);
  expect(getTabState(10).findings).toEqual([]);
});

test("FINDINGS_REPLACE: replaces findings for a given elementId", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [
      { id: 1, tier: "T1", elementId: 1 },
      { id: 2, tier: "T2", elementId: 1 },
    ], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [
      { id: 3, tier: "T3", elementId: 2 },
    ], sigMatches: [], elementId: 2 },
    fakeSender(10)
  );
  // Replace elementId 1 findings with a single new finding
  handleMessage(
    { type: "FINDINGS_REPLACE", elementId: 1, newFindings: [
      { id: 4, tier: "T1", elementId: 1 },
    ], sigMatches: [{ id: "BIDI-FLIP-01" }] },
    fakeSender(10)
  );
  const state = getTabState(10);
  expect(state.findings).toHaveLength(2); // 1 replaced + 1 from elementId 2
  expect(state.findings.map(f => f.id).sort()).toEqual([3, 4]);
  expect(state.byTier).toEqual({ T1: 1, T2: 0, T3: 1 });
  expect(state.total).toBe(2);
  expect(state.sigMatches).toEqual([{ id: "BIDI-FLIP-01" }]);
});

test("FINDINGS_REPLACE: no-op if tab has no state", () => {
  const result = handleMessage(
    { type: "FINDINGS_REPLACE", elementId: 1, newFindings: [], sigMatches: [] },
    fakeSender(99)
  );
  expect(getTabState(99)).toBeNull();
});

test("FINDINGS_REPLACE: replacing with empty array removes element findings", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [
      { id: 1, tier: "T1", elementId: 1 },
    ], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  handleMessage(
    { type: "FINDINGS_REPLACE", elementId: 1, newFindings: [], sigMatches: [] },
    fakeSender(10)
  );
  const state = getTabState(10);
  expect(state.findings).toHaveLength(0);
  expect(state.total).toBe(0);
});

test("no false negatives: FINDINGS_REPLACE preserves unrelated element findings", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [
      { id: 1, tier: "T1", elementId: 1 },
    ], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [
      { id: 2, tier: "T2", elementId: 2 },
      { id: 3, tier: "T3", elementId: 2 },
    ], sigMatches: [], elementId: 2 },
    fakeSender(10)
  );
  // Replace only elementId 1
  handleMessage(
    { type: "FINDINGS_REPLACE", elementId: 1, newFindings: [], sigMatches: [] },
    fakeSender(10)
  );
  const state = getTabState(10);
  expect(state.findings).toHaveLength(2);
  expect(state.findings.every(f => f.elementId === 2)).toBe(true);
});

test("tab cleanup: removing tab deletes all state", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T1", elementId: 1 }], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  expect(getTabState(10)).not.toBeNull();
  // Simulate chrome.tabs.onRemoved
  resetTabState(10);
  expect(getTabState(10)).toBeNull();
});

test("TRIGGER_SCAN: creates placeholder state with status=scanning", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  const state = getTabState(10);
  expect(state).not.toBeNull();
  expect(state.status).toBe("scanning");
  expect(state.findings).toEqual([]);
  expect(state.total).toBe(0);
  expect(state.byTier).toEqual({ T1: 0, T2: 0, T3: 0 });
  expect(state.sigMatches).toEqual([]);
});

test("TRIGGER_SCAN: GET_FINDINGS surfaces the scanning status", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  const state = handleMessage({ type: "GET_FINDINGS", tabId: 10 }, fakeSender(10));
  expect(state.status).toBe("scanning");
});

test("TRIGGER_SCAN: FINDINGS_BATCH preserves the status field", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T1", elementId: 1 }], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  const state = getTabState(10);
  expect(state.status).toBe("scanning");
  expect(state.total).toBe(1);
});

test("TRIGGER_SCAN: ignored when neither sender.tab nor msg.tabId is present", () => {
  const result = handleMessage({ type: "TRIGGER_SCAN" }, { id: "popup-origin" });
  expect(result).toBeUndefined();
  expect(getTabState(10)).toBeNull();
});

test("TRIGGER_SCAN: resets any prior findings on the tab", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T1", elementId: 1 }], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  expect(getTabState(10).total).toBe(1);
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  expect(getTabState(10).total).toBe(0);
  expect(getTabState(10).status).toBe("scanning");
});

test("SCAN_READY: drops the status field but preserves findings", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T1", elementId: 1 }], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  handleMessage({ type: "SCAN_READY" }, fakeSender(10));
  const state = getTabState(10);
  expect(state.status).toBeUndefined();
  expect(state.total).toBe(1);
});

test("SCAN_READY: clears status on a page with zero findings", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  handleMessage({ type: "SCAN_READY" }, fakeSender(10));
  const state = getTabState(10);
  expect(state.status).toBeUndefined();
  expect(state.total).toBe(0);
  expect(state.findings).toEqual([]);
});

test("SCAN_READY: no-op when tab has no prior state", () => {
  const result = handleMessage({ type: "SCAN_READY" }, fakeSender(99));
  expect(result).toBeUndefined();
  expect(getTabState(99)).toBeNull();
});

test("SCAN_READY: ignored when sender has no tab", () => {
  const result = handleMessage({ type: "SCAN_READY" }, { id: "popup-origin" });
  expect(result).toBeUndefined();
});

test("onTabUpdated: status=loading clears tab state", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T1", elementId: 1 }], sigMatches: [], elementId: 1 },
    fakeSender(10)
  );
  expect(getTabState(10)).not.toBeNull();
  onTabUpdated(10, { status: "loading" });
  expect(getTabState(10)).toBeNull();
});

test("onTabUpdated: status=complete does NOT clear state", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  onTabUpdated(10, { status: "complete" });
  expect(getTabState(10)).not.toBeNull();
});

test("onTabUpdated: unrelated changeInfo is a no-op", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  onTabUpdated(10, { title: "new title" });
  expect(getTabState(10)).not.toBeNull();
});

test("TRIGGER_SCAN: accepts tabId from msg when sender has no tab (popup origin)", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 55 }, { id: "popup-origin" });
  expect(getTabState(55)).not.toBeNull();
  expect(getTabState(55).status).toBe("scanning");
});

test("TRIGGER_SCAN: rejected when sender is a content script (popup-only contract)", () => {
  // Defense in depth: a content script bug should not be able to wipe
  // tab state by issuing TRIGGER_SCAN. Only the popup may trigger scans.
  const result = handleMessage({ type: "TRIGGER_SCAN" }, { tab: { id: 10 } });
  expect(result).toBeUndefined();
  expect(getTabState(10)).toBeNull();
});

test("TRIGGER_SCAN: a tab message with explicit msg.tabId is also rejected", () => {
  const result = handleMessage({ type: "TRIGGER_SCAN", tabId: 99 }, { tab: { id: 10 } });
  expect(result).toBeUndefined();
  expect(getTabState(99)).toBeNull();
  expect(getTabState(10)).toBeNull();
});

test("markTabUnsupported: only wipes findings when status was 'scanning' (defensive contract)", () => {
  // Seed state from a completed scan: SCAN_READY clears 'status'.
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [{ id: 1, tier: "T1", elementId: 1 }], sigMatches: [], elementId: 1 },
    fakeSender(10),
  );
  handleMessage({ type: "SCAN_READY" }, fakeSender(10));
  expect(getTabState(10).status).toBeUndefined();
  expect(getTabState(10).total).toBe(1);
  // A spurious markTabUnsupported on a completed scan must NOT wipe findings.
  markTabUnsupported(10);
  expect(getTabState(10).total).toBe(1);
  expect(getTabState(10).status).toBeUndefined();
});

test("SIGNATURES_UPDATE: replaces sigMatches without touching findings or byTier", () => {
  handleMessage(
    { type: "FINDINGS_BATCH", newFindings: [
      { id: 1, tier: "T2", elementId: 1 },
      { id: 2, tier: "T3", elementId: 1 },
    ], sigMatches: [], elementId: 1 },
    fakeSender(10),
  );
  handleMessage(
    { type: "SIGNATURES_UPDATE", sigMatches: [{ id: "GW-DECODE-02" }] },
    fakeSender(10),
  );
  const state = getTabState(10);
  expect(state.findings).toHaveLength(2);
  expect(state.byTier).toEqual({ T1: 0, T2: 1, T3: 1 });
  expect(state.sigMatches).toEqual([{ id: "GW-DECODE-02" }]);
});

test("SIGNATURES_UPDATE: no-op when tab has no state", () => {
  const result = handleMessage(
    { type: "SIGNATURES_UPDATE", sigMatches: [{ id: "X" }] },
    fakeSender(99),
  );
  expect(result).toBeUndefined();
  expect(getTabState(99)).toBeNull();
});

test("markTabUnsupported: sets status='unsupported' and clears findings", () => {
  // The wiring layer calls this when chrome.scripting.executeScript rejects
  // (chrome:// pages, restricted URLs, missing host permission, etc).
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  expect(getTabState(10).status).toBe("scanning");
  markTabUnsupported(10);
  const state = getTabState(10);
  expect(state.status).toBe("unsupported");
  expect(state.findings).toEqual([]);
  expect(state.total).toBe(0);
});

test("markTabUnsupported: no-op when tab has no state (avoid resurrecting cleaned-up tabs)", () => {
  markTabUnsupported(99);
  expect(getTabState(99)).toBeNull();
});

test("GET_FINDINGS: surfaces 'unsupported' status so the popup can show a distinct UI", () => {
  handleMessage({ type: "TRIGGER_SCAN", tabId: 10 }, { id: "popup-origin" });
  markTabUnsupported(10);
  const state = handleMessage({ type: "GET_FINDINGS", tabId: 10 }, fakeSender(10));
  expect(state.status).toBe("unsupported");
});
