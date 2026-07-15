// lib/tracking.ts — §3. Kliencki tracker sesji formularza (fire-and-forget).
// NIGDY nie blokuje UI, nie opóźnia przejść i nie pokazuje błędów wypełniającemu.
// Jeśli śledzenie padnie (adblock, sieć), formularz i tak działa i wysyła.
"use client";

import { getVisitorId, getCookie } from "./visitor";
import type { SessionMeta } from "./formSessions";

type TrackKind = "view" | "step_view" | "step_complete";

type TrackBody = {
  formId: string;
  visitorId: string;
  sessionId?: string;
  kind: TrackKind;
  stepIndex?: number;
  totalSteps?: number;
  answers?: Record<string, unknown>;
  consent?: boolean;
  meta?: SessionMeta;
};

// Zbiera metadane żądania: referrer, url, utm_*, fbclid oraz cookies Meta.
function collectMeta(): SessionMeta {
  if (typeof window === "undefined") return {};
  const url = new URL(window.location.href);
  const utm: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    if (k.toLowerCase().startsWith("utm_")) utm[k] = v;
  });
  return {
    referrer: document.referrer || null,
    url: window.location.href,
    utm,
    fbclid: url.searchParams.get("fbclid"),
    fbp: getCookie("_fbp"),
    fbc: getCookie("_fbc"),
    ua: navigator.userAgent,
  };
}

export type Tracker = {
  getSessionId: () => string | undefined;
  view: (totalSteps: number, consent: boolean) => Promise<void>;
  stepView: (stepIndex: number, totalSteps: number) => void;
  stepComplete: (stepIndex: number, answers: Record<string, unknown>, totalSteps: number) => void;
  beaconFinal: (stepIndex: number, totalSteps: number) => void;
  getMeta: () => SessionMeta;
};

export function createTracker(formId: string): Tracker {
  const visitorId = getVisitorId();
  const meta = collectMeta();
  let sessionId: string | undefined;
  let consent = false;

  async function send(body: TrackBody): Promise<void> {
    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.sessionId) sessionId = data.sessionId;
      }
    } catch {
      // Śledzenie jest wtórne — cisza jest zamierzona.
    }
  }

  return {
    getSessionId: () => sessionId,
    getMeta: () => meta,

    async view(totalSteps, consentGranted) {
      consent = consentGranted;
      await send({ formId, visitorId, kind: "view", totalSteps, consent, meta });
    },

    stepView(stepIndex, totalSteps) {
      void send({ formId, visitorId, sessionId, kind: "step_view", stepIndex, totalSteps, consent });
    },

    stepComplete(stepIndex, answers, totalSteps) {
      // Autosave częściowych odpowiedzi (§3) — jedyne źródło danych o porzuceniu.
      void send({ formId, visitorId, sessionId, kind: "step_complete", stepIndex, totalSteps, answers, consent });
    },

    // §3 — beacon przy chowaniu karty: dosyła ostatni krok, gdy ktoś zamyka kartę.
    beaconFinal(stepIndex, totalSteps) {
      try {
        const body: TrackBody = { formId, visitorId, sessionId, kind: "step_view", stepIndex, totalSteps, consent };
        const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
        if (navigator.sendBeacon) navigator.sendBeacon("/api/track", blob);
      } catch {
        /* ignore */
      }
    },
  };
}
