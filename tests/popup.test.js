/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadPopupDom() {
  const html = readFileSync(
    resolve(process.cwd(), "src/popup/popup.html"),
    "utf8",
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  for (const node of Array.from(doc.body.childNodes)) {
    document.body.appendChild(document.importNode(node, true));
  }
}

beforeEach(() => {
  loadPopupDom();
  jest.resetModules();
  global.chrome = {
    tabs: {
      query: jest.fn(async () => [
        { id: 10, url: "https://example.com/", title: "Example" },
      ]),
      sendMessage: jest.fn(async () => undefined),
    },
    runtime: {
      sendMessage: jest.fn(async () => null),
    },
  };
});

function section(id) {
  return document.getElementById(id);
}

test("unscanned: null state renders the Scan button and hides others", async () => {
  chrome.runtime.sendMessage = jest.fn(async () => null);
  await import("../src/popup/popup.js");
  await new Promise((r) => setTimeout(r, 0));
  expect(section("scan-empty").style.display).toBe("block");
  expect(section("scanning").style.display).toBe("none");
  expect(section("scanned").style.display).toBe("none");
});

test("scanning: status=scanning renders the spinner", async () => {
  chrome.runtime.sendMessage = jest.fn(async () => ({
    status: "scanning",
    findings: [],
    byTier: { T1: 0, T2: 0, T3: 0 },
    total: 0,
    sigMatches: [],
  }));
  await import("../src/popup/popup.js");
  await new Promise((r) => setTimeout(r, 0));
  expect(section("scanning").style.display).toBe("block");
  expect(section("scan-empty").style.display).toBe("none");
  expect(section("scanned").style.display).toBe("none");
});

test("scanned: findings present render the results section", async () => {
  chrome.runtime.sendMessage = jest.fn(async () => ({
    findings: [{ id: 1, codepoint: 0xfe00, tier: "T1", contextBefore: "x" }],
    byTier: { T1: 1, T2: 0, T3: 0 },
    total: 1,
    sigMatches: [],
  }));
  await import("../src/popup/popup.js");
  await new Promise((r) => setTimeout(r, 0));
  expect(section("scanned").style.display).toBe("block");
  expect(section("scan-empty").style.display).toBe("none");
  expect(section("scanning").style.display).toBe("none");
});

test("scan button: dispatches TRIGGER_SCAN with tabId to the background", async () => {
  chrome.runtime.sendMessage = jest.fn(async () => null);
  await import("../src/popup/popup.js");
  await new Promise((r) => setTimeout(r, 0));

  chrome.runtime.sendMessage.mockClear();
  document.getElementById("scan-btn").click();

  const calls = chrome.runtime.sendMessage.mock.calls.map((c) => c[0]);
  expect(calls).toContainEqual({ type: "TRIGGER_SCAN", tabId: 10 });
});

test("scanning poll: transitions to scanned when status clears", async () => {
  jest.useFakeTimers();
  let poll = 0;
  chrome.runtime.sendMessage = jest.fn(async () => {
    poll += 1;
    if (poll <= 2) {
      return {
        status: "scanning",
        findings: [],
        byTier: { T1: 0, T2: 0, T3: 0 },
        total: 0,
        sigMatches: [],
      };
    }
    return {
      findings: [],
      byTier: { T1: 0, T2: 0, T3: 0 },
      total: 0,
      sigMatches: [],
    };
  });

  await import("../src/popup/popup.js");
  await Promise.resolve();
  await Promise.resolve();

  expect(document.getElementById("scanning").style.display).toBe("block");

  for (let i = 0; i < 5; i++) {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
  }

  expect(document.getElementById("scanned").style.display).toBe("block");
  expect(document.getElementById("scanning").style.display).toBe("none");
  jest.useRealTimers();
});

test("scanning poll: times out to scan-failed after 5s", async () => {
  jest.useFakeTimers();
  chrome.runtime.sendMessage = jest.fn(async () => ({
    status: "scanning",
    findings: [],
    byTier: { T1: 0, T2: 0, T3: 0 },
    total: 0,
    sigMatches: [],
  }));

  await import("../src/popup/popup.js");
  await Promise.resolve();
  await Promise.resolve();

  for (let i = 0; i < 30; i++) {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
  }

  expect(document.getElementById("scan-failed").style.display).toBe("block");
  jest.useRealTimers();
});

test("rescan button: dispatches RESCAN to the tab", async () => {
  chrome.runtime.sendMessage = jest.fn(async () => ({
    findings: [{ id: 1, codepoint: 0xfe00, tier: "T1", contextBefore: "x" }],
    byTier: { T1: 1, T2: 0, T3: 0 },
    total: 1,
    sigMatches: [],
  }));

  await import("../src/popup/popup.js");
  await new Promise((r) => setTimeout(r, 0));

  chrome.tabs.sendMessage.mockClear();
  document.getElementById("rescan-btn").click();

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(10, { type: "RESCAN" });
});

test("scan poll: first poll fires immediately (no 200ms head-of-line delay) (I3)", async () => {
  jest.useFakeTimers();
  let calls = 0;
  chrome.runtime.sendMessage = jest.fn(async () => {
    calls += 1;
    // First call: no state (so popup wires scan-btn). Subsequent calls: poll.
    if (calls === 1) return null;
    // From poll #1 onward, return a finished scan.
    return {
      findings: [],
      byTier: { T1: 0, T2: 0, T3: 0 },
      total: 0,
      sigMatches: [],
    };
  });

  await import("../src/popup/popup.js");
  await Promise.resolve();
  await Promise.resolve();

  // Click scan-btn - this kicks off TRIGGER_SCAN + poll loop.
  document.getElementById("scan-btn").click();
  // Microtasks only - no setTimeout has fired yet.
  for (let i = 0; i < 5; i++) await Promise.resolve();

  // Without I3 the first poll waits 200ms before firing, leaving us in
  // 'scanning' until at least one timer tick. With I3, the first poll is
  // already in flight and the popup is on its way to 'scanned'.
  expect(document.getElementById("scanned").style.display).toBe("block");
  jest.useRealTimers();
});

test("scan-failed retry: after timeout, retry button dispatches a fresh TRIGGER_SCAN (C1)", async () => {
  jest.useFakeTimers();
  // Always-scanning - the poll will time out and surface scan-failed.
  chrome.runtime.sendMessage = jest.fn(async () => ({
    status: "scanning",
    findings: [],
    byTier: { T1: 0, T2: 0, T3: 0 },
    total: 0,
    sigMatches: [],
  }));

  await import("../src/popup/popup.js");
  await Promise.resolve();
  await Promise.resolve();

  for (let i = 0; i < 30; i++) {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
  }

  expect(document.getElementById("scan-failed").style.display).toBe("block");

  chrome.runtime.sendMessage.mockClear();
  document.getElementById("retry-btn").click();
  await Promise.resolve();

  const types = chrome.runtime.sendMessage.mock.calls.map((c) => c[0].type);
  expect(types).toContain("TRIGGER_SCAN");
  jest.useRealTimers();
});

test("unsupported page: status='unsupported' renders a distinct UI section (C2)", async () => {
  chrome.runtime.sendMessage = jest.fn(async () => ({
    status: "unsupported",
    findings: [],
    byTier: { T1: 0, T2: 0, T3: 0 },
    total: 0,
    sigMatches: [],
  }));

  await import("../src/popup/popup.js");
  await new Promise((r) => setTimeout(r, 0));

  const unsupported = document.getElementById("scan-unsupported");
  expect(unsupported).not.toBeNull();
  expect(unsupported.style.display).toBe("block");
  expect(document.getElementById("scanned").style.display).toBe("none");
  expect(document.getElementById("scan-failed").style.display).toBe("none");
});

test("unsupported page: scanning poll surfaces unsupported status (C2)", async () => {
  // The popup polls while status='scanning'. When the wiring layer detects an
  // executeScript failure it flips status to 'unsupported'. The poll must exit
  // and show scan-unsupported, not scan-failed.
  jest.useFakeTimers();
  let calls = 0;
  chrome.runtime.sendMessage = jest.fn(async () => {
    calls += 1;
    if (calls <= 2)
      return {
        status: "scanning",
        findings: [],
        byTier: { T1: 0, T2: 0, T3: 0 },
        total: 0,
        sigMatches: [],
      };
    return {
      status: "unsupported",
      findings: [],
      byTier: { T1: 0, T2: 0, T3: 0 },
      total: 0,
      sigMatches: [],
    };
  });

  await import("../src/popup/popup.js");
  await Promise.resolve();
  await Promise.resolve();

  for (let i = 0; i < 5; i++) {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
  }

  expect(document.getElementById("scan-unsupported").style.display).toBe(
    "block",
  );
  jest.useRealTimers();
});

test("safeHostname: normal URL returns hostname (S3)", async () => {
  const { safeHostname } = await import("../src/popup/popup.js");
  expect(safeHostname("https://github.com/foo/bar")).toBe("github.com");
});

test("safeHostname: malformed URL falls back to 'page' instead of throwing (S3)", async () => {
  const { safeHostname } = await import("../src/popup/popup.js");
  expect(safeHostname("not-a-url")).toBe("page");
  expect(safeHostname(undefined)).toBe("page");
  expect(safeHostname("")).toBe("page");
});

test("safeHostname: opaque-origin URLs return 'page' so download names stay sane (S3)", async () => {
  const { safeHostname } = await import("../src/popup/popup.js");
  // about:blank and data: URIs parse but have no hostname.
  expect(safeHostname("about:blank")).toBe("page");
  expect(safeHostname("data:text/plain,hi")).toBe("page");
});
