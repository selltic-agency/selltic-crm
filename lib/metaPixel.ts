// lib/metaPixel.ts — §9b. Wstrzyknięcie i wywołania Meta Pixel (przeglądarka).
// Ładowane tylko, gdy Pixel ID jest skonfigurowany ORAZ jest zgoda marketingowa.
"use client";

type FbqFn = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean };

declare global {
  interface Window {
    fbq?: FbqFn;
    _fbq?: FbqFn;
  }
}

let initialized = false;

// Wstrzykuje snippet fbevents i inicjalizuje Pixel (idempotentnie).
export function initPixel(pixelId: string) {
  if (typeof window === "undefined" || !pixelId || initialized) return;
  initialized = true;

  /* eslint-disable */
  (function (f: any, b, e, v, n?: any, t?: any, s?: any) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  /* eslint-enable */

  window.fbq?.("init", pixelId);
}

// Standardowe / custom eventy. eventId → deduplikacja z CAPI (§9b).
export function pixelTrack(
  event: string,
  data?: Record<string, unknown>,
  eventId?: string,
  custom = false
) {
  if (typeof window === "undefined" || !window.fbq) return;
  const method = custom ? "trackCustom" : "track";
  if (eventId) window.fbq(method, event, data || {}, { eventID: eventId });
  else window.fbq(method, event, data || {});
}
