// app/admin/forms/[id]/page.tsx — edytor formularza (trzy panele).
// Lewy: lista kroków · Środkowy: edytor kroku + motyw · Prawy: podgląd na żywo.
// Autozapis schematu (debounce 800ms); Publikuj/Aktualizuj kopiuje schema → published.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Hand,
  Type,
  AlignLeft,
  AtSign,
  CircleDot,
  ListChecks,
  MessageSquare,
  Flag,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import { useIsMobile } from "@/lib/responsive";
import {
  type FormSchema,
  type Step,
  type StepType,
  type FormStatus,
  type FieldValidation,
  NEXT,
  SUBMIT,
  STEP_TYPES,
  FONTS,
  VALIDATION_PRESETS,
  blankStep,
  newStepId,
  isChoice,
  isTextInput,
  stepTypeLabel,
  detectPreset,
  hasValidationRules,
} from "@/lib/forms";
import FormRenderer from "@/components/FormRenderer";
import { useToast } from "@/components/Toast";

const TYPE_ICON: Record<StepType, typeof Type> = {
  welcome: Hand,
  short_text: Type,
  long_text: AlignLeft,
  email: AtSign,
  single_choice: CircleDot,
  multi_choice: ListChecks,
  statement: MessageSquare,
  end: Flag,
};

type SaveState = "idle" | "saving" | "saved";

export default function FormEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const isMobile = useIsMobile(900);
  const [mobilePane, setMobilePane] = useState<"steps" | "editor" | "preview">(
    "editor"
  );

  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [published, setPublished] = useState<FormSchema | null>(null);
  const [status, setStatus] = useState<FormStatus>("draft");
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [addOpen, setAddOpen] = useState(false);

  const loadedRef = useRef(false);

  // ── Wczytanie ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("forms")
        .select("schema, published, status")
        .eq("id", id)
        .single();
      if (data) {
        const s = data.schema as FormSchema;
        setSchema(s);
        setPublished((data.published as FormSchema) ?? null);
        setStatus((data.status as FormStatus) ?? "draft");
        setActiveId(s.steps[0]?.id ?? "");
      }
      setLoading(false);
      // pozwól autozapisowi działać dopiero po pierwszym renderze danych
      setTimeout(() => (loadedRef.current = true), 0);
    })();
  }, [id, supabase]);

  // ── Autozapis (debounce 800ms) ─────────────────────────────
  useEffect(() => {
    if (!loadedRef.current || !schema) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      await supabase
        .from("forms")
        .update({ schema, title: schema.title })
        .eq("id", id);
      setSaveState("saved");
    }, 800);
    return () => clearTimeout(t);
  }, [schema, id, supabase]);

  const statusLabel = useMemo(() => {
    if (!published) return "Szkic";
    return JSON.stringify(schema) === JSON.stringify(published)
      ? "Opublikowany"
      : "Niezapisane zmiany";
  }, [schema, published]);

  // ── Mutatory schematu ──────────────────────────────────────
  const patchSchema = useCallback((patch: Partial<FormSchema>) => {
    setSchema((s) => (s ? { ...s, ...patch } : s));
  }, []);

  const patchStep = useCallback((stepId: string, patch: Partial<Step>) => {
    setSchema((s) =>
      s
        ? { ...s, steps: s.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) }
        : s
    );
  }, []);

  function addStep(type: StepType) {
    setAddOpen(false);
    const step = blankStep(type);
    step.id = newStepId();
    setSchema((s) => {
      if (!s) return s;
      // wstaw przed krokiem końcowym, jeśli istnieje
      const endIdx = s.steps.findIndex((st) => st.type === "end");
      const steps = [...s.steps];
      if (endIdx === -1) steps.push(step);
      else steps.splice(endIdx, 0, step);
      return { ...s, steps };
    });
    setActiveId(step.id);
  }

  function moveStep(stepId: string, dir: -1 | 1) {
    setSchema((s) => {
      if (!s) return s;
      const i = s.steps.findIndex((st) => st.id === stepId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.steps.length) return s;
      const steps = [...s.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...s, steps };
    });
  }

  function deleteStep(stepId: string) {
    setSchema((s) => {
      if (!s || s.steps.length <= 1) return s;
      const steps = s.steps.filter((st) => st.id !== stepId);
      if (activeId === stepId) setActiveId(steps[0]?.id ?? "");
      return { ...s, steps };
    });
  }

  async function publish() {
    if (!schema) return;
    const wasPublished = status === "published";
    const { error } = await supabase
      .from("forms")
      .update({ published: schema, status: "published" })
      .eq("id", id);
    if (error) {
      toast.error("Nie udało się opublikować formularza.");
      return;
    }
    setPublished(JSON.parse(JSON.stringify(schema)));
    setStatus("published");
    toast.success(wasPublished ? "Formularz zaktualizowany." : "Formularz opublikowany.");
  }

  if (loading) return <p style={{ color: tokens.muted }}>Wczytywanie…</p>;
  if (!schema)
    return <p style={{ color: tokens.danger }}>Nie znaleziono formularza.</p>;

  const active = schema.steps.find((st) => st.id === activeId) ?? schema.steps[0];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: isMobile ? "auto" : "calc(100vh - 120px)",
        minHeight: isMobile ? "calc(100vh - 130px)" : undefined,
      }}
    >
      {/* ── Pasek górny ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <button onClick={() => router.push("/admin/forms")} style={iconBtn} aria-label="Wróć">
          <ArrowLeft size={18} color={tokens.muted} />
        </button>
        <input
          value={schema.title}
          onChange={(e) => patchSchema({ title: e.target.value })}
          style={{ ...inputStyle, flex: isMobile ? "1 1 160px" : "0 1 320px", maxWidth: 320, fontWeight: 600 }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            borderRadius: 999,
            background:
              statusLabel === "Opublikowany"
                ? "#E7F7EE"
                : statusLabel === "Niezapisane zmiany"
                ? "#FDF1E3"
                : tokens.bg,
            color:
              statusLabel === "Opublikowany"
                ? tokens.success
                : statusLabel === "Niezapisane zmiany"
                ? tokens.warning
                : tokens.muted,
          }}
        >
          {statusLabel}
        </span>
        <span style={{ fontSize: 12, color: tokens.muted }}>
          {saveState === "saving" ? "Zapisywanie…" : saveState === "saved" ? "Zapisano ✓" : ""}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={publish} style={primaryButton}>
          {status === "published" ? "Aktualizuj" : "Publikuj"}
        </button>
      </div>

      {/* ── Przełącznik paneli (tylko mobile) ───────────────── */}
      {isMobile && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {(
            [
              ["steps", "Kroki"],
              ["editor", "Edytor"],
              ["preview", "Podgląd"],
            ] as ["steps" | "editor" | "preview", string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobilePane(key)}
              style={{
                padding: "9px 8px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${mobilePane === key ? tokens.accent : tokens.border}`,
                background: mobilePane === key ? tokens.accentSoft : "#fff",
                color: mobilePane === key ? tokens.accent : tokens.muted,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Trzy panele ─────────────────────────────────────── */}
      <div
        style={
          isMobile
            ? { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }
            : { display: "grid", gridTemplateColumns: "230px 1fr 440px", gap: 14, flex: 1, minHeight: 0 }
        }
      >
        {/* Lewy: lista kroków */}
        <div
          style={{
            ...pane,
            position: "relative",
            overflowY: "auto",
            ...(isMobile
              ? { display: mobilePane === "steps" ? "block" : "none", flex: 1, minHeight: 0 }
              : {}),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={paneTitle}>Kroki</span>
            <button onClick={() => setAddOpen((o) => !o)} style={iconBtn} aria-label="Dodaj krok">
              <Plus size={16} color={tokens.accent} />
            </button>
          </div>

          {addOpen && (
            <div
              style={{
                position: "absolute",
                top: 44,
                right: 12,
                zIndex: 10,
                background: "#fff",
                border: `1px solid ${tokens.border}`,
                borderRadius: 12,
                boxShadow: "0 12px 30px rgba(15,18,28,0.12)",
                padding: 6,
                width: 190,
              }}
            >
              {STEP_TYPES.filter((t) => t.type !== "end").map((t) => {
                const Icon = TYPE_ICON[t.type];
                return (
                  <button
                    key={t.type}
                    onClick={() => addStep(t.type)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      width: "100%",
                      padding: "8px 10px",
                      border: "none",
                      background: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 13.5,
                      color: tokens.text,
                      textAlign: "left",
                    }}
                  >
                    <Icon size={15} color={tokens.muted} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            {schema.steps.map((st, i) => {
              const Icon = TYPE_ICON[st.type];
              const on = st.id === active.id;
              return (
                <div
                  key={st.id}
                  onClick={() => setActiveId(st.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                    border: `1px solid ${on ? tokens.accent : tokens.border}`,
                    background: on ? tokens.accentSoft : "#fff",
                  }}
                >
                  <Icon size={15} color={on ? tokens.accent : tokens.muted} style={{ flexShrink: 0 }} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: on ? tokens.accent : tokens.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {st.question || stepTypeLabel(st.type)}
                  </span>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button onClick={(e) => { e.stopPropagation(); moveStep(st.id, -1); }} disabled={i === 0} style={miniBtn} aria-label="W górę">
                      <ChevronUp size={13} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); moveStep(st.id, 1); }} disabled={i === schema.steps.length - 1} style={miniBtn} aria-label="W dół">
                      <ChevronDown size={13} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteStep(st.id); }} style={miniBtn} aria-label="Usuń">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Środek: edytor kroku + motyw */}
        <div
          style={{
            ...pane,
            overflowY: "auto",
            ...(isMobile
              ? { display: mobilePane === "editor" ? "block" : "none", flex: 1, minHeight: 0 }
              : {}),
          }}
        >
          <StepEditor
            step={active}
            steps={schema.steps}
            onPatch={(patch) => patchStep(active.id, patch)}
          />
          <hr style={{ border: "none", borderTop: `1px solid ${tokens.border}`, margin: "22px 0" }} />
          <ThemePanel schema={schema} onPatch={patchSchema} />
        </div>

        {/* Prawy: podgląd */}
        <div
          style={{
            ...pane,
            padding: 0,
            overflow: "hidden",
            display: isMobile && mobilePane !== "preview" ? "none" : "flex",
            flexDirection: "column",
            ...(isMobile ? { flex: 1, minHeight: "60vh" } : {}),
          }}
        >
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${tokens.border}`, fontSize: 12, fontWeight: 700, color: tokens.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Podgląd na żywo
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <FormRenderer form={schema} gotoStepId={active.id} preview />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Edytor pojedynczego kroku ──────────────────────────────── */
function StepEditor({
  step,
  steps,
  onPatch,
}: {
  step: Step;
  steps: Step[];
  onPatch: (patch: Partial<Step>) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <span style={paneTitle}>{stepTypeLabel(step.type)}</span>

      <Field label="Pytanie / nagłówek">
        <input value={step.question} onChange={(e) => onPatch({ question: e.target.value })} style={inputStyle} />
      </Field>

      {step.type !== "end" && (
        <Field label="Opis (opcjonalnie)">
          <textarea
            value={step.description ?? ""}
            onChange={(e) => onPatch({ description: e.target.value })}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>
      )}
      {step.type === "end" && (
        <Field label="Opis">
          <textarea
            value={step.description ?? ""}
            onChange={(e) => onPatch({ description: e.target.value })}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>
      )}

      {step.type !== "end" && (
        <Field label="URL obrazka (opcjonalnie)">
          <input
            value={step.image ?? ""}
            onChange={(e) => onPatch({ image: e.target.value })}
            placeholder="https://…"
            style={inputStyle}
          />
        </Field>
      )}

      {isTextInput(step.type) && (
        <>
          <Field label="Placeholder">
            <input value={step.placeholder ?? ""} onChange={(e) => onPatch({ placeholder: e.target.value })} style={inputStyle} />
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={!!step.required}
              onChange={(e) => onPatch({ required: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: tokens.accent }}
            />
            Pole wymagane
          </label>
          <ValidationEditor step={step} onPatch={onPatch} />
        </>
      )}

      {step.type === "welcome" && (
        <Field label="Etykieta przycisku (CTA)">
          <input value={step.cta ?? ""} onChange={(e) => onPatch({ cta: e.target.value })} style={inputStyle} />
        </Field>
      )}

      {isChoice(step.type) && (
        <OptionsEditor step={step} steps={steps} onPatch={onPatch} />
      )}

      {step.type !== "end" && (
        <Field label={isChoice(step.type) ? "Domyślny następny krok" : "Następny krok"}>
          <NextSelect
            value={step.next}
            steps={steps}
            selfId={step.id}
            onChange={(v) => onPatch({ next: v })}
          />
        </Field>
      )}
    </div>
  );
}

/* ── Edytor opcji (kroki wyboru) ────────────────────────────── */
function OptionsEditor({
  step,
  steps,
  onPatch,
}: {
  step: Step;
  steps: Step[];
  onPatch: (patch: Partial<Step>) => void;
}) {
  const options = step.options ?? [];

  function update(id: string, patch: Partial<{ label: string; next: string }>) {
    onPatch({ options: options.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  }
  function add() {
    onPatch({
      options: [...options, { id: newStepId(), label: `Opcja ${String.fromCharCode(65 + options.length)}`, next: NEXT }],
    });
  }
  function remove(id: string) {
    onPatch({ options: options.filter((o) => o.id !== id) });
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Opcje</span>
      {options.map((o) => (
        <div key={o.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={o.label}
            onChange={(e) => update(o.id, { label: e.target.value })}
            style={{ ...inputStyle, flex: "1 1 100px" }}
          />
          <div style={{ flex: "1 1 130px" }}>
            <NextSelect value={o.next} steps={steps} selfId={step.id} onChange={(v) => update(o.id, { next: v })} />
          </div>
          <button onClick={() => remove(o.id)} style={miniBtn} aria-label="Usuń opcję">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button onClick={add} style={{ ...ghostButton, justifySelf: "start", display: "flex", alignItems: "center", gap: 6, padding: "7px 12px" }}>
        <Plus size={14} /> Dodaj opcję
      </button>
    </div>
  );
}

/* ── Edytor walidacji (pola tekstowe) ───────────────────────── */
function ValidationEditor({
  step,
  onPatch,
}: {
  step: Step;
  onPatch: (patch: Partial<Step>) => void;
}) {
  const v = step.validation;
  const preset = detectPreset(v);

  // Scal częściową zmianę walidacji; usuń obiekt, gdy nie ma już reguł.
  function setV(patch: Partial<FieldValidation>) {
    const next: FieldValidation = { ...(v ?? {}), ...patch };
    // Usuń klucze z wartością undefined.
    (Object.keys(next) as (keyof FieldValidation)[]).forEach((k) => {
      if (next[k] === undefined) delete next[k];
    });
    onPatch({ validation: hasValidationRules(next) || next.customMessage ? next : undefined });
  }

  function choosePreset(key: string) {
    if (key === "none") {
      setV({ pattern: undefined, customMessage: undefined });
      return;
    }
    if (key === "custom") {
      // Zachowaj istniejący wzorzec lub zacznij od pustego.
      setV({ pattern: v?.pattern ?? "" });
      return;
    }
    const p = VALIDATION_PRESETS.find((x) => x.key === key);
    if (p) setV({ pattern: p.pattern, customMessage: p.message });
  }

  // Pole liczbowe (min/max) sensowne tylko dla krótkiego tekstu; długość dla
  // wszystkich pól tekstowych.
  const numInput = (
    val: number | undefined,
    onChange: (n: number | undefined) => void,
    placeholder: string
  ) => (
    <input
      type="number"
      value={val ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      style={inputStyle}
    />
  );

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        padding: 12,
        borderRadius: 12,
        border: `1px solid ${tokens.border}`,
        background: tokens.bg,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700 }}>Walidacja</span>

      <Field label="Reguła">
        <select value={preset} onChange={(e) => choosePreset(e.target.value)} style={inputStyle}>
          {VALIDATION_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      {preset === "custom" && (
        <>
          <Field label="Wyrażenie regularne">
            <input
              value={v?.pattern ?? ""}
              onChange={(e) => setV({ pattern: e.target.value })}
              placeholder="np. ^\\d{2}-\\d{3}$"
              style={{ ...inputStyle, fontFamily: "monospace" }}
            />
          </Field>
          <Field label="Komunikat błędu">
            <input
              value={v?.customMessage ?? ""}
              onChange={(e) => setV({ customMessage: e.target.value || undefined })}
              placeholder="Nieprawidłowy format."
              style={inputStyle}
            />
          </Field>
        </>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Min. długość">
            {numInput(v?.minLength, (n) => setV({ minLength: n }), "—")}
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Maks. długość">
            {numInput(v?.maxLength, (n) => setV({ maxLength: n }), "—")}
          </Field>
        </div>
      </div>
    </div>
  );
}

/* ── Selektor routingu ──────────────────────────────────────── */
function NextSelect({
  value,
  steps,
  selfId,
  onChange,
}: {
  value: string;
  steps: Step[];
  selfId: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value={NEXT}>→ Następny krok</option>
      {steps
        .filter((s) => s.id !== selfId)
        .map((s) => (
          <option key={s.id} value={s.id}>
            Idź do: {(s.question || stepTypeLabel(s.type)).slice(0, 28)}
          </option>
        ))}
      <option value={SUBMIT}>✓ Wyślij formularz</option>
    </select>
  );
}

/* ── Panel motywu ───────────────────────────────────────────── */
function ThemePanel({
  schema,
  onPatch,
}: {
  schema: FormSchema;
  onPatch: (patch: Partial<FormSchema>) => void;
}) {
  const t = schema.theme;
  const setTheme = (patch: Partial<FormSchema["theme"]>) => onPatch({ theme: { ...t, ...patch } });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <span style={paneTitle}>Motyw</span>

      <Field label="Czcionka">
        <select value={t.font} onChange={(e) => setTheme({ font: e.target.value })} style={inputStyle}>
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <ColorField label="Akcent" value={t.primary} onChange={(v) => setTheme({ primary: v })} />
        <ColorField label="Tło" value={t.bg} onChange={(v) => setTheme({ bg: v })} />
        <ColorField label="Tekst" value={t.text} onChange={(v) => setTheme({ text: v })} />
      </div>

      <Field label="Układ">
        <select value={t.layout} onChange={(e) => setTheme({ layout: e.target.value as FormSchema["theme"]["layout"] })} style={inputStyle}>
          <option value="center">Wyśrodkowany</option>
          <option value="left">Do lewej</option>
          <option value="split">Podział (obraz po lewej)</option>
        </select>
      </Field>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "grid", gap: 5, flex: 1 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${tokens.border}`, borderRadius: 10, padding: 4 }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 30, height: 30, border: "none", background: "none", cursor: "pointer", padding: 0 }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ border: "none", outline: "none", fontSize: 12, width: "100%", color: tokens.text }}
        />
      </div>
    </label>
  );
}

/* ── drobne UI ──────────────────────────────────────────────── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 5 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

const pane: React.CSSProperties = {
  background: tokens.card,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radius,
  padding: 16,
};

const paneTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: tokens.muted,
};

const iconBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 9,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const miniBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: "none",
  background: "transparent",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  color: tokens.muted,
};
