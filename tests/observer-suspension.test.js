// tests/observer-suspension.test.js
//
// Regression test for a performance bug where the content script's own DOM
// mutations (wrapping suspicious codepoints with marker spans, or removing
// markers before a re-scan) would be observed by the MutationObserver and
// dispatched as text-change events, triggering a re-scan, which mutated again,
// which fired the observer again — an infinite feedback loop that made new
// tabs unusable.
//
// The fix is to suspend the observer around scan-triggered DOM mutations:
//   mo.disconnect(); mutate; mo.takeRecords(); mo.observe(...)
//
// These tests verify that pattern works: our own mutations produce zero
// callbacks, while legitimate page-caused mutations still fire normally.

import { makeMutationObserver } from "../src/content/observer.js";
import { buildFragment, removeMarkers } from "../src/content/marker.js";
import { scanText } from "../src/content/scanner.js";

function flush() {
  return Promise.resolve().then(() => Promise.resolve());
}

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

const MO_CONFIG = { childList: true, subtree: true, characterData: true };

test("disconnect/takeRecords/observe prevents self-triggered callbacks", async () => {
  const calls = { added: 0, changed: 0, removed: 0 };
  const mo = makeMutationObserver({
    onAdded: () => calls.added++,
    onChanged: () => calls.changed++,
    onRemoved: () => calls.removed++,
  });
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode("code\uFE00here"));
  document.body.appendChild(pre);
  mo.observe(document.body, MO_CONFIG);

  // Simulate a scanner pass: wrap a text node with marker fragment, WITHIN a
  // suspended window. This is exactly what content.js's withSuspendedObserver
  // does around scanAndEnrich.
  mo.disconnect();
  const textNode = pre.firstChild;
  const findings = scanText(textNode.textContent);
  const frag = buildFragment(textNode, findings, { groupThreshold: 4 });
  pre.replaceChild(frag, textNode);
  mo.takeRecords();
  mo.observe(document.body, MO_CONFIG);

  await flush();
  mo.disconnect();

  // No callbacks should have fired — mutations happened while disconnected.
  expect(calls.added).toBe(0);
  expect(calls.changed).toBe(0);
  expect(calls.removed).toBe(0);
});

test("page-caused mutations still fire after suspended scan completes", async () => {
  // This proves the suspension pattern is scoped — after reconnect, legitimate
  // page mutations are still detected. Without this, the C2 fix would regress.
  const changed = [];
  const mo = makeMutationObserver({
    onChanged: (el) => changed.push(el),
  });
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode("clean code"));
  document.body.appendChild(pre);
  mo.observe(document.body, MO_CONFIG);

  // Simulated scan (no suspicious chars to wrap, but the suspend/reconnect
  // cycle should still leave the observer operational).
  mo.disconnect();
  // (no-op scan — clean text produces no mutations)
  mo.takeRecords();
  mo.observe(document.body, MO_CONFIG);

  // Page JS appends a suspicious text node — must fire onChanged(pre).
  pre.appendChild(document.createTextNode("\uFE00"));

  await flush();
  mo.disconnect();
  expect(changed).toContain(pre);
});

test("per-element characterData observer catches in-place text edits", async () => {
  // Models the content-script design after the performance fix: instead of
  // watching characterData at body level (which fires on every text tick
  // anywhere on the page), each processed code block gets its own narrow
  // observer. This verifies that pattern still catches the S1 scenario.
  let rescanCount = 0;
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode("original"));
  document.body.appendChild(pre);

  const obs = new MutationObserver(() => rescanCount++);
  obs.observe(pre, { characterData: true, subtree: true });

  pre.firstChild.data = "changed \uFE00";
  await flush();

  obs.disconnect();
  expect(rescanCount).toBeGreaterThanOrEqual(1);
});

test("performance: per-element observer ignores text edits outside its scope", async () => {
  // Core performance property — a characterData edit elsewhere on the page
  // must NOT fire the per-element observer. Without this, the old
  // body-level `characterData: true, subtree: true` config generated
  // callback storms that froze the browser.
  let rescanCount = 0;
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode("code"));
  document.body.appendChild(pre);

  const unrelated = document.createElement("div");
  unrelated.appendChild(document.createTextNode("ticker 00:00"));
  document.body.appendChild(unrelated);

  const obs = new MutationObserver(() => rescanCount++);
  obs.observe(pre, { characterData: true, subtree: true });

  // Simulate 100 unrelated text mutations (e.g., a live ticker updating).
  for (let i = 0; i < 100; i++) {
    unrelated.firstChild.data = `ticker ${String(i).padStart(2, "0")}:${i}`;
  }
  await flush();

  obs.disconnect();
  expect(rescanCount).toBe(0); // zero noise from unrelated mutations
});

test("repeated scan + rescan cycles do not accumulate callbacks (no feedback loop)", async () => {
  // Simulates a live site where the scanner initial-scans a <pre>, then a
  // subsequent DOM mutation triggers a rescan. Before the fix, this cycle
  // exploded exponentially. After the fix, each cycle should produce at most
  // one legitimate callback (the external trigger), not a cascade.
  let changedCount = 0;
  const mo = makeMutationObserver({
    onChanged: () => changedCount++,
  });
  const pre = document.createElement("pre");
  pre.appendChild(document.createTextNode("x\uFE00y"));
  document.body.appendChild(pre);
  mo.observe(document.body, MO_CONFIG);

  // Simulated initial scan — wrap codepoints (suspended).
  mo.disconnect();
  const t1 = pre.firstChild;
  const f1 = scanText(t1.textContent);
  pre.replaceChild(buildFragment(t1, f1, { groupThreshold: 4 }), t1);
  mo.takeRecords();
  mo.observe(document.body, MO_CONFIG);
  await flush();
  expect(changedCount).toBe(0);

  // Simulated page mutation: append new text
  pre.appendChild(document.createTextNode("\u202E"));
  await flush();
  expect(changedCount).toBeGreaterThanOrEqual(1);
  const afterPageMutation = changedCount;

  // Simulated rescan — remove markers, re-wrap (suspended).
  mo.disconnect();
  removeMarkers(pre);
  const t2 = pre.firstChild; // now a single reconstructed text node
  const f2 = scanText(t2.textContent);
  if (f2.length > 0) {
    pre.replaceChild(buildFragment(t2, f2, { groupThreshold: 4 }), t2);
  }
  mo.takeRecords();
  mo.observe(document.body, MO_CONFIG);
  await flush();

  // Crucially: changedCount should NOT have grown exponentially.
  // Zero new callbacks beyond the legitimate page-mutation trigger.
  expect(changedCount).toBe(afterPageMutation);
  mo.disconnect();
});
