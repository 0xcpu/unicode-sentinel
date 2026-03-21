export function makeIntersectionObserver(onVisible) {
  return new IntersectionObserver(
    (entries) => { for (const e of entries) if (e.isIntersecting) onVisible(e.target); },
    { rootMargin: "200px" }
  );
}

export function makeMutationObserver(onAdded) {
  return new MutationObserver((mutations) => {
    for (const m of mutations)
      for (const node of m.addedNodes)
        if (node.nodeType === Node.ELEMENT_NODE) onAdded(node);
  });
}
