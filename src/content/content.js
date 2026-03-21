import { scanText } from "./scanner.js";
import { buildFragment } from "./marker.js";
import { createBanner, removeBanner } from "./banner.js";
import { matchSignatures } from "../shared/signatures.js";
import { getSettings } from "../shared/storage.js";
import { makeIntersectionObserver, makeMutationObserver } from "./observer.js";

const CODE_SEL = [
  "pre", "code", '[class*="highlight"]', '[class*="blob-code"]',
  '[class*="diff"]', ".changed", "[data-diff-type]",
].join(",");

const processed = new WeakSet();
let allFindings = [];
let settings = {};

async function init() {
  settings = await getSettings();
  const url = location.href;
  for (const pat of settings.site_allowlist) {
    if (new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(url)) return;
  }
  const roots = settings.scan_scope === "full_page"
    ? [document.body]
    : Array.from(document.querySelectorAll(CODE_SEL));

  for (const el of roots) maybeQueue(el);

  const io = makeIntersectionObserver(scanElement);
  const mo = makeMutationObserver((el) => {
    const nodes = el.matches?.(CODE_SEL) ? [el] : Array.from(el.querySelectorAll(CODE_SEL));
    for (const n of nodes) maybeQueue(n);
  });
  for (const el of roots) io.observe(el);
  mo.observe(document.body, { childList: true, subtree: true });
}

function maybeQueue(el) {
  const { top } = el.getBoundingClientRect();
  if (top < window.innerHeight + 200) scanElement(el);
}

function scanElement(el) {
  if (processed.has(el)) return;
  processed.add(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent;
    const findings = scanText(text);
    if (!findings.length) continue;
    if (settings.inline_markers_enabled) {
      const frag = buildFragment(node, findings, { groupThreshold: settings.group_threshold });
      node.parentNode?.replaceChild(frag, node);
    }
    const sel = cssPath(el);
    allFindings.push(...findings.map((f, i) => ({
      ...f,
      id: allFindings.length + i + 1,
      elementSelector: sel,
      contextBefore: text.slice(Math.max(0, f.offset - 20), f.offset),
      contextAfter: text.slice(f.offset + (f.codepoint > 0xFFFF ? 2 : 1), f.offset + 21),
    })));
  }
  updateState();
}

function updateState() {
  const byTier = { T1: 0, T2: 0, T3: 0 };
  for (const f of allFindings) byTier[f.tier] = (byTier[f.tier] ?? 0) + 1;
  const allText = Array.from(document.querySelectorAll(CODE_SEL)).map(e => e.textContent).join("\n");
  const sigMatches = matchSignatures(allText);
  chrome.runtime.sendMessage({ type: "FINDINGS_UPDATE", byTier, total: allFindings.length, sigMatches });
  removeBanner(document.body);
  if (allFindings.length > 0 || sigMatches.length > 0) {
    createBanner({ totalFindings: allFindings.length, byTier, signatureMatches: sigMatches }, document.body, { t3Threshold: settings.banner_threshold_t3 });
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
  if (msg.type === "TOGGLE_MARKERS") {
    document.querySelectorAll("span.usent-marker").forEach(s => {
      s.style.display = s.style.display === "none" ? "" : "none";
    });
  }
  if (msg.type === "GET_FULL_FINDINGS") {
    sendResponse(allFindings);
  }
  if (msg.type === "GET_DOC_HASH") {
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(document.documentElement.outerHTML))
      .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join(""))
      .then(hash => sendResponse(hash));
    return true; // async response
  }
});

init();
