// Exercises the Chrome API wiring block at the bottom of background.js.
// We set up a full chrome mock, jest.resetModules, then re-import the module
// so the wiring block runs against the mock and we can invoke the captured
// onMessage listener directly.

import { jest } from "@jest/globals";

let onMessageListener;
let insertCSS;
let executeScript;
let tabsSendMessage;
let getTabState;

async function flushAsync() {
  // Multiple microtask flushes - the wiring chains promises with .catch handlers.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(async () => {
  jest.resetModules();
  insertCSS = jest.fn().mockResolvedValue(undefined);
  executeScript = jest.fn().mockResolvedValue(undefined);
  tabsSendMessage = jest.fn().mockResolvedValue({ alive: true });
  const onMessageAdd = jest.fn((cb) => {
    onMessageListener = cb;
  });
  global.chrome = {
    runtime: { onMessage: { addListener: onMessageAdd } },
    scripting: { insertCSS, executeScript },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    tabs: {
      onRemoved: { addListener: jest.fn() },
      onUpdated: { addListener: jest.fn() },
      sendMessage: (...args) => tabsSendMessage(...args),
    },
  };
  ({ getTabState } = await import("../src/background/background.js"));
});

test("TRIGGER_SCAN wiring: tries tabs.sendMessage(RESCAN) first; if a content script answers, executeScript is NOT called", async () => {
  tabsSendMessage.mockResolvedValueOnce({ alive: true });
  onMessageListener(
    { type: "TRIGGER_SCAN", tabId: 42 },
    { id: "popup-origin" },
    () => {},
  );
  await flushAsync();
  expect(tabsSendMessage).toHaveBeenCalledWith(42, { type: "RESCAN" });
  expect(executeScript).not.toHaveBeenCalled();
  expect(insertCSS).not.toHaveBeenCalled();
});

test("TRIGGER_SCAN wiring: when no content script is listening, falls back to insertCSS + executeScript", async () => {
  tabsSendMessage.mockRejectedValueOnce(
    new Error("Could not establish connection"),
  );
  onMessageListener(
    { type: "TRIGGER_SCAN", tabId: 42 },
    { id: "popup-origin" },
    () => {},
  );
  await flushAsync();
  expect(tabsSendMessage).toHaveBeenCalledWith(42, { type: "RESCAN" });
  expect(insertCSS).toHaveBeenCalledWith({
    target: { tabId: 42 },
    files: ["dist/content.css"],
  });
  expect(executeScript).toHaveBeenCalledWith({
    target: { tabId: 42 },
    files: ["dist/src/content/content.js"],
  });
});

test("TRIGGER_SCAN wiring: executeScript failure marks tab status='unsupported' so the popup can stop polling", async () => {
  tabsSendMessage.mockRejectedValueOnce(new Error("no listener"));
  executeScript.mockRejectedValueOnce(
    new Error("Cannot access contents of url 'chrome://newtab/'"),
  );
  onMessageListener(
    { type: "TRIGGER_SCAN", tabId: 42 },
    { id: "popup-origin" },
    () => {},
  );
  await flushAsync();
  const state = getTabState(42);
  expect(state).not.toBeNull();
  expect(state.status).toBe("unsupported");
});

test("TRIGGER_SCAN wiring: insertCSS failure alone does NOT mark the tab unsupported (CSS is best-effort)", async () => {
  tabsSendMessage.mockRejectedValueOnce(new Error("no listener"));
  insertCSS.mockRejectedValueOnce(new Error("CSS injection refused"));
  // executeScript still resolves - content script will run, just without our markers css.
  onMessageListener(
    { type: "TRIGGER_SCAN", tabId: 42 },
    { id: "popup-origin" },
    () => {},
  );
  await flushAsync();
  const state = getTabState(42);
  expect(state.status).toBe("scanning");
});

test("TRIGGER_SCAN wiring: non-trigger messages do not hit chrome.scripting or chrome.tabs.sendMessage", () => {
  onMessageListener(
    { type: "FINDINGS_BATCH", newFindings: [], sigMatches: [], elementId: 1 },
    { tab: { id: 10 } },
    () => {},
  );
  expect(insertCSS).not.toHaveBeenCalled();
  expect(executeScript).not.toHaveBeenCalled();
  expect(tabsSendMessage).not.toHaveBeenCalled();
});

test("SIGNATURES_UPDATE wiring: badge update is dispatched after sigMatches change", () => {
  // Seed state via FINDINGS_BATCH so byTier is populated.
  onMessageListener(
    {
      type: "FINDINGS_BATCH",
      newFindings: [{ id: 1, tier: "T2", elementId: 1 }],
      sigMatches: [],
      elementId: 1,
    },
    { tab: { id: 10 } },
    () => {},
  );
  chrome.action.setBadgeText.mockClear();
  onMessageListener(
    { type: "SIGNATURES_UPDATE", sigMatches: [{ id: "GW-DECODE-02" }] },
    { tab: { id: 10 } },
    () => {},
  );
  expect(chrome.action.setBadgeText).toHaveBeenCalled();
  // T1 promotion via signature match should make the badge red.
  expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith(
    expect.objectContaining({ color: "#dc2626", tabId: 10 }),
  );
});
