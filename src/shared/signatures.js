import { getTier, TIER } from "./codepoints.js";

const builtinRules = [
  { id: "GW-DECODE-01", version: 1, description: "Glassworm-style decoder: codePointAt + FE00/E0100 range check + dynamic code execution sink", pattern_type: "compound", confidence: "critical", scope: "text_content" },
  { id: "GW-DECODE-02", version: 1, description: "8+ consecutive Tier-1 codepoints (variation selectors or PUA) in text", pattern_type: "compound", confidence: "high", scope: "text_content" },
  { id: "BIDI-FLIP-01", version: 1, description: "Unclosed bidi override (RLO/LRO/RLI/LRI) in code", pattern_type: "compound", confidence: "high", scope: "text_content" },
  { id: "ZW-BULK-01", version: 1, description: "16+ zero-width characters in a contiguous run", pattern_type: "compound", confidence: "high", scope: "text_content" },
];

const EXEC_SINK_RE = /\beval\s*\(|\bFunction\s*\(|\bnew\s+Function\b|setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`]/;
const CODEPOINTAT_RE = /codePointAt\s*\(/;
const FE00_RANGE_RE = /0x[fF][eE]0[0-9a-fA-F]|0x[eE]01[0-9a-eA-E][0-9a-fA-F]|6502[4-9]|6503[0-9]|917[7-9][0-9]{2}/i;

const COMPOUND_MATCHERS = {
  "GW-DECODE-01": (text) =>
    CODEPOINTAT_RE.test(text) && FE00_RANGE_RE.test(text) && EXEC_SINK_RE.test(text),

  "GW-DECODE-02": (text) => {
    let run = 0;
    let i = 0;
    while (i < text.length) {
      const cp = text.codePointAt(i);
      if (getTier(cp) === TIER.T1) { if (++run >= 8) return true; }
      else run = 0;
      i += cp > 0xffff ? 2 : 1;
    }
    return false;
  },

  "BIDI-FLIP-01": (text) => {
    const overrideOpeners = new Set([0x202a, 0x202b, 0x202d, 0x202e]);
    const isolateOpeners = new Set([0x2066, 0x2067, 0x2068]);
    let overrideDepth = 0, isolateDepth = 0, i = 0;
    while (i < text.length) {
      const cp = text.codePointAt(i);
      if (overrideOpeners.has(cp)) overrideDepth++;
      else if (isolateOpeners.has(cp)) isolateDepth++;
      else if (cp === 0x202c && overrideDepth > 0) overrideDepth--;
      else if (cp === 0x2069 && isolateDepth > 0) isolateDepth--;
      i += cp > 0xffff ? 2 : 1;
    }
    return overrideDepth > 0 || isolateDepth > 0;
  },

  "ZW-BULK-01": (text) => {
    const ZW = new Set([0x200b, 0x200c, 0x200d]);
    let run = 0, i = 0;
    while (i < text.length) {
      const cp = text.codePointAt(i);
      if (ZW.has(cp)) { if (++run >= 16) return true; }
      else run = 0;
      i += cp > 0xffff ? 2 : 1;
    }
    return false;
  },
};

export function loadRuleset(rules) {
  const valid = [];
  for (const rule of rules) {
    if (!rule.id || typeof rule.id !== "string") continue;
    if (!rule.description || typeof rule.description !== "string") continue;
    if (!["critical", "high", "medium"].includes(rule.confidence)) continue;
    if (rule.pattern_type === "regex") {
      if (typeof rule.pattern !== "string" || rule.pattern.length > 500) continue;
      try { new RegExp(rule.pattern); } catch { continue; }
    }
    valid.push(rule);
  }
  return valid;
}

export function matchSignatures(text, extraRules = []) {
  const matches = [];
  for (const rule of builtinRules) {
    const fn = COMPOUND_MATCHERS[rule.id];
    if (fn && fn(text)) {
      matches.push({ id: rule.id, description: rule.description, confidence: rule.confidence });
    }
  }
  for (const rule of extraRules) {
    if (rule.pattern_type !== "regex") continue;
    try {
      if (new RegExp(rule.pattern).test(text)) {
        matches.push({ id: rule.id, description: rule.description, confidence: rule.confidence });
      }
    } catch { }
  }
  return matches;
}
