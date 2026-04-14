// tests/observer.test.js
//
// Tests for the MutationObserver helper. These verify that characterData
// mutations and removedNodes are dispatched to the right callbacks — the
// feature needed for S1 (re-scan on text change) and for the no-stale-text
// fix (signature matches must not reflect removed DOM).

import { makeMutationObserver } from "../src/content/observer.js";

function mkContainer() {
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

function flush() {
  // MutationObserver delivers records as microtasks; await a settled promise.
  return Promise.resolve().then(() => Promise.resolve());
}

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

test("onAdded fires when an element is inserted", async () => {
  const added = [];
  const mo = makeMutationObserver({ onAdded: (el) => added.push(el) });
  const c = mkContainer();
  mo.observe(c, { childList: true, subtree: true });

  const p = document.createElement("pre");
  c.appendChild(p);

  await flush();
  mo.disconnect();
  expect(added).toHaveLength(1);
  expect(added[0]).toBe(p);
});

test("onChanged fires when text inside a tracked element changes", async () => {
  const changed = [];
  const mo = makeMutationObserver({ onChanged: (el) => changed.push(el) });
  const c = mkContainer();
  const p = document.createElement("pre");
  p.appendChild(document.createTextNode("hello"));
  c.appendChild(p);
  mo.observe(c, { childList: true, subtree: true, characterData: true });

  p.firstChild.data = "hello world";

  await flush();
  mo.disconnect();
  expect(changed).toHaveLength(1);
  expect(changed[0]).toBe(p); // ancestor element, not the text node itself
});

test("onRemoved fires when an element is removed", async () => {
  const removed = [];
  const mo = makeMutationObserver({ onRemoved: (el) => removed.push(el) });
  const c = mkContainer();
  const p = document.createElement("pre");
  c.appendChild(p);
  mo.observe(c, { childList: true, subtree: true });

  c.removeChild(p);

  await flush();
  mo.disconnect();
  expect(removed).toHaveLength(1);
  expect(removed[0]).toBe(p);
});

test("only provided callbacks are invoked (no onChanged means no dispatch)", async () => {
  const added = [];
  const mo = makeMutationObserver({ onAdded: (el) => added.push(el) });
  // no onChanged callback
  const c = mkContainer();
  const p = document.createElement("pre");
  p.appendChild(document.createTextNode("text"));
  c.appendChild(p);
  mo.observe(c, { childList: true, subtree: true, characterData: true });

  p.firstChild.data = "changed";
  // this should NOT throw — missing callback is a no-op
  await flush();
  mo.disconnect();
  expect(added).toEqual([]); // no new element added, just text changed
});

test("non-element added nodes are ignored", async () => {
  const added = [];
  const mo = makeMutationObserver({ onAdded: (el) => added.push(el) });
  const c = mkContainer();
  mo.observe(c, { childList: true, subtree: true });

  c.appendChild(document.createTextNode("just text"));

  await flush();
  mo.disconnect();
  expect(added).toEqual([]);
});

test("no false negatives: text-node insertion into an existing element fires onChanged", async () => {
  // Regression test for C2: if JS appends a new text node (e.g., with suspicious
  // chars) to an already-scanned code block, the observer must treat it as a
  // text change so the content script can re-scan. Before the fix, text-node
  // additions were silently dropped (addedNodes iteration skipped non-elements).
  const changed = [];
  const added = [];
  const mo = makeMutationObserver({
    onAdded: (el) => added.push(el),
    onChanged: (el) => changed.push(el),
  });
  const c = mkContainer();
  const p = document.createElement("pre");
  p.appendChild(document.createTextNode("original "));
  c.appendChild(p);
  mo.observe(c, { childList: true, subtree: true, characterData: true });

  // Simulate JS appending suspicious content to an already-present code block.
  p.appendChild(document.createTextNode("appended \uFE00"));

  await flush();
  mo.disconnect();
  // The appended text node should have triggered onChanged with the <pre>
  expect(changed).toContain(p);
  // And onAdded should NOT fire for text nodes
  expect(added).toEqual([]);
});

test("no false positives: unobserved mutations do not invoke callbacks", async () => {
  const added = [];
  const changed = [];
  const removed = [];
  const mo = makeMutationObserver({
    onAdded: (el) => added.push(el),
    onChanged: (el) => changed.push(el),
    onRemoved: (el) => removed.push(el),
  });
  const c = mkContainer();
  // not observing yet — this mutation should not fire
  c.appendChild(document.createElement("pre"));
  await flush();
  expect(added).toEqual([]);
  expect(changed).toEqual([]);
  expect(removed).toEqual([]);
  mo.disconnect();
});
