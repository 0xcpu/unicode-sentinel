const tabState = new Map();

export function resetAllState() {
  tabState.clear();
}

export function resetTabState(tabId) {
  tabState.delete(tabId);
}

export function getTabState(tabId) {
  return tabState.get(tabId) ?? null;
}

function recomputeSummary(state) {
  const byTier = { T1: 0, T2: 0, T3: 0 };
  for (const f of state.findings) {
    byTier[f.tier] = (byTier[f.tier] ?? 0) + 1;
  }
  state.byTier = byTier;
  state.total = state.findings.length;
}

export function handleMessage(msg, sender) {
  if (msg.type === "TRIGGER_SCAN") {
    const tabId = sender.tab?.id ?? msg.tabId;
    if (typeof tabId !== "number") return undefined;
    tabState.set(tabId, {
      status: "scanning",
      findings: [],
      byTier: { T1: 0, T2: 0, T3: 0 },
      total: 0,
      sigMatches: [],
      lastUpdated: Date.now(),
    });
    return { triggerScan: true, tabId };
  }

  if (msg.type === "FINDINGS_BATCH" && sender.tab) {
    const tabId = sender.tab.id;
    if (!tabState.has(tabId)) {
      tabState.set(tabId, {
        findings: [],
        byTier: { T1: 0, T2: 0, T3: 0 },
        total: 0,
        sigMatches: [],
        lastUpdated: 0,
      });
    }
    const state = tabState.get(tabId);
    state.findings.push(...msg.newFindings);
    state.sigMatches = msg.sigMatches;
    state.lastUpdated = Date.now();
    recomputeSummary(state);
    return { badgeUpdate: true, tabId, byTier: state.byTier, sigMatches: state.sigMatches };
  }

  if (msg.type === "FINDINGS_REPLACE" && sender.tab) {
    const tabId = sender.tab.id;
    const state = tabState.get(tabId);
    if (!state) return undefined;
    state.findings = state.findings.filter(f => f.elementId !== msg.elementId);
    state.findings.push(...msg.newFindings);
    state.sigMatches = msg.sigMatches;
    state.lastUpdated = Date.now();
    recomputeSummary(state);
    return { badgeUpdate: true, tabId, byTier: state.byTier, sigMatches: state.sigMatches };
  }

  if (msg.type === "SCAN_READY" && sender.tab) {
    const state = tabState.get(sender.tab.id);
    if (state) delete state.status;
    return undefined;
  }

  if (msg.type === "GET_FINDINGS") {
    return tabState.get(msg.tabId) ?? null;
  }

  if (msg.type === "COMPUTE_HASH") {
    return { asyncHash: true, findings: msg.findings };
  }

  return undefined;
}

export function onTabUpdated(tabId, changeInfo) {
  if (changeInfo && changeInfo.status === "loading") {
    tabState.delete(tabId);
  }
}

// Chrome API wiring — only runs in extension context
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const result = handleMessage(msg, sender);

    if (result?.badgeUpdate) {
      updateBadge(result.tabId, result.byTier, result.sigMatches);
    }

    if (result?.asyncHash) {
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(result.findings)))
        .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join(""))
        .then(hash => sendResponse({ hash }));
      return true;
    }

    if (result?.triggerScan) {
      chrome.scripting
        .insertCSS({ target: { tabId: result.tabId }, files: ["dist/content.css"] })
        .catch(() => {});
      chrome.scripting
        .executeScript({ target: { tabId: result.tabId }, files: ["dist/src/content/content.js"] })
        .catch(() => {});
    }

    if (msg.type === "GET_FINDINGS") {
      sendResponse(result);
    }
  });

  chrome.tabs.onRemoved.addListener(id => resetTabState(id));
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => onTabUpdated(tabId, changeInfo));
}

function updateBadge(tabId, byTier, sigMatches) {
  const count = (byTier.T1 ?? 0) + (byTier.T2 ?? 0);
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
  if (count > 0) {
    const color = byTier.T1 > 0 || sigMatches.length > 0 ? "#dc2626" : "#f59e0b";
    chrome.action.setBadgeBackgroundColor({ color, tabId });
  }
}
