// app/admin/page.tsx — Pulpit (Dashboard).
// Szybkie akcje, leady w toku, zadania na dziś (realne dane) i ostatnia aktywność.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  type Contact,
  type Task,
  stageMeta,
} from "@/lib/types";
import ContactDrawer from "@/components/ContactDrawer";

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
  { href: "/admin/pipeline", label: "Nowy kontakt", icon: UserPlus },
  { href: "/admin/tasks", label: "Nowe zadanie", icon: CheckSquare },
  { href: "/admin/analytics", label: "Analityka", icon: BarChart3 },
];

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<
    (Activity & { contacts?: { name: string | null } | null })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [drawerContact, setDrawerContact] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // koniec dnia (lokalnie) jako granica „na dziś”
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const [c, t, a] = await Promise.all([
      supabase
        .from("contacts")
        .select("*")
        .not("stage", "in", "(won,lost)")
        .order("updated_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("*, contacts(id, name)")
        .eq("done", false)
        .not("due_at", "is", null)
        .lte("due_at", end.toISOString())
        .order("due_at", { ascending: true }),
      supabase
        .from("activities")
        .select("*, contacts(name)")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    setContacts((c.data as Contact[]) ?? []);
    setTasks((t.data as Task[]) ?? []);
    setActivities((a.data as (Activity & { contacts?: { name: string | null } | null })[]) ?? []);
    setLoading(false);
  }, [supabase]);

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
        {QUICK.map((q) => {
          const Icon = q.icon;
          return (
            <Link
              key={q.href}
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
          ) : contacts.length === 0 ? (
            <Muted>Brak leadów w toku.</Muted>
          ) : (
            <div style={{ display: "grid", gap: 2 }}>
              {contacts.slice(0, 8).map((c) => {
                const sm = stageMeta(c.stage);
                return (
                  <button
                    key={c.id}
                    onClick={() => setDrawerContact(c.id)}
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
                        {c.name || "Bez nazwy"}
                      </div>
                      <div style={{ fontSize: 12, color: tokens.muted }}>
                        {c.company || "—"}
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
                      {formatPLN(c.value)}
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
                        {a.contacts?.name ? (
                          <span style={{ color: tokens.muted }}> · {a.contacts.name}</span>
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

      {drawerContact && (
        <ContactDrawer contactId={drawerContact} onClose={() => setDrawerContact(null)} />
      )}
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
