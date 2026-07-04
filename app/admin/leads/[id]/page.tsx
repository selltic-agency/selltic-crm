// app/admin/leads/[id]/page.tsx — strona deala w układzie HubSpot (Faza 10.1).
//
// Podział na dwa wizualnie oddzielone panele wypełniające 100vh:
//   • LEWY  — tożsamość deala (nazwa, kontakt), przyciski akcji (notatka /
//             zadanie / telefon aktywne; e-mail / kalendarz wyłączone,
//             pod przyszłą integrację Google), etap oraz konfigurowalne
//             właściwości. Kolejność właściwości jest WSPÓLNA dla wszystkich
//             deali (zapis do property_defs.position) — zmiana tutaj zmienia
//             widok każdego deala, nie tylko bieżącego.
//   • PRAWY — kanał aktywności (notatki, telefony, e-maile, zadania, zmiany
//             etapu). Kolory sygnalizują status: czerwony = zaległe zadanie,
//             zielony = wykonane, pomarańczowy = nadchodzące.
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, formatDateTime } from "@/lib/ui";
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
import { useIsMobile } from "@/lib/responsive";
import { useToast } from "@/components/Toast";
import { ScoreBreakdownList } from "@/components/ScoreBreakdown";
import { parseScoreBreakdown } from "@/lib/scoreBreakdown";

// Wysokość szkieletu panelu: topbar (64) + pionowy padding .selltic-main
// (28+28) trzeba odjąć od 100vh, żeby dwa panele zmieściły się bez
// przewijania całej strony. Wartości pochodzą z shell.tsx i globals.css.
const DESKTOP_PAGE_H = "calc(100vh - 120px)";
// Poniżej tej szerokości panele układają się pionowo (kolumny są za ciasne).
const STACK_BREAKPOINT = 1024;

type ComposerTab = "note" | "call" | "task";

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
  const isNarrow = useIsMobile(STACK_BREAKPOINT);

  const [deal, setDeal] = useState<Deal | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [propertyDefs, setPropertyDefs] = useState<PropertyDef[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<ComposerTab>("note");
  const [body, setBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [saving, setSaving] = useState(false);

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

  async function saveField(field: "name" | "email" | "phone" | "company", value: string) {
    if (!deal) return;
    const clean = value.trim() || null;
    if (deal[field] === clean) return;
    setDeal({ ...deal, [field]: clean });
    await supabase.from("deals").update({ [field]: clean }).eq("id", deal.id);
  }

  async function saveValue(raw: string) {
    if (!deal) return;
    const value = raw ? Number(raw) : 0;
    if (Number(deal.value) === value) return;
    setDeal({ ...deal, value });
    await supabase.from("deals").update({ value }).eq("id", deal.id);
  }

  async function saveAssignee(raw: Assignee | "") {
    if (!deal) return;
    const assignee = raw || null;
    if (deal.assignee === assignee) return;
    setDeal({ ...deal, assignee });
    await supabase.from("deals").update({ assignee }).eq("id", deal.id);
  }

  // Zapis wartości właściwości konfigurowalnej (deals.props[key]).
  async function savePropValue(key: string, value: string) {
    if (!deal) return;
    const props = { ...(deal.props ?? {}) };
    if ((props[key] ?? "") === value) return;
    if (value === "") delete props[key];
    else props[key] = value;
    setDeal({ ...deal, props });
    await supabase.from("deals").update({ props }).eq("id", deal.id);
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

  async function saveActivity() {
    if (!deal || saving) return;

    if (tab === "task") {
      if (!taskTitle.trim()) return;
      setSaving(true);
      const due = taskDue ? new Date(taskDue).toISOString() : null;
      const { error } = await supabase.from("tasks").insert({
        owner: deal.owner,
        deal_id: deal.id,
        title: taskTitle.trim(),
        due_at: due,
      });
      if (!error) {
        await supabase.from("activities").insert({
          owner: deal.owner,
          deal_id: deal.id,
          type: "task",
          body: taskTitle.trim(),
          meta: due ? { due_at: due } : null,
        });
        setTaskTitle("");
        setTaskDue("");
        await reloadFeed();
        toast.success("Zadanie dodane.");
      } else {
        toast.error("Nie udało się dodać zadania.");
      }
      setSaving(false);
      return;
    }

    if (!body.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("activities").insert({
      owner: deal.owner,
      deal_id: deal.id,
      type: tab as ActivityType,
      body: body.trim(),
    });
    if (!error) {
      setBody("");
      await reloadFeed();
      toast.success("Aktywność dodana.");
    } else {
      toast.error("Nie udało się zapisać aktywności.");
    }
    setSaving(false);
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
            <span style={{ fontSize: 12.5, color: tokens.muted }}>
              Otwarty {formatDateTime(deal.opened_at)}
              {deal.closed_at ? ` · Zamknięty ${formatDateTime(deal.closed_at)}` : ""}
            </span>
          </div>
        </div>

        {/* Treść przewijalna */}
        <div className="selltic-scroll-y" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18 }}>
          {/* Przyciski akcji */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <ActionButton icon={StickyNote} label="Notatka" active={tab === "note"} onClick={() => setTab("note")} />
            <ActionButton icon={Phone} label="Telefon" active={tab === "call"} onClick={() => setTab("call")} />
            <ActionButton icon={CheckSquare} label="Zadanie" active={tab === "task"} onClick={() => setTab("task")} />
            <ActionButton icon={Mail} label="E-mail" disabled title="Wkrótce — integracja Google" />
            <ActionButton icon={Calendar} label="Kalendarz" disabled title="Wkrótce — integracja Google" />
          </div>

          {/* Kompozytor dla aktywnej zakładki */}
          <div style={{ marginBottom: 22 }}>
            {tab === "task" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <input
                  placeholder="Tytuł zadania"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="datetime-local"
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                  style={inputStyle}
                />
                <button onClick={saveActivity} disabled={saving} style={primaryButton}>
                  {saving ? "Zapisywanie…" : "Dodaj zadanie"}
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <textarea
                  placeholder={tab === "call" ? "Podsumowanie rozmowy…" : "Treść notatki…"}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
                <button onClick={saveActivity} disabled={saving} style={primaryButton}>
                  {saving ? "Zapisywanie…" : "Zapisz"}
                </button>
              </div>
            )}
          </div>

          {/* Kontakt / tożsamość */}
          <SectionTitle>Dane kontaktowe</SectionTitle>
          <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
            <FieldLabel label="Nazwa / osoba">
              <input defaultValue={deal.name ?? ""} onBlur={(e) => saveField("name", e.target.value)} style={inputStyle} />
            </FieldLabel>
            <FieldLabel label="Firma">
              <input defaultValue={deal.company ?? ""} onBlur={(e) => saveField("company", e.target.value)} style={inputStyle} />
            </FieldLabel>
            <FieldLabel label="E-mail">
              <input type="email" defaultValue={deal.email ?? ""} onBlur={(e) => saveField("email", e.target.value)} style={inputStyle} />
            </FieldLabel>
            <FieldLabel label="Telefon">
              <input defaultValue={deal.phone ?? ""} onBlur={(e) => saveField("phone", e.target.value)} style={inputStyle} />
            </FieldLabel>
          </div>

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

          {/* Właściwości deala (wbudowane + konfigurowalne) */}
          <SectionTitle>Właściwości</SectionTitle>
          <div style={{ display: "grid", gap: 12, marginBottom: 10 }}>
            <FieldLabel label="Wartość (zł)">
              <input
                type="number"
                defaultValue={deal.value || ""}
                onBlur={(e) => saveValue(e.target.value)}
                style={inputStyle}
              />
            </FieldLabel>
            <FieldLabel label="Deal Owner">
              <select
                value={deal.assignee ?? ""}
                onChange={(e) => saveAssignee(e.target.value as Assignee | "")}
                style={inputStyle}
              >
                <option value="">Nieprzypisany</option>
                <option value="dominik">Dominik</option>
                <option value="kuba">Kuba</option>
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
                    value={deal.props?.[def.key] ?? ""}
                    onChange={(v) => savePropValue(def.key, v)}
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
          />
        </div>
      </Panel>
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

/* ── Przycisk akcji (Notatka / Telefon / Zadanie / …) ───────────────────── */
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
}: {
  activities: Activity[];
  tasks: Task[];
  onToggleTask: (t: Task) => void;
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
            <FeedRow key={it.id} item={it} now={now} onToggleTask={onToggleTask} />
          ))}
        </FeedGroup>
      )}
      {groups.map((g) => (
        <FeedGroup key={g.label} label={g.label}>
          {g.items.map((it) => (
            <FeedRow key={it.id} item={it} now={now} onToggleTask={onToggleTask} />
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
}: {
  item: FeedItem;
  now: number;
  onToggleTask: (t: Task) => void;
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
      </Row>
    );
  }

  const a = item.activity;
  const Icon = ACTIVITY_ICON[a.type] ?? CircleDot;
  const color = ACTIVITY_COLOR[a.type] ?? tokens.accent;

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
    </Row>
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
        {deal.lead_score != null && (
          <DealRow label="Lead score">
            <b>{deal.lead_score}/100</b>
          </DealRow>
        )}
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
