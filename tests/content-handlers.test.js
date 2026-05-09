import { jest } from "@jest/globals";

function FakeMutationObserver(cb) {
  this._cb = cb;
  this.observe = function () {};
  this.disconnect = function () {};
  this.takeRecords = function () {
    return [];
  };
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
  const types = chrome.runtime.sendMessage.mock.calls.map((c) => c[0].type);
  expect(types).toContain("SCAN_READY");
});

test("SCAN_READY: init sends SCAN_READY on a DOM with code blocks", async () => {
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode("clean"));
  document.body.appendChild(pre);
  const { init } = await import("../src/content/content.js");
  await init();
  const types = chrome.runtime.sendMessage.mock.calls.map((c) => c[0].type);
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
  await new Promise((r) => setTimeout(r, 0));

  const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  chrome.runtime.sendMessage.mockClear();

  listener({ type: "RESCAN" }, { tab: { id: 1 } }, () => {});

  const types = chrome.runtime.sendMessage.mock.calls.map((c) => c[0].type);
  expect(
    types.filter((t) => t === "FINDINGS_BATCH" || t === "FINDINGS_REPLACE")
      .length,
  ).toBeGreaterThanOrEqual(2);
});

test("RESCAN handler: sends SCAN_READY at end so the popup poll can exit (C1 fix)", async () => {
  // Without this, a TRIGGER_SCAN that gets routed to RESCAN (because the content
  // script is already installed) would leave status='scanning' indefinitely.
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode("hello"));
  document.body.appendChild(pre);

  await import("../src/content/content.js");
  await new Promise((r) => setTimeout(r, 0));

  const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  chrome.runtime.sendMessage.mockClear();
  listener({ type: "RESCAN" }, { tab: { id: 1 } }, () => {});

  const types = chrome.runtime.sendMessage.mock.calls.map((c) => c[0].type);
  expect(types).toContain("SCAN_READY");
});

test("initial sweep: skips per-batch signature recompute and posts a single SIGNATURES_UPDATE (I2)", async () => {
  // Five code blocks. Without I2, sendBatch would compute signatures 5 times
  // over a growing scanned-text mirror. With I2, FINDINGS_BATCH messages still
  // fire for findings, but their sigMatches are deferred - a single
  // SIGNATURES_UPDATE message follows the sweep.
  for (let i = 0; i < 5; i++) {
    const pre = document.createElement("pre");
    pre.appendChild(document.createTextNode(`block ${i} ︀`));
    document.body.appendChild(pre);
  }

  await import("../src/content/content.js");
  await new Promise((r) => setTimeout(r, 0));

  const messages = chrome.runtime.sendMessage.mock.calls.map((c) => c[0]);
  const batches = messages.filter((m) => m.type === "FINDINGS_BATCH");
  expect(batches.length).toBe(5);
  for (const b of batches) {
    // sigMatches deferred during bulk sweep
    expect(b.sigMatches).toEqual([]);
  }
  const sigUpdates = messages.filter((m) => m.type === "SIGNATURES_UPDATE");
  expect(sigUpdates.length).toBe(1);
});

test("post-init updates: signature recompute is NOT deferred (sigMatches travel with each batch)", async () => {
  // After init's bulk sweep ends, ordinary mutations should fall back to the
  // synchronous sigMatches path so signature warnings stay live without
  // requiring a follow-up SIGNATURES_UPDATE round-trip.
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode("clean"));
  document.body.appendChild(pre);

  await import("../src/content/content.js");
  await new Promise((r) => setTimeout(r, 0));

  const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  chrome.runtime.sendMessage.mockClear();
  // Trigger a rescan after init - this is the post-bulk path.
  listener({ type: "RESCAN" }, { tab: { id: 1 } }, () => {});

  const messages = chrome.runtime.sendMessage.mock.calls.map((c) => c[0]);
  const replaces = messages.filter((m) => m.type === "FINDINGS_REPLACE");
  // sigMatches must be carried inline on FINDINGS_REPLACE in steady state.
  for (const r of replaces) {
    expect(Array.isArray(r.sigMatches)).toBe(true);
  }
});
