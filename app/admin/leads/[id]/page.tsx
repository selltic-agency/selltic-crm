// app/admin/leads/[id]/page.tsx — strona deala w układzie HubSpot (Faza 10.1).
//
// Podział na dwa wizualnie oddzielone panele wypełniające 100vh:
//   • LEWY  — tożsamość deala (nazwa, kontakt), przyciski akcji (notatka /
//             zadanie otwierają popup nad osią czasu; e-mail / kalendarz
//             wyłączone, pod przyszłą integrację Google), etap oraz
//             konfigurowalne właściwości. Kolejność właściwości jest WSPÓLNA
//             dla wszystkich deali (zapis do property_defs.position) — zmiana
//             tutaj zmienia widok każdego deala, nie tylko bieżącego.
//   • PRAWY — kanał aktywności (notatki, telefony, e-maile, zadania, zmiany
//             etapu). Kolory sygnalizują status: czerwony = zaległe zadanie,
//             zielony = wykonane, pomarańczowy = nadchodzące. Wpisy można
//             edytować i usuwać, a zadania odhaczać wprost na osi czasu.
// Każdy panel przewija się niezależnie; cała strona mieści się w 100vh.
// Na wąskich ekranach panele układają się jeden pod drugim (responsywność).
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Reorder, useDragControls } from "framer-motion";
import {
  ArrowLeft,
  StickyNote,
  Phone,
  Mail,
  FileText,
  CircleDot,
  CheckSquare,
  PhoneCall,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Circle,
  GripVertical,
  GitBranch,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  tokens,
  inputStyle,
  primaryButton,
  ghostButton,
  formatDateTime,
  toDatetimeLocal,
} from "@/lib/ui";
import {
  type Activity,
  type ActivityType,
  type Assignee,
  type Deal,
  type PropertyDef,
  type Stage,
  type Task,
} from "@/lib/types";
import { useStages } from "@/lib/stages";
import { useClassification } from "@/lib/classification";
import { useIsMobile } from "@/lib/responsive";
import { useToast } from "@/components/Toast";
import { ScoreBreakdownList } from "@/components/ScoreBreakdown";
import { CategoryBadge } from "@/components/ClassificationBadges";
import { parseScoreBreakdown } from "@/lib/scoreBreakdown";

// Wysokość szkieletu panelu: topbar (64) + pionowy padding .selltic-main
// (28+28) trzeba odjąć od 100vh, żeby dwa panele zmieściły się bez
// przewijania całej strony. Wartości pochodzą z shell.tsx i globals.css.
const DESKTOP_PAGE_H = "calc(100vh - 120px)";
// Poniżej tej szerokości panele układają się pionowo (kolumny są za ciasne).
const STACK_BREAKPOINT = 1024;

// Stan modala kompozytora: tworzenie notatki/zadania lub edycja istniejącego
// wpisu osi czasu. Popup otwiera się nad kanałem aktywności.
type Composer =
  | { open: false }
  | { open: true; editor: "text"; mode: "create" }
  | { open: true; editor: "text"; mode: "edit"; activity: Activity }
  | { open: true; editor: "task"; mode: "create" }
  | { open: true; editor: "task"; mode: "edit"; task: Task };

// Typy aktywności, których treść można edytować. Systemowe (stage/submission)
// wolno tylko usuwać.
const EDITABLE_ACTIVITY_TYPES = new Set<string>(["note", "call", "email"]);

const ACTIVITY_ICON: Record<string, typeof StickyNote> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  submission: FileText,
  stage: GitBranch,
  task: CheckSquare,
};

const ACTIVITY_LABEL: Record<string, string> = {
  note: "Notatka",
  call: "Telefon",
  email: "E-mail",
  submission: "Zgłoszenie",
  stage: "Zmiana etapu",
  task: "Zadanie",
};

// Kolor „akcentu” aktywności wg typu (dla ikony w osi czasu).
const ACTIVITY_COLOR: Record<string, string> = {
  note: tokens.accent,
  call: "#1A73E7",
  email: "#00A3A3",
  submission: tokens.accent,
  stage: "#64748B",
};

// ── Model osi czasu ──────────────────────────────────────────────────────
// Łączymy zadania (tabela tasks — niosą due_at + done, potrzebne do koloru
// zaległości) z pozostałymi aktywnościami (activities bez typu 'task', żeby
// nie dublować). Każdy element ma znormalizowaną datę do grupowania.
type FeedItem =
  | { kind: "task"; id: string; date: number; task: Task }
  | { kind: "activity"; id: string; date: number; activity: Activity };

export default function DealPage() {
  const params = useParams<{ id: string }>();
  const dealId = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromCalling = searchParams.get("from") === "calling";
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { stages, stageMeta } = useStages();
  const { categories } = useClassification();
  const isNarrow = useIsMobile(STACK_BREAKPOINT);

  const [deal, setDeal] = useState<Deal | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [propertyDefs, setPropertyDefs] = useState<PropertyDef[]>([]);
  const [loading, setLoading] = useState(true);

  const [composer, setComposer] = useState<Composer>({ open: false });

  // ── Sekcje z wsadową edycją: lokalny szkic + jeden przycisk „Zapisz” dla
  // całej sekcji (zamiast zapisu przy każdej zmianie pola). Szkic resetuje
  // się tylko przy wczytaniu NOWEGO deala (dependency na id, nie na całym
  // obiekcie deal) — dzięki temu niezapisany szkic nie ginie przy innych
  // akcjach na stronie (np. zmianie etapu, która też robi setDeal(...)).
  const [contactDraft, setContactDraft] = useState({ name: "", company: "", email: "", phone: "" });
  const [contactSaving, setContactSaving] = useState(false);
  const [contactSavedAt, setContactSavedAt] = useState<number | null>(null);

  const [propsDraft, setPropsDraft] = useState<{ value: string; assignee: Assignee | ""; category: string; custom: Record<string, string> }>({
    value: "",
    assignee: "",
    category: "",
    custom: {},
  });
  const [propsSaving, setPropsSaving] = useState(false);
  const [propsSavedAt, setPropsSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!deal) return;
    setContactDraft({
      name: deal.name ?? "",
      company: deal.company ?? "",
      email: deal.email ?? "",
      phone: deal.phone ?? "",
    });
    setPropsDraft({
      value: deal.value ? String(deal.value) : "",
      assignee: deal.assignee ?? "",
      category: deal.category ?? "",
      custom: { ...(deal.props ?? {}) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id]);

  const contactDirty =
    !!deal &&
    (contactDraft.name !== (deal.name ?? "") ||
      contactDraft.company !== (deal.company ?? "") ||
      contactDraft.email !== (deal.email ?? "") ||
      contactDraft.phone !== (deal.phone ?? ""));

  const propsDirty =
    !!deal &&
    (propsDraft.value !== (deal.value ? String(deal.value) : "") ||
      propsDraft.assignee !== (deal.assignee ?? "") ||
      propsDraft.category !== (deal.category ?? "") ||
      propertyDefs.some((d) => (propsDraft.custom[d.key] ?? "") !== (deal.props?.[d.key] ?? "")));

  const propTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lekkie odświeżenie samej osi czasu (bez pełnego spinnera strony).
  const reloadFeed = useCallback(async () => {
    const [{ data: a }, { data: t }] = await Promise.all([
      supabase
        .from("activities")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false }),
    ]);
    setActivities((a as Activity[]) ?? []);
    setTasks((t as Task[]) ?? []);
  }, [supabase, dealId]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: d }, { data: defs }] = await Promise.all([
      supabase.from("deals").select("*").eq("id", dealId).single(),
      supabase.from("property_defs").select("*").order("position", { ascending: true }),
    ]);

    const dealRow = d as Deal | null;
    setDeal(dealRow ?? null);
    setPropertyDefs((defs as PropertyDef[]) ?? []);
    if (dealRow) await reloadFeed();
    setLoading(false);
  }, [supabase, dealId, reloadFeed]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStage(stage: Stage) {
    if (!deal || deal.stage === stage) return;
    const prev = deal;
    const meta = stageMeta(stage);
    const terminal = isTerminal(stage);
    // closed_at ustawiamy wchodząc na etap wygrany/przegrany; czyścimy wychodząc.
    const closed_at = terminal ? new Date().toISOString() : null;
    setDeal({ ...deal, stage, closed_at });

    const { error } = await supabase
      .from("deals")
      .update({ stage, closed_at })
      .eq("id", deal.id);
    if (error) {
      setDeal(prev);
      toast.error("Nie udało się zmienić etapu.");
      return;
    }
    await supabase.from("activities").insert({
      owner: deal.owner,
      deal_id: deal.id,
      type: "stage",
      body: `Etap zmieniony na: ${meta.label}`,
    });
    reloadFeed();
  }

  // Zwraca true, gdy etap jest terminalny (wygrany lub przegrany).
  function isTerminal(key: Stage): boolean {
    const s = stages.find((x) => x.key === key);
    return !!(s?.is_won || s?.is_lost);
  }

  // Zapis całej sekcji „Dane kontaktowe” jednym zapytaniem, jednym kliknięciem.
  async function saveContact() {
    if (!deal || !contactDirty || contactSaving) return;
    setContactSaving(true);
    const patch = {
      name: contactDraft.name.trim() || null,
      company: contactDraft.company.trim() || null,
      email: contactDraft.email.trim() || null,
      phone: contactDraft.phone.trim() || null,
    };
    const { error } = await supabase.from("deals").update(patch).eq("id", deal.id);
    setContactSaving(false);
    if (error) {
      toast.error("Nie udało się zapisać danych kontaktowych.");
      return;
    }
    setDeal({ ...deal, ...patch });
    setContactSavedAt(Date.now());
    setTimeout(() => setContactSavedAt(null), 2000);
  }

  // Zapis całej sekcji „Właściwości” (wbudowane + konfigurowalne) jednym zapytaniem.
  async function saveProps() {
    if (!deal || !propsDirty || propsSaving) return;
    setPropsSaving(true);
    const value = propsDraft.value ? Number(propsDraft.value) : 0;
    const assignee = propsDraft.assignee || null;
    const category = propsDraft.category || null;
    const props = { ...(deal.props ?? {}) };
    for (const def of propertyDefs) {
      const v = (propsDraft.custom[def.key] ?? "").trim();
      if (v === "") delete props[def.key];
      else props[def.key] = v;
    }
    const { error } = await supabase.from("deals").update({ value, assignee, category, props }).eq("id", deal.id);
    setPropsSaving(false);
    if (error) {
      toast.error("Nie udało się zapisać właściwości.");
      return;
    }
    setDeal({ ...deal, value, assignee, category, props });
    setPropsSavedAt(Date.now());
    setTimeout(() => setPropsSavedAt(null), 2000);
  }

  // Nowa kolejność właściwości → zapis position do property_defs (globalnie,
  // dla wszystkich deali). Debounce, bo onReorder strzela często podczas drag.
  function persistPropOrder(next: PropertyDef[]) {
    setPropertyDefs(next);
    if (propTimer.current) clearTimeout(propTimer.current);
    propTimer.current = setTimeout(() => {
      Promise.all(
        next.map((d, i) =>
          d.position === i
            ? Promise.resolve()
            : supabase.from("property_defs").update({ position: i }).eq("id", d.id)
        )
      );
    }, 500);
  }

  // Przełączenie stanu wykonania zadania z poziomu osi czasu (optymistycznie).
  async function toggleTask(t: Task) {
    const done = !t.done;
    setTasks((list) => list.map((x) => (x.id === t.id ? { ...x, done } : x)));
    const { error } = await supabase.from("tasks").update({ done }).eq("id", t.id);
    if (error) {
      setTasks((list) => list.map((x) => (x.id === t.id ? { ...x, done: t.done } : x)));
      toast.error("Nie udało się zaktualizować zadania.");
    }
  }

  // ── Kompozytor / edycja / usuwanie wpisów osi czasu ────────────────────
  async function createNote(text: string) {
    if (!deal) return;
    const { error } = await supabase.from("activities").insert({
      owner: deal.owner,
      deal_id: deal.id,
      type: "note" as ActivityType,
      body: text,
    });
    if (error) {
      toast.error("Nie udało się zapisać notatki.");
      return;
    }
    await reloadFeed();
    toast.success("Notatka dodana.");
  }

  async function updateActivity(id: string, text: string) {
    const { error } = await supabase.from("activities").update({ body: text }).eq("id", id);
    if (error) {
      toast.error("Nie udało się zapisać zmian.");
      return;
    }
    await reloadFeed();
    toast.success("Zapisano zmiany.");
  }

  async function createTask(title: string, due_at: string | null) {
    if (!deal) return;
    const { error } = await supabase.from("tasks").insert({
      owner: deal.owner,
      deal_id: deal.id,
      title,
      due_at,
    });
    if (error) {
      toast.error("Nie udało się dodać zadania.");
      return;
    }
    await supabase.from("activities").insert({
      owner: deal.owner,
      deal_id: deal.id,
      type: "task",
      body: title,
      meta: due_at ? { due_at } : null,
    });
    await reloadFeed();
    toast.success("Zadanie dodane.");
  }

  async function updateTask(
    id: string,
    patch: { title: string; due_at: string | null; done: boolean }
  ) {
    // Optymistyczna aktualizacja, żeby oś czasu odświeżyła się natychmiast.
    setTasks((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) {
      toast.error("Nie udało się zapisać zmian.");
      await reloadFeed();
      return;
    }
    toast.success("Zapisano zmiany.");
  }

  function editItem(item: FeedItem) {
    if (item.kind === "task") setComposer({ open: true, editor: "task", mode: "edit", task: item.task });
    else setComposer({ open: true, editor: "text", mode: "edit", activity: item.activity });
  }

  async function deleteItem(item: FeedItem) {
    if (item.kind === "task") {
      if (!window.confirm("Usunąć to zadanie?")) return;
      setTasks((list) => list.filter((x) => x.id !== item.task.id));
      const { error } = await supabase.from("tasks").delete().eq("id", item.task.id);
      if (error) {
        toast.error("Nie udało się usunąć zadania.");
        await reloadFeed();
        return;
      }
      toast.success("Zadanie usunięte.");
    } else {
      if (!window.confirm("Usunąć ten wpis z osi czasu?")) return;
      setActivities((list) => list.filter((x) => x.id !== item.activity.id));
      const { error } = await supabase.from("activities").delete().eq("id", item.activity.id);
      if (error) {
        toast.error("Nie udało się usunąć wpisu.");
        await reloadFeed();
        return;
      }
      toast.success("Wpis usunięty.");
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      </div>
    );
  }

  if (!deal) {
    return (
      <div style={{ padding: 24 }}>
        <BackLink router={router} />
        <p style={{ color: tokens.danger, marginTop: 16 }}>Nie znaleziono deala.</p>
      </div>
    );
  }

  const dealName = deal.name || "Bez nazwy";
  const currentStage = stageMeta(deal.stage);

  // ── Kontener strony ────────────────────────────────────────────────────
  // Desktop: 100vh, dwie kolumny, każdy panel przewija się w środku.
  // Wąski ekran: panele jeden pod drugim, przewija się cała strona.
  const containerStyle: CSSProperties = isNarrow
    ? { display: "flex", flexDirection: "column", gap: 16 }
    : {
        height: DESKTOP_PAGE_H,
        display: "grid",
        gridTemplateColumns: "minmax(300px, 380px) minmax(0, 1fr)",
        gap: 16,
      };

  return (
    <div style={containerStyle}>
      {/* ── LEWY PANEL: tożsamość + akcje + właściwości ───────────────── */}
      <Panel fill={!isNarrow}>
        {/* Nagłówek panelu (nie przewija się) */}
        <div
          style={{
            flexShrink: 0,
            padding: "16px 18px",
            borderBottom: `1px solid ${tokens.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <BackLink router={router} />
            {fromCalling && (
              <button
                onClick={() => router.push("/admin/prospecting?calling=1")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: tokens.accent,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <PhoneCall size={13} /> Dzwonienie
              </button>
            )}
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "10px 0 8px", lineHeight: 1.25 }}>
            {dealName}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 11px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                color: "#fff",
                background: currentStage.color,
              }}
            >
              {currentStage.label}
            </span>
            {deal.category && <CategoryBadge categoryKey={deal.category} />}
            <span style={{ fontSize: 12.5, color: tokens.muted }}>
              Otwarty {formatDateTime(deal.opened_at)}
              {deal.closed_at ? ` · Zamknięty ${formatDateTime(deal.closed_at)}` : ""}
            </span>
          </div>
        </div>

        {/* Treść przewijalna */}
        <div className="selltic-scroll-y" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18 }}>
          {/* Przyciski akcji — Notatka / Zadanie otwierają popup nad osią czasu.
              E-mail / Kalendarz wyłączone (pod przyszłą integrację Google). */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
            <ActionButton
              icon={StickyNote}
              label="Notatka"
              onClick={() => setComposer({ open: true, editor: "text", mode: "create" })}
            />
            <ActionButton
              icon={CheckSquare}
              label="Zadanie"
              onClick={() => setComposer({ open: true, editor: "task", mode: "create" })}
            />
            <ActionButton icon={Mail} label="E-mail" disabled title="Wkrótce — integracja Google" />
            <ActionButton icon={Calendar} label="Kalendarz" disabled title="Wkrótce — integracja Google" />
          </div>

          {/* Kontakt / tożsamość — edycja wsadowa: jeden „Zapisz” dla całej sekcji */}
          <SectionTitle>Dane kontaktowe</SectionTitle>
          <div style={{ display: "grid", gap: 12, marginBottom: 10 }}>
            <FieldLabel label="Nazwa / osoba">
              <input
                value={contactDraft.name}
                onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))}
                style={inputStyle}
              />
            </FieldLabel>
            <FieldLabel label="Firma">
              <input
                value={contactDraft.company}
                onChange={(e) => setContactDraft((d) => ({ ...d, company: e.target.value }))}
                style={inputStyle}
              />
            </FieldLabel>
            <FieldLabel label="E-mail">
              <input
                type="email"
                value={contactDraft.email}
                onChange={(e) => setContactDraft((d) => ({ ...d, email: e.target.value }))}
                style={inputStyle}
              />
            </FieldLabel>
            <FieldLabel label="Telefon">
              <input
                value={contactDraft.phone}
                onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
                style={inputStyle}
              />
            </FieldLabel>
          </div>
          <SectionSaveBar
            dirty={contactDirty}
            saving={contactSaving}
            savedAt={contactSavedAt}
            onSave={saveContact}
            style={{ marginBottom: 22 }}
          />

          {/* Etap lejka */}
          <SectionTitle>Etap</SectionTitle>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
            {stages.map((s) => {
              const active = deal.stage === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => changeStage(s.key)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${active ? s.color : tokens.border}`,
                    background: active ? s.color : "#fff",
                    color: active ? "#fff" : tokens.muted,
                    transition: `all .15s ${tokens.ease}`,
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Właściwości deala (wbudowane + konfigurowalne) — edycja wsadowa:
              zmień dowolną liczbę pól i zapisz je jednym kliknięciem. Kolejność
              (drag) nadal zapisuje się od razu — to bezpośrednia manipulacja,
              nie pole formularza. */}
          <SectionTitle>Właściwości</SectionTitle>
          <div style={{ display: "grid", gap: 12, marginBottom: 10 }}>
            <FieldLabel label="Wartość (zł)">
              <input
                type="number"
                value={propsDraft.value}
                onChange={(e) => setPropsDraft((d) => ({ ...d, value: e.target.value }))}
                style={inputStyle}
              />
            </FieldLabel>
            <FieldLabel label="Deal Owner">
              <select
                value={propsDraft.assignee}
                onChange={(e) => setPropsDraft((d) => ({ ...d, assignee: e.target.value as Assignee | "" }))}
                style={inputStyle}
              >
                <option value="">Nieprzypisany</option>
                <option value="dominik">Dominik</option>
                <option value="kuba">Kuba</option>
              </select>
            </FieldLabel>
            {/* Kategoria branży (Feature 1) — przeniesiona z prospektu, edytowalna. */}
            <FieldLabel label="Kategoria branży">
              <select
                value={propsDraft.category}
                onChange={(e) => setPropsDraft((d) => ({ ...d, category: e.target.value }))}
                style={inputStyle}
              >
                <option value="">— brak —</option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </div>

          {/* Konfigurowalne właściwości — przeciągnij, by zmienić kolejność.
              Kolejność jest wspólna dla wszystkich deali. */}
          {propertyDefs.length > 0 ? (
            <>
              <Reorder.Group
                axis="y"
                values={propertyDefs}
                onReorder={persistPropOrder}
                style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}
              >
                {propertyDefs.map((def) => (
                  <PropertyReorderRow
                    key={def.id}
                    def={def}
                    value={propsDraft.custom[def.key] ?? ""}
                    onChange={(v) =>
                      setPropsDraft((d) => ({ ...d, custom: { ...d.custom, [def.key]: v } }))
                    }
                  />
                ))}
              </Reorder.Group>
              <p style={{ fontSize: 11.5, color: tokens.muted, margin: "10px 0 0" }}>
                Przeciągnij <GripVertical size={11} style={{ verticalAlign: "-1px" }} />, by zmienić kolejność — dotyczy wszystkich deali.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 13, color: tokens.muted, margin: 0 }}>
              Brak własnych właściwości. Dodaj je w Ustawieniach → Właściwości.
            </p>
          )}

          <SectionSaveBar
            dirty={propsDirty}
            saving={propsSaving}
            savedAt={propsSavedAt}
            onSave={saveProps}
            style={{ marginTop: 14 }}
          />

          {/* Dane z Google Maps (tylko dla deali ze scrapera) */}
          <ProspectingDataCard deal={deal} />
        </div>
      </Panel>

      {/* ── PRAWY PANEL: oś czasu aktywności ──────────────────────────── */}
      <Panel fill={!isNarrow}>
        <div
          style={{
            flexShrink: 0,
            padding: "16px 18px",
            borderBottom: `1px solid ${tokens.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Aktywność</h2>
          <StatusLegend />
        </div>
        <div
          className="selltic-scroll-y"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: 18,
            background: tokens.bg,
          }}
        >
          <ActivityFeed
            activities={activities}
            tasks={tasks}
            onToggleTask={toggleTask}
            onEdit={editItem}
            onDelete={deleteItem}
          />
        </div>
      </Panel>

      {/* Popup kompozytora / edycji, wyśrodkowany nad osią czasu */}
      {composer.open && (
        <ComposerModal
          key={composerKey(composer)}
          composer={composer}
          onClose={() => setComposer({ open: false })}
          handlers={{ createNote, updateActivity, createTask, updateTask }}
        />
      )}
    </div>
  );
}

/* ── Panel (karta z wewnętrznym przewijaniem) ───────────────────────────── */
function Panel({ fill, children }: { fill: boolean; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        boxShadow: "0 1px 2px rgba(15,18,28,0.04)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        // Na wąskim ekranie panel rośnie z treścią (przewija się cała strona),
        // ograniczamy tylko wysokość osi czasu, by nie była nieskończona.
        ...(fill ? {} : { maxHeight: "calc(100vh - 96px)" }),
      }}
    >
      {children}
    </section>
  );
}

/* ── Przycisk akcji (Notatka / Zadanie / E-mail / Kalendarz) ────────────── */
function ActionButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  title,
  onClick,
}: {
  icon: typeof StickyNote;
  label: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 9,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        border: `1px solid ${active ? tokens.accent : tokens.border}`,
        background: active ? tokens.accentSoft : "#fff",
        color: disabled ? "#B7BECC" : active ? tokens.accent : tokens.text,
        transition: `all .15s ${tokens.ease}`,
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

/* ── Wiersz właściwości z uchwytem do przeciągania ──────────────────────── */
function PropertyReorderRow({
  def,
  value,
  onChange,
}: {
  def: PropertyDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={def}
      dragListener={false}
      dragControls={controls}
      style={{ listStyle: "none", display: "flex", alignItems: "flex-start", gap: 8 }}
    >
      <button
        onPointerDown={(e) => controls.start(e)}
        aria-label="Przeciągnij, by zmienić kolejność"
        style={{
          marginTop: 22,
          border: "none",
          background: "none",
          cursor: "grab",
          padding: 0,
          color: tokens.muted,
          touchAction: "none",
          flexShrink: 0,
        }}
      >
        <GripVertical size={15} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <FieldLabel label={def.key}>
          <PropertyInput def={def} value={value} onChange={onChange} />
        </FieldLabel>
      </div>
    </Reorder.Item>
  );
}

// Pole właściwości renderowane wg typu (tekst / liczba / data / lista).
function PropertyInput({
  def,
  value,
  onChange,
}: {
  def: PropertyDef;
  value: string;
  onChange: (value: string) => void;
}) {
  if (def.type === "select") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">—</option>
        {(def.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  const type = def.type === "number" ? "number" : def.type === "date" ? "date" : "text";
  return (
    <input
      type={type}
      defaultValue={value}
      onBlur={(e) => onChange(e.target.value.trim())}
      style={inputStyle}
    />
  );
}

/* ── Oś czasu ────────────────────────────────────────────────────────────
   Łączy zadania i aktywności, grupuje na „Zaległe” + kolejne miesiące. */
function ActivityFeed({
  activities,
  tasks,
  onToggleTask,
  onEdit,
  onDelete,
}: {
  activities: Activity[];
  tasks: Task[];
  onToggleTask: (t: Task) => void;
  onEdit: (item: FeedItem) => void;
  onDelete: (item: FeedItem) => void;
}) {
  const now = Date.now();

  const items: FeedItem[] = useMemo(() => {
    const list: FeedItem[] = [];
    for (const t of tasks) {
      const date = t.due_at ? new Date(t.due_at).getTime() : new Date(t.created_at).getTime();
      list.push({ kind: "task", id: `task-${t.id}`, date, task: t });
    }
    for (const a of activities) {
      // Zadania mają własny wpis (z tasks) — nie dublujemy przez activities.
      if (a.type === "task") continue;
      list.push({ kind: "activity", id: `act-${a.id}`, date: new Date(a.created_at).getTime(), activity: a });
    }
    return list;
  }, [activities, tasks]);

  // Zaległe = niewykonane zadania po terminie. Reszta grupowana po miesiącu.
  const { overdue, groups } = useMemo(() => {
    const overdue: FeedItem[] = [];
    const rest: FeedItem[] = [];
    for (const it of items) {
      const isOverdue =
        it.kind === "task" && !it.task.done && it.task.due_at && new Date(it.task.due_at).getTime() < now;
      (isOverdue ? overdue : rest).push(it);
    }
    overdue.sort((a, b) => a.date - b.date); // najstarsze zaległe u góry
    rest.sort((a, b) => b.date - a.date);

    const groups: { label: string; items: FeedItem[] }[] = [];
    for (const it of rest) {
      const label = monthLabel(it.date);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(it);
      else groups.push({ label, items: [it] });
    }
    return { overdue, groups };
  }, [items, now]);

  if (items.length === 0) {
    return <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>Brak aktywności.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 22 }}>
      {overdue.length > 0 && (
        <FeedGroup label="Zaległe" danger>
          {overdue.map((it) => (
            <FeedRow key={it.id} item={it} now={now} onToggleTask={onToggleTask} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </FeedGroup>
      )}
      {groups.map((g) => (
        <FeedGroup key={g.label} label={g.label}>
          {g.items.map((it) => (
            <FeedRow key={it.id} item={it} now={now} onToggleTask={onToggleTask} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </FeedGroup>
      ))}
    </div>
  );
}

function FeedGroup({
  label,
  danger = false,
  children,
}: {
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: danger ? "uppercase" : "capitalize",
          color: danger ? tokens.danger : tokens.muted,
          margin: "0 0 12px",
        }}
      >
        {label}
      </div>
      <div style={{ display: "grid", gap: 10 }}>{children}</div>
    </div>
  );
}

// Pojedynczy wpis osi czasu (zadanie lub aktywność).
function FeedRow({
  item,
  now,
  onToggleTask,
  onEdit,
  onDelete,
}: {
  item: FeedItem;
  now: number;
  onToggleTask: (t: Task) => void;
  onEdit: (item: FeedItem) => void;
  onDelete: (item: FeedItem) => void;
}) {
  if (item.kind === "task") {
    const t = item.task;
    const overdue = !t.done && !!t.due_at && new Date(t.due_at).getTime() < now;
    const color = t.done ? tokens.success : overdue ? tokens.danger : tokens.warning;
    const Icon = t.done ? CheckCircle2 : overdue ? AlertCircle : Circle;
    const stripe = overdue ? tokens.danger : t.done ? tokens.success : tokens.warning;

    return (
      <Row stripe={stripe}>
        <button
          onClick={() => onToggleTask(t)}
          aria-label={t.done ? "Oznacz jako niewykonane" : "Oznacz jako wykonane"}
          title={t.done ? "Oznacz jako niewykonane" : "Oznacz jako wykonane"}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            flexShrink: 0,
            border: "none",
            cursor: "pointer",
            background: hexSoft(color),
            color,
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon size={16} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color }}>
              Zadanie
            </span>
            {overdue && <StatusChip color={tokens.danger}>Zaległe</StatusChip>}
            {t.done && <StatusChip color={tokens.success}>Wykonane</StatusChip>}
          </div>
          <div
            style={{
              fontSize: 14,
              marginTop: 2,
              fontWeight: 600,
              textDecoration: t.done ? "line-through" : "none",
              color: t.done ? tokens.muted : tokens.text,
            }}
          >
            {t.title}
          </div>
          {t.due_at && (
            <div style={{ fontSize: 12, marginTop: 3, color: overdue ? tokens.danger : tokens.muted, fontWeight: overdue ? 600 : 400 }}>
              Termin: {formatDateTime(t.due_at)}
            </div>
          )}
        </div>
        <RowActions
          onToggleComplete={() => onToggleTask(t)}
          completed={t.done}
          onEdit={() => onEdit(item)}
          onDelete={() => onDelete(item)}
          editLabel="Edytuj zadanie"
        />
      </Row>
    );
  }

  const a = item.activity;
  const Icon = ACTIVITY_ICON[a.type] ?? CircleDot;
  const color = ACTIVITY_COLOR[a.type] ?? tokens.accent;
  const editable = EDITABLE_ACTIVITY_TYPES.has(a.type);

  return (
    <Row stripe={color}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          flexShrink: 0,
          background: hexSoft(color),
          color,
          display: "grid",
          placeItems: "center",
        }}
      >
        <Icon size={15} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color }}>
            {ACTIVITY_LABEL[a.type] ?? a.type}
          </span>
          <span style={{ fontSize: 12, color: tokens.muted }}>{formatDateTime(a.created_at)}</span>
        </div>
        {a.body && (
          <div style={{ fontSize: 14, marginTop: 2, whiteSpace: "pre-wrap", color: tokens.text }}>{a.body}</div>
        )}
      </div>
      <RowActions onEdit={editable ? () => onEdit(item) : undefined} onDelete={() => onDelete(item)} />
    </Row>
  );
}

// Przyciski akcji po prawej stronie wpisu osi czasu: dla zadań dochodzi
// jawny przycisk „Oznacz jako wykonane” — osobny od edycji, żeby nie trzeba
// było wchodzić w popup edycji tylko po to, by odhaczyć zadanie.
function RowActions({
  onToggleComplete,
  completed,
  onEdit,
  onDelete,
  editLabel = "Edytuj",
}: {
  onToggleComplete?: () => void;
  completed?: boolean;
  onEdit?: () => void;
  onDelete: () => void;
  editLabel?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      {onToggleComplete && (
        <IconAction
          icon={completed ? Circle : CheckCircle2}
          label={completed ? "Oznacz jako niewykonane" : "Oznacz jako wykonane"}
          active={!completed}
          onClick={onToggleComplete}
        />
      )}
      {onEdit && <IconAction icon={Pencil} label={editLabel} onClick={onEdit} />}
      <IconAction icon={Trash2} label="Usuń" danger onClick={onDelete} />
    </div>
  );
}

function IconAction({
  icon: Icon,
  label,
  danger = false,
  active = false,
  onClick,
}: {
  icon: typeof Pencil;
  label: string;
  danger?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        flexShrink: 0,
        border: `1px solid ${danger ? tokens.danger : active ? tokens.success : tokens.border}`,
        background: active ? hexSoft(tokens.success) : "#fff",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        color: danger ? tokens.danger : active ? tokens.success : tokens.muted,
      }}
    >
      <Icon size={14} />
    </button>
  );
}

/* ── Popup kompozytora / edycji ─────────────────────────────────────────
   Jeden modal obsługuje: nową notatkę, edycję notatki/telefonu/e-maila,
   nowe zadanie oraz edycję zadania (tytuł, termin, wykonane). */
type ComposerOpen = Extract<Composer, { open: true }>;

function composerKey(c: ComposerOpen): string {
  if (c.mode === "create") return `${c.editor}-create`;
  return c.editor === "task" ? `task-${c.task.id}` : `text-${c.activity.id}`;
}

function ComposerModal({
  composer,
  onClose,
  handlers,
}: {
  composer: ComposerOpen;
  onClose: () => void;
  handlers: {
    createNote: (text: string) => Promise<void>;
    updateActivity: (id: string, text: string) => Promise<void>;
    createTask: (title: string, dueAt: string | null) => Promise<void>;
    updateTask: (id: string, patch: { title: string; due_at: string | null; done: boolean }) => Promise<void>;
  };
}) {
  const isTask = composer.editor === "task";
  const [saving, setSaving] = useState(false);
  const [body, setBody] = useState(
    composer.editor === "text" && composer.mode === "edit" ? composer.activity.body ?? "" : ""
  );
  const [title, setTitle] = useState(
    composer.editor === "task" && composer.mode === "edit" ? composer.task.title : ""
  );
  const [due, setDue] = useState(
    composer.editor === "task" && composer.mode === "edit" ? toDatetimeLocal(composer.task.due_at) : ""
  );
  const [done, setDone] = useState(
    composer.editor === "task" && composer.mode === "edit" ? composer.task.done : false
  );

  const heading =
    composer.editor === "task"
      ? composer.mode === "edit"
        ? "Edytuj zadanie"
        : "Nowe zadanie"
      : composer.mode === "edit"
      ? `Edytuj: ${ACTIVITY_LABEL[composer.activity.type] ?? "wpis"}`
      : "Nowa notatka";

  async function submit() {
    if (saving) return;
    if (composer.editor === "task") {
      if (!title.trim()) return;
      setSaving(true);
      const dueAt = due ? new Date(due).toISOString() : null;
      if (composer.mode === "create") await handlers.createTask(title.trim(), dueAt);
      else await handlers.updateTask(composer.task.id, { title: title.trim(), due_at: dueAt, done });
    } else {
      if (!body.trim()) return;
      setSaving(true);
      if (composer.mode === "create") await handlers.createNote(body.trim());
      else await handlers.updateActivity(composer.activity.id, body.trim());
    }
    setSaving(false);
    onClose();
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 40 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "14%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "min(76vh, calc(100vh - 120px))",
          overflowY: "auto",
          background: tokens.card,
          borderRadius: tokens.radius,
          border: `1px solid ${tokens.border}`,
          boxShadow: "0 24px 60px rgba(15,18,28,0.18)",
          zIndex: 41,
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{heading}</h2>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}
          >
            <X size={15} color={tokens.muted} />
          </button>
        </div>

        {isTask ? (
          <div style={{ display: "grid", gap: 12 }}>
            <FieldLabel label="Tytuł zadania">
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
            </FieldLabel>
            <FieldLabel label="Termin">
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={inputStyle} />
            </FieldLabel>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, color: tokens.text }}>
              <input
                type="checkbox"
                checked={done}
                onChange={(e) => setDone(e.target.checked)}
                style={{ accentColor: tokens.success, width: 16, height: 16 }}
              />
              Oznacz jako wykonane
            </label>
          </div>
        ) : (
          <FieldLabel label="Treść">
            <textarea
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </FieldLabel>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={ghostButton}>
            Anuluj
          </button>
          <button onClick={submit} disabled={saving} style={primaryButton}>
            {saving ? "Zapisywanie…" : composer.mode === "edit" ? "Zapisz zmiany" : "Dodaj"}
          </button>
        </div>
      </div>
    </>
  );
}

// Karta wpisu z kolorowym paskiem statusu po lewej.
function Row({ stripe, children }: { stripe: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 11,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderLeft: `3px solid ${stripe}`,
        borderRadius: 10,
        padding: "11px 13px",
      }}
    >
      {children}
    </div>
  );
}

function StatusChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.3,
        textTransform: "uppercase",
        padding: "1px 7px",
        borderRadius: 999,
        color,
        background: hexSoft(color),
      }}
    >
      {children}
    </span>
  );
}

// Mała legenda kolorów w nagłówku osi czasu.
function StatusLegend() {
  const dot = (c: string) => (
    <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11.5, color: tokens.muted, flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{dot(tokens.danger)} Zaległe</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{dot(tokens.warning)} Nadchodzące</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{dot(tokens.success)} Wykonane</span>
    </div>
  );
}

/* ── Etykieta miesiąca (np. „lipiec 2026”), pierwsza litera wielka ──────── */
function monthLabel(ms: number): string {
  const s = new Date(ms).toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Miękkie (przezroczyste) tło z koloru hex — dla kafli ikon i chipów.
function hexSoft(hex: string): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return "rgba(108,92,231,0.12)";
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.12)`;
}

const WEBSITE_STATUS_LABEL: Record<string, string> = {
  none: "Brak strony",
  active: "Aktywna",
  broken: "Zepsuta",
  slow: "Wolna",
};

// Dane z Google Maps + wyjaśnienie lead score, przeniesione przy konwersji
// prospekt → deal. Renderuje się tylko, gdy deal faktycznie pochodzi ze scrapera.
function ProspectingDataCard({ deal }: { deal: Deal }) {
  const hasData =
    deal.lead_score != null ||
    !!deal.place_id ||
    !!deal.website ||
    deal.google_rating != null ||
    !!deal.address ||
    !!deal.business_status;
  if (!hasData) return null;

  const scoreReasonsFallback = (deal.props as Record<string, unknown> | null)?.score_reasons;
  const mapsUrl = (deal.props as Record<string, unknown> | null)?.google_maps_url as string | undefined;
  const hasBreakdown =
    parseScoreBreakdown(deal.lead_score_breakdown, scoreReasonsFallback).items.length > 0;

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${tokens.border}` }}>
      <SectionTitle>Dane z Google Maps</SectionTitle>
      <div style={{ display: "grid", gap: 10 }}>
        <DealRow label="Strona">
          {deal.website ? (
            <a href={deal.website} target="_blank" rel="noreferrer" style={{ color: tokens.accent }}>
              {deal.website}
            </a>
          ) : (
            <span style={{ color: tokens.success, fontWeight: 700 }}>Brak strony</span>
          )}
        </DealRow>
        {deal.website_status && (
          <DealRow label="Status strony">
            {WEBSITE_STATUS_LABEL[deal.website_status] ?? deal.website_status}
          </DealRow>
        )}
        <DealRow label="Adres">{deal.address || "—"}</DealRow>
        <DealRow label="Ocena">
          {deal.google_rating != null
            ? `⭐ ${deal.google_rating} (${deal.review_count ?? 0} opinii)`
            : "—"}
        </DealRow>
        <DealRow label="Branża">{deal.industry || "—"}</DealRow>
        <DealRow label="Miasto">{deal.city || "—"}</DealRow>
        <DealRow label="Status firmy">{deal.business_status || "—"}</DealRow>
        <DealRow label="Lead score">
          {deal.lead_score != null ? <b>{deal.lead_score}/100</b> : "—"}
        </DealRow>
        {hasBreakdown && (
          <DealRow label="Wyjaśnienie">
            <ScoreBreakdownList
              score={deal.lead_score ?? null}
              breakdown={deal.lead_score_breakdown}
              fallbackReasons={scoreReasonsFallback}
            />
          </DealRow>
        )}
      </div>
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            marginTop: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 14px",
            borderRadius: 10,
            background: tokens.accentSoft,
            color: tokens.accent,
            fontWeight: 700,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          Zobacz w Google Maps
        </a>
      )}
    </div>
  );
}

function DealRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <span style={{ width: 110, flexShrink: 0, fontSize: 13, color: tokens.muted, fontWeight: 600, paddingTop: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: tokens.text, minWidth: 0 }}>{children}</span>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: tokens.muted }}>{label}</span>
      {children}
    </label>
  );
}

// Pasek zapisu dla sekcji z wsadową edycją: jeden przycisk „Zapisz zmiany”
// dla dowolnej liczby pól naraz + jawny stan (niezapisane / zapisano ✓),
// żeby zawsze było wiadomo, czy zmiana faktycznie poszła do bazy.
function SectionSaveBar({
  dirty,
  saving,
  savedAt,
  onSave,
  style,
}: {
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  onSave: () => void;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, ...style }}>
      <button
        onClick={onSave}
        disabled={!dirty || saving}
        style={{
          ...primaryButton,
          padding: "8px 16px",
          fontSize: 13,
          opacity: dirty && !saving ? 1 : 0.5,
          cursor: dirty && !saving ? "pointer" : "not-allowed",
        }}
      >
        {saving ? "Zapisywanie…" : "Zapisz zmiany"}
      </button>
      {dirty ? (
        <span style={{ fontSize: 12.5, color: tokens.warning, fontWeight: 600 }}>Niezapisane zmiany</span>
      ) : savedAt ? (
        <span style={{ fontSize: 12.5, color: tokens.success, fontWeight: 600 }}>Zapisano ✓</span>
      ) : null}
    </div>
  );
}

function BackLink({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <button
      onClick={() => router.back()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        background: "none",
        cursor: "pointer",
        color: tokens.muted,
        fontSize: 13,
        fontWeight: 600,
        padding: 0,
      }}
    >
      <ArrowLeft size={16} />
      Wstecz
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: tokens.muted,
        margin: "0 0 12px",
      }}
    >
      {children}
    </h3>
  );
}
