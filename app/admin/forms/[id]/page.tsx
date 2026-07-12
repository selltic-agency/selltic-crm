// app/admin/forms/[id]/page.tsx — edytor formularza (trzy panele).
// Lewy: lista kroków (drag & drop) · Środek: edytor kroku / ustawienia / wygląd
// · Prawy: podgląd na żywo (desktop/mobile, zwijany).
// Autozapis schematu (debounce 800ms); Publikuj/Aktualizuj kopiuje schema → published.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Reorder, useDragControls } from "framer-motion";
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
  GripVertical,
  MoreVertical,
  Copy,
  Monitor,
  Smartphone,
  PanelRightClose,
  PanelRightOpen,
  AlertTriangle,
  SlidersHorizontal,
  Palette,
  Layers,
  Undo2,
  Redo2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import { useIsMobile } from "@/lib/responsive";
import {
  type FormSchema,
  type Step,
  type StepType,
  type FieldType,
  type FormField,
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
  blankField,
  newStepId,
  isChoice,
  isTextInput,
  isInputStep,
  isContainerStep,
  stepFields,
  stepIssues,
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

const TYPE_ICON: Record<string, typeof Type> = {
  welcome: Hand,
  question: Layers,
  short_text: Type,
  long_text: AlignLeft,
  email: AtSign,
  phone: Phone,
  single_choice: CircleDot,
  multi_choice: ListChecks,
  statement: MessageSquare,
  end: Flag,
};

// Ikona kroku: dla kontenera pól bierzemy typ pierwszego pola.
function stepIcon(step: Step): typeof Type {
  if (step.type === "question") {
    const f = stepFields(step)[0];
    return (f && TYPE_ICON[f.type]) || Layers;
  }
  return TYPE_ICON[step.type] || Type;
}

// Nazwa wyświetlana kroku na liście (nagłówek lub etykieta pierwszego pola).
function stepDisplayName(step: Step): string {
  if (step.question.trim()) return step.question;
  const f = stepFields(step)[0];
  if (f?.question.trim()) return f.question;
  return stepTypeLabel(step.type);
}

// Typy pól do menu „Dodaj pole”.
const FIELD_TYPE_MENU: { type: FieldType; label: string }[] = [
  { type: "short_text", label: "Krótki tekst" },
  { type: "long_text", label: "Długi tekst" },
  { type: "email", label: "E-mail" },
  { type: "phone", label: "Telefon" },
  { type: "single_choice", label: "Wybór jednokrotny" },
  { type: "multi_choice", label: "Wybór wielokrotny" },
];

type SaveState = "idle" | "saving" | "saved";
type EditorTab = "step" | "settings" | "appearance";

export default function FormEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const isMobile = useIsMobile(900);
  const [mobilePane, setMobilePane] = useState<"steps" | "editor" | "preview">("editor");

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
  const [editorTab, setEditorTab] = useState<EditorTab>("step");
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");

  // Undo/redo (item 7): stosy migawek JSON schematu. Migawka jest robiona po
  // krótkim debounce, więc jedna edycja = jeden krok cofnięcia (nie per znak).
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const lastSnapshot = useRef<string>("");
  const skipSnapshot = useRef(false);

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
        lastSnapshot.current = JSON.stringify(s);
      }
      setLoading(false);
      setTimeout(() => (loadedRef.current = true), 0);
    })();
  }, [id, supabase]);

  // ── Historia (undo/redo) — migawka po debounce 400ms ───────
  useEffect(() => {
    if (!loadedRef.current || !schema) return;
    const t = setTimeout(() => {
      const snap = JSON.stringify(schema);
      if (skipSnapshot.current) {
        skipSnapshot.current = false;
        lastSnapshot.current = snap;
        return;
      }
      if (snap !== lastSnapshot.current) {
        const prev = lastSnapshot.current;
        lastSnapshot.current = snap;
        if (prev) {
          setUndoStack((u) => [...u.slice(-49), prev]);
          setRedoStack([]);
        }
      }
    }, 400);
    return () => clearTimeout(t);
  }, [schema]);

  const applyHistory = useCallback((snapshot: string) => {
    skipSnapshot.current = true;
    lastSnapshot.current = snapshot;
    const parsed = JSON.parse(snapshot) as FormSchema;
    setSchema(parsed);
    setActiveId((cur) => (parsed.steps.some((s) => s.id === cur) ? cur : parsed.steps[0]?.id ?? ""));
  }, []);

  const undo = useCallback(() => {
    setUndoStack((u) => {
      if (!u.length) return u;
      const prev = u[u.length - 1];
      setRedoStack((r) => [...r, lastSnapshot.current]);
      applyHistory(prev);
      return u.slice(0, -1);
    });
  }, [applyHistory]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r;
      const next = r[r.length - 1];
      setUndoStack((u) => [...u, lastSnapshot.current]);
      applyHistory(next);
      return r.slice(0, -1);
    });
  }, [applyHistory]);

  // Skróty klawiszowe — tylko poza polami tekstowymi, by nie przechwytywać
  // natywnego cofania w inputach.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ── Autozapis (debounce 800ms) ─────────────────────────────
  useEffect(() => {
    if (!loadedRef.current || !schema) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      await supabase.from("forms").update({ schema, title: schema.title }).eq("id", id);
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
      const endIdx = s.steps.findIndex((st) => st.type === "end");
      const steps = [...s.steps];
      if (endIdx === -1) steps.push(step);
      else steps.splice(endIdx, 0, step);
      return { ...s, steps };
    });
    setActiveId(step.id);
    setEditorTab("step");
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

  // Duplikuj krok (item 4). Kopiuje wszystkie pola/treść; NADAJE nowe id
  // krokowi, polom i opcjom. Cele rozgałęzień wskazujące KONKRETNY krok są
  // resetowane do „następny krok” (NEXT) — duplikat nie odsyła po cichu do
  // niewłaściwego kroku. Cele NEXT/SUBMIT pozostają bez zmian.
  function duplicateStep(stepId: string) {
    const orig = schema?.steps.find((st) => st.id === stepId);
    if (!orig) return;
    const resetTarget = (t?: string) => (t === NEXT || t === SUBMIT ? t : NEXT);
    const copy: Step = JSON.parse(JSON.stringify(orig));
    copy.id = newStepId();
    copy.next = resetTarget(copy.next) ?? NEXT;
    if (copy.options) {
      copy.options = copy.options.map((o) => ({ ...o, id: newStepId(), next: resetTarget(o.next) ?? NEXT }));
    }
    if (copy.fields) {
      copy.fields = copy.fields.map((f) => ({
        ...f,
        id: newStepId(),
        options: f.options?.map((o) => ({ ...o, id: newStepId(), next: resetTarget(o.next) ?? NEXT })),
      }));
    }
    setSchema((s) => {
      if (!s) return s;
      const idx = s.steps.findIndex((st) => st.id === stepId);
      const steps = [...s.steps];
      steps.splice(idx + 1, 0, copy);
      return { ...s, steps };
    });
    setActiveId(copy.id);
    setEditorTab("step");
    toast.success("Krok zduplikowany.");
  }

  // Usuwanie kroku z ochroną ostatniego ekranu końcowego (item 5).
  function deleteStep(stepId: string) {
    setSchema((s) => {
      if (!s || s.steps.length <= 1) return s;
      const target = s.steps.find((st) => st.id === stepId);
      if (target?.type === "end") {
        const endCount = s.steps.filter((st) => st.type === "end").length;
        if (endCount <= 1) {
          toast.error("Nie możesz usunąć jedynego ekranu końcowego („Zakończenie”).");
          return s;
        }
      }
      const steps = s.steps.filter((st) => st.id !== stepId);
      if (activeId === stepId) setActiveId(steps[0]?.id ?? "");
      return { ...s, steps };
    });
  }

  async function saveChanges() {
    if (!schema) return;
    setSaveState("saving");
    const { error } = await supabase.from("forms").update({ schema, title: schema.title }).eq("id", id);
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

    let effectiveSlug = slug;
    if (!effectiveSlug) effectiveSlug = randomSlug();

    const { error } = await supabase
      .from("forms")
      .update({
        schema,
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
  if (!schema) return <p style={{ color: tokens.danger }}>Nie znaleziono formularza.</p>;

  const active = schema.steps.find((st) => st.id === activeId) ?? schema.steps[0];

  // Kroki z problemami walidacji (item 7) — do globalnego ostrzeżenia.
  const stepsWithIssues = schema.steps.filter((st) => stepIssues(st).length > 0);

  const desktopColumns = previewCollapsed
    ? "minmax(190px, 1.7fr) minmax(0, 8fr) 46px"
    : "minmax(190px, 1.7fr) minmax(0, 5fr) minmax(300px, 2.9fr)";

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
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
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
              statusLabel === "Opublikowany" ? "#E7F7EE" : statusLabel === "Niezapisane zmiany" ? "#FDF1E3" : tokens.bg,
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
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          style={{ ...iconBtn, opacity: undoStack.length ? 1 : 0.4, cursor: undoStack.length ? "pointer" : "not-allowed" }}
          aria-label="Cofnij"
          title="Cofnij (Ctrl+Z)"
        >
          <Undo2 size={17} color={tokens.muted} />
        </button>
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          style={{ ...iconBtn, opacity: redoStack.length ? 1 : 0.4, cursor: redoStack.length ? "pointer" : "not-allowed" }}
          aria-label="Ponów"
          title="Ponów (Ctrl+Shift+Z)"
        >
          <Redo2 size={17} color={tokens.muted} />
        </button>
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

      {/* ── Ostrzeżenie walidacji (item 7) ──────────────────── */}
      {stepsWithIssues.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            marginBottom: 12,
            borderRadius: 10,
            background: "#FDF1E3",
            border: `1px solid ${tokens.warning}`,
            color: "#8a5a1a",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <AlertTriangle size={15} />
          {stepsWithIssues.length === 1
            ? "1 krok wymaga uzupełnienia przed publikacją."
            : `${stepsWithIssues.length} kroków wymaga uzupełnienia przed publikacją.`}
        </div>
      )}

      {/* ── Przełącznik paneli (tylko mobile) ───────────────── */}
      {isMobile && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
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
            : { display: "grid", gridTemplateColumns: desktopColumns, gap: 14, flex: 1, minHeight: 0 }
        }
      >
        {/* Lewy: lista kroków */}
        <div
          style={{
            ...pane,
            position: "relative",
            overflowY: "auto",
            overflowX: "hidden",
            ...(isMobile ? { display: mobilePane === "steps" ? "block" : "none", flex: 1, minHeight: 0 } : {}),
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
                width: 200,
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

          {/* Lista kroków — drag & drop (item 2). Uchwyt „⠿” po lewej inicjuje
              przeciąganie; kliknięcie treści zaznacza krok. Strzałki / duplikuj
              / usuń w menu (kebab). */}
          <Reorder.Group
            as="div"
            axis="y"
            values={schema.steps}
            onReorder={(next) => patchSchema({ steps: next as Step[] })}
            style={{ display: "grid", gap: 6, listStyle: "none", margin: 0, padding: 0 }}
          >
            {schema.steps.map((st, i) => (
              <StepRow
                key={st.id}
                step={st}
                index={i}
                total={schema.steps.length}
                active={st.id === active.id}
                issues={stepIssues(st)}
                onSelect={() => {
                  setActiveId(st.id);
                  setEditorTab("step");
                  if (isMobile) setMobilePane("editor");
                }}
                onMove={moveStep}
                onDuplicate={duplicateStep}
                onDelete={deleteStep}
              />
            ))}
          </Reorder.Group>
        </div>

        {/* Środek: edytor kroku / ustawienia / wygląd (zakładki — item 3) */}
        <div
          style={{
            ...pane,
            overflowY: "auto",
            ...(isMobile ? { display: mobilePane === "editor" ? "block" : "none", flex: 1, minHeight: 0 } : {}),
          }}
        >
          <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
            <TabButton active={editorTab === "step"} onClick={() => setEditorTab("step")} icon={Layers} label="Krok" />
            <TabButton
              active={editorTab === "settings"}
              onClick={() => setEditorTab("settings")}
              icon={SlidersHorizontal}
              label="Ustawienia formularza"
            />
            <TabButton active={editorTab === "appearance"} onClick={() => setEditorTab("appearance")} icon={Palette} label="Wygląd" />
          </div>

          {editorTab === "step" && <StepEditor step={active} steps={schema.steps} onPatch={(patch) => patchStep(active.id, patch)} formId={id} />}
          {editorTab === "settings" && <SettingsPanel schema={schema} onPatch={patchSchema} formId={id} />}
          {editorTab === "appearance" && <ThemePanel schema={schema} onPatch={patchSchema} />}
        </div>

        {/* Prawy: podgląd */}
        {(!isMobile || mobilePane === "preview") && (
          <div
            style={{
              ...pane,
              padding: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              ...(isMobile ? { flex: 1, minHeight: "60vh" } : {}),
            }}
          >
            {previewCollapsed && !isMobile ? (
              <button
                onClick={() => setPreviewCollapsed(false)}
                aria-label="Rozwiń podgląd"
                title="Rozwiń podgląd"
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  background: "#fff",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  color: tokens.muted,
                }}
              >
                <PanelRightOpen size={18} />
              </button>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderBottom: `1px solid ${tokens.border}`,
                  }}
                >
                  <span style={{ ...paneTitle, flex: 1 }}>Podgląd na żywo</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => setPreviewDevice("desktop")}
                      title="Podgląd desktop"
                      aria-label="Podgląd desktop"
                      style={deviceBtn(previewDevice === "desktop")}
                    >
                      <Monitor size={15} />
                    </button>
                    <button
                      onClick={() => setPreviewDevice("mobile")}
                      title="Podgląd mobile"
                      aria-label="Podgląd mobile"
                      style={deviceBtn(previewDevice === "mobile")}
                    >
                      <Smartphone size={15} />
                    </button>
                  </div>
                  {!isMobile && (
                    <button
                      onClick={() => setPreviewCollapsed(true)}
                      title="Zwiń podgląd"
                      aria-label="Zwiń podgląd"
                      style={deviceBtn(false)}
                    >
                      <PanelRightClose size={15} />
                    </button>
                  )}
                </div>
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "stretch",
                    background: previewDevice === "mobile" ? tokens.bg : undefined,
                    padding: previewDevice === "mobile" ? 16 : 0,
                    overflow: "auto",
                  }}
                >
                  {previewDevice === "mobile" ? (
                    <div
                      style={{
                        width: 390,
                        maxWidth: "100%",
                        alignSelf: "center",
                        height: "100%",
                        minHeight: 560,
                        border: `1px solid ${tokens.border}`,
                        borderRadius: 22,
                        overflow: "hidden",
                        boxShadow: "0 10px 34px rgba(15,18,28,0.14)",
                        background: "#fff",
                      }}
                    >
                      <FormRenderer form={schema} gotoStepId={active.id} preview forceMobile />
                    </div>
                  ) : (
                    <div style={{ width: "100%", height: "100%" }}>
                      <FormRenderer form={schema} gotoStepId={active.id} preview />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {shareOpen && slug && <ShareModal slug={slug} title={schema.title} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

/* ── Wiersz kroku (drag & drop + kebab) ─────────────────────── */
function StepRow({
  step,
  index,
  total,
  active,
  issues,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
}: {
  step: Step;
  index: number;
  total: number;
  active: boolean;
  issues: string[];
  onSelect: () => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const controls = useDragControls();
  const [menuOpen, setMenuOpen] = useState(false);
  const Icon = stepIcon(step);
  const isLast = index === total - 1;

  return (
    <Reorder.Item
      as="div"
      value={step}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ boxShadow: "0 10px 26px rgba(15,18,28,0.18)", zIndex: 5 }}
      style={{
        borderRadius: 10,
        border: `1px solid ${active ? tokens.accent : tokens.border}`,
        background: active ? tokens.accentSoft : "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "9px 8px 9px 6px" }}>
        <button
          onPointerDown={(e) => controls.start(e)}
          aria-label="Przeciągnij, aby zmienić kolejność"
          title="Przeciągnij, aby zmienić kolejność"
          style={{
            border: "none",
            background: "transparent",
            cursor: "grab",
            padding: "2px 2px",
            marginTop: 1,
            color: tokens.muted,
            touchAction: "none",
            flexShrink: 0,
          }}
        >
          <GripVertical size={15} />
        </button>
        <Icon size={15} color={active ? tokens.accent : tokens.muted} style={{ flexShrink: 0, marginTop: 3 }} />
        <span
          onClick={onSelect}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            color: active ? tokens.accent : tokens.text,
            whiteSpace: "normal",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            lineHeight: 1.35,
            cursor: "pointer",
            paddingTop: 2,
          }}
        >
          {stepDisplayName(step)}
        </span>
        {issues.length > 0 && (
          <span title={issues.join("\n")} style={{ flexShrink: 0, marginTop: 2, color: tokens.warning }}>
            <AlertTriangle size={14} />
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          style={miniBtn}
          aria-label="Więcej akcji"
        >
          <MoreVertical size={15} />
        </button>
      </div>

      {menuOpen && (
        <div style={{ display: "flex", gap: 4, padding: "0 8px 8px 30px", flexWrap: "wrap" }}>
          <KebabAction disabled={index === 0} onClick={() => { onMove(step.id, -1); }} icon={ChevronUp} label="W górę" />
          <KebabAction disabled={isLast} onClick={() => { onMove(step.id, 1); }} icon={ChevronDown} label="W dół" />
          <KebabAction onClick={() => { setMenuOpen(false); onDuplicate(step.id); }} icon={Copy} label="Duplikuj" />
          <KebabAction danger onClick={() => { setMenuOpen(false); onDelete(step.id); }} icon={Trash2} label="Usuń" />
        </div>
      )}
    </Reorder.Item>
  );
}

function KebabAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Type;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 9px",
        borderRadius: 8,
        border: `1px solid ${tokens.border}`,
        background: "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        fontSize: 12,
        fontWeight: 600,
        color: danger ? tokens.danger : tokens.muted,
      }}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Type;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 9,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        border: `1px solid ${active ? tokens.accent : tokens.border}`,
        background: active ? tokens.accentSoft : "#fff",
        color: active ? tokens.accent : tokens.muted,
      }}
    >
      <Icon size={14} />
      {label}
    </button>
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
  const input = isInputStep(step);
  const container = isContainerStep(step);
  // Nagłówek ekranu pokazujemy dla ekranów nie-wejściowych (powitanie/komunikat/
  // zakończenie) oraz dla kontenerów wielopolowych. Dla starego, jedno-polowego
  // kroku nagłówkiem jest etykieta jego jedynego pola (edytowana niżej) —
  // osobne pole nagłówka byłoby zdublowane.
  const showHeading = !input || container;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <span style={paneTitle}>
        {step.type === "welcome" ? "Powitanie" : step.type === "statement" ? "Komunikat" : step.type === "end" ? "Zakończenie" : "Krok z polami"}
      </span>

      {showHeading && (
        <Field label={input ? "Nagłówek ekranu (opcjonalnie)" : "Pytanie / nagłówek"}>
          <input value={step.question} onChange={(e) => onPatch({ question: e.target.value })} style={inputStyle} />
        </Field>
      )}

      <Field label="Opis (opcjonalnie)">
        <textarea
          value={step.description ?? ""}
          onChange={(e) => onPatch({ description: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      {step.type !== "end" && <ImageField value={step.image ?? ""} onChange={(url) => onPatch({ image: url })} formId={formId} />}

      {step.type === "welcome" && (
        <Field label="Etykieta przycisku (CTA)">
          <input value={step.cta ?? ""} onChange={(e) => onPatch({ cta: e.target.value })} style={inputStyle} />
        </Field>
      )}

      {input && <FieldsEditor step={step} steps={steps} onPatch={onPatch} />}

      {step.type !== "end" && (
        <Field label="Domyślny następny krok">
          <NextSelect value={step.next} steps={steps} selfId={step.id} onChange={(v) => onPatch({ next: v })} />
        </Field>
      )}
    </div>
  );
}

/* ── Edytor pól kroku (item 6: wiele pól na krok) ───────────── */
function FieldsEditor({
  step,
  steps,
  onPatch,
}: {
  step: Step;
  steps: Step[];
  onPatch: (patch: Partial<Step>) => void;
}) {
  const fields = stepFields(step);
  const alreadyContainer = isContainerStep(step);

  // Zapis listy pól. Pierwsza edycja starego, jedno-polowego kroku konwertuje
  // go w kontener (typ „question”) i czyści pola legacy przeniesione do fields[].
  function commitFields(nextFields: FormField[]) {
    onPatch({
      type: "question",
      fields: nextFields,
      ...(alreadyContainer ? {} : { question: "" }),
      placeholder: undefined,
      required: undefined,
      validation: undefined,
      phonePrefix: undefined,
      options: undefined,
      map: undefined,
    });
  }

  function patchField(fieldId: string, patch: Partial<FormField>) {
    commitFields(fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)));
  }
  function addField(type: FieldType) {
    commitFields([...fields, blankField(type)]);
  }
  function removeField(fieldId: string) {
    if (fields.length <= 1) return;
    commitFields(fields.filter((f) => f.id !== fieldId));
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>Pola ({fields.length})</span>

      <Reorder.Group
        as="div"
        axis="y"
        values={fields}
        onReorder={(next) => commitFields(next as FormField[])}
        style={{ display: "grid", gap: 12, listStyle: "none", margin: 0, padding: 0 }}
      >
        {fields.map((f) => (
          <FieldEditor
            key={f.id}
            field={f}
            steps={steps}
            selfStepId={step.id}
            canRemove={fields.length > 1}
            onPatch={(patch) => patchField(f.id, patch)}
            onRemove={() => removeField(f.id)}
          />
        ))}
      </Reorder.Group>

      <AddFieldButton onAdd={addField} />
    </div>
  );
}

function AddFieldButton({ onAdd }: { onAdd: (type: FieldType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ ...ghostButton, justifySelf: "start", display: "flex", alignItems: "center", gap: 6, padding: "8px 12px" }}
      >
        <Plus size={15} /> Dodaj pole
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 42,
            left: 0,
            zIndex: 10,
            background: "#fff",
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
            boxShadow: "0 12px 30px rgba(15,18,28,0.12)",
            padding: 6,
            width: 210,
          }}
        >
          {FIELD_TYPE_MENU.map((t) => {
            const Icon = TYPE_ICON[t.type];
            return (
              <button
                key={t.type}
                onClick={() => {
                  onAdd(t.type);
                  setOpen(false);
                }}
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
    </div>
  );
}

function FieldEditor({
  field,
  steps,
  selfStepId,
  canRemove,
  onPatch,
  onRemove,
}: {
  field: FormField;
  steps: Step[];
  selfStepId: string;
  canRemove: boolean;
  onPatch: (patch: Partial<FormField>) => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  const Icon = TYPE_ICON[field.type];

  return (
    <Reorder.Item
      as="div"
      value={field}
      dragListener={false}
      dragControls={controls}
      style={{
        display: "grid",
        gap: 12,
        padding: 12,
        borderRadius: 12,
        border: `1px solid ${tokens.border}`,
        background: tokens.bg,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onPointerDown={(e) => controls.start(e)}
          aria-label="Przeciągnij pole"
          title="Przeciągnij, aby zmienić kolejność pól"
          style={{ border: "none", background: "transparent", cursor: "grab", color: tokens.muted, touchAction: "none", padding: 0 }}
        >
          <GripVertical size={15} />
        </button>
        <Icon size={15} color={tokens.accent} />
        <select
          value={field.type}
          onChange={(e) => onPatch(changeFieldType(field, e.target.value as FieldType))}
          style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
        >
          {FIELD_TYPE_MENU.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Usuń pole"
          title={canRemove ? "Usuń pole" : "Krok musi mieć co najmniej jedno pole"}
          style={{ ...miniBtn, opacity: canRemove ? 1 : 0.4, cursor: canRemove ? "pointer" : "not-allowed" }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <Field label="Etykieta pola">
        <input value={field.question} onChange={(e) => onPatch({ question: e.target.value })} style={inputStyle} />
      </Field>

      {isTextInput(field.type) && (
        <>
          <Field label="Placeholder">
            <input value={field.placeholder ?? ""} onChange={(e) => onPatch({ placeholder: e.target.value })} style={inputStyle} />
          </Field>
          <RequiredToggle checked={!!field.required} onChange={(v) => onPatch({ required: v })} />
          <ValidationEditor field={field} onPatch={onPatch} />
        </>
      )}

      {field.type === "phone" && (
        <>
          <Field label="Placeholder">
            <input value={field.placeholder ?? ""} onChange={(e) => onPatch({ placeholder: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Domyślny prefiks kraju">
            <select value={field.phonePrefix ?? DEFAULT_PHONE_PREFIX} onChange={(e) => onPatch({ phonePrefix: e.target.value })} style={inputStyle}>
              {COUNTRY_PREFIXES.map((p) => (
                <option key={p.iso} value={p.code}>
                  {p.flag} {p.name} ({p.code})
                </option>
              ))}
            </select>
          </Field>
          <RequiredToggle checked={!!field.required} onChange={(v) => onPatch({ required: v })} />
          <p style={{ fontSize: 12.5, color: tokens.muted, margin: 0 }}>
            Numer telefonu jest walidowany automatycznie (8–15 cyfr z prefiksem).
          </p>
        </>
      )}

      {isChoice(field.type) && <OptionsEditor field={field} steps={steps} selfStepId={selfStepId} onPatch={onPatch} />}

      <Field label="Mapowanie do kontaktu">
        <select
          value={field.map ?? ""}
          onChange={(e) => onPatch({ map: (e.target.value || undefined) as FormField["map"] })}
          style={inputStyle}
        >
          <option value="">Brak</option>
          <option value="name">Imię / nazwa</option>
          <option value="email">E-mail</option>
          <option value="phone">Telefon</option>
        </select>
      </Field>
    </Reorder.Item>
  );
}

// Zmiana typu pola — dokłada/porządkuje właściwości specyficzne dla typu.
function changeFieldType(field: FormField, type: FieldType): Partial<FormField> {
  if (type === field.type) return {};
  const patch: Partial<FormField> = { type };
  if (isChoice(type)) {
    if (!field.options || field.options.length === 0) {
      patch.options = [
        { id: newStepId(), label: "Opcja A", next: NEXT },
        { id: newStepId(), label: "Opcja B", next: NEXT },
      ];
    }
    patch.validation = undefined;
  } else {
    patch.options = undefined;
  }
  if (type === "phone" && !field.phonePrefix) patch.phonePrefix = DEFAULT_PHONE_PREFIX;
  return patch;
}

function RequiredToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, fontWeight: 600 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: tokens.accent }} />
      Pole wymagane
    </label>
  );
}

/* ── Pole obrazka: URL LUB upload do Supabase Storage + podgląd ─────────── */
function ImageField({ value, onChange, formId }: { value: string; onChange: (url: string) => void; formId: string }) {
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
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
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
            style={{ border: "none", outline: "none", fontSize: 14, width: "100%", padding: "10px 0", color: tokens.text, background: "transparent" }}
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
            style={{ maxWidth: 180, maxHeight: 120, borderRadius: 10, border: `1px solid ${tokens.border}`, objectFit: "cover", display: "block" }}
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
        <p style={{ fontSize: 12, color: tokens.muted, margin: 0 }}>JPEG, PNG, WEBP lub GIF, maks. 5 MB. Możesz też wkleić gotowy adres URL.</p>
      )}
    </div>
  );
}

/* ── Edytor opcji (pola wyboru) ─────────────────────────────── */
function OptionsEditor({
  field,
  steps,
  selfStepId,
  onPatch,
}: {
  field: FormField;
  steps: Step[];
  selfStepId: string;
  onPatch: (patch: Partial<FormField>) => void;
}) {
  const options = field.options ?? [];

  function update(optId: string, patch: Partial<{ label: string; next: string }>) {
    onPatch({ options: options.map((o) => (o.id === optId ? { ...o, ...patch } : o)) });
  }
  function add() {
    onPatch({ options: [...options, { id: newStepId(), label: `Opcja ${String.fromCharCode(65 + options.length)}`, next: NEXT }] });
  }
  function remove(optId: string) {
    onPatch({ options: options.filter((o) => o.id !== optId) });
  }
  function move(optId: string, dir: -1 | 1) {
    const i = options.findIndex((o) => o.id === optId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= options.length) return;
    const next = [...options];
    [next[i], next[j]] = [next[j], next[i]];
    onPatch({ options: next });
  }

  const branching = field.type === "single_choice";

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
          <input value={o.label} onChange={(e) => update(o.id, { label: e.target.value })} style={{ ...inputStyle, flex: "1 1 100px", minWidth: 0 }} />
          {branching && (
            <div style={{ flex: "1 1 130px", minWidth: 0 }}>
              <NextSelect value={o.next} steps={steps} selfId={selfStepId} onChange={(v) => update(o.id, { next: v })} />
            </div>
          )}
          <button onClick={() => remove(o.id)} style={miniBtn} aria-label="Usuń opcję">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button onClick={add} style={{ ...ghostButton, justifySelf: "start", display: "flex", alignItems: "center", gap: 6, padding: "7px 12px" }}>
        <Plus size={14} /> Dodaj opcję
      </button>
      {branching && (
        <p style={{ fontSize: 12, color: tokens.muted, margin: 0 }}>
          Rozgałęzienie: wybór opcji może kierować do wskazanego kroku (item 7).
        </p>
      )}
    </div>
  );
}

/* ── Edytor walidacji (pola tekstowe) ───────────────────────── */
function ValidationEditor({ field, onPatch }: { field: FormField; onPatch: (patch: Partial<FormField>) => void }) {
  const v = field.validation;
  const preset = detectPreset(v);

  function setV(patch: Partial<FieldValidation>) {
    const next: FieldValidation = { ...(v ?? {}), ...patch };
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
      setV({ pattern: v?.pattern ?? "" });
      return;
    }
    const p = VALIDATION_PRESETS.find((x) => x.key === key);
    if (p) setV({ pattern: p.pattern, customMessage: p.message });
  }

  const numInput = (val: number | undefined, onChange: (n: number | undefined) => void, placeholder: string) => (
    <input
      type="number"
      value={val ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      style={inputStyle}
    />
  );

  return (
    <div style={{ display: "grid", gap: 12, padding: 12, borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff" }}>
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
            <input value={v?.pattern ?? ""} onChange={(e) => setV({ pattern: e.target.value })} placeholder="np. ^\\d{2}-\\d{3}$" style={{ ...inputStyle, fontFamily: "monospace" }} />
          </Field>
          <Field label="Komunikat błędu">
            <input value={v?.customMessage ?? ""} onChange={(e) => setV({ customMessage: e.target.value || undefined })} placeholder="Nieprawidłowy format." style={inputStyle} />
          </Field>
        </>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Min. długość">{numInput(v?.minLength, (n) => setV({ minLength: n }), "—")}</Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Maks. długość">{numInput(v?.maxLength, (n) => setV({ maxLength: n }), "—")}</Field>
        </div>
      </div>
    </div>
  );
}

/* ── Selektor routingu ──────────────────────────────────────── */
function NextSelect({ value, steps, selfId, onChange }: { value: string; steps: Step[]; selfId: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value={NEXT}>→ Następny krok</option>
      {steps
        .filter((s) => s.id !== selfId)
        .map((s) => (
          <option key={s.id} value={s.id}>
            Idź do: {stepDisplayName(s).slice(0, 28)}
          </option>
        ))}
      <option value={SUBMIT}>✓ Wyślij formularz</option>
    </select>
  );
}

/* ── Panel wyglądu (motyw) ──────────────────────────────────── */
function ThemePanel({ schema, onPatch }: { schema: FormSchema; onPatch: (patch: Partial<FormSchema>) => void }) {
  const t = schema.theme;
  const setTheme = (patch: Partial<FormSchema["theme"]>) => onPatch({ theme: { ...t, ...patch } });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <span style={paneTitle}>Wygląd</span>

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

/* ── Panel ustawień formularza: przekierowanie + mail „dziękujemy” ─────── */
function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function SettingsPanel({ schema, onPatch, formId }: { schema: FormSchema; onPatch: (patch: Partial<FormSchema>) => void; formId: string }) {
  const settings: FormSettings = schema.settings ?? {};
  const setSettings = (patch: Partial<FormSettings>) => onPatch({ settings: { ...settings, ...patch } });

  const email: ThankYouEmail = settings.thankYouEmail ?? defaultThankYouEmail();
  const setEmail = (patch: Partial<ThankYouEmail>) => setSettings({ thankYouEmail: { ...email, ...patch } });

  const redirect = settings.redirectUrl ?? "";
  const redirectInvalid = redirect.trim() !== "" && !isValidUrl(redirect);
  const extraLink = settings.extraLink ?? "";
  const extraInvalid = extraLink.trim() !== "" && !isValidUrl(extraLink);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

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

  // „Wyślij testowy e-mail” (item 7) — renderuje szablon i wysyła przez backend.
  async function sendTest() {
    const to = testEmail.trim();
    if (!to) {
      toast.error("Podaj adres e-mail do testu.");
      return;
    }
    setSendingTest(true);
    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId, to, subject: email.subject, html: email.html, extraLink: settings.extraLink }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error || "Nie udało się wysłać testu.");
      } else {
        toast.success("Testowy e-mail wysłany.");
      }
    } catch {
      toast.error("Błąd sieci przy wysyłce testu.");
    }
    setSendingTest(false);
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <span style={paneTitle}>Ustawienia formularza</span>

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

      <Field label="Dodatkowy link (np. konsultacja / VSL)">
        <input
          value={extraLink}
          onChange={(e) => setSettings({ extraLink: e.target.value })}
          placeholder="https://cal.com/selltic/konsultacja"
          style={{ ...inputStyle, ...(extraInvalid ? { borderColor: tokens.danger } : {}) }}
        />
      </Field>
      <p style={{ fontSize: 12, color: extraInvalid ? tokens.danger : tokens.muted, margin: "-6px 0 0" }}>
        {extraInvalid ? "Podaj poprawny adres URL (http:// lub https://)." : "Wstawiany w mailu przez placeholder {{extra_link}}."}
      </p>

      <div style={{ display: "grid", gap: 12, padding: 12, borderRadius: 12, border: `1px solid ${tokens.border}`, background: tokens.bg }}>
        <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, fontWeight: 700 }}>
          <Mail size={15} color={tokens.accent} />
          <input type="checkbox" checked={email.enabled} onChange={(e) => setEmail({ enabled: e.target.checked })} style={{ width: 16, height: 16, accentColor: tokens.accent }} />
          Wyślij automatyczny mail „dziękujemy”
        </label>

        {email.enabled && (
          <>
            <Field label="Temat">
              <input value={email.subject} onChange={(e) => setEmail({ subject: e.target.value })} style={inputStyle} />
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
                <button type="button" onClick={() => setEmail(defaultThankYouEmail())} style={{ ...ghostButton, padding: "6px 10px", fontSize: 12.5, marginLeft: "auto" }}>
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
                Placeholdery: <code>{"{{name}}"}</code> (imię/nazwa), <code>{"{{extra_link}}"}</code> (dodatkowy link powyżej). Wysyłany, gdy formularz zbiera adres e-mail.
              </p>
            </div>

            {/* Wyślij testowy e-mail (item 7) */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="adres@do-testu.pl"
                style={{ ...inputStyle, flex: "1 1 180px", minWidth: 0 }}
              />
              <button onClick={sendTest} disabled={sendingTest} style={{ ...ghostButton, whiteSpace: "nowrap" }}>
                {sendingTest ? "Wysyłanie…" : "Wyślij testowy e-mail"}
              </button>
            </div>
            <p style={{ fontSize: 12, color: tokens.muted, margin: 0 }}>
              Test wymaga skonfigurowanego klucza Resend w Ustawienia → Integracje.
            </p>
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
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 30, height: 30, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
        <input value={value} onChange={(e) => onChange(e.target.value)} style={{ border: "none", outline: "none", fontSize: 12, width: "100%", color: tokens.text }} />
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

function deviceBtn(active: boolean): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: `1px solid ${active ? tokens.accent : tokens.border}`,
    background: active ? tokens.accentSoft : "#fff",
    color: active ? tokens.accent : tokens.muted,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    flexShrink: 0,
  };
}
