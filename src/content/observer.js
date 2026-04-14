export function makeIntersectionObserver(onVisible) {
  return new IntersectionObserver(
    (entries) => { for (const e of entries) if (e.isIntersecting) onVisible(e.target); },
    { rootMargin: "200px" }
  );
}

// Dispatches element-level events to callbacks:
// - onAdded(el): an element has been added to the DOM
// - onChanged(el): text inside an already-present element has changed —
//   fires for characterData mutations AND for text-node insertions into
//   an existing element (both represent "text inside el changed")
// - onRemoved(el): an element has been removed from the DOM
// For mutations targeting text nodes, the nearest element ancestor is passed.
function nearestElement(node) {
  let el = node.parentNode;
  while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode;
  return el;
}

export function makeMutationObserver({ onAdded, onChanged, onRemoved } = {}) {
  return new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (onAdded) onAdded(node);
          } else if (node.nodeType === Node.TEXT_NODE && onChanged) {
            const el = nearestElement(node);
            if (el) onChanged(el);
          }
        }
        if (onRemoved) {
          for (const node of m.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) onRemoved(node);
          }
        }
      } else if (m.type === "characterData" && onChanged) {
        const el = nearestElement(m.target);
        if (el) onChanged(el);
      }
    }
  });
}
