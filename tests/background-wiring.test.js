// Exercises the Chrome API wiring block at the bottom of background.js.
// We set up a full chrome mock, jest.resetModules, then re-import the module
// so the wiring block runs against the mock and we can invoke the captured
// onMessage listener directly.

import { jest } from "@jest/globals";

let onMessageListener;
let insertCSS;
let executeScript;

beforeEach(async () => {
  jest.resetModules();
  insertCSS = jest.fn().mockResolvedValue(undefined);
  executeScript = jest.fn().mockResolvedValue(undefined);
  const onMessageAdd = jest.fn((cb) => { onMessageListener = cb; });
  global.chrome = {
    runtime: { onMessage: { addListener: onMessageAdd } },
    scripting: { insertCSS, executeScript },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    tabs: {
      onRemoved: { addListener: jest.fn() },
      onUpdated: { addListener: jest.fn() },
    },
  };
  await import("../src/background/background.js");
});

test("TRIGGER_SCAN wiring: listener calls insertCSS and executeScript with the injected tabId", () => {
  onMessageListener({ type: "TRIGGER_SCAN" }, { tab: { id: 42 } }, () => {});
  expect(insertCSS).toHaveBeenCalledWith({ target: { tabId: 42 }, files: ["dist/content.css"] });
  expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 42 }, files: ["dist/src/content/content.js"] });
});

test("TRIGGER_SCAN wiring: non-trigger messages do not hit chrome.scripting", () => {
  onMessageListener({ type: "FINDINGS_BATCH", newFindings: [], sigMatches: [], elementId: 1 },
    { tab: { id: 10 } }, () => {});
  expect(insertCSS).not.toHaveBeenCalled();
  expect(executeScript).not.toHaveBeenCalled();
});
