// app/admin/calendar/page.tsx — Kalendarz zadań (Dzień / Tydzień / Miesiąc).
// Prosty model bez workspace/multi-login z Fazy 11: dwie osoby (Dominik/Kuba)
// dzielą jedno konto, rozróżniane polem `assignee` na tasks/leads.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatDateTime } from "@/lib/ui";
import type { Assignee, Task } from "@/lib/types";
import MIcon from "@/components/MaterialIcon";

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

// Zakres godzin osi czasu (dzień/tydzień). Zadania poza tym zakresem trafiają do
// najbliższej skrajnej godziny, więc nigdy nie znikają.
const START_HOUR = 6;
const END_HOUR = 22;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

type CalView = "day" | "week" | "month";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// Poniedziałek jako początek tygodnia (konwencja PL).
function startOfWeek(d: Date) {
  const wd = (d.getDay() + 6) % 7;
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - wd);
  return s;
}
// Godzina zadania sprowadzona do widocznego zakresu osi czasu.
function clampedHour(d: Date) {
  return Math.min(END_HOUR, Math.max(START_HOUR, d.getHours()));
}

// Siatka 6×7 dni obejmująca cały miesiąc + dopełnienie sąsiednich miesięcy.
function buildGrid(monthStart: Date): Date[] {
  const firstWeekday = (monthStart.getDay() + 6) % 7; // 0 = poniedziałek
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - firstWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export default function CalendarPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [view, setView] = useState<CalView>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState<"all" | Assignee>("all");
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const today = useMemo(() => new Date(), []);
  const monthStart = useMemo(() => startOfMonth(cursor), [cursor]);
  const grid = useMemo(() => buildGrid(monthStart), [monthStart]);
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Zakres pobierania danych zależny od aktywnego widoku.
  const range = useMemo(() => {
    if (view === "day") {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      return { start, end: addDays(start, 1) };
    }
    if (view === "week") {
      return { start: weekStart, end: addDays(weekStart, 7) };
    }
    // month — z marginesem na dni sąsiednich miesięcy.
    return { start: new Date(grid[0]), end: addDays(new Date(grid[grid.length - 1]), 1) };
  }, [view, cursor, weekStart, grid]);

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
  }, [supabase, range.start, range.end]);

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
  // Klik w wydarzenie (dzień/tydzień): otwórz kartę deala jak w widoku miesiąca,
  // a gdy zadanie nie ma powiązanego deala — pokaż panel dnia.
  const openEvent = (t: Task, day: Date) => {
    if (t.deal_id) openContact(t.deal_id);
    else setSelectedDay(day);
  };

  function prev() {
    if (view === "month") setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
    else setCursor((c) => addDays(c, view === "week" ? -7 : -1));
  }
  function next() {
    if (view === "month") setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
    else setCursor((c) => addDays(c, view === "week" ? 7 : 1));
  }
  function goToday() {
    setCursor(new Date());
  }

  const rangeLabel = useMemo(() => {
    if (view === "day") {
      return cursor.toLocaleDateString("pl-PL", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    }
    if (view === "week") {
      const end = addDays(weekStart, 6);
      const sameMonth = weekStart.getMonth() === end.getMonth();
      const startTxt = weekStart.toLocaleDateString("pl-PL", { day: "2-digit", month: sameMonth ? undefined : "short" });
      const endTxt = end.toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
      return `${startTxt} – ${endTxt}`;
    }
    return `${MONTH_NAMES[monthStart.getMonth()]} ${monthStart.getFullYear()}`;
  }, [view, cursor, weekStart, monthStart]);

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
        <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Kalendarz</h1>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <ViewSwitcher value={view} onChange={setView} />
          <OwnerFilter value={ownerFilter} onChange={setOwnerFilter} />

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <IconButton onClick={prev} label="Poprzedni">
              <MIcon name="chevron_left" size={16} />
            </IconButton>
            <span style={{ fontSize: 14, fontWeight: 700, minWidth: 190, textAlign: "center", textTransform: "capitalize" }}>
              {rangeLabel}
            </span>
            <IconButton onClick={next} label="Następny">
              <MIcon name="chevron_right" size={16} />
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
          grid={grid}
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
          onOpenEvent={openEvent}
        />
      ) : (
        <DayView
          day={cursor}
          today={today}
          tasks={tasksByDay.get(dayKey(cursor)) ?? []}
          ownerFilter={ownerFilter}
          onOpenEvent={openEvent}
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

/* ── Widok miesiąca ─────────────────────────────────────────── */
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
          <div key={w} style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, color: tokens.muted, textAlign: "center" }}>
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

/* ── Widok tygodnia (7 kolumn, oś godzin) ───────────────────── */
function WeekView({
  days,
  today,
  tasksByDay,
  ownerFilter,
  onOpenEvent,
}: {
  days: Date[];
  today: Date;
  tasksByDay: Map<string, Task[]>;
  ownerFilter: "all" | Assignee;
  onOpenEvent: (t: Task, day: Date) => void;
}) {
  // Zadania pogrupowane po (dzień, godzina).
  const byDayHour = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const d of days) {
      const dayTasks = tasksByDay.get(dayKey(d)) ?? [];
      for (const t of dayTasks) {
        if (!t.due_at) continue;
        const h = clampedHour(new Date(t.due_at));
        const k = `${dayKey(d)}|${h}`;
        const list = map.get(k) ?? [];
        list.push(t);
        map.set(k, list);
      }
    }
    return map;
  }, [days, tasksByDay]);

  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        overflow: "hidden",
      }}
    >
      {/* Nagłówek dni */}
      <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", borderBottom: `1px solid ${tokens.border}` }}>
        <div />
        {days.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div
              key={i}
              style={{
                padding: "10px 6px",
                textAlign: "center",
                borderLeft: `1px solid ${tokens.border}`,
                background: isToday ? tokens.accentSoft : "transparent",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: tokens.muted, textTransform: "uppercase" }}>{WEEKDAYS[i]}</div>
              <div style={{ fontSize: 15, fontWeight: isToday ? 800 : 600, color: isToday ? tokens.accent : tokens.text }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Oś godzin */}
      <div style={{ maxHeight: "calc(100vh - 240px)", overflowY: "auto" }}>
        {HOURS.map((h) => (
          <div key={h} style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", borderBottom: `1px solid ${tokens.border}`, minHeight: 52 }}>
            <div style={{ padding: "6px 8px", fontSize: 11, fontWeight: 600, color: tokens.muted, textAlign: "right" }}>
              {String(h).padStart(2, "0")}:00
            </div>
            {days.map((d, di) => {
              const cellTasks = byDayHour.get(`${dayKey(d)}|${h}`) ?? [];
              return (
                <div key={di} style={{ borderLeft: `1px solid ${tokens.border}`, padding: 3, display: "grid", gap: 3, alignContent: "start" }}>
                  {cellTasks.map((t) => (
                    <EventBlock key={t.id} task={t} showOwnerDot={ownerFilter === "all"} onClick={() => onOpenEvent(t, d)} compact />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Widok dnia (oś godzin) ─────────────────────────────────── */
function DayView({
  day,
  today,
  tasks,
  ownerFilter,
  onOpenEvent,
}: {
  day: Date;
  today: Date;
  tasks: Task[];
  ownerFilter: "all" | Assignee;
  onOpenEvent: (t: Task, day: Date) => void;
}) {
  const byHour = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const t of tasks) {
      if (!t.due_at) continue;
      const h = clampedHour(new Date(t.due_at));
      const list = map.get(h) ?? [];
      list.push(t);
      map.set(h, list);
    }
    return map;
  }, [tasks]);

  const isToday = isSameDay(day, today);

  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        overflow: "hidden",
      }}
    >
      <div style={{ maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
        {HOURS.map((h) => {
          const cellTasks = byHour.get(h) ?? [];
          const nowHour = isToday && new Date().getHours() === h;
          return (
            <div key={h} style={{ display: "grid", gridTemplateColumns: "64px 1fr", borderBottom: `1px solid ${tokens.border}`, minHeight: 56, background: nowHour ? tokens.accentSoft : "transparent" }}>
              <div style={{ padding: "8px 10px", fontSize: 12, fontWeight: 600, color: tokens.muted, textAlign: "right" }}>
                {String(h).padStart(2, "0")}:00
              </div>
              <div style={{ borderLeft: `1px solid ${tokens.border}`, padding: 6, display: "grid", gap: 4, alignContent: "start" }}>
                {cellTasks.map((t) => (
                  <EventBlock key={t.id} task={t} showOwnerDot={ownerFilter === "all"} onClick={() => onOpenEvent(t, day)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Blok wydarzenia (dzień/tydzień) ────────────────────────── */
function EventBlock({
  task,
  showOwnerDot,
  onClick,
  compact,
}: {
  task: Task;
  showOwnerDot: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const overdue = isOverdue(task);
  const accent = task.assignee ? ASSIGNEE_COLOR[task.assignee] : tokens.accent;
  return (
    <button
      onClick={onClick}
      title={task.title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        textAlign: "left",
        padding: compact ? "3px 5px" : "6px 8px",
        borderRadius: 7,
        border: "none",
        borderLeft: `3px solid ${overdue && !task.done ? tokens.danger : accent}`,
        background: overdue && !task.done ? `${tokens.danger}14` : `${accent}14`,
        cursor: "pointer",
        opacity: task.done ? 0.55 : 1,
        overflow: "hidden",
      }}
    >
      {showOwnerDot && task.assignee && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, flexShrink: 0 }} />
      )}
      {task.due_at && (
        <span style={{ fontSize: compact ? 10 : 11.5, fontWeight: 700, color: tokens.muted, flexShrink: 0 }}>
          {timeLabel(task.due_at)}
        </span>
      )}
      <span
        style={{
          fontSize: compact ? 11 : 12.5,
          fontWeight: 600,
          color: overdue && !task.done ? tokens.danger : tokens.text,
          textDecoration: task.done ? "line-through" : "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {task.title}
      </span>
    </button>
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
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: ASSIGNEE_COLOR[task.assignee], flexShrink: 0 }} />
      )}
      {task.due_at && <span style={{ flexShrink: 0, opacity: 0.7 }}>{timeLabel(task.due_at)}</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</span>
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
            <MIcon name="close" size={16} color={tokens.muted} />
          </button>
        </div>

        {sorted.length === 0 ? (
          <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>Brak zadań tego dnia.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {sorted.map((t) => {
              const overdue = isOverdue(t);
              return (
                <div
                  key={t.id}
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
                          <MIcon name="schedule" size={12} />
                          {formatDateTime(t.due_at)}
                        </span>
                      )}
                      {t.deals && (
                        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: tokens.accent, fontWeight: 600 }}>
                          <MIcon name="person" size={12} />
                          {t.deals.name || "Deal"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function ViewSwitcher({ value, onChange }: { value: CalView; onChange: (v: CalView) => void }) {
  const options: [CalView, string][] = [
    ["day", "Dzień"],
    ["week", "Tydzień"],
    ["month", "Miesiąc"],
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
