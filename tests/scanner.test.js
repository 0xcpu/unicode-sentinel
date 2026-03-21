// tests/scanner.test.js
import { scanText } from "../src/content/scanner.js";
import { TIER } from "../src/shared/codepoints.js";

test("returns empty array for clean ASCII", () => {
  expect(scanText("hello world")).toEqual([]);
});

test("detects single T1 variation selector at offset 3", () => {
  const text = "abc\uFE00def";
  const findings = scanText(text);
  expect(findings).toHaveLength(1);
  expect(findings[0].tier).toBe(TIER.T1);
  expect(findings[0].codepoint).toBe(0xfe00);
  expect(findings[0].offset).toBe(3);
});

test("detects T2 bidi override", () => {
  const text = "code\u202Emore";
  const findings = scanText(text);
  expect(findings[0].tier).toBe(TIER.T2);
  expect(findings[0].codepoint).toBe(0x202e);
});

test("detects T3 soft hyphen", () => {
  const text = "re\u00ADsume";
  const findings = scanText(text);
  expect(findings[0].tier).toBe(TIER.T3);
});

test("detects multiple chars of different tiers", () => {
  const text = "\uFE00\u202E\u00AD";
  const findings = scanText(text);
  expect(findings).toHaveLength(3);
  expect(findings.map(f => f.tier)).toEqual([TIER.T1, TIER.T2, TIER.T3]);
});

test("handles supplementary plane PUA codepoint (U+F0001)", () => {
  const text = "x\uDB80\uDC01y";
  const findings = scanText(text);
  expect(findings).toHaveLength(1);
  expect(findings[0].codepoint).toBe(0xf0001);
  expect(findings[0].tier).toBe(TIER.T2);
});

test("offset for supplementary plane accounts for surrogate pair", () => {
  const text = "ab\uDB80\uDC01c";
  const findings = scanText(text);
  expect(findings[0].offset).toBe(2);
});

test("each finding includes category", () => {
  const findings = scanText("\uFE00");
  expect(findings[0].category).toBe("variation-selector");
});
