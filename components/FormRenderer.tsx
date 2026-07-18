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
  type StepOption,
  type OptionStyle,
  NEXT,
  googleFontHref,
  isChoice,
  branchingField,
  stepFields,
  isInputStep,
  isContainerStep,
  validateFieldValue,
  resolveNextAction,
  themeSurface,
  themeOptionStyle,
  themeProgress,
  themeRadius,
  themeCardBg,
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
  // ── Instrumentacja śledzenia (§3) — fire-and-forget, obsługiwane przez rodzica.
  onStepView?: (stepIndex: number, totalSteps: number) => void;
  onStepComplete?: (stepIndex: number, answers: Answers, totalSteps: number) => void;
  onFirstAnswer?: () => void;
};

export default function FormRenderer({
  form,
  gotoStepId,
  onSubmit,
  preview,
  forceMobile,
  onStepView,
  onStepComplete,
  onFirstAnswer,
}: Props) {
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
  const firstAnswerRef = useRef(false);

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

  // §3 — zdarzenie „widok kroku” przy każdej zmianie kroku (także na starcie).
  useEffect(() => {
    if (preview || !current) return;
    onStepView?.(currentIndex, steps.length);
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // §3 — pierwsza udzielona odpowiedź (raz na sesję renderera).
  useEffect(() => {
    if (preview || firstAnswerRef.current) return;
    const hasAny = Object.values(answers).some(
      (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
    );
    if (hasAny) {
      firstAnswerRef.current = true;
      onFirstAnswer?.();
    }
  }, [answers, preview, onFirstAnswer]);

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

    // §3 — krok ukończony (autosave częściowych odpowiedzi po stronie rodzica).
    if (!preview) onStepComplete?.(currentIndex, answers, steps.length);

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
  }, [current, answers, resolveTarget, validateCurrent, preview, onStepComplete, currentIndex, steps.length]);

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
    const nextAnswers = { ...answers, [field.id]: label };
    setAnswers(nextAnswers);
    setErrors({});
    // §3 — wybór = ukończenie kroku; przekaż świeże odpowiedzi do autosave.
    if (!preview) onStepComplete?.(currentIndex, nextAnswers, steps.length);
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

  // ── Styl / wygląd (redesign) ──────────────────────────────────────────
  const surface = themeSurface(theme); // "card" | "full"
  const optStyle = themeOptionStyle(theme); // "list" | "cards"
  const progressStyle = themeProgress(theme); // "bar" | "dots" | "none"
  const radius = themeRadius(theme);
  const cardBg = themeCardBg(theme);
  const branding = form.branding;
  const isCard = surface === "card";

  // Układ „split” (obraz po lewej) tylko w trybie pełnoekranowym.
  const isSplit = !isCard && theme.layout === "split" && !!current.image && !isMobile;
  const align: "left" | "center" = theme.layout === "left" ? "left" : isSplit ? "left" : "center";

  const accent = theme.primary || "#6C5CE7";
  const text = theme.text || "#1A1D26";
  const bg = theme.bg || "#FFFFFF";
  const fontFamily = `"${theme.font || "Inter"}", system-ui, sans-serif`;
  const cardRadius = Math.min(28, radius + 8);
  const cardMaxWidth = 560;

  const btn: React.CSSProperties = {
    background: accent,
    color: "#fff",
    border: "none",
    borderRadius: radius,
    padding: "13px 24px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    boxShadow: `0 8px 20px ${accent}33`,
  };

  // Nagłówek kroku: dla kontenera pokazujemy tylko, gdy podano tekst.
  const heading = current.question || (container ? "" : "—");

  const canBack = history.length > 0 && current.type !== "end";
  const showCounter = current.type !== "end" && current.type !== "welcome" && steps.length > 2;
  const showKrok = !!theme.showStepNumber && current.type !== "end" && current.type !== "welcome" && current.type !== "statement";
  const showStepAvatar = !!branding?.showAvatarOnSteps && !!branding?.logo && current.type !== "welcome" && current.type !== "end";

  // ── Nagłówek marki (awatar + nazwa + podtytuł) ────────────────────────
  const brandHeader =
    branding?.showHeader && (branding.logo || branding.name) ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          maxWidth: cardMaxWidth,
          margin: "0 auto",
          marginBottom: isCard ? 14 : 22,
          padding: "0 2px",
          boxSizing: "border-box",
        }}
      >
        {branding.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logo}
            alt=""
            style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", border: `1px solid rgba(0,0,0,0.08)`, flexShrink: 0 }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          {branding.name && (
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2, color: text, opacity: 0.85 }}>{branding.name}</div>
          )}
          {branding.tagline && (
            <div style={{ fontSize: 12.5, opacity: 0.55, lineHeight: 1.3, color: text }}>{branding.tagline}</div>
          )}
        </div>
      </div>
    ) : null;

  // ── Pasek / kropki postępu + wstecz + licznik (górny pasek kroku) ─────
  const topBar =
    canBack || showCounter || progressStyle !== "none" ? (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        {canBack ? (
          <button
            onClick={back}
            aria-label="Wstecz"
            style={{
              flexShrink: 0,
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: `1px solid rgba(0,0,0,0.10)`,
              background: "transparent",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: text,
            }}
          >
            <ArrowLeft size={17} />
          </button>
        ) : (
          progressStyle !== "none" && <span style={{ width: 0 }} />
        )}

        {progressStyle === "bar" && (
          <div style={{ flex: 1, height: 8, borderRadius: 999, background: "rgba(0,0,0,0.07)", overflow: "hidden" }}>
            <motion.div animate={{ width: `${progress}%` }} transition={spring} style={{ height: "100%", background: accent, borderRadius: 999 }} />
          </div>
        )}
        {progressStyle === "dots" && (
          <div style={{ flex: 1, display: "flex", gap: 6, alignItems: "center" }}>
            {steps.map((s, i) => (
              <span
                key={s.id}
                style={{
                  height: 7,
                  flex: 1,
                  maxWidth: 40,
                  borderRadius: 999,
                  background: i <= currentIndex ? accent : "rgba(0,0,0,0.10)",
                  transition: "background .2s ease",
                }}
              />
            ))}
          </div>
        )}
        {progressStyle === "none" && <div style={{ flex: 1 }} />}

        {showCounter && (
          <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, opacity: 0.55 }}>
            {Math.min(currentIndex + 1, steps.length)} / {steps.length}
          </span>
        )}
      </div>
    ) : null;

  // ── Treść kroku (współdzielona przez tryb „card” i „full”) ────────────
  const stepContent = (
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
        style={{ textAlign: align as React.CSSProperties["textAlign"] }}
      >
        {showStepAvatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding!.logo}
            alt=""
            style={{
              width: 54,
              height: 54,
              borderRadius: "50%",
              objectFit: "cover",
              border: `2px solid ${accent}`,
              display: "block",
              margin: align === "center" ? "0 auto 14px" : "0 0 14px",
            }}
          />
        )}

        {!isSplit && current.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.image}
            alt=""
            style={{
              maxWidth: "100%",
              maxHeight: 200,
              borderRadius: radius,
              objectFit: "cover",
              margin: align === "center" ? "0 auto 20px" : "0 0 20px",
              display: "block",
            }}
          />
        )}

        {showKrok && (
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: accent, marginBottom: 8 }}>
            Krok {Math.min(currentIndex + 1, steps.length)}
          </div>
        )}

        {heading && (
          <h2 style={{ fontSize: isMobile ? 24 : 29, fontWeight: 800, margin: "0 0 10px", lineHeight: 1.18, letterSpacing: -0.3 }}>
            {heading}
          </h2>
        )}
        {current.description && (
          <p style={{ fontSize: 16, opacity: 0.68, margin: "0 0 24px", lineHeight: 1.45 }}>{current.description}</p>
        )}

        {/* Pola wejściowe (jedno lub wiele — item 6). */}
        {isInputStep(current) && (
          <motion.div animate={shake} style={{ display: "grid", gap: 22 }}>
            {fields.map((f) => (
              <FieldControl
                key={f.id}
                field={f}
                showLabel={container}
                optionStyle={optStyle}
                radius={radius}
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
                  autoAdvanceChoice ? (label, next) => chooseSingleAuto(f, label, next) : undefined
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
          <div style={{ marginTop: 26, display: "flex", justifyContent: align === "center" ? "center" : "flex-start" }}>
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
  );

  // ── Tryb KARTY: wyśrodkowana, brandowana karta na tle strony ──────────
  if (isCard) {
    return (
      <div
        style={{
          height: "100%",
          minHeight: 460,
          background: bg,
          color: text,
          fontFamily,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: isMobile ? "24px 16px" : "40px 24px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ width: "100%", maxWidth: cardMaxWidth, margin: "0 auto" }}>
          {brandHeader}
          <div
            style={{
              position: "relative",
              background: cardBg,
              borderRadius: cardRadius,
              boxShadow: "0 18px 50px rgba(15,18,28,0.10), 0 2px 6px rgba(15,18,28,0.05)",
              padding: isMobile ? "22px 20px 26px" : "28px 32px 34px",
              boxSizing: "border-box",
            }}
          >
            {topBar}
            {stepContent}
          </div>
        </div>
      </div>
    );
  }

  // ── Tryb PEŁNY: treść na całym tle (klasyczny, „na całą stronę”) ───────
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
      {/* Pasek postępu na samej górze */}
      {progressStyle !== "none" && (
        <div style={{ height: 4, background: "rgba(0,0,0,0.06)", flexShrink: 0 }}>
          <motion.div animate={{ width: `${progress}%` }} transition={spring} style={{ height: "100%", background: accent }} />
        </div>
      )}

      {/* Przycisk wstecz */}
      {canBack && (
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
      {showCounter && (
        <div style={{ position: "absolute", top: 18, right: 18, zIndex: 2, fontSize: 12, fontWeight: 600, opacity: 0.55 }}>
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
          <img src={current.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}

        <div
          style={{
            width: "100%",
            maxWidth: cardMaxWidth,
            margin: isSplit ? 0 : "0 auto",
            padding: isMobile ? "32px 18px" : "48px 32px",
            boxSizing: "border-box",
          }}
        >
          {brandHeader}
          {stepContent}
        </div>
      </div>
    </div>
  );
}

/* ── Kontrolka pojedynczego pola ────────────────────────────── */
function FieldControl({
  field,
  showLabel,
  optionStyle,
  radius,
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
  optionStyle: OptionStyle;
  radius: number;
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
  const cards = optionStyle === "cards";

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

      {isChoice(field.type) && (
        <div style={{ display: "grid", gap: 10 }}>
          {(field.options ?? []).map((o, i) => {
            const selected = field.type === "multi_choice" ? arrVal.includes(o.label) : strVal === o.label;
            const inner = <OptionInner option={o} index={i} accent={accent} selected={selected} cards={cards} radius={radius} />;
            const style = optionRowStyle(accent, text, selected, radius, cards);
            return field.type === "single_choice" ? (
              <motion.button
                key={o.id}
                type="button"
                onClick={() => (onChooseSingle ? onChooseSingle(o.label, o.next) : onChange(o.label))}
                initial={{ opacity: 0, y: reduce ? 0 : 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduce ? { duration: 0 } : { ...spring, delay: 0.06 + i * 0.05 }}
                style={style}
              >
                {inner}
              </motion.button>
            ) : (
              <button key={o.id} type="button" onClick={() => onToggleMulti(o.label)} style={style}>
                {inner}
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

// Wnętrze karty opcji: kafelek (emoji lub litera A/B/C) + etykieta + podtytuł.
function OptionInner({
  option,
  index,
  accent,
  selected,
  cards,
  radius,
}: {
  option: StepOption;
  index: number;
  accent: string;
  selected: boolean;
  cards: boolean;
  radius: number;
}) {
  return (
    <>
      <span style={optionTile(accent, !!option.icon, cards, selected, radius)}>
        {option.icon ? option.icon : String.fromCharCode(65 + index)}
      </span>
      <span style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontWeight: 600, fontSize: cards ? 16.5 : 16, lineHeight: 1.25 }}>{option.label}</span>
        {option.description && (
          <span style={{ fontSize: 13.5, opacity: 0.6, lineHeight: 1.3, fontWeight: 400 }}>{option.description}</span>
        )}
      </span>
    </>
  );
}

function optionRowStyle(accent: string, text: string, selected: boolean, radius: number, cards: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 14,
    width: "100%",
    textAlign: "left",
    padding: cards ? "14px 16px" : "13px 15px",
    fontSize: 16,
    fontWeight: 500,
    borderRadius: radius,
    cursor: "pointer",
    border: `1.5px solid ${selected ? accent : "rgba(0,0,0,0.12)"}`,
    background: selected ? `${accent}12` : "#fff",
    color: text,
    boxShadow: selected ? `0 0 0 3px ${accent}22` : "0 1px 2px rgba(15,18,28,0.04)",
    transition: "all .15s cubic-bezier(.22,1,.36,1)",
  };
}

// Kafelek po lewej: dla emoji — miękkie tło; dla litery — obrys akcentem.
function optionTile(accent: string, hasIcon: boolean, cards: boolean, selected: boolean, radius: number): React.CSSProperties {
  const size = cards ? 40 : 26;
  return {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: hasIcon ? Math.min(12, radius) : cards ? 10 : 6,
    display: "grid",
    placeItems: "center",
    fontSize: hasIcon ? (cards ? 20 : 15) : 12.5,
    fontWeight: 700,
    lineHeight: 1,
    ...(hasIcon
      ? { background: selected ? `${accent}1f` : "rgba(0,0,0,0.05)", color: accent }
      : { border: `1px solid ${accent}`, color: accent, background: selected ? `${accent}12` : "transparent" }),
  };
}
