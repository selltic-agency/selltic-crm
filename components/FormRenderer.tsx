// components/FormRenderer.tsx — współdzielony renderer formularza.
// Używany w podglądzie edytora ORAZ na publicznej stronie /f/[slug].
// Obsługuje routing, historię (przycisk wstecz), pasek postępu,
// nawigację klawiaturą (Enter, A/B/C) i animacje slajdów.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
} from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  type FormSchema,
  type Step,
  NEXT,
  googleFontHref,
  isTextInput,
  validateStepValue,
  resolveNextAction,
} from "@/lib/forms";
import {
  COUNTRY_PREFIXES,
  DEFAULT_PHONE_PREFIX,
  splitPhone,
  formatPhoneValue,
} from "@/lib/phone";
import { useIsMobile } from "@/lib/responsive";

export type Answers = Record<string, string | string[]>;

const ERROR_COLOR = "#EB5757";

type Props = {
  form: FormSchema;
  // Podgląd w edytorze: skok do wskazanego kroku (np. zaznaczonego w liście).
  gotoStepId?: string;
  // Wywoływane, gdy routing dojdzie do __submit__ (publiczna strona → POST).
  onSubmit?: (answers: Answers) => void;
  // Tryb podglądu — nie wykonuje realnego wysłania.
  preview?: boolean;
};

export default function FormRenderer({ form, gotoStepId, onSubmit, preview }: Props) {
  const steps = form.steps ?? [];
  const theme = form.theme;
  const isMobile = useIsMobile(680);
  const reduce = useReducedMotion();
  const shake = useAnimationControls();

  // Sprężyste przejście (lub natychmiastowe przy prefers-reduced-motion).
  const spring = reduce
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 300, damping: 30 } as const);

  const [currentId, setCurrentId] = useState<string>(steps[0]?.id ?? "");
  const [history, setHistory] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [error, setError] = useState<string | null>(null);
  const [phonePrefix, setPhonePrefix] = useState<string>(DEFAULT_PHONE_PREFIX);
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

  // Inicjalizuj prefiks telefonu przy wejściu na krok „phone”
  // (z zapisanej odpowiedzi lub domyślnego prefiksu kroku).
  useEffect(() => {
    if (current?.type === "phone") {
      const stored = (answers[current.id] as string) || "";
      const { prefix } = splitPhone(stored, current.phonePrefix || DEFAULT_PHONE_PREFIX);
      setPhonePrefix(prefix);
    }
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const result = onSubmit?.(answers);

      // Przekierowanie po wysłaniu (opcjonalne, ustawiane w kreatorze).
      // Czekamy aż zgłoszenie zostanie wysłane (best-effort), po czym
      // przekierowujemy zamiast pokazywać ekran „dziękujemy”.
      const redirectUrl = (form.settings?.redirectUrl || "").trim();
      if (redirectUrl && !preview) {
        Promise.resolve(result)
          .catch(() => {})
          .finally(() => {
            try {
              // W trybie embed przekieruj stronę nadrzędną, jeśli to możliwe.
              (window.top ?? window).location.href = redirectUrl;
            } catch {
              window.location.href = redirectUrl;
            }
          });
        return;
      }
    }
    const end = steps.find((s) => s.type === "end");
    if (end) {
      setDir("fwd");
      setCurrentId(end.id);
    }
  }, [answers, onSubmit, steps, form.settings, preview]);

  const resolveTarget = useCallback(
    (target: string) => {
      // Rozstrzygnięcie routingu jest współdzielone i testowane w lib/forms.ts.
      // Dotarcie do kroku „end” = wysyłka formularza (naprawa: zgłoszenia znikały).
      const action = resolveNextAction(steps, currentIndex, target);
      if (action.kind === "submit") return submit();
      setHistory((h) => [...h, current.id]);
      setDir("fwd");
      setCurrentId(action.id);
      setError(null);
    },
    [steps, currentIndex, current, submit]
  );

  // Waliduje bieżące pole tekstowe. Ustawia komunikat błędu i (opcjonalnie)
  // uruchamia animację „shake”. Zwraca true gdy pole jest poprawne.
  const validateCurrent = useCallback(
    (withShake: boolean) => {
      if (!current || (!isTextInput(current.type) && current.type !== "phone")) return true;
      const v = (answers[current.id] as string) || "";
      const msg = validateStepValue(current, v);
      setError(msg);
      if (msg && withShake && !reduce) {
        shake.start({
          x: [0, -8, 8, -6, 6, -3, 3, 0],
          transition: { duration: 0.4 },
        });
      }
      return !msg;
    },
    [current, answers, reduce, shake]
  );

  const advance = useCallback(() => {
    if (!current) return;
    // Walidacja (blokuje dalsze przejście dla pól tekstowych).
    if (!validateCurrent(true)) return;

    // Routing
    let target = current.next || NEXT;
    if (current.type === "single_choice") {
      const sel = answers[current.id] as string | undefined;
      const opt = current.options?.find((o) => o.label === sel);
      if (opt) target = opt.next || NEXT;
    }
    resolveTarget(target);
  }, [current, answers, resolveTarget, validateCurrent]);

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
      {/* Pasek postępu */}
      <div style={{ height: 4, background: "rgba(0,0,0,0.06)", flexShrink: 0 }}>
        <motion.div
          animate={{ width: `${progress}%` }}
          transition={spring}
          style={{
            height: "100%",
            background: accent,
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

        <AnimatePresence mode="wait" custom={dir}>
        <motion.div
          key={current.id}
          custom={dir}
          variants={{
            enter: (d: "fwd" | "back") => ({
              opacity: 0,
              y: reduce ? 0 : d === "fwd" ? 28 : -28,
            }),
            center: { opacity: 1, y: 0 },
            exit: (d: "fwd" | "back") => ({
              opacity: 0,
              y: reduce ? 0 : d === "fwd" ? -28 : 28,
            }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={spring}
          style={{
            width: "100%",
            maxWidth: 520,
            margin: isSplit ? 0 : "0 auto",
            padding: isMobile ? "32px 18px" : "48px 32px",
            textAlign: align as React.CSSProperties["textAlign"],
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
          {(isTextInput(current.type) || current.type === "phone") && (
            <motion.div animate={shake}>
              {current.type === "phone" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    value={phonePrefix}
                    onChange={(e) => {
                      const prefix = e.target.value;
                      setPhonePrefix(prefix);
                      const local = splitPhone(
                        (answers[current.id] as string) || "",
                        prefix
                      ).local;
                      setAnswer(local.trim() ? `${prefix} ${local}` : "");
                    }}
                    aria-label="Prefiks kraju"
                    style={{ ...fieldStyle(text, !!error), width: "auto", flexShrink: 0 }}
                  >
                    {COUNTRY_PREFIXES.map((p) => (
                      <option key={p.iso} value={p.code}>
                        {p.flag} {p.code}
                      </option>
                    ))}
                  </select>
                  <input
                    autoFocus
                    type="tel"
                    value={splitPhone((answers[current.id] as string) || "", phonePrefix).local}
                    onChange={(e) => {
                      const local = e.target.value;
                      setAnswer(local.trim() ? `${phonePrefix} ${local}` : "");
                    }}
                    onBlur={() => {
                      // Sprowadź numer do spójnego formatu (np. „+48 XXX XXX XXX”),
                      // o ile jest poprawny — nie przeszkadzając w pisaniu.
                      const local = splitPhone((answers[current.id] as string) || "", phonePrefix).local;
                      if (local.trim() && !validateStepValue(current, `${phonePrefix} ${local}`)) {
                        setAnswer(formatPhoneValue(phonePrefix, local));
                      }
                      validateCurrent(false);
                    }}
                    placeholder={current.placeholder}
                    style={fieldStyle(text, !!error)}
                  />
                </div>
              )}
              {current.type === "short_text" && (
                <input
                  autoFocus
                  value={(answers[current.id] as string) || ""}
                  onChange={(e) => setAnswer(e.target.value)}
                  onBlur={() => validateCurrent(false)}
                  placeholder={current.placeholder}
                  style={fieldStyle(text, !!error)}
                />
              )}
              {current.type === "email" && (
                <input
                  autoFocus
                  type="email"
                  value={(answers[current.id] as string) || ""}
                  onChange={(e) => setAnswer(e.target.value)}
                  onBlur={() => validateCurrent(false)}
                  placeholder={current.placeholder}
                  style={fieldStyle(text, !!error)}
                />
              )}
              {current.type === "long_text" && (
                <textarea
                  autoFocus
                  rows={4}
                  value={(answers[current.id] as string) || ""}
                  onChange={(e) => setAnswer(e.target.value)}
                  onBlur={() => validateCurrent(false)}
                  placeholder={current.placeholder}
                  style={{ ...fieldStyle(text, !!error), resize: "vertical" }}
                />
              )}
            </motion.div>
          )}

          {current.type === "single_choice" && (
            <div style={{ display: "grid", gap: 10, marginBottom: 8 }}>
              {(current.options ?? []).map((o, i) => (
                <motion.button
                  key={o.id}
                  onClick={() => chooseSingle(o.label, o.next)}
                  initial={{ opacity: 0, y: reduce ? 0 : 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduce ? { duration: 0 } : { ...spring, delay: 0.08 + i * 0.06 }}
                  style={optionStyle(accent, text, (answers[current.id] as string) === o.label)}
                >
                  <span style={keyBadge(accent)}>{String.fromCharCode(65 + i)}</span>
                  {o.label}
                </motion.button>
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
            <p style={{ color: ERROR_COLOR, fontSize: 14, margin: "10px 0 0" }}>{error}</p>
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
        </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function fieldStyle(text: string, invalid = false): React.CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "14px 16px",
    fontSize: 17,
    border: invalid ? `1.5px solid ${ERROR_COLOR}` : "1px solid rgba(0,0,0,0.15)",
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
