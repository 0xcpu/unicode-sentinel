const tabState = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FINDINGS_UPDATE" && sender.tab) {
    tabState.set(sender.tab.id, {
      byTier: msg.byTier,
      total: msg.total,
      sigMatches: msg.sigMatches,
    });
    updateBadge(sender.tab.id, msg.byTier, msg.sigMatches);
  }
  if (msg.type === "GET_FINDINGS") {
    sendResponse(tabState.get(msg.tabId) ?? null);
  }
  if (msg.type === "COMPUTE_HASH") {
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(msg.findings)))
      .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join(""))
      .then(hash => sendResponse({ hash }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(id => tabState.delete(id));

function updateBadge(tabId, byTier, sigMatches) {
  const count = (byTier.T1 ?? 0) + (byTier.T2 ?? 0);
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
  if (count > 0) {
    const color = byTier.T1 > 0 || sigMatches.length > 0 ? "#dc2626" : "#f59e0b";
    chrome.action.setBadgeBackgroundColor({ color, tabId });
  }
}
