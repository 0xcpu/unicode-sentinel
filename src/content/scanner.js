import { getTier, getCategory } from "../shared/codepoints.js";

export function scanText(text) {
  const findings = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    const tier = getTier(cp);
    if (tier !== null) {
      findings.push({ codepoint: cp, tier, category: getCategory(cp), offset: i });
    }
    i += cp > 0xffff ? 2 : 1;
  }
  return findings;
}
