// tests/marker.test.js
import { buildFragment, removeMarkers } from "../src/content/marker.js";

test("clean text: fragment has single text node", () => {
  const node = document.createTextNode("hello");
  const frag = buildFragment(node, []);
  expect(frag.childNodes.length).toBe(1);
  expect(frag.firstChild.nodeType).toBe(Node.TEXT_NODE);
});

test("single T1 finding: wrapped in span.usent-t1", () => {
  const node = document.createTextNode("ab\uFE00cd");
  const findings = [{ codepoint: 0xfe00, tier: "T1", category: "variation-selector", offset: 2 }];
  const frag = buildFragment(node, findings);
  const span = frag.querySelector("span.usent-t1");
  expect(span).not.toBeNull();
  expect(span.dataset.codepoint).toBe("U+FE00");
  expect(span.textContent).toBe("\u2039FE00\u203A");
});

test("T2 finding gets usent-t2 class", () => {
  const node = document.createTextNode("x\u202Ey");
  const findings = [{ codepoint: 0x202e, tier: "T2", category: "bidi-override", offset: 1 }];
  const frag = buildFragment(node, findings);
  expect(frag.querySelector("span.usent-t2")).not.toBeNull();
});

test("text before and after finding preserved as text nodes", () => {
  const node = document.createTextNode("ab\uFE00cd");
  const findings = [{ codepoint: 0xfe00, tier: "T1", category: "variation-selector", offset: 2 }];
  const frag = buildFragment(node, findings);
  const children = Array.from(frag.childNodes);
  expect(children[0].textContent).toBe("ab");
  expect(children[2].textContent).toBe("cd");
});

test("4+ consecutive same-tier findings collapse into group marker", () => {
  const text = "\uFE00\uFE01\uFE02\uFE03rest";
  const node = document.createTextNode(text);
  const findings = [
    { codepoint: 0xfe00, tier: "T1", category: "variation-selector", offset: 0 },
    { codepoint: 0xfe01, tier: "T1", category: "variation-selector", offset: 1 },
    { codepoint: 0xfe02, tier: "T1", category: "variation-selector", offset: 2 },
    { codepoint: 0xfe03, tier: "T1", category: "variation-selector", offset: 3 },
  ];
  const frag = buildFragment(node, findings, { groupThreshold: 4 });
  const spans = Array.from(frag.querySelectorAll("span.usent-marker"));
  expect(spans).toHaveLength(1);
  expect(spans[0].classList.contains("usent-group")).toBe(true);
  expect(spans[0].dataset.count).toBe("4");
});

test("span has title and aria-label containing U+XXXX", () => {
  const node = document.createTextNode("\uFE00");
  const findings = [{ codepoint: 0xfe00, tier: "T1", category: "variation-selector", offset: 0 }];
  const frag = buildFragment(node, findings);
  const span = frag.querySelector("span.usent-marker");
  expect(span.title).toMatch(/U\+FE00/);
  expect(span.getAttribute("aria-label")).toMatch(/U\+FE00/);
});

test("removeMarkers restores original text", () => {
  const parent = document.createElement("div");
  const text = "ab\uFE00cd";
  const node = document.createTextNode(text);
  parent.appendChild(node);
  const findings = [{ codepoint: 0xfe00, tier: "T1", category: "variation-selector", offset: 2 }];
  const frag = buildFragment(node, findings);
  parent.replaceChild(frag, node);
  removeMarkers(parent);
  expect(parent.textContent).toBe("ab\uFE00cd");
});

test("removeMarkers restores all codepoints from a grouped marker", () => {
  const parent = document.createElement("div");
  const text = "start\uFE00\uFE01\uFE02\uFE03end";
  const node = document.createTextNode(text);
  parent.appendChild(node);
  const findings = [
    { codepoint: 0xfe00, tier: "T1", category: "variation-selector", offset: 5 },
    { codepoint: 0xfe01, tier: "T1", category: "variation-selector", offset: 6 },
    { codepoint: 0xfe02, tier: "T1", category: "variation-selector", offset: 7 },
    { codepoint: 0xfe03, tier: "T1", category: "variation-selector", offset: 8 },
  ];
  const frag = buildFragment(node, findings, { groupThreshold: 4 });
  parent.replaceChild(frag, node);

  // Verify it was grouped into a single span
  const spans = parent.querySelectorAll("span.usent-group");
  expect(spans).toHaveLength(1);
  expect(spans[0].dataset.codepoints).toBe("U+FE00,U+FE01,U+FE02,U+FE03");

  // Remove markers and verify all codepoints are restored
  removeMarkers(parent);
  expect(parent.textContent).toBe(text);
});
