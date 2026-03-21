function cpHex(cp) {
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

function cpName(cp) {
  const names = {
    0xfe00: "VARIATION SELECTOR-1", 0x202e: "RIGHT-TO-LEFT OVERRIDE",
    0x200b: "ZERO WIDTH SPACE", 0x200c: "ZERO WIDTH NON-JOINER",
    0x200d: "ZERO WIDTH JOINER", 0xfeff: "BYTE ORDER MARK", 0x00ad: "SOFT HYPHEN",
  };
  return names[cp] ?? `U+${cpHex(cp)}`;
}

export function buildFragment(textNode, findings, opts = {}) {
  const { groupThreshold = 4 } = opts;
  const text = textNode.textContent;
  const frag = document.createDocumentFragment();

  if (findings.length === 0) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }

  const groups = [];
  let i = 0;
  while (i < findings.length) {
    let j = i;
    while (
      j + 1 < findings.length &&
      findings[j + 1].tier === findings[i].tier &&
      findings[j + 1].offset === findings[j].offset + (findings[j].codepoint > 0xffff ? 2 : 1)
    ) j++;
    groups.push(findings.slice(i, j + 1));
    i = j + 1;
  }

  let pos = 0;
  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const endOffset = last.offset + (last.codepoint > 0xffff ? 2 : 1);

    if (first.offset > pos) frag.appendChild(document.createTextNode(text.slice(pos, first.offset)));

    const span = document.createElement("span");
    span.className = `usent-marker usent-${first.tier.toLowerCase()}`;
    span.dataset.codepoint = `U+${cpHex(first.codepoint)}`;
    span.dataset.category = first.category;

    if (group.length >= groupThreshold) {
      span.classList.add("usent-group");
      span.dataset.count = String(group.length);
      span.dataset.codepoints = group.map(f => `U+${cpHex(f.codepoint)}`).join(",");
      span.title = `${group.length} invisible characters (${first.category}). Click to expand.`;
      span.setAttribute("aria-label", `${group.length} hidden Unicode characters`);
      span.textContent = `\u2039\xD7${group.length} ${first.tier}\u203A`;
    } else {
      span.title = `Invisible: U+${cpHex(first.codepoint)} ${cpName(first.codepoint)} (${first.tier} \u2014 ${first.category})`;
      span.setAttribute("aria-label", `Hidden Unicode character U+${cpHex(first.codepoint)}`);
      span.textContent = `\u2039${cpHex(first.codepoint)}\u203A`;
    }

    frag.appendChild(span);
    pos = endOffset;
  }

  if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
  return frag;
}

export function removeMarkers(container) {
  const reconstructed = [];

  function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        reconstructed.push(child.textContent);
      } else if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains("usent-marker")) {
        const cpsList = child.dataset.codepoints;
        if (cpsList) {
          for (const entry of cpsList.split(",")) {
            const hex = entry.trim();
            if (hex.startsWith("U+")) {
              const cp = parseInt(hex.slice(2), 16);
              if (!isNaN(cp)) {
                reconstructed.push(String.fromCodePoint(cp));
              }
            }
          }
        } else {
          const cpStr = child.dataset.codepoint;
          if (cpStr && cpStr.startsWith("U+")) {
            const cp = parseInt(cpStr.slice(2), 16);
            if (!isNaN(cp)) {
              reconstructed.push(String.fromCodePoint(cp));
            }
          }
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  }

  walk(container);
  const text = reconstructed.join("");
  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(document.createTextNode(text));
}
