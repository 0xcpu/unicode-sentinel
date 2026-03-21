export const TIER = Object.freeze({ T1: "T1", T2: "T2", T3: "T3" });

const T3_EXACT = new Set([0x00ad, 0xfff9, 0xfffa, 0xfffb, 0xfffc]);
const T2_EXACT = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);

const T2_RANGES = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xe0001, 0xe007f],
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
];

const T1_RANGES = [
  [0xfe00, 0xfe0f],
  [0xe0100, 0xe01ef],
];

export function getTier(cp) {
  if (T3_EXACT.has(cp)) return TIER.T3;
  if (T2_EXACT.has(cp)) return TIER.T2;
  for (const [lo, hi] of T2_RANGES) if (cp >= lo && cp <= hi) return TIER.T2;
  for (const [lo, hi] of T1_RANGES) if (cp >= lo && cp <= hi) return TIER.T1;
  return null;
}

export function getCategory(cp) {
  if (cp >= 0xfe00 && cp <= 0xfe0f) return "variation-selector";
  if (cp >= 0xe0100 && cp <= 0xe01ef) return "variation-selector-supplement";
  if ((cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd)) return "pua";
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return "bidi-override";
  if ([0x200b, 0x200c, 0x200d, 0xfeff].includes(cp)) return "zero-width";
  if (cp >= 0xe0001 && cp <= 0xe007f) return "tags-block";
  if (cp === 0x00ad) return "soft-hyphen";
  if (cp >= 0xfff9 && cp <= 0xfffb) return "interlinear-annotation";
  if (cp === 0xfffc) return "object-replacement";
  return "unknown";
}
