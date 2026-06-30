// app/admin/page.tsx — Pulpit (Dashboard).
// Szybkie akcje, leady w toku, zadania na dziś (realne dane) i ostatnia aktywność.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FilePlus2,
  UserPlus,
  CheckSquare,
  BarChart3,
  Clock,
  StickyNote,
  Phone,
  Mail,
  FileText,
  CircleDot,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatDateTime, formatPLN } from "@/lib/ui";
import {
  type Activity,
  type Deal,
  type Task,
} from "@/lib/types";
import { useStages } from "@/lib/stages";

const ACTIVITY_ICON: Record<string, typeof StickyNote> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  submission: FileText,
  stage: CircleDot,
  task: CheckSquare,
};

const QUICK = [
  { href: "/admin/forms", label: "Nowy formularz", icon: FilePlus2 },
  { href: "/admin/pipeline", label: "Nowy deal", icon: UserPlus },
  { href: "/admin/tasks", label: "Nowe zadanie", icon: CheckSquare },
  { href: "/admin/analytics", label: "Analityka", icon: BarChart3 },
];

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
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
    setTasks((list) => list.filter((t) => t.id !== task.id)); // znika z „na dziś”
    await supabase.from("tasks").update({ done: true }).eq("id", task.id);
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>Pulpit</h1>

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
          const Icon = q.icon;
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
                  <Icon size={19} />
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
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {l.name || "Bez nazwy"}
                      </div>
                      <div style={{ fontSize: 12, color: tokens.muted }}>
                        {l.company || "—"}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "3px 10px",
                        borderRadius: 999,
                        background: `${sm.color}1A`,
                        color: sm.color,
                      }}
                    >
                      {sm.label}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 70, textAlign: "right" }}>
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
                        <Clock size={12} />
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
                const Icon = ACTIVITY_ICON[a.type] ?? CircleDot;
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
                      <Icon size={15} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14 }}>
                        {a.body || "—"}
                        {a.deals?.name ? (
                          <span style={{ color: tokens.muted }}> · {a.deals.name}</span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 12, color: tokens.muted }}>
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
