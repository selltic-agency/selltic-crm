// components/FormRenderer.tsx — współdzielony renderer formularza.
// Używany w podglądzie edytora ORAZ na publicznej stronie /f/[slug].
// Obsługuje routing, historię (przycisk wstecz), pasek postępu,
// nawigację klawiaturą (Enter, A/B/C) i animacje slajdów.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  type FormSchema,
  type Step,
  NEXT,
  SUBMIT,
  googleFontHref,
} from "@/lib/forms";
import { useIsMobile } from "@/lib/responsive";

export type Answers = Record<string, string | string[]>;

type Props = {
  form: FormSchema;
  // Podgląd w edytorze: skok do wskazanego kroku (np. zaznaczonego w liście).
  gotoStepId?: string;
  // Wywoływane, gdy routing dojdzie do __submit__ (publiczna strona → POST).
  onSubmit?: (answers: Answers) => void;
  // Tryb podglądu — nie wykonuje realnego wysłania.
  preview?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function FormRenderer({ form, gotoStepId, onSubmit, preview }: Props) {
  const steps = form.steps ?? [];
  const theme = form.theme;
  const isMobile = useIsMobile(680);

  const [currentId, setCurrentId] = useState<string>(steps[0]?.id ?? "");
  const [history, setHistory] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  // Wstrzyknij arkusz Google Fonts dla wybranej czcionki.
  useEffect(() => {
    const href = googleFontHref(theme?.font ?? "Inter");
    if (!href) return;
    const id = "selltic-font-" + (theme.font || "Inter").replace(/\s+/g, "-");
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [theme?.font]);

  // Skok do kroku z edytora.
  useEffect(() => {
    if (gotoStepId && steps.some((s) => s.id === gotoStepId)) {
      setDir("fwd");
      setCurrentId(gotoStepId);
      setError(null);
    }
  }, [gotoStepId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gdy bieżący krok zniknął (usunięty/reorder) — wróć na początek.
  useEffect(() => {
    if (steps.length && !steps.some((s) => s.id === currentId)) {
      setCurrentId(steps[0].id);
    }
  }, [steps, currentId]);

  const current = useMemo(
    () => steps.find((s) => s.id === currentId) ?? steps[0],
    [steps, currentId]
  );
  const currentIndex = steps.findIndex((s) => s.id === current?.id);
  const progress = steps.length > 1 ? (currentIndex / (steps.length - 1)) * 100 : 0;

  const setAnswer = useCallback(
    (val: string | string[]) => {
      if (!current) return;
      setAnswers((a) => ({ ...a, [current.id]: val }));
      setError(null);
    },
    [current]
  );

  const submit = useCallback(() => {
    if (!submittedRef.current) {
      submittedRef.current = true;
      onSubmit?.(answers);
    }
    const end = steps.find((s) => s.type === "end");
    if (end) {
      setDir("fwd");
      setCurrentId(end.id);
    }
  }, [answers, onSubmit, steps]);

  const resolveTarget = useCallback(
    (target: string) => {
      if (target === SUBMIT) return submit();
      if (!target || target === NEXT) {
        const next = steps[currentIndex + 1];
        if (!next) return submit();
        setHistory((h) => [...h, current.id]);
        setDir("fwd");
        setCurrentId(next.id);
        setError(null);
        return;
      }
      const next = steps.find((s) => s.id === target);
      if (!next) return submit();
      setHistory((h) => [...h, current.id]);
      setDir("fwd");
      setCurrentId(next.id);
      setError(null);
    },
    [steps, currentIndex, current, submit]
  );

  const advance = useCallback(() => {
    if (!current) return;
    // Walidacja
    if (current.type === "email") {
      const v = (answers[current.id] as string) || "";
      if (current.required && !v.trim()) return setError("To pole jest wymagane.");
      if (v.trim() && !EMAIL_RE.test(v.trim())) return setError("Podaj poprawny e-mail.");
    }
    if ((current.type === "short_text" || current.type === "long_text") && current.required) {
      const v = (answers[current.id] as string) || "";
      if (!v.trim()) return setError("To pole jest wymagane.");
    }

    // Routing
    let target = current.next || NEXT;
    if (current.type === "single_choice") {
      const sel = answers[current.id] as string | undefined;
      const opt = current.options?.find((o) => o.label === sel);
      if (opt) target = opt.next || NEXT;
    }
    resolveTarget(target);
  }, [current, answers, resolveTarget]);

  const back = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const copy = [...h];
      const prev = copy.pop()!;
      setDir("back");
      setCurrentId(prev);
      setError(null);
      return copy;
    });
  }, []);

  function chooseSingle(label: string, next: string) {
    setAnswers((a) => ({ ...a, [current.id]: label }));
    setError(null);
    resolveTarget(next || current.next || NEXT);
  }

  // Klawiatura
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";

      if (e.key === "Enter") {
        if (current.type === "long_text" && !e.metaKey && !e.ctrlKey) return; // Enter = nowa linia
        if (current.type !== "single_choice") {
          e.preventDefault();
          advance();
        }
        return;
      }
      // A/B/C wybór opcji (poza polami tekstowymi)
      if (!typing && current.options && /^[a-zA-Z]$/.test(e.key)) {
        const idx = e.key.toLowerCase().charCodeAt(0) - 97;
        const opt = current.options[idx];
        if (opt) {
          if (current.type === "single_choice") chooseSingle(opt.label, opt.next);
          else toggleMulti(opt.label);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // bez deps — zawsze aktualne domknięcie

  function toggleMulti(label: string) {
    const cur = (answers[current.id] as string[]) || [];
    const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
    setAnswer(next);
  }

  if (!current) {
    return <div style={{ padding: 40, color: "#8A92A6" }}>Brak kroków.</div>;
  }

  // Na wąskim ekranie układ „split” składamy do jednej kolumny (obraz nad treścią).
  const isSplit = theme.layout === "split" && !!current.image && !isMobile;
  const align = theme.layout === "left" ? "left" : isSplit ? "left" : "center";

  const accent = theme.primary || "#6C5CE7";
  const text = theme.text || "#1A1D26";
  const bg = theme.bg || "#FFFFFF";
  const fontFamily = `"${theme.font || "Inter"}", system-ui, sans-serif`;

  const btn: React.CSSProperties = {
    background: accent,
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 22px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        minHeight: 420,
        background: bg,
        color: text,
        fontFamily,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes selltic-up { from { opacity:0; transform: translateY(28px);} to { opacity:1; transform:none;} }
        @keyframes selltic-down { from { opacity:0; transform: translateY(-28px);} to { opacity:1; transform:none;} }
        @media (prefers-reduced-motion: reduce){ .selltic-step{ animation: none !important; } }
      `}</style>

      {/* Pasek postępu */}
      <div style={{ height: 4, background: "rgba(0,0,0,0.06)", flexShrink: 0 }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: accent,
            transition: "width .35s cubic-bezier(.22,1,.36,1)",
          }}
        />
      </div>

      {/* Przycisk wstecz */}
      {history.length > 0 && current.type !== "end" && (
        <button
          onClick={back}
          aria-label="Wstecz"
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 2,
            width: 36,
            height: 36,
            borderRadius: 9,
            border: `1px solid rgba(0,0,0,0.10)`,
            background: "rgba(255,255,255,0.7)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            color: text,
          }}
        >
          <ArrowLeft size={18} />
        </button>
      )}

      <div
        style={{
          flex: 1,
          display: isSplit ? "grid" : "flex",
          gridTemplateColumns: isSplit ? "1fr 1fr" : undefined,
          alignItems: "center",
          justifyContent: "center",
          overflowY: "auto",
        }}
      >
        {isSplit && current.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.image}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        <div
          key={current.id + dir}
          className="selltic-step"
          style={{
            width: "100%",
            maxWidth: 520,
            margin: isSplit ? 0 : "0 auto",
            padding: isMobile ? "32px 18px" : "48px 32px",
            textAlign: align as React.CSSProperties["textAlign"],
            animation: `${dir === "fwd" ? "selltic-up" : "selltic-down"} .34s cubic-bezier(.22,1,.36,1)`,
          }}
        >
          {!isSplit && current.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.image}
              alt=""
              style={{
                maxWidth: "100%",
                maxHeight: 200,
                borderRadius: 12,
                marginBottom: 20,
                objectFit: "cover",
                margin: align === "center" ? "0 auto 20px" : "0 0 20px",
                display: "block",
              }}
            />
          )}

          <h2 style={{ fontSize: isMobile ? 23 : 28, fontWeight: 700, margin: "0 0 10px", lineHeight: 1.2 }}>
            {current.question || "—"}
          </h2>
          {current.description && (
            <p style={{ fontSize: 16, opacity: 0.7, margin: "0 0 22px" }}>{current.description}</p>
          )}

          {/* Pola wg typu */}
          {current.type === "short_text" && (
            <input
              autoFocus
              value={(answers[current.id] as string) || ""}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={current.placeholder}
              style={fieldStyle(text)}
            />
          )}
          {current.type === "email" && (
            <input
              autoFocus
              type="email"
              value={(answers[current.id] as string) || ""}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={current.placeholder}
              style={fieldStyle(text)}
            />
          )}
          {current.type === "long_text" && (
            <textarea
              autoFocus
              rows={4}
              value={(answers[current.id] as string) || ""}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={current.placeholder}
              style={{ ...fieldStyle(text), resize: "vertical" }}
            />
          )}

          {current.type === "single_choice" && (
            <div style={{ display: "grid", gap: 10, marginBottom: 8 }}>
              {(current.options ?? []).map((o, i) => (
                <button
                  key={o.id}
                  onClick={() => chooseSingle(o.label, o.next)}
                  style={optionStyle(accent, text, (answers[current.id] as string) === o.label)}
                >
                  <span style={keyBadge(accent)}>{String.fromCharCode(65 + i)}</span>
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {current.type === "multi_choice" && (
            <div style={{ display: "grid", gap: 10, marginBottom: 8 }}>
              {(current.options ?? []).map((o, i) => {
                const sel = ((answers[current.id] as string[]) || []).includes(o.label);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggleMulti(o.label)}
                    style={optionStyle(accent, text, sel)}
                  >
                    <span style={keyBadge(accent)}>{String.fromCharCode(65 + i)}</span>
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <p style={{ color: "#E5484D", fontSize: 14, margin: "10px 0 0" }}>{error}</p>
          )}

          {/* Przyciski akcji (nie dla single_choice ani end) */}
          {current.type !== "single_choice" && current.type !== "end" && (
            <div style={{ marginTop: 24, display: "flex", justifyContent: align === "center" ? "center" : "flex-start" }}>
              <button onClick={advance} style={btn}>
                {current.type === "welcome" ? current.cta || "Dalej" : "Dalej"}
                <ArrowRight size={18} />
              </button>
            </div>
          )}

          {current.type === "end" && !preview && (
            <p style={{ fontSize: 14, opacity: 0.6, marginTop: 18 }}>
              Możesz zamknąć to okno.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function fieldStyle(text: string): React.CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "14px 16px",
    fontSize: 17,
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: 12,
    background: "rgba(255,255,255,0.8)",
    color: text,
    outline: "none",
  };
}

function optionStyle(accent: string, text: string, selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    textAlign: "left",
    padding: "14px 16px",
    fontSize: 16,
    fontWeight: 500,
    borderRadius: 12,
    cursor: "pointer",
    border: `1.5px solid ${selected ? accent : "rgba(0,0,0,0.14)"}`,
    background: selected ? `${accent}14` : "rgba(255,255,255,0.7)",
    color: text,
    transition: "all .15s cubic-bezier(.22,1,.36,1)",
  };
}

function keyBadge(accent: string): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    flexShrink: 0,
    borderRadius: 6,
    border: `1px solid ${accent}`,
    color: accent,
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 700,
  };
}
