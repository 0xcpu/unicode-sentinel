import { scanText } from "./scanner.js";
import { buildFragment, removeMarkers } from "./marker.js";
import { createBanner, removeBanner } from "./banner.js";
import { matchSignatures } from "../shared/signatures.js";
import { getSettings } from "../shared/storage.js";
import { makeIntersectionObserver, makeMutationObserver } from "./observer.js";
import {
  assignFindingIds, setScannedText, getScannedText, removeScannedText,
} from "./content-state.js";

const CODE_SEL = [
  "pre", "code", '[class*="highlight"]', '[class*="blob-code"]',
  '[class*="diff"]', ".changed", "[data-diff-type]",
].join(",");

const processed = new WeakSet();
const elementIdMap = new WeakMap(); // DOM element -> elementId
let nextElementId = 1;
// Local findings cache, used for banner tier aggregation and to filter out
// per-element entries on re-scan. Background worker is the canonical source
// of truth; this cache mirrors only what this content script has observed.
let allFindings = [];
let settings = {};

// MutationObserver instance is hoisted so scanning helpers can suspend it
// around their own DOM mutations. Without this, wrapping text nodes with
// marker spans inside CODE_SEL elements would be observed, dispatched to
// onChanged, and trigger infinite re-scan feedback loops.
//
// Note: we intentionally do NOT watch `characterData` at the body level —
// that fires on every text tick, timer, input character, React render, etc.
// across the entire page, producing callback storms that freeze the browser.
// In-place text edits inside processed code blocks are caught by per-element
// characterData observers (see observeTextChanges) attached on first scan.
let mo = null;
const MO_CONFIG = { childList: true, subtree: true };

function withSuspendedObserver(fn) {
  if (!mo) { fn(); return; }
  mo.disconnect();
  try {
    fn();
  } finally {
    mo.takeRecords(); // drop any mutations we created
    mo.observe(document.body, MO_CONFIG);
  }
}

// Per-element characterData observers. Each processed CODE_SEL element gets
// one, watching only its own subtree for in-place text edits. Narrowly scoped
// so we pay zero cost for the flood of text mutations happening elsewhere on
// the page. Our own scan mutations are all childList (replaceChild, etc.),
// not characterData, so these observers do NOT need suspension.
const textObservers = new WeakMap();

function observeTextChanges(el) {
  if (textObservers.has(el)) return;
  const obs = new MutationObserver(() => rescanElement(el));
  obs.observe(el, { characterData: true, subtree: true });
  textObservers.set(el, obs);
}

function unobserveTextChanges(el) {
  const obs = textObservers.get(el);
  if (!obs) return;
  obs.disconnect();
  textObservers.delete(el);
}

export async function init() {
  if (window.__usent_installed) return;
  window.__usent_installed = true;
  settings = await getSettings();
  const roots = settings.scan_scope === "full_page"
    ? [document.body]
    : Array.from(document.querySelectorAll(CODE_SEL));

  for (const el of roots) scanElement(el);

  const io = makeIntersectionObserver(scanElement);
  mo = makeMutationObserver({
    onAdded: (el) => {
      const nodes = el.matches?.(CODE_SEL) ? [el] : Array.from(el.querySelectorAll(CODE_SEL));
      for (const n of nodes) {
        if (processed.has(n)) rescanElement(n);
        else io.observe(n);
      }
    },
    onChanged: (el) => {
      // text inside an already-processed element changed — re-scan it
      const target = el.closest?.(CODE_SEL) ?? (el.matches?.(CODE_SEL) ? el : null);
      if (target && processed.has(target)) rescanElement(target);
    },
    onRemoved: (el) => {
      const nodes = el.matches?.(CODE_SEL) ? [el] : Array.from(el.querySelectorAll(CODE_SEL));
      for (const n of nodes) {
        if (processed.has(n)) forgetElement(n);
      }
    },
  });
  for (const el of roots) io.observe(el);
  mo.observe(document.body, MO_CONFIG);

  // S5: Settings reload — apply changes without requiring page reload.
  chrome.storage.onChanged.addListener((changes) => {
    for (const key of Object.keys(changes)) {
      if (key in settings) {
        settings[key] = changes[key].newValue;
      }
    }
  });
  chrome.runtime.sendMessage({ type: "SCAN_READY" });
}

function getOrAssignElementId(el) {
  if (!elementIdMap.has(el)) {
    elementIdMap.set(el, nextElementId++);
  }
  return elementIdMap.get(el);
}

function scanAndEnrich(el, elemId) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  const elementFindings = [];
  while ((node = walker.nextNode())) {
    const text = node.textContent;
    const findings = scanText(text);
    if (!findings.length) continue;
    if (settings.inline_markers_enabled) {
      const frag = buildFragment(node, findings, { groupThreshold: settings.group_threshold });
      node.parentNode?.replaceChild(frag, node);
    }
    const sel = cssPath(el);
    const enriched = assignFindingIds(findings, elemId).map((f, i) => ({
      ...f,
      elementSelector: sel,
      contextBefore: text.slice(Math.max(0, findings[i].offset - 20), findings[i].offset),
      contextAfter: text.slice(findings[i].offset + (findings[i].codepoint > 0xFFFF ? 2 : 1), findings[i].offset + 21),
    }));
    elementFindings.push(...enriched);
  }
  return elementFindings;
}

function scanElement(el) {
  if (processed.has(el)) return;
  processed.add(el);
  const elemId = getOrAssignElementId(el);
  // Capture original text BEFORE scanAndEnrich mutates the DOM via inline markers,
  // otherwise setScannedText would store marker bracket text like "‹FE00›" and
  // signature matchers would never see the raw T1 codepoints (false negatives).
  const originalText = el.textContent;
  let elementFindings = [];
  withSuspendedObserver(() => {
    elementFindings = scanAndEnrich(el, elemId);
  });
  allFindings.push(...elementFindings);
  setScannedText(elemId, originalText);
  observeTextChanges(el);
  sendBatch(elementFindings, elemId);
}

function rescanElement(el) {
  const elemId = getOrAssignElementId(el);
  // Remove old local findings for this element
  allFindings = allFindings.filter(f => f.elementId !== elemId);
  let elementFindings = [];
  let originalText = "";
  withSuspendedObserver(() => {
    // Strip any existing marker spans so we scan original text, not bracket-wrapped
    // replacements. Otherwise re-scans would double-wrap already-marked codepoints
    // and contextBefore/contextAfter would reflect marker output rather than source.
    if (settings.inline_markers_enabled) {
      removeMarkers(el);
    }
    originalText = el.textContent;
    elementFindings = scanAndEnrich(el, elemId);
  });
  allFindings.push(...elementFindings);
  setScannedText(elemId, originalText);
  sendReplace(elementFindings, elemId);
}

// Called when an element is removed from the DOM. Drops its findings from the
// local cache and its text from the scanned-text mirror, then notifies the
// background (via FINDINGS_REPLACE with an empty array) so stale content
// doesn't keep contributing to signature matches or badge counts.
function forgetElement(el) {
  const elemId = getOrAssignElementId(el);
  allFindings = allFindings.filter(f => f.elementId !== elemId);
  removeScannedText(elemId);
  unobserveTextChanges(el);
  sendReplace([], elemId);
}

function sendBatch(findings, elementId) {
  const sigMatches = matchSignatures(getScannedText());
  chrome.runtime.sendMessage({
    type: "FINDINGS_BATCH",
    newFindings: findings,
    sigMatches,
    elementId,
  });
  updateBanner(sigMatches);
}

function sendReplace(findings, elementId) {
  const sigMatches = matchSignatures(getScannedText());
  chrome.runtime.sendMessage({
    type: "FINDINGS_REPLACE",
    newFindings: findings,
    sigMatches,
    elementId,
  });
  updateBanner(sigMatches);
}

function updateBanner(sigMatches) {
  const byTier = { T1: 0, T2: 0, T3: 0 };
  for (const f of allFindings) byTier[f.tier] = (byTier[f.tier] ?? 0) + 1;
  removeBanner(document.body);
  if (allFindings.length > 0 || sigMatches.length > 0) {
    createBanner(
      { totalFindings: allFindings.length, byTier, signatureMatches: sigMatches },
      document.body,
      { t3Threshold: settings.banner_threshold_t3 },
    );
  }
}

function cssPath(el) {
  const parts = [];
  let cur = el;
  while (cur && cur !== document.body) {
    let s = cur.tagName.toLowerCase();
    if (cur.id) { parts.unshift(s + "#" + cur.id); break; }
    const sibs = Array.from(cur.parentNode?.children ?? []).filter(c => c.tagName === cur.tagName);
    if (sibs.length > 1) s += `:nth-child(${Array.from(cur.parentNode.children).indexOf(cur) + 1})`;
    parts.unshift(s);
    cur = cur.parentNode;
  }
  return parts.join(" > ");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "RESCAN") {
    for (const el of document.querySelectorAll(CODE_SEL)) {
      if (processed.has(el)) rescanElement(el);
      else scanElement(el);
    }
    return;
  }
  if (msg.type === "TOGGLE_MARKERS") {
    document.querySelectorAll("span.usent-marker").forEach(s => {
      s.style.display = s.style.display === "none" ? "" : "none";
    });
  }
  if (msg.type === "GET_DOC_HASH") {
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(document.documentElement.outerHTML))
      .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join(""))
      .then(hash => sendResponse(hash));
    return true;
  }
});

init();
