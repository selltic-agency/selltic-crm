// app/admin/page.tsx — Pulpit (Dashboard).
// Szybkie akcje, leady w toku, zadania na dziś (realne dane) i ostatnia aktywność.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { tokens, formatDateTime, formatPLN } from "@/lib/ui";
import {
  type Activity,
  type Deal,
  type Task,
} from "@/lib/types";
import { useStages } from "@/lib/stages";
import MIcon from "@/components/MaterialIcon";

const ACTIVITY_ICON: Record<string, string> = {
  note: "sticky_note_2",
  call: "call",
  email: "mail",
  submission: "description",
  stage: "adjust",
  task: "check_box",
};

const QUICK = [
  { href: "/admin/forms", label: "Nowy formularz", icon: "note_add" },
  { href: "/admin/pipeline", label: "Nowy deal", icon: "person_add" },
  { href: "/admin/tasks", label: "Nowe zadanie", icon: "add_task" },
  { href: "/admin/analytics", label: "Analityka", icon: "monitoring" },
];

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const reduce = useReducedMotion();
  const router = useRouter();
  const { stages, stageMeta } = useStages();
  const [leads, setLeads] = useState<Deal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<
    (Activity & { deals?: { name: string | null } | null })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const openLead = (id: string) => router.push(`/admin/leads/${id}`);

  const load = useCallback(async () => {
    if (stages.length === 0) return;
    setLoading(true);
    // koniec dnia (lokalnie) jako granica „na dziś”
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const wonLost = stages.filter((s) => s.is_won || s.is_lost).map((s) => s.key);

    const [l, t, a] = await Promise.all([
      supabase
        .from("deals")
        .select("*")
        .not("stage", "in", `(${wonLost.join(",")})`)
        .order("updated_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("*, deals(id, name)")
        .eq("done", false)
        .not("due_at", "is", null)
        .lte("due_at", end.toISOString())
        .order("due_at", { ascending: true }),
      supabase
        .from("activities")
        .select("*, deals(name)")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    setLeads((l.data as Deal[]) ?? []);
    setTasks((t.data as Task[]) ?? []);
    setActivities((a.data as (Activity & { deals?: { name: string | null } | null })[]) ?? []);
    setLoading(false);
  }, [supabase, stages]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleTask(task: Task) {
    setTasks((list) => list.filter((t) => t.id !== task.id)); // optymistycznie znika z „na dziś”
    const { error } = await supabase.from("tasks").update({ done: true }).eq("id", task.id);
    if (error) {
      // Nie chowaj cichej porażki: przywróć zadanie na liście i zgłoś błąd,
      // inaczej użytkownik myśli, że odhaczył, a po odświeżeniu wraca.
      setTasks((list) => (list.some((t) => t.id === task.id) ? list : [...list, task]));
      toast.error("Nie udało się oznaczyć zadania jako wykonane.");
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", margin: "0 0 16px" }}>Start</h1>

      {/* Szybkie akcje */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
          marginBottom: 28,
        }}
      >
        {QUICK.map((q, i) => {
          return (
            <motion.div
              key={q.href}
              initial={{ opacity: 0, y: reduce ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 320, damping: 28, delay: i * 0.07 }
              }
              whileHover={reduce ? undefined : { y: -3 }}
            >
              <Link
                href={q.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: tokens.card,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: tokens.radius,
                  padding: "16px 18px",
                  textDecoration: "none",
                  color: tokens.text,
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: tokens.accentSoft,
                    color: tokens.accent,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <MIcon name={q.icon} size={19} />
                </span>
                {q.label}
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 18,
        }}
      >
        {/* Leady w toku */}
        <Card title="Leady w toku">
          {loading ? (
            <Muted>Wczytywanie…</Muted>
          ) : leads.length === 0 ? (
            <Muted>Brak leadów w toku.</Muted>
          ) : (
            <div style={{ display: "grid", gap: 2 }}>
              {leads.slice(0, 8).map((l) => {
                const sm = stageMeta(l.stage);
                return (
                  <button
                    key={l.id}
                    onClick={() => openLead(l.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 6px",
                      borderTop: `1px solid ${tokens.border}`,
                      background: "none",
                      border: "none",
                      width: "100%",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.name || "Bez nazwy"}
                      </div>
                      <div style={{ fontSize: 12, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.company || "—"}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: "2px 9px",
                        borderRadius: 999,
                        background: `${sm.color}1A`,
                        color: sm.color,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sm.label}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 62, textAlign: "right", flexShrink: 0 }}>
                      {formatPLN(l.value)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* Zadania na dziś */}
        <Card title="Zadania na dziś">
          {loading ? (
            <Muted>Wczytywanie…</Muted>
          ) : tasks.length === 0 ? (
            <Muted>Brak zadań na dziś 🎉</Muted>
          ) : (
            <div style={{ display: "grid", gap: 2 }}>
              {tasks.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 6px",
                    borderTop: `1px solid ${tokens.border}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggleTask(t)}
                    style={{ width: 18, height: 18, cursor: "pointer", accentColor: tokens.accent }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</div>
                    {t.due_at && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: tokens.muted }}>
                        <MIcon name="schedule" size={12} />
                        {formatDateTime(t.due_at)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Ostatnia aktywność */}
        <Card title="Ostatnia aktywność">
          {loading ? (
            <Muted>Wczytywanie…</Muted>
          ) : activities.length === 0 ? (
            <Muted>Brak aktywności.</Muted>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {activities.map((a) => {
                const iconName = ACTIVITY_ICON[a.type] ?? "adjust";
                return (
                  <div key={a.id} style={{ display: "flex", gap: 11 }}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        flexShrink: 0,
                        background: tokens.accentSoft,
                        color: tokens.accent,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <MIcon name={iconName} size={15} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          lineHeight: 1.4,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {a.body || "—"}
                        {a.deals?.name ? <span style={{ color: tokens.muted }}> · {a.deals.name}</span> : null}
                      </div>
                      <div style={{ fontSize: 12, color: tokens.muted, marginTop: 2 }}>
                        {formatDateTime(a.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 18,
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>{title}</h2>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 14, color: tokens.muted, margin: 0 }}>{children}</p>;
}
