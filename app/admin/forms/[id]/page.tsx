// app/admin/forms/[id]/page.tsx — edytor formularza (trzy panele).
// Lewy: lista kroków (drag & drop) · Środek: edytor kroku / ustawienia / wygląd
// · Prawy: podgląd na żywo (desktop/mobile, zwijany).
// Autozapis schematu (debounce 800ms); Publikuj/Aktualizuj kopiuje schema → published.
"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Reorder, useDragControls } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import { useIsMobile } from "@/lib/responsive";
import {
  type FormSchema,
  type Step,
  type StepType,
  type FieldType,
  type FormField,
  type StepOption,
  type FormStatus,
  type FieldValidation,
  type FormSettings,
  type FormBranding,
  type ThankYouEmail,
  NEXT,
  SUBMIT,
  FONTS,
  PAGE_TYPES,
  blankStep,
  blankField,
  newStepId,
  isTextInput,
  isInputStep,
  isContainerStep,
  stepFields,
  stepIssues,
  stepTypeLabel,
  hasValidationRules,
  defaultThankYouEmail,
  randomSlug,
  BUILTIN_LEAD_PROPERTIES,
  FIELD_TYPES,
  hasOptions,
  type FieldMapping,
  type TeamProperty,
} from "@/lib/forms";
import { publicFormUrl } from "@/lib/publicUrl";
import { compatibleTargetTypes, isCompatible, BUILTIN_TARGET_TYPE, type MapTargetType } from "@/lib/leadMapping";
import { leadTitleTokens } from "@/lib/leadTitle";
import { normalizeOptions, propLabel } from "@/lib/properties";
import type { PropertyDef } from "@/lib/types";
import { COUNTRY_PREFIXES, DEFAULT_PHONE_PREFIX } from "@/lib/phone";
import FormRenderer from "@/components/FormRenderer";
import ShareModal from "../share-modal";
import { useToast } from "@/components/Toast";
import FormStats from "@/components/forms/FormStats";
import FormSubmissions from "@/components/forms/FormSubmissions";
import MetaSettings from "@/components/forms/MetaSettings";
import SmsSettings from "@/components/forms/SmsSettings";
import MIcon from "@/components/MaterialIcon";

// ── Upload obrazków (przez serwerowy endpoint /api/forms/upload) ──────────
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const TYPE_ICON: Record<string, string> = {
  welcome: "waving_hand",
  question: "description",
  short_text: "text_fields",
  long_text: "notes",
  email: "alternate_email",
  phone: "call",
  single_choice: "radio_button_checked",
  multi_choice: "checklist",
  statement: "chat",
  end: "flag",
};

// Ikona kroku: dla kontenera pól bierzemy typ pierwszego pola.
function stepIcon(step: Step): string {
  if (step.type === "question") {
    const f = stepFields(step)[0];
    return (f && TYPE_ICON[f.type]) || "description";
  }
  return TYPE_ICON[step.type] || "text_fields";
}

// Nazwa wyświetlana kroku na liście (nagłówek lub etykieta pierwszego pola).
function stepDisplayName(step: Step): string {
  if (step.question.trim()) return step.question;
  const f = stepFields(step)[0];
  if (f?.question.trim()) return f.question;
  return stepTypeLabel(step.type);
}

// Typy pól do menu „Dodaj pole” — pełny zestaw z metadanymi (lib/forms).
const FIELD_TYPE_MENU: { type: FieldType; label: string; icon: string; group: string }[] = FIELD_TYPES;

type SaveState = "idle" | "saving" | "saved";
// Zakres edycji: „form” = ustawienia całego formularza (marka / wygląd / opcje),
// „step” = ustawienia zaznaczonego kroku / pytania. Rozdzielenie tych dwóch
// światów to główny cel redesignu — ogólne właściwości formularza są wyraźnie
// oddzielone od ustawień pojedynczego pytania.
type FormTab = "brand" | "design";

// Zakładki najwyższego poziomu kreatora (Typeform-style).
type BuilderView = "edytor" | "workflow" | "integracje" | "udostepnij" | "wyniki" | "ustawienia";

// §7b — definicje właściwości (custom fields) dostępne do mapowania pól.
// `add` pozwala od razu utworzyć nową właściwość z poziomu mapowania pola.
type PropDefsCtxValue = { defs: PropertyDef[]; add: (def: PropertyDef) => void };
const PropDefsCtx = createContext<PropDefsCtxValue>({ defs: [], add: () => {} });

export default function FormEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const isMobile = useIsMobile(900);
  const [mobilePane, setMobilePane] = useState<"steps" | "editor" | "preview">("editor");

  // Widok najwyższego poziomu (Typeform-style): Edytor · Workflow · Integracje ·
  // Udostępnij · Wyniki · Ustawienia.
  const searchParams = useSearchParams();
  const [view, setView] = useState<BuilderView>(() => {
    const t = searchParams.get("tab");
    if (t === "stats" || t === "submissions" || t === "wyniki") return "wyniki";
    if (t === "settings" || t === "ustawienia") return "ustawienia";
    if (t === "workflow") return "workflow";
    if (t === "integracje") return "integracje";
    if (t === "udostepnij") return "udostepnij";
    return "edytor";
  });
  // Niezapisane zmiany w zakładce Ustawienia (single-save + dirty guard).
  const [settingsDirty, setSettingsDirty] = useState(false);
  const guardedSetView = useCallback((next: BuilderView) => {
    setView((cur) => {
      if (cur === "ustawienia" && next !== "ustawienia" && settingsDirty) {
        if (!window.confirm("Masz niezapisane zmiany w Ustawieniach. Opuścić bez zapisywania?")) return cur;
        setSettingsDirty(false);
      }
      return next;
    });
  }, [settingsDirty]);
  useEffect(() => {
    if (!settingsDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [settingsDirty]);

  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [published, setPublished] = useState<FormSchema | null>(null);
  const [status, setStatus] = useState<FormStatus>("draft");
  const [slug, setSlug] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishing, setPublishing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  // Szerokość kolumny „Kroki i pytania” — regulowana przez użytkownika (item —
  // sekcja nie jest już sztywna). Trzymana w px, utrwalana w localStorage.
  const [stepsColW, setStepsColW] = useState(300);
  useEffect(() => {
    const saved = Number(localStorage.getItem("selltic-forms-steps-w"));
    if (saved >= 220 && saved <= 560) setStepsColW(saved);
  }, []);
  const startStepsResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      let latest = stepsColW;
      const onMove = (ev: MouseEvent) => {
        latest = Math.min(560, Math.max(220, stepsColW + (ev.clientX - startX)));
        setStepsColW(latest);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem("selltic-forms-steps-w", String(Math.round(latest)));
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [stepsColW]
  );
  // §7b — właściwości CRM do mapowania pól (aktywne + zarchiwizowane, by ostrzec
  // o usuniętych). Pobierane raz, współdzielone przez kontekst.
  const [propDefs, setPropDefs] = useState<PropertyDef[]>([]);
  useEffect(() => {
    supabase.from("property_defs").select("*").order("position", { ascending: true }).then(({ data }) => {
      setPropDefs((data as PropertyDef[]) ?? []);
    });
  }, [supabase]);

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
    const step = blankStep(type);
    step.id = newStepId();
    setSchema((s) => {
      if (!s) return s;
      const steps = [...s.steps];
      if (type === "welcome") {
        // Powitanie zawsze na początku (za ewentualnym istniejącym powitaniem).
        const after = steps.filter((st) => st.type === "welcome").length;
        steps.splice(after, 0, step);
      } else if (type === "end") {
        // Kolejne zakończenie doklejamy na sam koniec.
        steps.push(step);
      } else {
        // Zwykłą stronę wstawiamy przed pierwszym ekranem końcowym.
        const endIdx = steps.findIndex((st) => st.type === "end");
        if (endIdx === -1) steps.push(step);
        else steps.splice(endIdx, 0, step);
      }
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

  // Lewa kolumna (lista kroków) ma regulowaną, utrwalaną szerokość (uchwyt na
  // prawej krawędzi) — nie jest już sztywna, a nazwy kroków się mieszczą.
  // Środkowy edytor i podgląd elastycznie wypełniają resztę.
  const desktopColumns = previewCollapsed
    ? `${stepsColW}px minmax(360px, 1fr) 46px`
    : `${stepsColW}px minmax(340px, 1.5fr) minmax(300px, 1fr)`;

  return (
    <PropDefsCtx.Provider value={{ defs: propDefs, add: (def) => setPropDefs((p) => [...p, def]) }}>
    <div
      className={isMobile ? undefined : "selltic-page-fill"}
      style={{
        display: "flex",
        flexDirection: "column",
        ...(isMobile ? { minHeight: "calc(100vh - 130px)" } : {}),
      }}
    >
      {/* ── Pasek górny ─────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => {
            if (view === "ustawienia" && settingsDirty && !window.confirm("Masz niezapisane zmiany w Ustawieniach. Opuścić bez zapisywania?")) return;
            router.push("/admin/forms");
          }}
          style={iconBtn}
          aria-label="Wróć"
        >
          <MIcon name="arrow_back" size={18} color={tokens.muted} />
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
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: saveState === "saving" ? tokens.warning : tokens.success, fontWeight: 600 }}
          title="Kreator, marka, wygląd i ustawienia zapisują się automatycznie jako wersja robocza. Zakładki SMS i Meta mają własny przycisk „Zapisz”."
        >
          <span
            style={{
              width: 7, height: 7, borderRadius: "50%",
              background: saveState === "saving" ? tokens.warning : tokens.success,
            }}
          />
          {saveState === "saving" ? "Zapisywanie…" : "Automatycznie zapisane"}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          style={{ ...iconBtn, opacity: undoStack.length ? 1 : 0.4, cursor: undoStack.length ? "pointer" : "not-allowed" }}
          aria-label="Cofnij"
          title="Cofnij (Ctrl+Z)"
        >
          <MIcon name="undo" size={17} color={tokens.muted} />
        </button>
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          style={{ ...iconBtn, opacity: redoStack.length ? 1 : 0.4, cursor: redoStack.length ? "pointer" : "not-allowed" }}
          aria-label="Ponów"
          title="Ponów (Ctrl+Shift+Z)"
        >
          <MIcon name="redo" size={17} color={tokens.muted} />
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

      {/* ── Zakładki (Typeform-style) ─────────────────────────── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${tokens.border}`, paddingBottom: 2, flexWrap: "wrap" }}>
        <ViewTab active={view === "edytor"} onClick={() => guardedSetView("edytor")} icon="design_services" label="Edytor" />
        <ViewTab active={view === "workflow"} onClick={() => guardedSetView("workflow")} icon="rule" label="Workflow" />
        <ViewTab active={view === "integracje"} onClick={() => guardedSetView("integracje")} icon="hub" label="Integracje" />
        <ViewTab active={view === "udostepnij"} onClick={() => guardedSetView("udostepnij")} icon="share" label="Udostępnij" />
        <ViewTab active={view === "wyniki"} onClick={() => guardedSetView("wyniki")} icon="monitoring" label="Wyniki" />
        <ViewTab active={view === "ustawienia"} onClick={() => guardedSetView("ustawienia")} icon="tune" label="Ustawienia" />
      </div>

      {view === "workflow" && <WorkflowView schema={schema} onPatch={patchSchema} formId={id} />}
      {view === "integracje" && <IntegrationsView formId={id} />}
      {view === "udostepnij" && (
        <ShareView formId={id} slug={slug} title={schema.title} status={status} onSlugSaved={setSlug} />
      )}
      {view === "wyniki" && (
        <div style={{ display: "grid", gap: 18 }}>
          <FormStats formId={id} />
          <FormSubmissions formId={id} />
        </div>
      )}
      {view === "ustawienia" && (
        <UstawieniaView schema={schema} onPatch={patchSchema} formId={id} isMobile={isMobile} onDirtyChange={setSettingsDirty} />
      )}

      {view === "edytor" && (
      <>
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
          <MIcon name="warning" size={15} />
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
              ["steps", "Strony"],
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
          {/* Uchwyt zmiany szerokości kolumny (tylko desktop). */}
          {!isMobile && (
            <div
              onMouseDown={startStepsResize}
              title="Przeciągnij, aby zmienić szerokość"
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: 12,
                cursor: "col-resize",
                zIndex: 6,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <span style={{ width: 3, background: tokens.border, borderRadius: 2 }} />
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={paneTitle}>Strony</span>
            <AddPageMenu onAdd={addStep} />
          </div>

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
                  if (isMobile) setMobilePane("editor");
                }}
                onMove={moveStep}
                onDuplicate={duplicateStep}
                onDelete={deleteStep}
              />
            ))}
          </Reorder.Group>
        </div>

        {/* Środek: edytor zaznaczonego kroku. Ustawienia globalne formularza
            (marka / wygląd / ustawienia / SMS) mają teraz osobną zakładkę. */}
        <div
          style={{
            ...pane,
            overflowY: "auto",
            ...(isMobile ? { display: mobilePane === "editor" ? "block" : "none", flex: 1, minHeight: 0 } : {}),
          }}
        >
          <StepEditor step={active} steps={schema.steps} onPatch={(patch) => patchStep(active.id, patch)} />
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
                <MIcon name="right_panel_open" size={18} />
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
                      <MIcon name="desktop_windows" size={15} />
                    </button>
                    <button
                      onClick={() => setPreviewDevice("mobile")}
                      title="Podgląd mobile"
                      aria-label="Podgląd mobile"
                      style={deviceBtn(previewDevice === "mobile")}
                    >
                      <MIcon name="smartphone" size={15} />
                    </button>
                  </div>
                  {!isMobile && (
                    <button
                      onClick={() => setPreviewCollapsed(true)}
                      title="Zwiń podgląd"
                      aria-label="Zwiń podgląd"
                      style={deviceBtn(false)}
                    >
                      <MIcon name="right_panel_close" size={15} />
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
      </>
      )}

      {shareOpen && slug && <ShareModal slug={slug} title={schema.title} onClose={() => setShareOpen(false)} />}
    </div>
    </PropDefsCtx.Provider>
  );
}

/* ── Widok „Ustawienia" — ustawienia globalne całego formularza ─────────────
   Wydzielone z listy kroków do osobnej zakładki najwyższego poziomu (item 2):
   marka · wygląd · ustawienia · SMS, z podglądem na żywo obok. */
// ── Zakładka „Workflow": maile i SMS-y do klientów (treść, opóźnienie,
//    przekierowanie) + potwierdzenia do zespołu (per formularz). ────────────
function WorkflowView({ schema, onPatch, formId }: { schema: FormSchema; onPatch: (patch: Partial<FormSchema>) => void; formId: string }) {
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 780 }}>
      <div style={pane}>
        <span style={{ ...paneTitle, display: "block", marginBottom: 4 }}>SMS do klientów i zespołu</span>
        <p style={{ fontSize: 12.5, color: tokens.muted, margin: "0 0 12px" }}>
          Treść, opóźnienie i potwierdzenia dla zespołu. Placeholdery (np. imię) możesz wstawiać w treści.
        </p>
        <SmsSettings schema={schema} formId={formId} formTitle={schema.title} />
      </div>
      <div style={pane}>
        <SettingsPanel schema={schema} onPatch={onPatch} formId={formId} showMeta={false} />
      </div>
    </div>
  );
}

// ── Zakładka „Integracje": Meta (Pixel + CAPI) i webhook, pogrupowane. ──────
function IntegrationsView({ formId }: { formId: string }) {
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 780 }}>
      <div style={pane}>
        <span style={{ ...paneTitle, display: "block", marginBottom: 4 }}>Meta i webhook</span>
        <p style={{ fontSize: 12.5, color: tokens.muted, margin: "0 0 12px" }}>
          Integracje z dostawcami zewnętrznymi. Meta Conversions (Pixel + CAPI) oraz webhook (Make / Zapier / GA4).
        </p>
        <MetaSettings formId={formId} />
      </div>
    </div>
  );
}

// ── Zakładka „Udostępnij": edycja linku (slug), kopiowanie, embed. ──────────
function ShareView({
  formId, slug, title, status, onSlugSaved,
}: {
  formId: string; slug: string | null; title: string; status: FormStatus; onSlugSaved: (slug: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [value, setValue] = useState(slug ?? "");
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const normalized = value.trim().toLowerCase();
  const valid = /^[a-z0-9-]+$/.test(normalized);
  const publicUrl = normalized ? publicFormUrl(normalized, origin) : "";
  const embed = publicUrl ? `<iframe src="${publicUrl}?embed=1" width="100%" height="700" style="border:0" title="${title}"></iframe>` : "";

  async function saveSlug() {
    if (!valid || saving) return;
    setSaving(true);
    const { error } = await supabase.from("forms").update({ slug: normalized }).eq("id", formId);
    setSaving(false);
    if (error) {
      // 23505 = naruszenie unikalności (slug zajęty).
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) toast.error("Ten link jest już zajęty — wybierz inny.");
      else toast.error("Nie udało się zapisać linku.");
      return;
    }
    onSlugSaved(normalized);
    toast.success("Link zapisany.");
  }

  function copy(text: string, msg: string) {
    navigator.clipboard?.writeText(text).then(() => toast.success(msg));
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <div style={pane}>
        <span style={{ ...paneTitle, display: "block", marginBottom: 4 }}>Własny link</span>
        <p style={{ fontSize: 12.5, color: tokens.muted, margin: "0 0 12px" }}>
          Ustaw końcówkę adresu po ukośniku, np. <code>{publicFormUrl("kampania-wizytowka", origin)}</code>.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: tokens.muted, whiteSpace: "nowrap" }}>
            {(publicFormUrl("", origin) || "/f/").replace(/\/+$/, "")}/
          </span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="kampania-wizytowka"
            style={{ ...inputStyle, flex: "1 1 220px", minWidth: 0, ...(value.trim() && !valid ? { borderColor: tokens.danger } : {}) }}
          />
          <button onClick={saveSlug} disabled={!valid || saving} style={primaryButton}>
            {saving ? "Zapisywanie…" : "Zapisz link"}
          </button>
        </div>
        {value.trim() && !valid && (
          <p style={{ fontSize: 12, color: tokens.danger, margin: "8px 0 0" }}>
            Dozwolone są tylko małe litery, cyfry i myślniki (np. <code>kampania-wizytowka</code>).
          </p>
        )}
        {status !== "published" && (
          <p style={{ fontSize: 12, color: tokens.muted, margin: "8px 0 0" }}>
            Link zacznie działać publicznie po opublikowaniu formularza.
          </p>
        )}
      </div>

      {normalized && valid && (
        <div style={pane}>
          <span style={{ ...paneTitle, display: "block", marginBottom: 10 }}>Publiczny link</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input readOnly value={publicUrl} style={{ ...inputStyle, flex: "1 1 260px", minWidth: 0 }} />
            <button onClick={() => copy(publicUrl, "Skopiowano link")} style={ghostButton}>
              <MIcon name="content_copy" size={15} /> Kopiuj
            </button>
            <button onClick={() => window.open(publicUrl, "_blank")} style={ghostButton}>
              <MIcon name="open_in_new" size={15} /> Podgląd
            </button>
          </div>

          <span style={{ ...paneTitle, display: "block", margin: "18px 0 10px" }}>Osadzenie na stronie (embed)</span>
          <textarea
            readOnly
            value={embed}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}
          />
          <button onClick={() => copy(embed, "Skopiowano kod embed")} style={{ ...ghostButton, marginTop: 8 }}>
            <MIcon name="content_copy" size={15} /> Kopiuj kod
          </button>
        </div>
      )}
    </div>
  );
}

// ── Zakładka „Ustawienia": branding + wygląd + zachowania. JEDEN globalny
//    przycisk „Zapisz"; edycje trafiają do lokalnego szkicu, a zakładki nie da
//    się opuścić przy niezapisanych zmianach (dirty-guard w rodzicu). ─────────
function UstawieniaView({
  schema, onPatch, formId, isMobile, onDirtyChange,
}: {
  schema: FormSchema; onPatch: (patch: Partial<FormSchema>) => void; formId: string; isMobile: boolean; onDirtyChange: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<FormTab>("brand");
  const [draft, setDraft] = useState<{ theme: FormSchema["theme"]; branding: FormBranding }>({
    theme: schema.theme,
    branding: schema.branding ?? {},
  });

  const dirty = useMemo(
    () =>
      JSON.stringify(draft.theme) !== JSON.stringify(schema.theme) ||
      JSON.stringify(draft.branding ?? {}) !== JSON.stringify(schema.branding ?? {}),
    [draft, schema]
  );
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // Syntetyczny schemat dla paneli + podglądu — odzwierciedla lokalny szkic.
  const draftSchema: FormSchema = { ...schema, theme: draft.theme, branding: draft.branding };
  const localPatch = (patch: Partial<FormSchema>) =>
    setDraft((d) => ({
      theme: patch.theme ? (patch.theme as FormSchema["theme"]) : d.theme,
      branding: patch.branding ? (patch.branding as FormBranding) : d.branding,
    }));

  function save() {
    onPatch({ theme: draft.theme, branding: draft.branding });
    onDirtyChange(false);
    toast.success("Ustawienia zapisane.");
  }

  return (
    <div
      style={
        isMobile
          ? { display: "flex", flexDirection: "column", gap: 14 }
          : { display: "grid", gridTemplateColumns: "minmax(340px, 1.5fr) minmax(320px, 1fr)", gap: 14, alignItems: "start" }
      }
    >
      <div style={{ ...pane, display: "flex", flexDirection: "column", maxHeight: isMobile ? undefined : "calc(100vh - 200px)" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          <TabButton active={tab === "brand"} onClick={() => setTab("brand")} icon="image" label="Branding" />
          <TabButton active={tab === "design"} onClick={() => setTab("design")} icon="palette" label="Wygląd i zachowanie" />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 2 }}>
          {tab === "brand" && <BrandPanel schema={draftSchema} onPatch={localPatch} formId={formId} />}
          {tab === "design" && <ThemePanel schema={draftSchema} onPatch={localPatch} formId={formId} />}
        </div>

        {/* Jeden globalny przycisk zapisu — sticky na dole panelu. */}
        <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 12, marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: dirty ? tokens.warning : tokens.muted }}>
            {dirty ? "Niezapisane zmiany" : "Wszystko zapisane"}
          </span>
          <button onClick={save} disabled={!dirty} style={{ ...primaryButton, opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "not-allowed" }}>
            <MIcon name="save" size={15} /> Zapisz
          </button>
        </div>
      </div>

      {/* Podgląd na żywo — odzwierciedla szkic (przed zapisem). */}
      {!isMobile && (
        <div style={{ ...pane, padding: 0, overflow: "hidden", position: "sticky", top: 0, height: "calc(100vh - 200px)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${tokens.border}` }}>
            <span style={paneTitle}>Podgląd na żywo</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <FormRenderer form={draftSchema} preview />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Menu „Dodaj stronę" (item 1.3): powitanie · strona · zakończenie ─────── */
function AddPageMenu({ onAdd }: { onAdd: (type: StepType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={iconBtn} aria-label="Dodaj stronę" title="Dodaj stronę">
        <MIcon name="add" size={16} color={tokens.accent} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 42,
            right: 0,
            zIndex: 20,
            background: "#fff",
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
            boxShadow: tokens.shadowMenu,
            padding: 6,
            width: 232,
          }}
        >
          <div style={{ ...paneTitle, padding: "6px 8px 4px" }}>Dodaj stronę</div>
          {PAGE_TYPES.map((p) => (
            <button
              key={p.type}
              onClick={() => {
                onAdd(p.type);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                width: "100%",
                padding: "9px 10px",
                border: "none",
                background: "none",
                borderRadius: 9,
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: tokens.accentSoft,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <MIcon name={p.icon} size={16} color={tokens.accent} />
              </span>
              <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: tokens.text }}>{p.label}</span>
                <span style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.3 }}>{p.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
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
  const iconName = stepIcon(step);
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
          <MIcon name="drag_indicator" size={15} />
        </button>
        <MIcon name={iconName} size={15} color={active ? tokens.accent : tokens.muted} style={{ flexShrink: 0, marginTop: 3 }} />
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
            <MIcon name="warning" size={14} />
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
          <MIcon name="more_vert" size={15} />
        </button>
      </div>

      {menuOpen && (
        <div style={{ display: "flex", gap: 4, padding: "0 8px 8px 30px", flexWrap: "wrap" }}>
          <KebabAction disabled={index === 0} onClick={() => { onMove(step.id, -1); }} icon="keyboard_arrow_up" label="W górę" />
          <KebabAction disabled={isLast} onClick={() => { onMove(step.id, 1); }} icon="keyboard_arrow_down" label="W dół" />
          <KebabAction onClick={() => { setMenuOpen(false); onDuplicate(step.id); }} icon="content_copy" label="Duplikuj" />
          <KebabAction danger onClick={() => { setMenuOpen(false); onDelete(step.id); }} icon="delete" label="Usuń" />
        </div>
      )}
    </Reorder.Item>
  );
}

function KebabAction({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: string;
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
      <MIcon name={icon} size={13} />
      {label}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
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
      <MIcon name={icon} size={14} />
      {label}
    </button>
  );
}

// Zakładka widoku najwyższego poziomu (Kreator / Statystyki / Zgłoszenia).
function ViewTab({
  active, onClick, icon, label,
}: {
  active: boolean; onClick: () => void; icon: string; label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "9px 14px",
        border: "none", borderBottom: `2px solid ${active ? tokens.accent : "transparent"}`,
        background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 600,
        color: active ? tokens.accent : tokens.muted, marginBottom: -2,
      }}
    >
      <MIcon name={icon} size={15} />
      {label}
    </button>
  );
}

/* ── Edytor pojedynczej strony ──────────────────────────────────────────────
   Uproszczony (item 2): oddzielone sekcje — treść strony (nagłówek + opis),
   pola (pytania) oraz przycisk. Bez walidacji regex i bez „domyślnej następnej
   strony" (kolejność wynika z listy stron). */
function StepEditor({
  step,
  steps,
  onPatch,
}: {
  step: Step;
  steps: Step[];
  onPatch: (patch: Partial<Step>) => void;
}) {
  const input = isInputStep(step);
  const container = isContainerStep(step);
  // Nagłówek strony pokazujemy dla ekranów nie-wejściowych (powitanie/komunikat/
  // zakończenie) oraz dla stron wielopolowych. Dla starego, jedno-polowego kroku
  // nagłówkiem jest etykieta jego jedynego pola — osobne pole byłoby zdublowane.
  const showHeading = !input || container;
  const pageLabel = stepTypeLabel(step.type);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Nagłówek edytora: typ strony (spójny z listą stron). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: tokens.accentSoft, display: "grid", placeItems: "center" }}>
          <MIcon name={stepIcon(step)} size={16} color={tokens.accent} />
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: tokens.text }}>{pageLabel}</span>
      </div>

      {/* Sekcja: treść strony (globalny nagłówek + opis). */}
      <EditorSection title="Treść strony">
        {showHeading && (
          <Field label={input ? "Nagłówek strony (opcjonalnie)" : "Nagłówek"}>
            <input
              value={step.question}
              onChange={(e) => onPatch({ question: e.target.value })}
              placeholder={input ? "np. Zostaw kontakt" : "np. Witaj 👋"}
              style={inputStyle}
            />
          </Field>
        )}
        <Field label="Opis (opcjonalnie)">
          <textarea
            value={step.description ?? ""}
            onChange={(e) => onPatch({ description: e.target.value })}
            rows={2}
            placeholder="Krótki tekst pod nagłówkiem…"
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>
      </EditorSection>

      {/* Sekcja: pola (pytania). */}
      {input && <FieldsEditor step={step} steps={steps} onPatch={onPatch} />}

      {/* Sekcja: przycisk (CTA) — konfigurowalny na każdej stronie poza
          zakończeniem (item 3.7). */}
      {step.type !== "end" && <CtaEditor step={step} onPatch={onPatch} />}
    </div>
  );
}

/* ── Sekcja edytora — wizualnie oddziela grupy pól (item 2.1) ─────────────── */
function EditorSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 12, padding: 14, borderRadius: 12, border: `1px solid ${tokens.border}`, background: tokens.bg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 24 }}>
        <span style={paneTitle}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ── Edytor przycisku strony (etykieta + ukrycie) ────────────────────────── */
function CtaEditor({ step, onPatch }: { step: Step; onPatch: (patch: Partial<Step>) => void }) {
  const hidden = !!step.hideCta;
  return (
    <EditorSection title="Przycisk">
      {!hidden && (
        <Field label="Etykieta przycisku">
          <input
            value={step.cta ?? ""}
            onChange={(e) => onPatch({ cta: e.target.value })}
            placeholder={step.type === "welcome" ? "Zaczynamy" : "Dalej"}
            style={inputStyle}
          />
        </Field>
      )}
      {/* Ukrycie przycisku ma sens dla stron, po których użytkownik przechodzi
          dalej klawiszem Enter lub wyborem opcji — nie dla powitania (byłby to
          ślepy zaułek bez sposobu na start). */}
      {step.type !== "welcome" && (
        <ToggleRow
          label="Ukryj przycisk na tej stronie"
          checked={hidden}
          onChange={(v) => onPatch({ hideCta: v || undefined })}
        />
      )}
      {hidden && (
        <p style={{ fontSize: 12, color: tokens.muted, margin: 0 }}>
          Bez przycisku użytkownik przejdzie dalej klawiszem Enter lub po wyborze opcji.
        </p>
      )}
    </EditorSection>
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
    <EditorSection title={`Pola (${fields.length})`} action={<AddFieldButton onAdd={addField} />}>
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
    </EditorSection>
  );
}

// Plus „Dodaj pole" — rozwija listę dostępnych typów pól (item 2.3). Renderowany
// w nagłówku sekcji „Pola" jako mała ikona (menu wyrównane do prawej).
function AddFieldButton({ onAdd }: { onAdd: (type: FieldType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ ...iconBtn, width: 30, height: 30 }}
        aria-label="Dodaj pole"
        title="Dodaj pole"
      >
        <MIcon name="add" size={16} color={tokens.accent} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 38,
            right: 0,
            zIndex: 10,
            background: "#fff",
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
            boxShadow: tokens.shadowMenu,
            padding: 6,
            width: 210,
            maxHeight: 340,
            overflowY: "auto",
          }}
        >
          {FIELD_TYPE_MENU.map((t) => {
            const iconName = t.icon ?? TYPE_ICON[t.type] ?? "text_fields";
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
                <MIcon name={iconName} size={15} color={tokens.muted} />
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
  const iconName = TYPE_ICON[field.type] ?? "text_fields";

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
          <MIcon name="drag_indicator" size={15} />
        </button>
        <MIcon name={iconName} size={15} color={tokens.accent} />
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
          <MIcon name="delete" size={14} />
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
          {/* item 2.4 — jedyna „walidacja" pól tekstowych: limit znaków. Pola
              wymagające formatu (e-mail, telefon, link, liczba) mają dedykowane
              typy z wbudowaną kontrolą, więc nie potrzebują reguł regex. */}
          {(field.type === "short_text" || field.type === "long_text") && (
            <MinMaxChars field={field} onPatch={onPatch} />
          )}
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

      {hasOptions(field.type) && (
        <>
          {field.type === "dropdown" && (
            <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!field.multiple}
                onChange={(e) => onPatch({ multiple: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: tokens.accent }}
              />
              Pozwól wybrać wiele opcji
            </label>
          )}
          <OptionsEditor field={field} steps={steps} selfStepId={selfStepId} onPatch={onPatch} />
          <RequiredToggle checked={!!field.required} onChange={(v) => onPatch({ required: v })} />
        </>
      )}

      {field.type === "yes_no" && (
        <RequiredToggle checked={!!field.required} onChange={(v) => onPatch({ required: v })} />
      )}

      {field.type === "checkbox" && (
        <>
          <Field label="Treść zgody (obok pola wyboru)">
            <textarea
              value={field.description ?? ""}
              onChange={(e) => onPatch({ description: e.target.value })}
              rows={2}
              placeholder="np. Wyrażam zgodę na przetwarzanie danych osobowych w celu…"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Field>
          <RequiredToggle checked={!!field.required} onChange={(v) => onPatch({ required: v })} />
        </>
      )}

      <PropertyMappingEditor field={field} onPatch={onPatch} />
    </Reorder.Item>
  );
}

// §7b — mapowanie pola na właściwość CRM (wbudowaną lub własną). Oferuje tylko
// właściwości ZGODNE typem (multi_select nie zmapuje się na number). Pola wyboru
// mapowane na listy dostają mapowanie opcja-po-opcji z walidacją.
function newPropTypeFor(field: FormField): PropertyDef["type"] {
  switch (field.type) {
    case "number": return "number";
    case "email": return "email";
    case "phone": return "text";
    case "single_choice":
    case "dropdown": return field.multiple ? "multi_select" : "select";
    case "multi_choice": return "multi_select";
    case "checkbox":
    case "yes_no": return "boolean";
    default: return "text";
  }
}

function slugKey(s: string): string {
  const base = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "pole";
  return `${base}_${Math.random().toString(36).slice(2, 6)}`;
}

function PropertyMappingEditor({ field, onPatch }: { field: FormField; onPatch: (patch: Partial<FormField>) => void }) {
  const { defs: propDefs, add: addPropDef } = useContext(PropDefsCtx);
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();

  // §7 — utworzenie nowej właściwości CRM wprost z mapowania pola i zmapowanie.
  async function createProperty() {
    const label = window.prompt("Nazwa nowej właściwości CRM:", field.question || "");
    if (!label || !label.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Sesja wygasła — zaloguj się ponownie."); return; }
    const type = newPropTypeFor(field);
    const key = slugKey(label);
    const options = (type === "select" || type === "multi_select")
      ? (field.options ?? []).map((o) => ({ key: slugKey(o.label), label: o.label }))
      : null;
    const base = { owner: user.id, key, label: label.trim(), type, options, position: 999 };
    let { data, error } = await supabase
      .from("property_defs")
      .insert({ ...base, scopes: ["deals"] })
      .select("*").single();
    // Przed migration_attio_redesign.sql kolumny `scopes` może nie być —
    // ponów bez niej (spójnie z dodawaniem właściwości w Ustawieniach).
    if (error && /scopes/.test(error.message)) {
      ({ data, error } = await supabase.from("property_defs").insert(base).select("*").single());
    }
    if (error || !data) {
      toast.error(error?.code === "23505" ? "Właściwość o tym kluczu już istnieje." : "Nie udało się utworzyć właściwości.");
      return;
    }
    addPropDef(data as PropertyDef);
    onPatch({ mapping: { target: "custom", property: key }, map: undefined });
    toast.success("Utworzono właściwość i zmapowano pole.");
  }

  // Zbuduj listę zgodnych celów (wbudowane + własne aktywne).
  const targets = useMemo(() => {
    const builtin = BUILTIN_LEAD_PROPERTIES
      .filter((p) => isCompatible(field.type, BUILTIN_TARGET_TYPE[p.key]))
      .map((p) => ({ value: `builtin:${p.key}`, label: p.label, group: "Wbudowane", type: BUILTIN_TARGET_TYPE[p.key] }));
    const compatTypes = new Set(compatibleTargetTypes(field.type) as MapTargetType[]);
    const custom = propDefs
      .filter((d) => !d.archived_at && compatTypes.has(d.type as MapTargetType))
      .map((d) => ({ value: `custom:${d.key}`, label: propLabel(d), group: "Własne", type: d.type as MapTargetType }));
    return [...builtin, ...custom];
  }, [field.type, propDefs]);

  // Bieżąca wartość: nowe mapping albo legacy map (name/email/phone → builtin).
  const current: string = field.mapping
    ? `${field.mapping.target}:${field.mapping.property}`
    : field.map
    ? `builtin:${field.map}`
    : "";

  // Czy wybrana właściwość została usunięta (mapping wskazuje na nieistniejącą)?
  const deletedCustom =
    field.mapping?.target === "custom" && !propDefs.some((d) => d.key === field.mapping!.property && !d.archived_at);

  function onSelect(value: string) {
    if (value === "__new__") { createProperty(); return; }
    if (!value) {
      onPatch({ mapping: undefined, map: undefined });
      return;
    }
    const [target, property] = value.split(":") as ["builtin" | "custom", string];
    const mapping: FieldMapping = { target, property };
    // Zachowaj legacy `map` dla wbudowanych pól kontaktu (spójność z heurystyką).
    const legacy = target === "builtin" && (property === "name" || property === "email" || property === "phone")
      ? (property as FormField["map"]) : undefined;
    onPatch({ mapping, map: legacy });
  }

  // Docelowy typ wybranej właściwości (do mapowania opcji).
  const selectedType: MapTargetType | null = field.mapping
    ? field.mapping.target === "builtin"
      ? BUILTIN_TARGET_TYPE[field.mapping.property] ?? null
      : (propDefs.find((d) => d.key === field.mapping!.property)?.type as MapTargetType) ?? null
    : null;

  const needsOptionMap = hasOptions(field.type) && (selectedType === "select" || selectedType === "multi_select");
  const targetProp = field.mapping?.target === "custom"
    ? propDefs.find((d) => d.key === field.mapping!.property)
    : null;
  const targetOptions = targetProp ? normalizeOptions(targetProp.options) : [];

  return (
    <Field label="Mapowanie do właściwości CRM">
      <select value={current} onChange={(e) => onSelect(e.target.value)} style={inputStyle}>
        <option value="">Brak (odpowiedź zapisana tylko w zgłoszeniu)</option>
        <optgroup label="Wbudowane">
          {targets.filter((t) => t.group === "Wbudowane").map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </optgroup>
        {targets.some((t) => t.group === "Własne") && (
          <optgroup label="Własne właściwości">
            {targets.filter((t) => t.group === "Własne").map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </optgroup>
        )}
        <option value="__new__">＋ Utwórz nową właściwość…</option>
      </select>

      {deletedCustom && (
        <p style={{ fontSize: 12.5, color: tokens.warning, margin: "6px 0 0", fontWeight: 600 }}>
          ⚠ Zmapowana właściwość została usunięta w Ustawieniach — wybierz inną lub usuń mapowanie.
        </p>
      )}

      {/* Mapowanie opcja-po-opcji (wybór → lista). */}
      {needsOptionMap && targetProp && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: tokens.muted }}>Mapowanie opcji</span>
          {(field.options ?? []).map((o) => {
            const mappedKey = field.mapping?.optionMap?.[o.label] ?? "";
            return (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
                <span style={{ color: tokens.muted }}>→</span>
                <select
                  value={mappedKey}
                  onChange={(e) => {
                    const optionMap = { ...(field.mapping?.optionMap ?? {}) };
                    if (e.target.value) optionMap[o.label] = e.target.value;
                    else delete optionMap[o.label];
                    onPatch({ mapping: { ...field.mapping!, optionMap } });
                  }}
                  style={{ ...inputStyle, flex: 1, width: "auto" }}
                >
                  <option value="">—</option>
                  {targetOptions.map((to) => (
                    <option key={to.key} value={to.key}>{to.label}</option>
                  ))}
                </select>
              </div>
            );
          })}
          {(field.options ?? []).some((o) => !field.mapping?.optionMap?.[o.label]) && (
            <p style={{ fontSize: 12.5, color: tokens.warning, margin: "2px 0 0", fontWeight: 600 }}>
              ⚠ Nie wszystkie opcje są zmapowane — niezmapowane zostaną pominięte przy tworzeniu leadu.
            </p>
          )}
        </div>
      )}
    </Field>
  );
}

// Zmiana typu pola — dokłada/porządkuje właściwości specyficzne dla typu.
function changeFieldType(field: FormField, type: FieldType): Partial<FormField> {
  if (type === field.type) return {};
  const patch: Partial<FormField> = { type };
  if (hasOptions(type)) {
    if (!field.options || field.options.length === 0) {
      patch.options = [
        { id: newStepId(), label: "Opcja A", next: NEXT },
        { id: newStepId(), label: "Opcja B", next: NEXT },
      ];
    }
    patch.validation = undefined;
  } else {
    patch.options = undefined;
    patch.multiple = undefined;
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
function ImageField({
  value,
  onChange,
  formId,
  label = "Obraz (opcjonalnie)",
  uploadOnly = false,
  disabled = false,
}: {
  value: string;
  onChange: (url: string) => void;
  formId: string;
  label?: string;
  // uploadOnly: ukryj pole URL i podpowiedź o formatach (item 3.3.4 / 3.5) —
  // tylko przycisk „Wgraj plik".
  uploadOnly?: boolean;
  disabled?: boolean;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [broken, setBroken] = useState(false);

  // Upload przez serwerowy endpoint (service_role). Endpoint sam tworzy bucket
  // „form-assets”, gdy go brak — dzięki temu znika błąd „Bucket not found”.
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
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("formId", formId);
      const res = await fetch("/api/forms/upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.url) {
        toast.error(body?.error || "Nie udało się wgrać pliku.");
        return;
      }
      setBroken(false);
      onChange(body.url as string);
      toast.success("Obraz wgrany.");
    } catch {
      toast.error("Błąd sieci podczas wgrywania pliku.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {!uploadOnly && (
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
            <MIcon name="link" size={14} color={tokens.muted} style={{ flexShrink: 0 }} />
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
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || disabled}
          style={{ ...ghostButton, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0, ...(uploadOnly ? { justifySelf: "start" } : {}) }}
        >
          <MIcon name="upload" size={14} /> {uploading ? "Wgrywanie…" : "Wgraj plik"}
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
            <MIcon name="close" size={12} color={tokens.muted} />
          </button>
        </div>
      ) : value && broken ? (
        <p style={{ fontSize: 12, color: tokens.danger, margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <MIcon name="image" size={13} /> Nie można wczytać obrazka z tego adresu.
        </p>
      ) : uploadOnly ? null : (
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

  function update(optId: string, patch: Partial<StepOption>) {
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
        <div
          key={o.id}
          style={{ display: "grid", gap: 6, padding: 8, borderRadius: 10, border: `1px solid ${tokens.border}`, background: "#fff" }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <button onClick={() => move(o.id, -1)} disabled={i === 0} style={{ ...miniBtn, height: 18 }} aria-label="Opcja w górę">
                <MIcon name="expand_less" size={12} />
              </button>
              <button onClick={() => move(o.id, 1)} disabled={i === options.length - 1} style={{ ...miniBtn, height: 18 }} aria-label="Opcja w dół">
                <MIcon name="expand_more" size={12} />
              </button>
            </div>
            <input
              value={o.icon ?? ""}
              onChange={(e) => update(o.id, { icon: e.target.value || undefined })}
              placeholder="🙂"
              aria-label="Ikona (emoji)"
              title="Ikona opcji (emoji)"
              style={{ ...inputStyle, width: 46, flexShrink: 0, textAlign: "center", padding: "10px 4px" }}
            />
            <input value={o.label} onChange={(e) => update(o.id, { label: e.target.value })} placeholder="Etykieta opcji" style={{ ...inputStyle, flex: "1 1 100px", minWidth: 0 }} />
            <button onClick={() => remove(o.id)} style={miniBtn} aria-label="Usuń opcję">
              <MIcon name="delete" size={14} />
            </button>
          </div>
          <input
            value={o.description ?? ""}
            onChange={(e) => update(o.id, { description: e.target.value || undefined })}
            placeholder="Podtytuł opcji (opcjonalnie)"
            style={{ ...inputStyle, fontSize: 13 }}
          />
          {branching && (
            <NextSelect value={o.next} steps={steps} selfId={selfStepId} onChange={(v) => update(o.id, { next: v })} />
          )}
        </div>
      ))}
      <button onClick={add} style={{ ...ghostButton, justifySelf: "start", display: "flex", alignItems: "center", gap: 6, padding: "7px 12px" }}>
        <MIcon name="add" size={14} /> Dodaj opcję
      </button>
      {branching && (
        <p style={{ fontSize: 12, color: tokens.muted, margin: 0 }}>
          Rozgałęzienie: wybór opcji może kierować do wskazanego kroku (item 7).
        </p>
      )}
    </div>
  );
}

/* ── Limit znaków (pola tekstowe) — jedyna „walidacja" w uproszczonym edytorze
   (item 2.4). Ustawia minLength/maxLength; puste = brak limitu. ─────────────── */
function MinMaxChars({ field, onPatch }: { field: FormField; onPatch: (patch: Partial<FormField>) => void }) {
  const v = field.validation;

  function setV(patch: Partial<FieldValidation>) {
    const next: FieldValidation = { ...(v ?? {}), ...patch };
    (Object.keys(next) as (keyof FieldValidation)[]).forEach((k) => {
      if (next[k] === undefined) delete next[k];
    });
    onPatch({ validation: hasValidationRules(next) || next.customMessage ? next : undefined });
  }

  const numInput = (val: number | undefined, onChange: (n: number | undefined) => void) => (
    <input
      type="number"
      min={0}
      value={val ?? ""}
      placeholder="—"
      onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)))}
      style={inputStyle}
    />
  );

  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ flex: 1 }}>
        <Field label="Min. znaków">{numInput(v?.minLength, (n) => setV({ minLength: n }))}</Field>
      </div>
      <div style={{ flex: 1 }}>
        <Field label="Maks. znaków">{numInput(v?.maxLength, (n) => setV({ maxLength: n }))}</Field>
      </div>
    </div>
  );
}

/* ── Selektor routingu ──────────────────────────────────────── */
function NextSelect({ value, steps, selfId, onChange }: { value: string; steps: Step[]; selfId: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value={NEXT}>→ Następna strona</option>
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

/* ── Panel marki: logo/awatar + nazwa + podtytuł (nagłówek formularza) ─── */
function BrandPanel({
  schema,
  onPatch,
  formId,
}: {
  schema: FormSchema;
  onPatch: (patch: Partial<FormSchema>) => void;
  formId: string;
}) {
  const b: FormBranding = schema.branding ?? {};
  const setB = (patch: Partial<FormBranding>) => onPatch({ branding: { ...b, ...patch } });
  const on = b.showHeader !== false; // branding włączony?
  // Pola brandingu są wyszarzone i nieaktywne, gdy branding jest wyłączony
  // (item 3.3.3) — zamiast znikać, dają czytelny sygnał „można to włączyć".
  const dim: React.CSSProperties = on ? {} : { opacity: 0.5, pointerEvents: "none" };
  const countOn = !!b.showSubmissionCount;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* item 3.3.3 — jeden przełącznik „Włącz branding". */}
      <ToggleRow label="Włącz branding" checked={on} onChange={(v) => setB({ showHeader: v })} />

      <div style={{ display: "grid", gap: 14, ...dim }}>
        {/* item 3.3.4 — logo: tylko wgranie pliku, bez URL i bez podpowiedzi. */}
        <ImageField
          value={b.logo ?? ""}
          onChange={(url) => setB({ logo: url })}
          formId={formId}
          label="Logo"
          uploadOnly
          disabled={!on}
        />

        {/* item 3.3.5 / 3.3.6 — „Nagłówek" (dawniej „Nazwa marki"). */}
        <Field label="Nagłówek">
          <input
            value={b.name ?? ""}
            onChange={(e) => setB({ name: e.target.value })}
            placeholder="np. Selltic Agency"
            disabled={!on}
            style={inputStyle}
          />
        </Field>

        {/* item 3.3.7 / 3.3.8 — podtytuł wyróżniony wizualnie (druga linia). */}
        <Field label="Podtytuł (opcjonalnie)">
          <input
            value={b.tagline ?? ""}
            onChange={(e) => setB({ tagline: e.target.value })}
            placeholder="np. Strony internetowe dla branży medycznej"
            disabled={!on}
            style={{ ...inputStyle, fontStyle: "italic", color: tokens.muted }}
          />
        </Field>
      </div>

      {/* item 3.8 — dowód społeczny: licznik osób, które wypełniły formularz. */}
      <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 14, display: "grid", gap: 12 }}>
        <ToggleRow
          label="Pokaż licznik wypełnień (na powitaniu)"
          checked={countOn}
          onChange={(v) => setB({ showSubmissionCount: v || undefined })}
        />
        {countOn && (
          <Field label="Liczba osób">
            <input
              type="number"
              min={0}
              value={b.submissionCount ?? ""}
              onChange={(e) => setB({ submissionCount: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
              placeholder="np. 128"
              style={{ ...inputStyle, maxWidth: 160 }}
            />
          </Field>
        )}
      </div>
    </div>
  );
}

/* ── Panel wyglądu (motyw + styl) ───────────────────────────── */
function ThemePanel({ schema, onPatch, formId }: { schema: FormSchema; onPatch: (patch: Partial<FormSchema>) => void; formId: string }) {
  const t = schema.theme;
  const setTheme = (patch: Partial<FormSchema["theme"]>) => onPatch({ theme: { ...t, ...patch } });
  const surface = t.surface ?? "full";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Field label="Czcionka">
        <select value={t.font} onChange={(e) => setTheme({ font: e.target.value })} style={{ ...inputStyle, fontFamily: `"${t.font}", system-ui, sans-serif` }}>
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: `"${f}", system-ui, sans-serif` }}>
              {f}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <ColorField label="Akcent" value={t.primary} onChange={(v) => setTheme({ primary: v })} />
        <ColorField label="Poświata pól" value={t.glow ?? t.primary} onChange={(v) => setTheme({ glow: v })} />
        <ColorField label="Tło strony" value={t.bg} onChange={(v) => setTheme({ bg: v })} />
        <ColorField label="Tekst" value={t.text} onChange={(v) => setTheme({ text: v })} />
        {surface === "card" && (
          <ColorField label="Tło karty" value={t.cardBg ?? "#FFFFFF"} onChange={(v) => setTheme({ cardBg: v })} />
        )}
      </div>

      {/* Własne tło formularza — tylko wgranie pliku (item 3.5). */}
      <ImageField
        value={t.bgImage ?? ""}
        onChange={(url) => setTheme({ bgImage: url || undefined })}
        formId={formId}
        label="Tło formularza (obraz — opcjonalnie)"
        uploadOnly
      />

      <Field label="Powierzchnia formularza">
        <select value={surface} onChange={(e) => setTheme({ surface: e.target.value as FormSchema["theme"]["surface"] })} style={inputStyle}>
          <option value="card">Karta (wyśrodkowana, z cieniem)</option>
          <option value="full">Pełne tło (na całą stronę)</option>
        </select>
      </Field>

      <Field label="Styl opcji wyboru">
        <select value={t.optionStyle ?? "list"} onChange={(e) => setTheme({ optionStyle: e.target.value as FormSchema["theme"]["optionStyle"] })} style={inputStyle}>
          <option value="cards">Karty (ikona + podtytuł)</option>
          <option value="list">Lista (skróty A/B/C)</option>
        </select>
      </Field>

      <Field label="Pasek postępu">
        <select value={t.progress ?? "bar"} onChange={(e) => setTheme({ progress: e.target.value as FormSchema["theme"]["progress"] })} style={inputStyle}>
          <option value="bar">Pasek</option>
          <option value="dots">Kropki / segmenty</option>
          <option value="none">Ukryty</option>
        </select>
      </Field>

      <Field label="Zaokrąglenie rogów">
        <select value={String(t.radius ?? 12)} onChange={(e) => setTheme({ radius: Number(e.target.value) })} style={inputStyle}>
          <option value="6">Ostre (6 px)</option>
          <option value="12">Standardowe (12 px)</option>
          <option value="18">Miękkie (18 px)</option>
          <option value="24">Zaokrąglone (24 px)</option>
        </select>
      </Field>

      <Field label="Układ treści">
        <select value={t.layout} onChange={(e) => setTheme({ layout: e.target.value as FormSchema["theme"]["layout"] })} style={inputStyle}>
          <option value="center">Wyśrodkowany</option>
          <option value="left">Do lewej</option>
          <option value="split">Podział (obraz po lewej — tylko pełne tło)</option>
        </select>
      </Field>

      <ToggleRow
        label="Numer kroku („KROK 3”) nad pytaniem"
        checked={!!t.showStepNumber}
        onChange={(v) => setTheme({ showStepNumber: v })}
      />

      {/* item 3.6 — licznik „Krok X z Y" jest teraz opcjonalny (domyślnie off). */}
      <ToggleRow
        label="Licznik postępu („Krok 2 z 4”)"
        checked={!!t.showCounter}
        onChange={(v) => setTheme({ showCounter: v })}
      />

      <ToggleRow
        label="Podpowiedź przy pytaniach wyboru („Wybierz jedną opcję”)"
        checked={!!t.showChoiceHint}
        onChange={(v) => setTheme({ showChoiceHint: v })}
      />

      <ToggleRow
        label="Pozwól cofać się do poprzednich kroków"
        checked={t.allowBack !== false}
        onChange={(v) => setTheme({ allowBack: v })}
      />

      <Field label="Znaczniki przy opcjach wyboru">
        <select
          value={t.choiceLettering ?? "letters"}
          onChange={(e) => setTheme({ choiceLettering: e.target.value as FormSchema["theme"]["choiceLettering"] })}
          style={inputStyle}
        >
          <option value="letters">Litery (A, B, C)</option>
          <option value="numbers">Cyfry (1, 2, 3)</option>
          <option value="none">Bez znaczników</option>
        </select>
      </Field>
    </div>
  );
}

/* ── Przełącznik on/off (spójny wygląd) ─────────────────────── */
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: tokens.accent }} />
      {label}
    </label>
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

/* ── Predefiniowane właściwości formularza (ukryte dla klienta, widoczne dla
   zespołu). Stała wartość przypisywana do każdego leadu z tego formularza —
   np. „Źródło = Kampania FB”. Mapuje na własną właściwość (property_defs) lub
   wbudowaną (Firma / Wartość). Opcjonalne. ─────────────────────────────────── */
const TEAM_BUILTINS: { key: string; label: string; type: "text" | "number" }[] = [
  { key: "company", label: "Firma", type: "text" },
  { key: "value", label: "Wartość (zł)", type: "number" },
];

function TeamPropsEditor({ value, onChange }: { value: TeamProperty[]; onChange: (v: TeamProperty[]) => void }) {
  const { defs: propDefs } = useContext(PropDefsCtx);
  const activeDefs = useMemo(() => propDefs.filter((d) => !d.archived_at), [propDefs]);

  const setRow = (id: string, patch: Partial<TeamProperty>) =>
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () =>
    onChange([...value, { id: newStepId(), target: "builtin", property: "company", value: "" }]);
  const removeRow = (id: string) => onChange(value.filter((r) => r.id !== id));

  // Zmiana wybranej właściwości (target:property) — resetuje wartość, gdy typ
  // wymaga listy opcji.
  const selectProp = (id: string, composite: string) => {
    const [target, property] = composite.split(":") as ["builtin" | "custom", string];
    setRow(id, { target, property, value: "" });
  };

  const defFor = (r: TeamProperty) =>
    r.target === "custom" ? activeDefs.find((d) => d.key === r.property) : null;

  return (
    <div style={{ display: "grid", gap: 10, padding: 12, borderRadius: 12, border: `1px solid ${tokens.border}`, background: tokens.bg }}>
      <span style={{ ...paneTitle, display: "block" }}>Właściwości zespołu (ukryte dla klienta)</span>
      <p style={{ fontSize: 12.5, color: tokens.muted, margin: 0 }}>
        Stałe wartości doklejane do każdego leadu z tego formularza — np. „Źródło = Kampania FB”. Klient ich nie widzi;
        pojawiają się na karcie leadu. Własne właściwości (np. „Źródło”) tworzysz w Ustawienia → Właściwości.
      </p>

      {value.map((r) => {
        const def = defFor(r);
        const options = def ? normalizeOptions(def.options) : [];
        const isNumber = r.target === "builtin" && r.property === "value";
        return (
          <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={`${r.target}:${r.property}`}
              onChange={(e) => selectProp(r.id, e.target.value)}
              style={{ ...inputStyle, flex: "1 1 140px", minWidth: 0, width: "auto" }}
            >
              <optgroup label="Wbudowane">
                {TEAM_BUILTINS.map((b) => (
                  <option key={b.key} value={`builtin:${b.key}`}>{b.label}</option>
                ))}
              </optgroup>
              {activeDefs.length > 0 && (
                <optgroup label="Własne właściwości">
                  {activeDefs.map((d) => (
                    <option key={d.key} value={`custom:${d.key}`}>{propLabel(d)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <span style={{ color: tokens.muted }}>=</span>
            {options.length > 0 ? (
              <select
                value={r.value}
                onChange={(e) => setRow(r.id, { value: e.target.value })}
                style={{ ...inputStyle, flex: "1 1 140px", minWidth: 0, width: "auto" }}
              >
                <option value="">— wybierz —</option>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                value={r.value}
                onChange={(e) => setRow(r.id, { value: e.target.value })}
                type={isNumber ? "number" : "text"}
                placeholder={isNumber ? "np. 500" : "np. Kampania FB"}
                style={{ ...inputStyle, flex: "1 1 140px", minWidth: 0 }}
              />
            )}
            <button
              type="button"
              onClick={() => removeRow(r.id)}
              aria-label="Usuń właściwość"
              style={{ ...iconBtn, width: 32, height: 32 }}
            >
              <MIcon name="close" size={14} color={tokens.muted} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        style={{ ...ghostButton, display: "inline-flex", alignItems: "center", gap: 6, width: "fit-content", padding: "7px 12px", fontSize: 13 }}
      >
        <MIcon name="add" size={14} /> Dodaj właściwość
      </button>
    </div>
  );
}

function SettingsPanel({ schema, onPatch, formId, showMeta = true }: { schema: FormSchema; onPatch: (patch: Partial<FormSchema>) => void; formId: string; showMeta?: boolean }) {
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

  // §7 — pola formularza + ostrzeżenie o braku mapowania kontaktu.
  const allFields = useMemo(() => schema.steps.flatMap((s) => stepFields(s)), [schema.steps]);
  const hasContactMap = allFields.some(
    (f) => f.type === "email" || f.type === "phone" || f.map === "email" || f.map === "phone" ||
      f.mapping?.property === "email" || f.mapping?.property === "phone"
  );
  const leadTitle = settings.defaultLeadTitle ?? "";
  const tokens_ = useMemo(() => leadTitleTokens(allFields), [allFields]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <span style={paneTitle}>Ustawienia formularza</span>

      {!hasContactMap && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "#FDF1E3", border: `1px solid ${tokens.warning}`, color: "#8a5a1a", fontSize: 13, fontWeight: 600 }}>
          <MIcon name="warning" size={15} />
          Żadne pole nie jest zmapowane na e-mail ani telefon — ten formularz nie utworzy kontaktowalnego leadu.
        </div>
      )}

      {/* §7a — szablon domyślnego tytułu leadu */}
      <Field label="Domyślny tytuł leadu (szablon, opcjonalnie)">
        <input
          value={leadTitle}
          onChange={(e) => setSettings({ defaultLeadTitle: e.target.value })}
          placeholder="np. {{field:...}} — {{form:title}}"
          style={inputStyle}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {tokens_.map((t) => (
            <button
              key={t.token}
              type="button"
              onClick={() => setSettings({ defaultLeadTitle: (leadTitle + " " + t.token).trim() })}
              title={t.label}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 7, border: `1px solid ${tokens.border}`, background: "#fff", cursor: "pointer", color: tokens.accent }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12.5, color: tokens.muted, margin: "6px 0 0" }}>
          Puste = domyślne zachowanie (imię/nazwa). Nierozwiązane pola degradują się łagodnie.
        </p>
      </Field>

      {/* Predefiniowane właściwości zespołu — ukryte dla klienta. */}
      <TeamPropsEditor
        value={settings.teamProps ?? []}
        onChange={(teamProps) => setSettings({ teamProps: teamProps.length ? teamProps : undefined })}
      />

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
          <MIcon name="mail" size={15} color={tokens.accent} />
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
                  <MIcon name="format_bold" size={13} />
                </button>
                <button type="button" onClick={() => applyWrap("<i>", "</i>")} style={fmtBtn} aria-label="Kursywa" title="Kursywa">
                  <MIcon name="format_italic" size={13} />
                </button>
                <button type="button" onClick={insertLink} style={{ ...fmtBtn, width: "auto", padding: "0 10px", gap: 6, display: "inline-flex", alignItems: "center" }} title="Wstaw link">
                  <MIcon name="link" size={13} /> Link
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

      {/* §9 — Meta Conversions (Pixel + CAPI) + webhook. W nowym układzie Meta
          i webhook żyją w zakładce „Integracje"; tu pokazujemy je tylko gdy
          panel jest używany samodzielnie (showMeta). */}
      {showMeta && (
        <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 14, marginTop: 4 }}>
          <span style={{ ...paneTitle, display: "block", marginBottom: 10 }}>Meta Conversions & webhook</span>
          <MetaSettings formId={formId} />
        </div>
      )}
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
