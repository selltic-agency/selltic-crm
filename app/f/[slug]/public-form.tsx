// app/f/[slug]/public-form.tsx — kliencki wrapper publicznego formularza.
// Renderuje FormRenderer, instrumentuje śledzenie (§3) + Meta Pixel (§9b),
// wysyła odpowiedzi do /api/submit i (w embed) postMessage z wysokością.
//
// TWARDE OGRANICZENIE: śledzenie i Pixel są fire-and-forget. Nigdy nie blokują
// UI ani wysyłki. Gdy padną (adblock, brak zgody) — formularz i tak wysyła.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FormRenderer, { type Answers } from "@/components/FormRenderer";
import type { FormSchema } from "@/lib/forms";
import type { PublicMetaConfig } from "@/lib/server/meta";
import { createTracker, type Tracker } from "@/lib/tracking";
import { initPixel, pixelTrack } from "@/lib/metaPixel";
import { getConsent, setConsent, type ConsentState } from "@/lib/consent";

type Props = {
  formId: string;
  schema: FormSchema;
  embed: boolean;
  meta?: PublicMetaConfig;
};

export default function PublicForm({ formId, schema, embed, meta }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const currentStepRef = useRef(0);
  const pixelReadyRef = useRef(false);
  const totalSteps = schema.steps?.length ?? 0;
  const title = schema.title || "";

  const [consent, setConsentState] = useState<ConsentState>(null);

  const pixelConfigured = !!meta?.pixelId && !!meta?.eventsEnabled;

  // Odpal Pixel (ViewContent) po zgodzie — idempotentnie.
  const enablePixel = useCallback(() => {
    if (!pixelConfigured || pixelReadyRef.current) return;
    pixelReadyRef.current = true;
    initPixel(meta!.pixelId);
    pixelTrack("ViewContent", { content_name: title });
  }, [pixelConfigured, meta, title]);

  // Inicjalizacja śledzenia + Pixela na montażu (klient).
  useEffect(() => {
    const decided = getConsent();
    setConsentState(decided);
    const granted = decided === "granted";

    const tracker = createTracker(formId);
    trackerRef.current = tracker;
    // Zdarzenie „view” (zwraca sessionId dla reszty cyklu życia).
    void tracker.view(totalSteps, granted);

    if (granted) enablePixel();

    // Beacon przy chowaniu karty — dosyła ostatni krok (§3).
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        trackerRef.current?.beaconFinal(currentStepRef.current, totalSteps);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [formId, totalSteps, enablePixel]);

  // Tryb embed: wysyłaj wysokość do iframe rodzica po każdej zmianie.
  useEffect(() => {
    if (!embed) return;
    const el = wrapRef.current;
    if (!el || typeof window === "undefined") return;
    const post = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      window.parent?.postMessage({ type: "selltic-form", formId, formHeight: height }, "*");
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(el);
    return () => ro.disconnect();
  }, [embed, formId]);

  // ── Callbacki instrumentacji ──
  const onStepView = useCallback((stepIndex: number, total: number) => {
    currentStepRef.current = stepIndex;
    trackerRef.current?.stepView(stepIndex, total);
  }, []);

  const onStepComplete = useCallback((stepIndex: number, answers: Answers, total: number) => {
    trackerRef.current?.stepComplete(stepIndex, answers, total);
    // §9b — Pixel „FormStep” po ukończeniu kroku, z indeksem kroku.
    pixelTrack("FormStep", { step_index: stepIndex }, undefined, true); // custom
  }, []);

  const onFirstAnswer = useCallback(() => {
    pixelTrack("FormStart", { content_name: title }, undefined, true); // custom
  }, [title]);

  const handleSubmit = useCallback(
    async (answers: Answers) => {
      const tracker = trackerRef.current;
      const sessionId = tracker?.getSessionId();

      // §9b — Pixel „Lead” z event_id = id sesji (dedup z CAPI).
      pixelTrack("Lead", { content_name: title }, sessionId);

      try {
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            formId,
            answers,
            sessionId,
            meta: {
              embed,
              consent: getConsent() === "granted",
              // Meta cookies/atrybucja przekazane z klienta (server ich nie widzi).
              ...(tracker?.getMeta() ?? {}),
            },
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          console.error("[public-form submit] serwer odrzucił zgłoszenie:", res.status, body);
        }
      } catch (e) {
        console.error("[public-form submit]", e);
      }
    },
    [formId, embed, title]
  );

  function acceptConsent() {
    setConsent("granted");
    setConsentState("granted");
    enablePixel();
  }
  function declineConsent() {
    setConsent("denied");
    setConsentState("denied");
  }

  return (
    <div
      ref={wrapRef}
      style={{
        height: embed ? "auto" : "100dvh",
        minHeight: embed ? 420 : undefined,
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <FormRenderer
        form={schema}
        onSubmit={handleSubmit}
        onStepView={onStepView}
        onStepComplete={onStepComplete}
        onFirstAnswer={onFirstAnswer}
      />

      {/* §9d — baner zgody marketingowej: Pixel odpala się dopiero po „Akceptuję”. */}
      {pixelConfigured && consent === null && !embed && (
        <div
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: 12,
            zIndex: 50,
            maxWidth: 620,
            margin: "0 auto",
            background: "#1A1D26",
            color: "#fff",
            borderRadius: 12,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
          }}
        >
          <span style={{ fontSize: 13, flex: 1, minWidth: 180 }}>
            Używamy plików cookie do celów marketingowych (Meta Pixel), aby mierzyć skuteczność reklam.
          </span>
          <button
            onClick={declineConsent}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.3)", background: "transparent", color: "#fff", fontSize: 13, cursor: "pointer" }}
          >
            Odrzuć
          </button>
          <button
            onClick={acceptConsent}
            style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#6C5CE7", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Akceptuję
          </button>
        </div>
      )}
    </div>
  );
}
