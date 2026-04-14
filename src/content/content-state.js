let nextId = 1;

export function resetIdCounter() {
  nextId = 1;
}

export function assignFindingIds(findings, elementId) {
  return findings.map(f => ({
    ...f,
    id: nextId++,
    elementId,
  }));
}

const scannedTextMap = new Map(); // elementId -> text

export function resetScannedText() {
  scannedTextMap.clear();
}

// Upsert text for an element. Used both for first scan and re-scan of a
// previously-scanned element (text replaced by element.textContent each time).
export function setScannedText(elementId, text) {
  scannedTextMap.set(elementId, text);
}

// Remove text for an element that is no longer scanned/present.
// Symmetric with background worker's FINDINGS_REPLACE-with-empty pattern.
export function removeScannedText(elementId) {
  scannedTextMap.delete(elementId);
}

export function getScannedText() {
  return Array.from(scannedTextMap.values()).join("\n");
}
