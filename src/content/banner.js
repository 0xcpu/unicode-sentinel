export const BANNER_ID = "usent-banner";

export function createBanner(summary, body, opts = {}) {
  const { t3Threshold = 4 } = opts;
  if (
    summary.signatureMatches.length === 0 &&
    summary.byTier.T1 === 0 && summary.byTier.T2 === 0 &&
    summary.totalFindings <= t3Threshold
  ) return;

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.setAttribute("role", "alert");

  if (summary.byTier.T1 > 0 || summary.signatureMatches.some(m => m.confidence === "critical")) {
    banner.classList.add("usent-banner-critical");
  } else if (summary.byTier.T2 > 0) {
    banner.classList.add("usent-banner-high");
  } else {
    banner.classList.add("usent-banner-info");
  }

  let msg = `\u26A0 Unicode Sentinel: ${summary.totalFindings} invisible character${summary.totalFindings !== 1 ? "s" : ""} detected.`;
  if (summary.signatureMatches.length > 0) {
    msg += ` Pattern matched: ${summary.signatureMatches.map(m => m.id).join(", ")}.`;
  }

  const text = document.createElement("span");
  text.textContent = msg;
  banner.appendChild(text);

  const btnDismiss = document.createElement("button");
  btnDismiss.textContent = "Dismiss";
  btnDismiss.dataset.usentAction = "dismiss";
  btnDismiss.addEventListener("click", () => removeBanner(body));
  banner.appendChild(btnDismiss);

  body.insertAdjacentElement("afterbegin", banner);
}

export function removeBanner(body) {
  const doc = body.ownerDocument ?? document;
  doc.getElementById(BANNER_ID)?.remove();
}
