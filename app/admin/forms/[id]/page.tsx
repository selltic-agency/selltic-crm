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
  Phone,
  CircleDot,
  ListChecks,
  MessageSquare,
  Flag,
  Upload,
  Link2,
  ImageIcon,
  X,
  Bold,
  Italic,
  Mail,
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
  type FormSettings,
  type ThankYouEmail,
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
  defaultThankYouEmail,
  randomSlug,
} from "@/lib/forms";
import { COUNTRY_PREFIXES, DEFAULT_PHONE_PREFIX } from "@/lib/phone";
import FormRenderer from "@/components/FormRenderer";
import ShareModal from "../share-modal";
import { useToast } from "@/components/Toast";

// ── Upload obrazków (bucket Supabase Storage) ────────────────────────────
const IMAGE_BUCKET = "form-assets";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const TYPE_ICON: Record<StepType, typeof Type> = {
  welcome: Hand,
  short_text: Type,
  long_text: AlignLeft,
  email: AtSign,
  phone: Phone,
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
  const [slug, setSlug] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [addOpen, setAddOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const loadedRef = useRef(false);

  // ── Wczytanie ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("forms")
        .select("schema, published, status, slug")
        .eq("id", id)
        .single();
      if (data) {
        const s = data.schema as FormSchema;
        setSchema(s);
        setPublished((data.published as FormSchema) ?? null);
        setStatus((data.status as FormStatus) ?? "draft");
        setSlug((data.slug as string | null) ?? null);
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

  // Ręczny zapis wersji roboczej (przycisk „Zapisz zmiany”). Autozapis i tak
  // działa w tle — ten przycisk daje pewność i natychmiastowy feedback.
  async function saveChanges() {
    if (!schema) return;
    setSaveState("saving");
    const { error } = await supabase
      .from("forms")
      .update({ schema, title: schema.title })
      .eq("id", id);
    if (error) {
      toast.error("Nie udało się zapisać zmian.");
      setSaveState("idle");
      return;
    }
    setSaveState("saved");
    toast.success("Zapisano zmiany.");
  }

  async function publish() {
    if (!schema || publishing) return;
    setPublishing(true);
    const wasPublished = status === "published";

    // Wygeneruj slug, jeśli formularz jeszcze go nie ma (nowa publikacja).
    let effectiveSlug = slug;
    if (!effectiveSlug) {
      effectiveSlug = randomSlug();
    }

    const { error } = await supabase
      .from("forms")
      .update({
        schema, // upewnij się, że robocza wersja też jest zapisana
        title: schema.title,
        published: schema,
        status: "published",
        slug: effectiveSlug,
      })
      .eq("id", id);
    if (error) {
      setPublishing(false);
      toast.error("Nie udało się opublikować formularza.");
      return;
    }
    // Znacznik czasu publikacji — best-effort (nie blokuje publikacji, gdyby
    // migracja published_at nie była jeszcze zastosowana).
    await supabase
      .from("forms")
      .update({ published_at: new Date().toISOString() })
      .eq("id", id)
      .then(undefined, () => {});
    setPublishing(false);
    setPublished(JSON.parse(JSON.stringify(schema)));
    setStatus("published");
    setSlug(effectiveSlug);
    setShareOpen(true);
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
        <button onClick={saveChanges} style={ghostButton}>
          Zapisz zmiany
        </button>
        {status === "published" && slug && (
          <button onClick={() => setShareOpen(true)} style={ghostButton}>
            Udostępnij
          </button>
        )}
        <button onClick={publish} disabled={publishing} style={primaryButton}>
          {publishing ? "Publikowanie…" : status === "published" ? "Opublikuj zmiany" : "Publikuj"}
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
            overflowX: "hidden",
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

          {/* Lista kroków — responsywna: tekst zawija się (bez ucinania), a
              przyciski (przenieś w górę/dół, usuń) są ZAWSZE widoczne i klikalne
              niezależnie od długości treści i szerokości ekranu. */}
          <div style={{ display: "grid", gap: 6 }}>
            {schema.steps.map((st, i) => {
              const Icon = TYPE_ICON[st.type];
              const on = st.id === active.id;
              const isLast = i === schema.steps.length - 1;
              return (
                <div
                  key={st.id}
                  onClick={() => setActiveId(st.id)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "9px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                    border: `1px solid ${on ? tokens.accent : tokens.border}`,
                    background: on ? tokens.accentSoft : "#fff",
                  }}
                >
                  <Icon
                    size={15}
                    color={on ? tokens.accent : tokens.muted}
                    style={{ flexShrink: 0, marginTop: 3 }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: on ? tokens.accent : tokens.text,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                      lineHeight: 1.35,
                    }}
                  >
                    {st.question || stepTypeLabel(st.type)}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      gap: 2,
                      flexShrink: 0,
                      alignItems: "center",
                    }}
                  >
                    <button onClick={(e) => { e.stopPropagation(); moveStep(st.id, -1); }} disabled={i === 0} style={miniBtn} aria-label="W górę">
                      <ChevronUp size={13} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); moveStep(st.id, 1); }} disabled={isLast} style={miniBtn} aria-label="W dół">
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
            formId={id}
          />
          <hr style={{ border: "none", borderTop: `1px solid ${tokens.border}`, margin: "22px 0" }} />
          <ThemePanel schema={schema} onPatch={patchSchema} />
          <hr style={{ border: "none", borderTop: `1px solid ${tokens.border}`, margin: "22px 0" }} />
          <SettingsPanel schema={schema} onPatch={patchSchema} />
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

      {shareOpen && slug && (
        <ShareModal slug={slug} title={schema.title} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}

/* ── Edytor pojedynczego kroku ──────────────────────────────── */
function StepEditor({
  step,
  steps,
  onPatch,
  formId,
}: {
  step: Step;
  steps: Step[];
  onPatch: (patch: Partial<Step>) => void;
  formId: string;
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
        <ImageField
          value={step.image ?? ""}
          onChange={(url) => onPatch({ image: url })}
          formId={formId}
        />
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

      {step.type === "phone" && (
        <>
          <Field label="Placeholder">
            <input value={step.placeholder ?? ""} onChange={(e) => onPatch({ placeholder: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Domyślny prefiks kraju">
            <select
              value={step.phonePrefix ?? DEFAULT_PHONE_PREFIX}
              onChange={(e) => onPatch({ phonePrefix: e.target.value })}
              style={inputStyle}
            >
              {COUNTRY_PREFIXES.map((p) => (
                <option key={p.iso} value={p.code}>
                  {p.flag} {p.name} ({p.code})
                </option>
              ))}
            </select>
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
          <p style={{ fontSize: 12.5, color: tokens.muted, margin: 0 }}>
            Numer telefonu jest walidowany automatycznie (8–15 cyfr z prefiksem).
          </p>
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

/* ── Pole obrazka: URL LUB upload do Supabase Storage + podgląd ─────────── */
function ImageField({
  value,
  onChange,
  formId,
}: {
  value: string;
  onChange: (url: string) => void;
  formId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [broken, setBroken] = useState(false);

  async function handleFile(file: File) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Dozwolone formaty: JPEG, PNG, WEBP lub GIF.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Plik jest za duży — maksymalny rozmiar to 5 MB.");
      return;
    }
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${formId}/${newStepId()}.${ext}`;
    const { error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
    setUploading(false);
    if (error) {
      toast.error("Nie udało się wgrać pliku. " + (error.message || ""));
      return;
    }
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    setBroken(false);
    onChange(data.publicUrl);
    toast.success("Obraz wgrany.");
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Obraz (opcjonalnie)</span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            minWidth: 0,
            border: `1px solid ${tokens.border}`,
            borderRadius: 10,
            padding: "0 10px",
            background: "#fff",
          }}
        >
          <Link2 size={14} color={tokens.muted} style={{ flexShrink: 0 }} />
          <input
            value={value}
            onChange={(e) => {
              setBroken(false);
              onChange(e.target.value);
            }}
            placeholder="Wklej URL lub wgraj plik…"
            style={{
              border: "none",
              outline: "none",
              fontSize: 14,
              width: "100%",
              padding: "10px 0",
              color: tokens.text,
              background: "transparent",
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          style={{ ...ghostButton, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0 }}
        >
          <Upload size={14} /> {uploading ? "Wgrywanie…" : "Wgraj"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {value && !broken ? (
        <div style={{ position: "relative", width: "fit-content" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Podgląd obrazka"
            onError={() => setBroken(true)}
            style={{
              maxWidth: 180,
              maxHeight: 120,
              borderRadius: 10,
              border: `1px solid ${tokens.border}`,
              objectFit: "cover",
              display: "block",
            }}
          />
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Usuń obraz"
            style={{
              position: "absolute",
              top: -8,
              right: -8,
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: `1px solid ${tokens.border}`,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(15,18,28,0.12)",
            }}
          >
            <X size={12} color={tokens.muted} />
          </button>
        </div>
      ) : value && broken ? (
        <p style={{ fontSize: 12, color: tokens.danger, margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <ImageIcon size={13} /> Nie można wczytać obrazka z tego adresu.
        </p>
      ) : (
        <p style={{ fontSize: 12, color: tokens.muted, margin: 0 }}>
          JPEG, PNG, WEBP lub GIF, maks. 5 MB. Możesz też wkleić gotowy adres URL.
        </p>
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
  // Zmiana kolejności opcji (przenieś w górę/dół). Utrwalane natychmiast w
  // schemacie kroku, więc podgląd i wysłany formularz zachowują kolejność.
  function move(id: string, dir: -1 | 1) {
    const i = options.findIndex((o) => o.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= options.length) return;
    const next = [...options];
    [next[i], next[j]] = [next[j], next[i]];
    onPatch({ options: next });
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Opcje</span>
      {options.map((o, i) => (
        <div key={o.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <button onClick={() => move(o.id, -1)} disabled={i === 0} style={{ ...miniBtn, height: 18 }} aria-label="Opcja w górę">
              <ChevronUp size={12} />
            </button>
            <button onClick={() => move(o.id, 1)} disabled={i === options.length - 1} style={{ ...miniBtn, height: 18 }} aria-label="Opcja w dół">
              <ChevronDown size={12} />
            </button>
          </div>
          <input
            value={o.label}
            onChange={(e) => update(o.id, { label: e.target.value })}
            style={{ ...inputStyle, flex: "1 1 100px", minWidth: 0 }}
          />
          <div style={{ flex: "1 1 130px", minWidth: 0 }}>
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

/* ── Panel ustawień: przekierowanie + mail „dziękujemy” ─────────────────── */
function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function SettingsPanel({
  schema,
  onPatch,
}: {
  schema: FormSchema;
  onPatch: (patch: Partial<FormSchema>) => void;
}) {
  const settings: FormSettings = schema.settings ?? {};
  const setSettings = (patch: Partial<FormSettings>) =>
    onPatch({ settings: { ...settings, ...patch } });

  const email: ThankYouEmail = settings.thankYouEmail ?? defaultThankYouEmail();
  const setEmail = (patch: Partial<ThankYouEmail>) =>
    setSettings({ thankYouEmail: { ...email, ...patch } });

  const redirect = settings.redirectUrl ?? "";
  const redirectInvalid = redirect.trim() !== "" && !isValidUrl(redirect);
  const extraLink = settings.extraLink ?? "";
  const extraInvalid = extraLink.trim() !== "" && !isValidUrl(extraLink);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function applyWrap(before: string, after: string) {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const val = email.html;
    const selected = val.slice(start, end);
    const next = val.slice(0, start) + before + selected + after + val.slice(end);
    setEmail({ html: next });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + before.length + selected.length + after.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function insertLink() {
    const url = window.prompt("Adres linku (https://…)", "https://");
    if (!url) return;
    applyWrap(`<a href="${url}">`, "</a>");
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <span style={paneTitle}>Ustawienia</span>

      {/* Przekierowanie po wysłaniu (item 7) */}
      <Field label="Przekierowanie po wysłaniu (URL, opcjonalnie)">
        <input
          value={redirect}
          onChange={(e) => setSettings({ redirectUrl: e.target.value })}
          placeholder="https://twoja-strona.pl/dziekujemy (np. VSL)"
          style={{ ...inputStyle, ...(redirectInvalid ? { borderColor: tokens.danger } : {}) }}
        />
      </Field>
      <p style={{ fontSize: 12, color: redirectInvalid ? tokens.danger : tokens.muted, margin: "-6px 0 0" }}>
        {redirectInvalid
          ? "Podaj poprawny adres URL (http:// lub https://)."
          : "Po wysłaniu formularza klient zostanie przeniesiony pod ten adres. Puste = domyślny ekran „dziękujemy”."}
      </p>

      {/* Dodatkowy link do wstawienia w mailu (item 8) */}
      <Field label="Dodatkowy link (np. konsultacja / VSL)">
        <input
          value={extraLink}
          onChange={(e) => setSettings({ extraLink: e.target.value })}
          placeholder="https://cal.com/selltic/konsultacja"
          style={{ ...inputStyle, ...(extraInvalid ? { borderColor: tokens.danger } : {}) }}
        />
      </Field>
      <p style={{ fontSize: 12, color: extraInvalid ? tokens.danger : tokens.muted, margin: "-6px 0 0" }}>
        {extraInvalid
          ? "Podaj poprawny adres URL (http:// lub https://)."
          : "Wstawiany w mailu przez placeholder {{extra_link}}."}
      </p>

      {/* Automatyczny mail „dziękujemy” (item 8) */}
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
        <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, fontWeight: 700 }}>
          <Mail size={15} color={tokens.accent} />
          <input
            type="checkbox"
            checked={email.enabled}
            onChange={(e) => setEmail({ enabled: e.target.checked })}
            style={{ width: 16, height: 16, accentColor: tokens.accent }}
          />
          Wyślij automatyczny mail „dziękujemy”
        </label>

        {email.enabled && (
          <>
            <Field label="Temat">
              <input
                value={email.subject}
                onChange={(e) => setEmail({ subject: e.target.value })}
                style={inputStyle}
              />
            </Field>

            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Treść (HTML)</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" onClick={() => applyWrap("<b>", "</b>")} style={fmtBtn} aria-label="Pogrubienie" title="Pogrubienie">
                  <Bold size={13} />
                </button>
                <button type="button" onClick={() => applyWrap("<i>", "</i>")} style={fmtBtn} aria-label="Kursywa" title="Kursywa">
                  <Italic size={13} />
                </button>
                <button type="button" onClick={insertLink} style={{ ...fmtBtn, width: "auto", padding: "0 10px", gap: 6, display: "inline-flex", alignItems: "center" }} title="Wstaw link">
                  <Link2 size={13} /> Link
                </button>
                <button
                  type="button"
                  onClick={() => setEmail(defaultThankYouEmail())}
                  style={{ ...ghostButton, padding: "6px 10px", fontSize: 12.5, marginLeft: "auto" }}
                >
                  Domyślny szablon
                </button>
              </div>
              <textarea
                ref={bodyRef}
                value={email.html}
                onChange={(e) => setEmail({ html: e.target.value })}
                rows={8}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, lineHeight: 1.5 }}
              />
              <p style={{ fontSize: 12, color: tokens.muted, margin: 0 }}>
                Placeholdery: <code>{"{{name}}"}</code> (imię/nazwa), <code>{"{{extra_link}}"}</code> (dodatkowy link powyżej).
                Wysyłany, gdy formularz zbiera adres e-mail.
              </p>
            </div>
          </>
        )}
      </div>
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

const fmtBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  color: tokens.text,
};
