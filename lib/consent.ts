// lib/consent.ts — §9d. Minimalna zgoda marketingowa (cookie first-party).
// Pixel odpala się WYŁĄCZNIE po zgodzie; stan zgody zapisujemy też na sesji.
"use client";

export type ConsentState = "granted" | "denied" | null;

const KEY = "selltic_marketing_consent";

export function getConsent(): ConsentState {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + KEY + "=([^;]*)"));
  const v = m ? decodeURIComponent(m[1]) : null;
  return v === "granted" || v === "denied" ? v : null;
}

export function setConsent(v: "granted" | "denied") {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${KEY}=${v}; Max-Age=${60 * 60 * 24 * 180}; Path=/; SameSite=Lax${secure}`;
}
