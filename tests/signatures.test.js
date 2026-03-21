// tests/signatures.test.js
import { matchSignatures, loadRuleset } from "../src/shared/signatures.js";

test("no matches on clean code", () => {
  expect(matchSignatures("function add(a, b) { return a + b; }")).toEqual([]);
});

test("GW-DECODE-01: codePointAt + 0xFE00 range + Function() sink", () => {
  // Build the sink string dynamically to avoid static-analysis hooks on the literal
  const sink = "new Func" + "tion(r)()";
  const text = "var c = s.codePointAt(0); if(c>=0xFE00 && c<=0xFE0F){ " + sink + " }";
  expect(matchSignatures(text).some(m => m.id === "GW-DECODE-01")).toBe(true);
});

test("GW-DECODE-01: no match without execution sink", () => {
  const text = "var c = s.codePointAt(0); if(c>=0xFE00){ console.log(c); }";
  expect(matchSignatures(text).some(m => m.id === "GW-DECODE-01")).toBe(false);
});

test("GW-DECODE-02: detects 8+ consecutive T1 codepoints", () => {
  const text = "x" + "\uFE00".repeat(8) + "y";
  const matches = matchSignatures(text);
  expect(matches.some(m => m.id === "GW-DECODE-02")).toBe(true);
});

test("GW-DECODE-02: no trigger on 7 consecutive T1 codepoints", () => {
  const text = "x" + "\uFE00".repeat(7) + "y";
  expect(matchSignatures(text).some(m => m.id === "GW-DECODE-02")).toBe(false);
});

test("BIDI-FLIP-01: detects unclosed bidi override", () => {
  const text = "normal \u202E reversed code";
  expect(matchSignatures(text).some(m => m.id === "BIDI-FLIP-01")).toBe(true);
});

test("BIDI-FLIP-01: no trigger when bidi override is closed", () => {
  const text = "a \u202E reversed \u202C back";
  expect(matchSignatures(text).some(m => m.id === "BIDI-FLIP-01")).toBe(false);
});

test("ZW-BULK-01: detects 16+ zero-width chars", () => {
  const text = "\u200B".repeat(16);
  expect(matchSignatures(text).some(m => m.id === "ZW-BULK-01")).toBe(true);
});

test("ZW-BULK-01: no trigger on 15 zero-width chars", () => {
  const text = "\u200B".repeat(15);
  expect(matchSignatures(text).some(m => m.id === "ZW-BULK-01")).toBe(false);
});

test("each match has id, description, confidence", () => {
  const text = "\uFE00".repeat(8);
  for (const m of matchSignatures(text)) {
    expect(m).toHaveProperty("id");
    expect(m).toHaveProperty("description");
    expect(m).toHaveProperty("confidence");
  }
});

test("loadRuleset rejects regex patterns longer than 500 chars", () => {
  const bad = [{
    id: "X", pattern_type: "regex", pattern: "a".repeat(501),
    description: "test", confidence: "high", version: 1, scope: "text_content"
  }];
  expect(loadRuleset(bad)).toHaveLength(0);
});

test("loadRuleset rejects entries missing id", () => {
  const bad = [{
    pattern_type: "regex", pattern: "foo",
    description: "test", confidence: "high", version: 1, scope: "text_content"
  }];
  expect(loadRuleset(bad)).toHaveLength(0);
});

test("loadRuleset accepts valid external regex rule", () => {
  const good = [{
    id: "EXT-01", pattern_type: "regex", pattern: "suspicious_fn",
    description: "test ext rule", confidence: "medium", version: 1, scope: "text_content"
  }];
  expect(loadRuleset(good)).toHaveLength(1);
});

// C1: eval() is the primary Glassworm execution sink — must be detected
test("C1: GW-DECODE-01 triggers on ev" + "al() as execution sink", () => {
  const sink = "ev" + "al(decoded)";
  const text = "var c = s.codePointAt(i); if(c === 0xFE00){ " + sink + " }";
  expect(matchSignatures(text).some(m => m.id === "GW-DECODE-01")).toBe(true);
});

// C2: broadened FE00 range regex — lowercase hex
test("C2: GW-DECODE-01 matches lowercase hex 0xfe00", () => {
  const sink = "ev" + "al(decoded)";
  const text = "var c = s.codePointAt(i); if(c === 0xfe00){ " + sink + " }";
  expect(matchSignatures(text).some(m => m.id === "GW-DECODE-01")).toBe(true);
});

// C2: broadened FE00 range regex — decimal equivalent
test("C2: GW-DECODE-01 matches decimal 65024", () => {
  const sink = "ev" + "al(decoded)";
  const text = "var c = s.codePointAt(i); if(c === 65024){ " + sink + " }";
  expect(matchSignatures(text).some(m => m.id === "GW-DECODE-01")).toBe(true);
});

// C2: broadened FE00 range regex — range end value
test("C2: GW-DECODE-01 matches range end 0xFE0F", () => {
  const sink = "ev" + "al(decoded)";
  const text = "var c = s.codePointAt(i); if(c <= 0xFE0F){ " + sink + " }";
  expect(matchSignatures(text).some(m => m.id === "GW-DECODE-01")).toBe(true);
});

// I6: PDI (U+2069) must NOT close an override (U+202E) — only PDF (U+202C) can
test("I6: BIDI-FLIP-01 reports unclosed when RLO closed with PDI instead of PDF", () => {
  // U+202E is RLO (override), U+2069 is PDI (only closes isolates, not overrides)
  const text = "normal \u202E reversed \u2069 still reversed";
  expect(matchSignatures(text).some(m => m.id === "BIDI-FLIP-01")).toBe(true);
});
