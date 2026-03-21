// tests/banner.test.js
import { createBanner, removeBanner, BANNER_ID } from "../src/content/banner.js";

function summary(overrides = {}) {
  return { totalFindings: 47, byTier: { T1: 47, T2: 0, T3: 0 }, signatureMatches: [], ...overrides };
}

test("injects banner into body", () => {
  document.body.innerHTML = "";
  createBanner(summary(), document.body);
  expect(document.getElementById(BANNER_ID)).not.toBeNull();
});

test("banner shows finding count", () => {
  document.body.innerHTML = "";
  createBanner(summary({ totalFindings: 47 }), document.body);
  expect(document.getElementById(BANNER_ID).textContent).toMatch("47");
});

test("T1 findings: usent-banner-critical class", () => {
  document.body.innerHTML = "";
  createBanner(summary({ byTier: { T1: 1, T2: 0, T3: 0 } }), document.body);
  expect(document.getElementById(BANNER_ID).classList.contains("usent-banner-critical")).toBe(true);
});

test("T2-only findings: usent-banner-high class", () => {
  document.body.innerHTML = "";
  createBanner(summary({ byTier: { T1: 0, T2: 5, T3: 0 }, totalFindings: 5 }), document.body);
  expect(document.getElementById(BANNER_ID).classList.contains("usent-banner-high")).toBe(true);
});

test("signature match ID appears in banner text", () => {
  document.body.innerHTML = "";
  createBanner(summary({ signatureMatches: [{ id: "GW-DECODE-01", description: "test" }] }), document.body);
  expect(document.getElementById(BANNER_ID).textContent).toMatch("GW-DECODE-01");
});

test("T3-only below threshold: no banner", () => {
  document.body.innerHTML = "";
  createBanner(
    { totalFindings: 2, byTier: { T1: 0, T2: 0, T3: 2 }, signatureMatches: [] },
    document.body, { t3Threshold: 4 }
  );
  expect(document.getElementById(BANNER_ID)).toBeNull();
});

test("T3-only above threshold: shows banner", () => {
  document.body.innerHTML = "";
  createBanner(
    { totalFindings: 5, byTier: { T1: 0, T2: 0, T3: 5 }, signatureMatches: [] },
    document.body, { t3Threshold: 4 }
  );
  expect(document.getElementById(BANNER_ID)).not.toBeNull();
});

test("removeBanner removes element", () => {
  document.body.innerHTML = "";
  createBanner(summary(), document.body);
  removeBanner(document.body);
  expect(document.getElementById(BANNER_ID)).toBeNull();
});

test("dismiss button removes banner", () => {
  document.body.innerHTML = "";
  createBanner(summary(), document.body);
  document.querySelector("[data-usent-action='dismiss']").click();
  expect(document.getElementById(BANNER_ID)).toBeNull();
});
