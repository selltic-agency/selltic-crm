// components/FormRenderer.tsx — współdzielony renderer formularza.
// Używany w podglądzie edytora ORAZ na publicznej stronie /f/[slug].
// Obsługuje routing, historię (przycisk wstecz), pasek postępu,
// nawigację klawiaturą (Enter, A/B/C), animacje slajdów oraz — od item 6 —
// wiele pól na jednym kroku (krok = kontener pól).
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
  type FormField,
  NEXT,
  googleFontHref,
  isChoice,
  branchingField,
  stepFields,
  isInputStep,
  isContainerStep,
  validateFieldValue,
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
  // Wymuszony układ mobilny (podgląd „telefon” w edytorze).
  forceMobile?: boolean;
};

export default function FormRenderer({ form, gotoStepId, onSubmit, preview, forceMobile }: Props) {
  const steps = form.steps ?? [];
  const theme = form.theme;
  const autoMobile = useIsMobile(680);
  const isMobile = forceMobile || autoMobile;
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
  // Błędy walidacji kluczowane po id pola.
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  // Prefiks kraju per pole telefonu.
  const [phonePrefixes, setPhonePrefixes] = useState<Record<string, string>>({});
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
      setErrors({});
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

  const fields = useMemo(() => (current ? stepFields(current) : []), [current]);
  const container = current ? isContainerStep(current) : false;
  // Auto-przejście (styl Typeform) tylko, gdy krok ma DOKŁADNIE jedno pole
  // wyboru jednokrotnego — inaczej użytkownik musi wypełnić pozostałe pola.
  const autoAdvanceChoice = fields.length === 1 && fields[0].type === "single_choice";

  // Inicjalizuj prefiksy telefonu przy wejściu na krok (z zapisanych odpowiedzi
  // lub domyślnego prefiksu pola).
  useEffect(() => {
    if (!current) return;
    setPhonePrefixes((prev) => {
      const next = { ...prev };
      for (const f of stepFields(current)) {
        if (f.type !== "phone") continue;
        const stored = (answers[f.id] as string) || "";
        next[f.id] = splitPhone(stored, f.phonePrefix || DEFAULT_PHONE_PREFIX).prefix;
      }
      return next;
    });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFieldAnswer = useCallback((fieldId: string, val: string | string[]) => {
    setAnswers((a) => ({ ...a, [fieldId]: val }));
    setErrors((e) => (e[fieldId] ? { ...e, [fieldId]: null } : e));
  }, []);

  const submit = useCallback(() => {
    if (!submittedRef.current) {
      submittedRef.current = true;
      const result = onSubmit?.(answers);

      // Przekierowanie po wysłaniu (opcjonalne, ustawiane w kreatorze).
      const redirectUrl = (form.settings?.redirectUrl || "").trim();
      if (redirectUrl && !preview) {
        Promise.resolve(result)
          .catch(() => {})
          .finally(() => {
            try {
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
      const action = resolveNextAction(steps, currentIndex, target);
      if (action.kind === "submit") return submit();
      setHistory((h) => [...h, current.id]);
      setDir("fwd");
      setCurrentId(action.id);
      setErrors({});
    },
    [steps, currentIndex, current, submit]
  );

  // Waliduje wszystkie pola wejściowe bieżącego kroku. Ustawia błędy i
  // (opcjonalnie) animację „shake”. Zwraca true, gdy wszystkie pola OK.
  const validateCurrent = useCallback(
    (withShake: boolean) => {
      if (!current || !isInputStep(current)) return true;
      const next: Record<string, string | null> = {};
      let ok = true;
      for (const f of stepFields(current)) {
        const raw = f.type === "multi_choice" ? "" : ((answers[f.id] as string) || "");
        // Wielokrotny wybór: „wymagane” = min. jedna zaznaczona opcja.
        if (f.type === "multi_choice") {
          const sel = (answers[f.id] as string[]) || [];
          const msg = f.required && sel.length === 0 ? "Zaznacz co najmniej jedną opcję." : null;
          next[f.id] = msg;
          if (msg) ok = false;
          continue;
        }
        if (isChoice(f.type)) {
          const sel = (answers[f.id] as string) || "";
          const msg = f.required && !sel ? "Wybierz opcję." : null;
          next[f.id] = msg;
          if (msg) ok = false;
          continue;
        }
        const msg = validateFieldValue(f, raw);
        next[f.id] = msg;
        if (msg) ok = false;
      }
      setErrors(next);
      if (!ok && withShake && !reduce) {
        shake.start({ x: [0, -8, 8, -6, 6, -3, 3, 0], transition: { duration: 0.4 } });
      }
      return ok;
    },
    [current, answers, reduce, shake]
  );

  const advance = useCallback(() => {
    if (!current) return;
    if (!validateCurrent(true)) return;

    // Routing: domyślny cel kroku, ewentualnie nadpisany przez pole
    // rozgałęziające (pierwsze single_choice).
    let target = current.next || NEXT;
    const bf = branchingField(current);
    if (bf) {
      const sel = answers[bf.id] as string | undefined;
      const opt = bf.options?.find((o) => o.label === sel);
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
      setErrors({});
      return copy;
    });
  }, []);

  // Wybór jednokrotny z auto-przejściem (krok jedno-polowy).
  function chooseSingleAuto(field: FormField, label: string, next: string) {
    setAnswers((a) => ({ ...a, [field.id]: label }));
    setErrors({});
    resolveTarget(next || current.next || NEXT);
  }

  function toggleMulti(fieldId: string, label: string) {
    const cur = (answers[fieldId] as string[]) || [];
    const nextVal = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
    setFieldAnswer(fieldId, nextVal);
  }

  // Klawiatura (na poziomie kroku).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Enter") {
        // W polu długiego tekstu Enter = nowa linia (chyba że z modyfikatorem).
        const inLongText = tag === "TEXTAREA";
        if (inLongText && !e.metaKey && !e.ctrlKey) return;
        if (!autoAdvanceChoice) {
          e.preventDefault();
          advance();
        }
        return;
      }
      // A/B/C — skróty tylko dla kroku z jednym polem wyboru.
      if (!typing && autoAdvanceChoice && /^[a-zA-Z]$/.test(e.key)) {
        const field = fields[0];
        const idx = e.key.toLowerCase().charCodeAt(0) - 97;
        const opt = field.options?.[idx];
        if (opt) chooseSingleAuto(field, opt.label, opt.next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // bez deps — zawsze aktualne domknięcie

  if (!current) {
    return <div style={{ padding: 40, color: "#8A92A6" }}>Brak kroków.</div>;
  }

  // Na wąskim ekranie układ „split” składamy do jednej kolumny.
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

  // Nagłówek kroku: dla kontenera pokazujemy tylko, gdy podano tekst.
  const heading = current.question || (container ? "" : "—");

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
      {/* Pasek postępu + „Krok X z Y” (item 7) */}
      <div style={{ height: 4, background: "rgba(0,0,0,0.06)", flexShrink: 0 }}>
        <motion.div
          animate={{ width: `${progress}%` }}
          transition={spring}
          style={{ height: "100%", background: accent }}
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

      {/* Wskaźnik postępu tekstowy — dyskretnie w prawym górnym rogu. */}
      {current.type !== "end" && current.type !== "welcome" && steps.length > 2 && (
        <div
          style={{
            position: "absolute",
            top: 18,
            right: 18,
            zIndex: 2,
            fontSize: 12,
            fontWeight: 600,
            opacity: 0.55,
          }}
        >
          Krok {Math.min(currentIndex + 1, steps.length)} z {steps.length}
        </div>
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
              enter: (d: "fwd" | "back") => ({ opacity: 0, y: reduce ? 0 : d === "fwd" ? 28 : -28 }),
              center: { opacity: 1, y: 0 },
              exit: (d: "fwd" | "back") => ({ opacity: 0, y: reduce ? 0 : d === "fwd" ? -28 : 28 }),
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

            {heading && (
              <h2 style={{ fontSize: isMobile ? 23 : 28, fontWeight: 700, margin: "0 0 10px", lineHeight: 1.2 }}>
                {heading}
              </h2>
            )}
            {current.description && (
              <p style={{ fontSize: 16, opacity: 0.7, margin: "0 0 22px" }}>{current.description}</p>
            )}

            {/* Pola wejściowe (jedno lub wiele — item 6). */}
            {isInputStep(current) && (
              <motion.div animate={shake} style={{ display: "grid", gap: 22 }}>
                {fields.map((f) => (
                  <FieldControl
                    key={f.id}
                    field={f}
                    showLabel={container}
                    value={answers[f.id]}
                    error={errors[f.id] ?? null}
                    accent={accent}
                    text={text}
                    align={align}
                    autoFocusFirst={fields[0]?.id === f.id}
                    phonePrefix={phonePrefixes[f.id] || f.phonePrefix || DEFAULT_PHONE_PREFIX}
                    onPhonePrefix={(prefix) => {
                      setPhonePrefixes((p) => ({ ...p, [f.id]: prefix }));
                      const local = splitPhone((answers[f.id] as string) || "", prefix).local;
                      setFieldAnswer(f.id, local.trim() ? `${prefix} ${local}` : "");
                    }}
                    onChange={(val) => setFieldAnswer(f.id, val)}
                    onBlurValidate={() => {
                      if (isChoice(f.type)) return;
                      const raw = (answers[f.id] as string) || "";
                      // Domknij format telefonu, jeśli poprawny.
                      if (f.type === "phone") {
                        const prefix = phonePrefixes[f.id] || f.phonePrefix || DEFAULT_PHONE_PREFIX;
                        const local = splitPhone(raw, prefix).local;
                        if (local.trim() && !validateFieldValue(f, `${prefix} ${local}`)) {
                          setFieldAnswer(f.id, formatPhoneValue(prefix, local));
                        }
                      }
                      setErrors((e) => ({ ...e, [f.id]: validateFieldValue(f, raw) }));
                    }}
                    onChooseSingle={
                      autoAdvanceChoice
                        ? (label, next) => chooseSingleAuto(f, label, next)
                        : undefined
                    }
                    onToggleMulti={(label) => toggleMulti(f.id, label)}
                    reduce={!!reduce}
                    spring={spring}
                  />
                ))}
              </motion.div>
            )}

            {/* Przyciski akcji (nie dla auto-przejścia ani end). */}
            {!autoAdvanceChoice && current.type !== "end" && (
              <div style={{ marginTop: 24, display: "flex", justifyContent: align === "center" ? "center" : "flex-start" }}>
                <button onClick={advance} style={btn}>
                  {current.type === "welcome" ? current.cta || "Dalej" : "Dalej"}
                  <ArrowRight size={18} />
                </button>
              </div>
            )}

            {current.type === "end" && !preview && (
              <p style={{ fontSize: 14, opacity: 0.6, marginTop: 18 }}>Możesz zamknąć to okno.</p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Kontrolka pojedynczego pola ────────────────────────────── */
function FieldControl({
  field,
  showLabel,
  value,
  error,
  accent,
  text,
  align,
  autoFocusFirst,
  phonePrefix,
  onPhonePrefix,
  onChange,
  onBlurValidate,
  onChooseSingle,
  onToggleMulti,
  reduce,
  spring,
}: {
  field: FormField;
  showLabel: boolean;
  value: string | string[] | undefined;
  error: string | null;
  accent: string;
  text: string;
  align: string;
  autoFocusFirst: boolean;
  phonePrefix: string;
  onPhonePrefix: (prefix: string) => void;
  onChange: (val: string | string[]) => void;
  onBlurValidate: () => void;
  onChooseSingle?: (label: string, next: string) => void;
  onToggleMulti: (label: string) => void;
  reduce: boolean;
  spring: object;
}) {
  const strVal = (value as string) || "";
  const arrVal = (value as string[]) || [];
  const invalid = !!error;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {showLabel && field.question && (
        <div style={{ textAlign: align as React.CSSProperties["textAlign"] }}>
          <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>{field.question}</span>
          {field.description && (
            <div style={{ fontSize: 14, opacity: 0.65, marginTop: 2 }}>{field.description}</div>
          )}
        </div>
      )}

      {field.type === "phone" && (
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={phonePrefix}
            onChange={(e) => onPhonePrefix(e.target.value)}
            aria-label="Prefiks kraju"
            style={{ ...fieldStyle(text, invalid), width: "auto", flexShrink: 0 }}
          >
            {COUNTRY_PREFIXES.map((p) => (
              <option key={p.iso} value={p.code}>
                {p.flag} {p.code}
              </option>
            ))}
          </select>
          <input
            autoFocus={autoFocusFirst}
            type="tel"
            value={splitPhone(strVal, phonePrefix).local}
            onChange={(e) => {
              const local = e.target.value;
              onChange(local.trim() ? `${phonePrefix} ${local}` : "");
            }}
            onBlur={onBlurValidate}
            placeholder={field.placeholder}
            style={fieldStyle(text, invalid)}
          />
        </div>
      )}

      {field.type === "short_text" && (
        <input
          autoFocus={autoFocusFirst}
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlurValidate}
          placeholder={field.placeholder}
          style={fieldStyle(text, invalid)}
        />
      )}

      {field.type === "email" && (
        <input
          autoFocus={autoFocusFirst}
          type="email"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlurValidate}
          placeholder={field.placeholder}
          style={fieldStyle(text, invalid)}
        />
      )}

      {field.type === "long_text" && (
        <textarea
          autoFocus={autoFocusFirst}
          rows={4}
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlurValidate}
          placeholder={field.placeholder}
          style={{ ...fieldStyle(text, invalid), resize: "vertical" }}
        />
      )}

      {field.type === "single_choice" && (
        <div style={{ display: "grid", gap: 10 }}>
          {(field.options ?? []).map((o, i) => (
            <motion.button
              key={o.id}
              onClick={() =>
                onChooseSingle ? onChooseSingle(o.label, o.next) : onChange(o.label)
              }
              initial={{ opacity: 0, y: reduce ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { ...spring, delay: 0.08 + i * 0.06 }}
              style={optionStyle(accent, text, strVal === o.label)}
            >
              <span style={keyBadge(accent)}>{String.fromCharCode(65 + i)}</span>
              {o.label}
            </motion.button>
          ))}
        </div>
      )}

      {field.type === "multi_choice" && (
        <div style={{ display: "grid", gap: 10 }}>
          {(field.options ?? []).map((o, i) => {
            const sel = arrVal.includes(o.label);
            return (
              <button key={o.id} onClick={() => onToggleMulti(o.label)} style={optionStyle(accent, text, sel)}>
                <span style={keyBadge(accent)}>{String.fromCharCode(65 + i)}</span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {error && <p style={{ color: ERROR_COLOR, fontSize: 14, margin: "2px 0 0" }}>{error}</p>}
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
