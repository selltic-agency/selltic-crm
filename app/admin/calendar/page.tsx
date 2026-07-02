// app/admin/calendar/page.tsx — Kalendarz zadań (miesiąc / tydzień / dzień),
// Faza „Calendar”. Prosty model bez workspace/multi-login z Fazy 11: dwie osoby
// (Dominik/Kuba) dzielą jedno konto, rozróżniane polem `assignee` na tasks/leads.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, X, Clock, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatDateTime } from "@/lib/ui";
import type { Assignee, Task } from "@/lib/types";

type CalView = "month" | "week" | "day";

const WEEKDAYS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
const MONTH_NAMES = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];

const ASSIGNEE_COLOR: Record<Assignee, string> = {
  dominik: "#6C5CE7",
  kuba: "#1A73E7",
};
const ASSIGNEE_LABEL: Record<Assignee, string> = {
  dominik: "Dominik",
  kuba: "Kuba",
};

const MAX_VISIBLE_PER_DAY = 3;

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
// Poniedziałek tygodnia zawierającego `d` (konwencja PL).
function startOfWeek(d: Date) {
  const s = startOfDay(d);
  const weekday = (s.getDay() + 6) % 7; // 0 = poniedziałek
  s.setDate(s.getDate() - weekday);
  return s;
}
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Siatka 6×7 dni obejmująca cały miesiąc + dopełnienie sąsiednich miesięcy,
// zaczynając od poniedziałku (konwencja PL).
function buildMonthGrid(monthStart: Date): Date[] {
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export default function CalendarPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [view, setView] = useState<CalView>("month");
  // Kursor: punkt odniesienia. W trybie miesiąca liczy się miesiąc, w tygodniu —
  // tydzień zawierający kursor, w dniu — sam dzień.
  const [cursor, setCursor] = useState(() => new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState<"all" | Assignee>("all");
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const today = useMemo(() => new Date(), []);

  const monthStart = useMemo(() => startOfMonth(cursor), [cursor]);
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const monthGrid = useMemo(() => buildMonthGrid(monthStart), [monthStart]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Zakres pobierania danych zależy od trybu (z jednodniowym marginesem end).
  const range = useMemo(() => {
    if (view === "month") return { start: monthGrid[0], end: addDays(monthGrid[monthGrid.length - 1], 1) };
    if (view === "week") return { start: weekStart, end: addDays(weekStart, 7) };
    return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), 1) };
  }, [view, monthGrid, weekStart, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tasks")
      .select("*, deals(id, name)")
      .gte("due_at", range.start.toISOString())
      .lt("due_at", range.end.toISOString())
      .order("due_at", { ascending: true });
    setTasks((data as Task[]) ?? []);
    setLoading(false);
  }, [supabase, range]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredTasks = useMemo(() => {
    if (ownerFilter === "all") return tasks;
    return tasks.filter((t) => t.assignee === ownerFilter);
  }, [tasks, ownerFilter]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filteredTasks) {
      if (!t.due_at) continue;
      const k = dayKey(new Date(t.due_at));
      const list = map.get(k) ?? [];
      list.push(t);
      map.set(k, list);
    }
    return map;
  }, [filteredTasks]);

  const openContact = (id: string) => router.push(`/admin/leads/${id}`);

  // Nawigacja: krok zależy od trybu.
  function prev() {
    if (view === "month") setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
    else if (view === "week") setCursor((c) => addDays(c, -7));
    else setCursor((c) => addDays(c, -1));
  }
  function next() {
    if (view === "month") setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
    else if (view === "week") setCursor((c) => addDays(c, 7));
    else setCursor((c) => addDays(c, 1));
  }
  function goToday() {
    setCursor(new Date());
  }

  const label = useMemo(() => {
    if (view === "month") return `${MONTH_NAMES[monthStart.getMonth()]} ${monthStart.getFullYear()}`;
    if (view === "week") {
      const end = addDays(weekStart, 6);
      const sameMonth = weekStart.getMonth() === end.getMonth();
      const startStr = weekStart.toLocaleDateString("pl-PL", { day: "numeric", month: sameMonth ? undefined : "short" });
      const endStr = end.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
      return `${startStr} – ${endStr}`;
    }
    return cursor.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }, [view, monthStart, weekStart, cursor]);

  const selectedDayTasks = selectedDay ? tasksByDay.get(dayKey(selectedDay)) ?? [] : [];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Kalendarz</h1>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <ViewSwitch value={view} onChange={setView} />
          <OwnerFilter value={ownerFilter} onChange={setOwnerFilter} />

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <IconButton onClick={prev} label="Poprzedni">
              <ChevronLeft size={16} />
            </IconButton>
            <span style={{ fontSize: 14, fontWeight: 700, minWidth: 190, textAlign: "center" }}>
              {label}
            </span>
            <IconButton onClick={next} label="Następny">
              <ChevronRight size={16} />
            </IconButton>
          </div>

          <button onClick={goToday} style={todayButton}>
            Dzisiaj
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : view === "month" ? (
        <MonthView
          grid={monthGrid}
          monthStart={monthStart}
          today={today}
          tasksByDay={tasksByDay}
          ownerFilter={ownerFilter}
          onSelectDay={setSelectedDay}
        />
      ) : view === "week" ? (
        <WeekView
          days={weekDays}
          today={today}
          tasksByDay={tasksByDay}
          ownerFilter={ownerFilter}
          onSelectDay={setSelectedDay}
          onOpenContact={openContact}
        />
      ) : (
        <DayView
          tasks={tasksByDay.get(dayKey(cursor)) ?? []}
          showOwnerDot={ownerFilter === "all"}
          onOpenContact={openContact}
        />
      )}

      {selectedDay && (
        <DayPanel
          day={selectedDay}
          tasks={selectedDayTasks}
          showOwnerDot={ownerFilter === "all"}
          onClose={() => setSelectedDay(null)}
          onOpenContact={openContact}
        />
      )}
    </div>
  );
}

function MonthView({
  grid,
  monthStart,
  today,
  tasksByDay,
  ownerFilter,
  onSelectDay,
}: {
  grid: Date[];
  monthStart: Date;
  today: Date;
  tasksByDay: Map<string, Task[]>;
  ownerFilter: "all" | Assignee;
  onSelectDay: (d: Date) => void;
}) {
  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${tokens.border}` }}>
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, color: tokens.muted, textAlign: "center" }}
          >
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {grid.map((d, i) => {
          const inMonth = d.getMonth() === monthStart.getMonth();
          const isToday = isSameDay(d, today);
          const dayTasks = tasksByDay.get(dayKey(d)) ?? [];
          const visible = dayTasks.slice(0, MAX_VISIBLE_PER_DAY);
          const overflow = dayTasks.length - visible.length;

          return (
            <button
              key={i}
              onClick={() => onSelectDay(d)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: 4,
                minHeight: 104,
                padding: "8px 6px",
                border: "none",
                borderRight: (i + 1) % 7 !== 0 ? `1px solid ${tokens.border}` : "none",
                borderTop: i >= 7 ? `1px solid ${tokens.border}` : "none",
                background: isToday ? tokens.accentSoft : "transparent",
                cursor: "pointer",
                textAlign: "left",
                font: "inherit",
              }}
            >
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: isToday ? 800 : 600,
                  color: isToday ? tokens.accent : inMonth ? tokens.text : tokens.muted,
                  opacity: inMonth ? 1 : 0.55,
                  width: 22,
                  height: 22,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "50%",
                  background: isToday ? tokens.accent : "transparent",
                }}
              >
                <span style={{ color: isToday ? "#fff" : "inherit" }}>{d.getDate()}</span>
              </span>

              <div style={{ display: "grid", gap: 3 }}>
                {visible.map((t) => (
                  <TaskChip key={t.id} task={t} showOwnerDot={ownerFilter === "all"} />
                ))}
                {overflow > 0 && (
                  <span
                    style={{ fontSize: 11, fontWeight: 700, color: tokens.accent, padding: "1px 4px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDay(d);
                    }}
                  >
                    +{overflow} więcej
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  days,
  today,
  tasksByDay,
  ownerFilter,
  onSelectDay,
  onOpenContact,
}: {
  days: Date[];
  today: Date;
  tasksByDay: Map<string, Task[]>;
  ownerFilter: "all" | Assignee;
  onSelectDay: (d: Date) => void;
  onOpenContact: (id: string) => void;
}) {
  return (
    <div
      className="selltic-scroll-x"
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(150px, 1fr))",
      }}
    >
      {days.map((d, i) => {
        const isToday = isSameDay(d, today);
        const dayTasks = [...(tasksByDay.get(dayKey(d)) ?? [])].sort((a, b) =>
          (a.due_at ?? "").localeCompare(b.due_at ?? "")
        );
        return (
          <div
            key={i}
            style={{
              borderRight: i < 6 ? `1px solid ${tokens.border}` : "none",
              display: "flex",
              flexDirection: "column",
              minHeight: 460,
            }}
          >
            <button
              onClick={() => onSelectDay(d)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "10px 6px",
                borderBottom: `1px solid ${tokens.border}`,
                background: isToday ? tokens.accentSoft : "transparent",
                border: "none",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700, color: tokens.muted, textTransform: "uppercase" }}>
                {WEEKDAYS[i]}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: isToday ? 800 : 700,
                  width: 22,
                  height: 22,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "50%",
                  background: isToday ? tokens.accent : "transparent",
                  color: isToday ? "#fff" : tokens.text,
                }}
              >
                {d.getDate()}
              </span>
            </button>

            <div style={{ display: "grid", gap: 5, padding: 6, alignContent: "start" }}>
              {dayTasks.length === 0 ? (
                <span style={{ fontSize: 11.5, color: tokens.muted, padding: "6px 4px" }}>—</span>
              ) : (
                dayTasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => (t.deal_id ? onOpenContact(t.deal_id) : onSelectDay(d))}
                    style={{ border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left", font: "inherit" }}
                  >
                    <TaskChip task={t} showOwnerDot={ownerFilter === "all"} />
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  tasks,
  showOwnerDot,
  onOpenContact,
}: {
  tasks: Task[];
  showOwnerDot: boolean;
  onOpenContact: (id: string) => void;
}) {
  const sorted = [...tasks].sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 20,
        maxWidth: 640,
      }}
    >
      {sorted.length === 0 ? (
        <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>Brak zadań tego dnia.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {sorted.map((t) => (
            <TaskRow key={t.id} task={t} showOwnerDot={showOwnerDot} onOpenContact={onOpenContact} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskChip({ task, showOwnerDot }: { task: Task; showOwnerDot: boolean }) {
  const overdue = isOverdue(task);
  const color = overdue ? tokens.danger : task.done ? tokens.muted : tokens.text;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11.5,
        fontWeight: 600,
        color,
        opacity: task.done ? 0.55 : 1,
        textDecoration: task.done ? "line-through" : "none",
        overflow: "hidden",
        whiteSpace: "nowrap",
        padding: "1px 4px",
        borderRadius: 5,
        background: overdue && !task.done ? `${tokens.danger}14` : "transparent",
      }}
      title={task.title}
    >
      {showOwnerDot && task.assignee && (
        <span
          style={{ width: 6, height: 6, borderRadius: "50%", background: ASSIGNEE_COLOR[task.assignee], flexShrink: 0 }}
        />
      )}
      {task.due_at && <span style={{ flexShrink: 0, opacity: 0.7 }}>{timeLabel(task.due_at)}</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</span>
    </div>
  );
}

// Wiersz zadania (widok dnia oraz panel dnia) — jednolita prezentacja.
function TaskRow({
  task: t,
  showOwnerDot,
  onOpenContact,
}: {
  task: Task;
  showOwnerDot: boolean;
  onOpenContact: (id: string) => void;
}) {
  const overdue = isOverdue(t);
  return (
    <div
      onClick={() => t.deal_id && onOpenContact(t.deal_id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${overdue && !t.done ? tokens.danger : tokens.border}`,
        background: overdue && !t.done ? `${tokens.danger}0D` : "#fff",
        cursor: t.deal_id ? "pointer" : "default",
        opacity: t.done ? 0.6 : 1,
      }}
    >
      {showOwnerDot && t.assignee && (
        <span
          style={{ width: 8, height: 8, borderRadius: "50%", background: ASSIGNEE_COLOR[t.assignee], flexShrink: 0 }}
          title={ASSIGNEE_LABEL[t.assignee]}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            textDecoration: t.done ? "line-through" : "none",
            color: overdue && !t.done ? tokens.danger : tokens.text,
          }}
        >
          {t.title}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 3, flexWrap: "wrap" }}>
          {t.due_at && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: tokens.muted }}>
              <Clock size={12} />
              {formatDateTime(t.due_at)}
            </span>
          )}
          {t.deals && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: tokens.accent, fontWeight: 600 }}>
              <User size={12} />
              {t.deals.name || "Deal"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function DayPanel({
  day,
  tasks,
  showOwnerDot,
  onClose,
  onOpenContact,
}: {
  day: Date;
  tasks: Task[];
  showOwnerDot: boolean;
  onClose: () => void;
  onOpenContact: (id: string) => void;
}) {
  const sorted = [...tasks].sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 40 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(440px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
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
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            {day.toLocaleDateString("pl-PL", { day: "2-digit", month: "long", year: "numeric" })}
          </h2>
          <button onClick={onClose} aria-label="Zamknij" style={closeBtn}>
            <X size={16} color={tokens.muted} />
          </button>
        </div>

        {sorted.length === 0 ? (
          <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>Brak zadań tego dnia.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {sorted.map((t) => (
              <TaskRow key={t.id} task={t} showOwnerDot={showOwnerDot} onOpenContact={onOpenContact} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ViewSwitch({ value, onChange }: { value: CalView; onChange: (v: CalView) => void }) {
  const options: [CalView, string][] = [
    ["month", "Miesiąc"],
    ["week", "Tydzień"],
    ["day", "Dzień"],
  ];
  return (
    <div style={{ display: "flex", background: tokens.border, padding: 2, borderRadius: 10, gap: 2 }}>
      {options.map(([key, lbl]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            background: value === key ? tokens.card : "transparent",
            color: value === key ? tokens.accent : tokens.muted,
            boxShadow: value === key ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
          }}
        >
          {lbl}
        </button>
      ))}
    </div>
  );
}

function OwnerFilter({
  value,
  onChange,
}: {
  value: "all" | Assignee;
  onChange: (v: "all" | Assignee) => void;
}) {
  const options: ["all" | Assignee, string][] = [
    ["all", "Wszyscy"],
    ["dominik", "Dominik"],
    ["kuba", "Kuba"],
  ];
  return (
    <div style={{ display: "flex", background: tokens.border, padding: 2, borderRadius: 10, gap: 2 }}>
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            background: value === key ? tokens.card : "transparent",
            color: value === key ? tokens.accent : tokens.muted,
            boxShadow: value === key ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        border: `1px solid ${tokens.border}`,
        background: "#fff",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        color: tokens.text,
      }}
    >
      {children}
    </button>
  );
}

function isOverdue(t: Task): boolean {
  if (t.done || !t.due_at) return false;
  return new Date(t.due_at).getTime() < Date.now();
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  // Zadania dodane bez konkretnej godziny i tak mają timestamptz — pokaż
  // godzinę zawsze (00:00 dla „cały dzień” to akceptowalny uproszczony przypadek).
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

const todayButton: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  color: tokens.text,
};

const closeBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
