// app/admin/calendar/page.tsx — Kalendarz zadań (miesiąc/tydzień/dzień).
// Prosty model bez workspace/multi-login z Fazy 11: dwie osoby (Dominik/Kuba)
// dzielą jedno konto, rozróżniane polem `assignee` na tasks/leads.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, X, Clock, User, CalendarDays, CalendarRange, Calendar as CalendarIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatDateTime } from "@/lib/ui";
import type { Assignee, Task } from "@/lib/types";

type View = "month" | "week" | "day";

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

const MAX_VISIBLE_MONTH = 3;
const MAX_VISIBLE_WEEK = 6;

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date) {
  // Poniedziałek (konwencja PL).
  const wd = (d.getDay() + 6) % 7;
  return startOfDay(addDays(d, -wd));
}
function addDays(d: Date, n: number) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Siatka 6×7 dni obejmująca cały miesiąc + dopełnienie sąsiednich miesięcy.
function buildMonthGrid(monthStart: Date): Date[] {
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export default function CalendarPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState<"all" | Assignee>("all");
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    const saved = localStorage.getItem("selltic_calendar_view");
    if (saved === "month" || saved === "week" || saved === "day") setView(saved);
  }, []);

  function changeView(v: View) {
    setView(v);
    localStorage.setItem("selltic_calendar_view", v);
  }

  // Dni widoczne w bieżącym widoku — siatka miesiąca, tydzień (Pon–Nd) lub jeden dzień.
  const days = useMemo(() => {
    if (view === "month") return buildMonthGrid(startOfMonth(anchor));
    if (view === "week") {
      const s = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    return [startOfDay(anchor)];
  }, [view, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    const rangeStart = days[0];
    const rangeEnd = addDays(days[days.length - 1], 1);
    const { data } = await supabase
      .from("tasks")
      .select("*, contacts(id, name)")
      .gte("due_at", rangeStart.toISOString())
      .lt("due_at", rangeEnd.toISOString())
      .order("due_at", { ascending: true });
    setTasks((data as Task[]) ?? []);
    setLoading(false);
  }, [supabase, days]);

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

  const openContact = (id: string) => router.push(`/admin/contacts/${id}`);

  function goPrev() {
    setAnchor((a) => {
      if (view === "month") return new Date(a.getFullYear(), a.getMonth() - 1, 1);
      if (view === "week") return addDays(a, -7);
      return addDays(a, -1);
    });
  }
  function goNext() {
    setAnchor((a) => {
      if (view === "month") return new Date(a.getFullYear(), a.getMonth() + 1, 1);
      if (view === "week") return addDays(a, 7);
      return addDays(a, 1);
    });
  }
  function goToday() {
    setAnchor(startOfDay(new Date()));
  }

  const headerLabel = useMemo(() => {
    if (view === "month") return `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
    if (view === "week") {
      const s = days[0];
      const e = days[6];
      const sLabel = s.toLocaleDateString("pl-PL", { day: "2-digit", month: "short" });
      const eLabel = e.toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
      return `${sLabel} – ${eLabel}`;
    }
    return anchor.toLocaleDateString("pl-PL", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }, [view, anchor, days]);

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
          <OwnerFilter value={ownerFilter} onChange={setOwnerFilter} />
          <ViewSwitcher value={view} onChange={changeView} />

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <IconButton onClick={goPrev} label="Wstecz">
              <ChevronLeft size={16} />
            </IconButton>
            <span style={{ fontSize: 14, fontWeight: 700, minWidth: 150, textAlign: "center", textTransform: "capitalize" }}>
              {headerLabel}
            </span>
            <IconButton onClick={goNext} label="Dalej">
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
      ) : view === "day" ? (
        <DayView
          day={days[0]}
          tasks={tasksByDay.get(dayKey(days[0])) ?? []}
          showOwnerDot={ownerFilter === "all"}
          onOpenContact={openContact}
        />
      ) : (
        <div
          className="selltic-scroll-x"
          style={{
            background: tokens.card,
            border: `1px solid ${tokens.border}`,
            borderRadius: tokens.radius,
            overflow: "hidden",
          }}
        >
          <div style={{ minWidth: view === "week" ? 700 : undefined }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${tokens.border}` }}>
              {(view === "month" ? WEEKDAYS : days).map((w, i) => (
                <div
                  key={view === "month" ? (w as string) : (w as Date).toISOString()}
                  style={{
                    padding: "10px 8px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: view === "week" && isSameDay(w as Date, today) ? tokens.accent : tokens.muted,
                    textAlign: "center",
                  }}
                >
                  {view === "month" ? (w as string) : `${WEEKDAYS[i]} ${(w as Date).getDate()}`}
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
              {days.map((d, i) => {
                const inMonth = view === "month" ? d.getMonth() === anchor.getMonth() : true;
                const isToday = isSameDay(d, today);
                const dayTasks = tasksByDay.get(dayKey(d)) ?? [];
                const maxVisible = view === "month" ? MAX_VISIBLE_MONTH : MAX_VISIBLE_WEEK;
                const visible = dayTasks.slice(0, maxVisible);
                const overflow = dayTasks.length - visible.length;

                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDay(d)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: 4,
                      minHeight: view === "week" ? 280 : 104,
                      padding: "8px 6px",
                      border: "none",
                      borderRight: (i + 1) % 7 !== 0 ? `1px solid ${tokens.border}` : "none",
                      borderTop: view === "month" && i >= 7 ? `1px solid ${tokens.border}` : "none",
                      background: isToday ? tokens.accentSoft : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      font: "inherit",
                    }}
                  >
                    {view === "month" && (
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
                    )}

                    <div style={{ display: "grid", gap: 3 }}>
                      {visible.map((t) => (
                        <TaskChip key={t.id} task={t} showOwnerDot={ownerFilter === "all"} />
                      ))}
                      {overflow > 0 && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: tokens.accent,
                            padding: "1px 4px",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDay(d);
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
        </div>
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

// Widok dnia: pełna lista zadań tego dnia, bez obcinania/popovera (jest już
// na to dość miejsca) — ten sam wiersz zadania co w DayPanel.
function DayView({
  day,
  tasks,
  showOwnerDot,
  onOpenContact,
}: {
  day: Date;
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

function TaskRow({
  task,
  showOwnerDot,
  onOpenContact,
}: {
  task: Task;
  showOwnerDot: boolean;
  onOpenContact: (id: string) => void;
}) {
  const overdue = isOverdue(task);
  return (
    <div
      onClick={() => task.contact_id && onOpenContact(task.contact_id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${overdue && !task.done ? tokens.danger : tokens.border}`,
        background: overdue && !task.done ? `${tokens.danger}0D` : "#fff",
        cursor: task.contact_id ? "pointer" : "default",
        opacity: task.done ? 0.6 : 1,
      }}
    >
      {showOwnerDot && task.assignee && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: ASSIGNEE_COLOR[task.assignee],
            flexShrink: 0,
          }}
          title={ASSIGNEE_LABEL[task.assignee]}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            textDecoration: task.done ? "line-through" : "none",
            color: overdue && !task.done ? tokens.danger : tokens.text,
          }}
        >
          {task.title}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 3, flexWrap: "wrap" }}>
          {task.due_at && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: tokens.muted }}>
              <Clock size={12} />
              {formatDateTime(task.due_at)}
            </span>
          )}
          {task.contacts && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: tokens.accent, fontWeight: 600 }}>
              <User size={12} />
              {task.contacts.name || "Kontakt"}
            </span>
          )}
        </div>
      </div>
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
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: ASSIGNEE_COLOR[task.assignee],
            flexShrink: 0,
          }}
        />
      )}
      {task.due_at && (
        <span style={{ flexShrink: 0, opacity: 0.7 }}>{timeLabel(task.due_at)}</span>
      )}
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
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 40 }}
      />
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

function ViewSwitcher({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const options: [View, string, typeof CalendarIcon][] = [
    ["month", "Miesiąc", CalendarIcon],
    ["week", "Tydzień", CalendarRange],
    ["day", "Dzień", CalendarDays],
  ];
  return (
    <div style={{ display: "flex", background: tokens.border, padding: 2, borderRadius: 10, gap: 2 }}>
      {options.map(([key, label, Icon]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          title={label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
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
          <Icon size={14} />
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
