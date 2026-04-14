/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadPopupDom() {
  const html = readFileSync(resolve(process.cwd(), "src/popup/popup.html"), "utf8");
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
      query: jest.fn(async () => [{ id: 10, url: "https://example.com/", title: "Example" }]),
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
  await new Promise(r => setTimeout(r, 0));
  expect(section("scan-empty").style.display).toBe("block");
  expect(section("scanning").style.display).toBe("none");
  expect(section("scanned").style.display).toBe("none");
});

test("scanning: status=scanning renders the spinner", async () => {
  chrome.runtime.sendMessage = jest.fn(async () => ({
    status: "scanning", findings: [], byTier: { T1: 0, T2: 0, T3: 0 }, total: 0, sigMatches: [],
  }));
  await import("../src/popup/popup.js");
  await new Promise(r => setTimeout(r, 0));
  expect(section("scanning").style.display).toBe("block");
  expect(section("scan-empty").style.display).toBe("none");
  expect(section("scanned").style.display).toBe("none");
});

test("scanned: findings present render the results section", async () => {
  chrome.runtime.sendMessage = jest.fn(async () => ({
    findings: [{ id: 1, codepoint: 0xFE00, tier: "T1", contextBefore: "x" }],
    byTier: { T1: 1, T2: 0, T3: 0 },
    total: 1,
    sigMatches: [],
  }));
  await import("../src/popup/popup.js");
  await new Promise(r => setTimeout(r, 0));
  expect(section("scanned").style.display).toBe("block");
  expect(section("scan-empty").style.display).toBe("none");
  expect(section("scanning").style.display).toBe("none");
});

test("scan button: dispatches TRIGGER_SCAN with tabId to the background", async () => {
  chrome.runtime.sendMessage = jest.fn(async () => null);
  await import("../src/popup/popup.js");
  await new Promise(r => setTimeout(r, 0));

  chrome.runtime.sendMessage.mockClear();
  document.getElementById("scan-btn").click();

  const calls = chrome.runtime.sendMessage.mock.calls.map(c => c[0]);
  expect(calls).toContainEqual({ type: "TRIGGER_SCAN", tabId: 10 });
});

test("scanning poll: transitions to scanned when status clears", async () => {
  jest.useFakeTimers();
  let poll = 0;
  chrome.runtime.sendMessage = jest.fn(async () => {
    poll += 1;
    if (poll <= 2) {
      return { status: "scanning", findings: [], byTier: { T1: 0, T2: 0, T3: 0 }, total: 0, sigMatches: [] };
    }
    return { findings: [], byTier: { T1: 0, T2: 0, T3: 0 }, total: 0, sigMatches: [] };
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
    status: "scanning", findings: [], byTier: { T1: 0, T2: 0, T3: 0 }, total: 0, sigMatches: [],
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
    findings: [{ id: 1, codepoint: 0xFE00, tier: "T1", contextBefore: "x" }],
    byTier: { T1: 1, T2: 0, T3: 0 }, total: 1, sigMatches: [],
  }));

  await import("../src/popup/popup.js");
  await new Promise(r => setTimeout(r, 0));

  chrome.tabs.sendMessage.mockClear();
  document.getElementById("rescan-btn").click();

  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(10, { type: "RESCAN" });
});
