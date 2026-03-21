// tests/codepoints.test.js
import { getTier, TIER } from "../src/shared/codepoints.js";

test("variation selector U+FE00 is T1", () => {
  expect(getTier(0xfe00)).toBe(TIER.T1);
});
test("variation selector supplement U+E0100 is T1", () => {
  expect(getTier(0xe0100)).toBe(TIER.T1);
});
test("PUA BMP U+E000 is T2", () => {
  expect(getTier(0xe000)).toBe(TIER.T2);
});
test("PUA BMP U+F8FF is T2", () => {
  expect(getTier(0xf8ff)).toBe(TIER.T2);
});
test("PUA Supplement A U+F0000 is T2", () => {
  expect(getTier(0xf0000)).toBe(TIER.T2);
});
test("PUA Supplement B U+100000 is T2", () => {
  expect(getTier(0x100000)).toBe(TIER.T2);
});
test("bidi override U+202A is T2", () => {
  expect(getTier(0x202a)).toBe(TIER.T2);
});
test("RLO U+202E is T2", () => {
  expect(getTier(0x202e)).toBe(TIER.T2);
});
test("bidi isolate U+2066 is T2", () => {
  expect(getTier(0x2066)).toBe(TIER.T2);
});
test("ZWSP U+200B is T2", () => {
  expect(getTier(0x200b)).toBe(TIER.T2);
});
test("ZWJ U+200D is T2", () => {
  expect(getTier(0x200d)).toBe(TIER.T2);
});
test("BOM U+FEFF is T2", () => {
  expect(getTier(0xfeff)).toBe(TIER.T2);
});
test("tags block U+E0001 is T2", () => {
  expect(getTier(0xe0001)).toBe(TIER.T2);
});
test("tags block U+E007F is T2", () => {
  expect(getTier(0xe007f)).toBe(TIER.T2);
});
test("soft hyphen U+00AD is T3", () => {
  expect(getTier(0x00ad)).toBe(TIER.T3);
});
test("interlinear annotation U+FFF9 is T3", () => {
  expect(getTier(0xfff9)).toBe(TIER.T3);
});
test("object replacement U+FFFC is T3", () => {
  expect(getTier(0xfffc)).toBe(TIER.T3);
});
test("regular ASCII letter is null", () => {
  expect(getTier(0x41)).toBeNull();
});
test("regular space is null", () => {
  expect(getTier(0x20)).toBeNull();
});
