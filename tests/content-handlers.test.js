import { jest } from "@jest/globals";

function FakeMutationObserver(cb) {
  this._cb = cb;
  this.observe = function () {};
  this.disconnect = function () {};
  this.takeRecords = function () { return []; };
}

beforeEach(() => {
  delete window.__usent_installed;
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  jest.resetModules();
  global.MutationObserver = FakeMutationObserver;
  global.IntersectionObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    disconnect: jest.fn(),
  }));
  global.chrome = {
    runtime: {
      sendMessage: jest.fn(),
      onMessage: { addListener: jest.fn() },
    },
    storage: {
      sync: { get: jest.fn(async () => ({})) },
      onChanged: { addListener: jest.fn() },
    },
  };
});

test("idempotency: calling init twice installs only one body-level MutationObserver", async () => {
  const moSpy = jest.spyOn(globalThis, "MutationObserver");
  const { init } = await import("../src/content/content.js");
  await init();
  const firstCount = moSpy.mock.instances.length;
  await init();
  expect(moSpy.mock.instances.length).toBe(firstCount);
  moSpy.mockRestore();
});

test("SCAN_READY: init sends SCAN_READY after initial sweep on an empty DOM", async () => {
  const { init } = await import("../src/content/content.js");
  await init();
  const types = chrome.runtime.sendMessage.mock.calls.map(c => c[0].type);
  expect(types).toContain("SCAN_READY");
});

test("SCAN_READY: init sends SCAN_READY on a DOM with code blocks", async () => {
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode("clean"));
  document.body.appendChild(pre);
  const { init } = await import("../src/content/content.js");
  await init();
  const types = chrome.runtime.sendMessage.mock.calls.map(c => c[0].type);
  expect(types).toContain("SCAN_READY");
});

test("RESCAN handler: walks CODE_SEL elements after init", async () => {
  const preA = document.createElement("pre");
  preA.appendChild(document.createTextNode("a"));
  const preB = document.createElement("pre");
  preB.appendChild(document.createTextNode("b"));
  document.body.appendChild(preA);
  document.body.appendChild(preB);

  await import("../src/content/content.js");
  await new Promise(r => setTimeout(r, 0));

  const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  chrome.runtime.sendMessage.mockClear();

  listener({ type: "RESCAN" }, { tab: { id: 1 } }, () => {});

  const types = chrome.runtime.sendMessage.mock.calls.map(c => c[0].type);
  expect(
    types.filter(t => t === "FINDINGS_BATCH" || t === "FINDINGS_REPLACE").length
  ).toBeGreaterThanOrEqual(2);
});
