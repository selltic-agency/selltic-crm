// app/f/[slug]/public-form.tsx — kliencki wrapper publicznego formularza.
// Renderuje współdzielony FormRenderer, wysyła odpowiedzi do /api/submit
// i (w trybie embed) wysyła wysokość przez postMessage do strony nadrzędnej.
"use client";

import { useCallback, useEffect, useRef } from "react";
import FormRenderer, { type Answers } from "@/components/FormRenderer";
import type { FormSchema } from "@/lib/forms";

type Props = {
  formId: string;
  schema: FormSchema;
  embed: boolean;
};

export default function PublicForm({ formId, schema, embed }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Tryb embed: po każdej zmianie wysokości wyślij ją do iframe rodzica.
  // ResizeObserver łapie też przejścia między krokami (animacje slajdów).
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

  const handleSubmit = useCallback(
    async (answers: Answers) => {
      // Wysyłka „best effort” — ekran podziękowania pokaże się niezależnie
      // (FormRenderer przełącza na krok `end` po wywołaniu onSubmit).
      try {
        await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            formId,
            answers,
            meta: {
              embed,
              ref: typeof document !== "undefined" ? document.referrer || null : null,
              ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
            },
          }),
        });
      } catch (e) {
        // Sieć padła — i tak nie blokujemy użytkownika.
        console.error("[public-form submit]", e);
      }
    },
    [formId, embed]
  );

  return (
    <div
      ref={wrapRef}
      style={{
        // Poza embedem zajmujemy cały ekran (styl Typeform, pełny slajd).
        // W embedzie rośniemy z treścią, by iframe mógł dopasować wysokość.
        height: embed ? "auto" : "100dvh",
        minHeight: embed ? 420 : undefined,
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <FormRenderer form={schema} onSubmit={handleSubmit} />
    </div>
  );
}
