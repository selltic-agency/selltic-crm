// app/admin/tasks/page.tsx — samodzielne zarządzanie zadaniami.
// Dodawanie, oznaczanie jako zrobione / ponowne otwarcie, usuwanie.
// Optymistyczny UI; zadania powiązane z kontaktem otwierają ContactDrawer.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Clock, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  tokens,
  inputStyle,
  primaryButton,
  formatDateTime,
} from "@/lib/ui";
import type { Task } from "@/lib/types";
import ContactDrawer from "@/components/ContactDrawer";
import { useToast } from "@/components/Toast";

export default function TasksPage() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [adding, setAdding] = useState(false);
  const [drawerContact, setDrawerContact] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tasks")
      .select("*, contacts(id, name)")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    setTasks((data as Task[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addTask(e?: React.FormEvent) {
    e?.preventDefault();
    if (!title.trim() || adding) return;
    setAdding(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setAdding(false);
      return;
    }
    const due_at = due ? new Date(due).toISOString() : null;
    const { data, error } = await supabase
      .from("tasks")
      .insert({ owner: user.id, title: title.trim(), due_at })
      .select("*, contacts(id, name)")
      .single();
    if (!error && data) {
      setTasks((list) => [...list, data as Task]);
      setTitle("");
      setDue("");
      toast.success("Zadanie dodane.");
    } else if (error) {
      toast.error("Nie udało się dodać zadania.");
    }
    setAdding(false);
  }

  async function toggleDone(task: Task) {
    const next = !task.done;
    setTasks((list) =>
      list.map((t) => (t.id === task.id ? { ...t, done: next } : t))
    );
    const { error } = await supabase
      .from("tasks")
      .update({ done: next })
      .eq("id", task.id);
    if (error) {
      // cofnij przy błędzie
      setTasks((list) =>
        list.map((t) => (t.id === task.id ? { ...t, done: !next } : t))
      );
    } else if (next) {
      toast.success("Zadanie wykonane ✓");
    }
  }

  async function removeTask(task: Task) {
    if (!confirm(`Usunąć zadanie „${task.title}”?`)) return;
    const snapshot = tasks;
    setTasks((list) => list.filter((t) => t.id !== task.id));
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) {
      setTasks(snapshot);
      toast.error("Nie udało się usunąć zadania.");
    }
  }

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>Zadania</h1>

      {/* Formularz dodawania */}
      <form
        onSubmit={addTask}
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          background: tokens.card,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <input
          placeholder="Co trzeba zrobić?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ ...inputStyle, flex: "2 1 240px" }}
        />
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          style={{ ...inputStyle, flex: "1 1 180px" }}
        />
        <button type="submit" disabled={adding} style={{ ...primaryButton, display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} />
          {adding ? "Dodawanie…" : "Dodaj"}
        </button>
      </form>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : (
        <>
          {/* Otwarte */}
          <SectionLabel>Otwarte ({open.length})</SectionLabel>
          {open.length === 0 ? (
            <Empty>Brak otwartych zadań 🎉</Empty>
          ) : (
            <div style={{ display: "grid", gap: 8, marginBottom: 28 }}>
              {open.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggle={() => toggleDone(t)}
                  onDelete={() => removeTask(t)}
                  onOpenContact={(id) => setDrawerContact(id)}
                />
              ))}
            </div>
          )}

          {/* Zrobione */}
          {done.length > 0 && (
            <>
              <SectionLabel>Zrobione ({done.length})</SectionLabel>
              <div style={{ display: "grid", gap: 8 }}>
                {done.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={() => toggleDone(t)}
                    onDelete={() => removeTask(t)}
                    onOpenContact={(id) => setDrawerContact(id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {drawerContact && (
        <ContactDrawer
          contactId={drawerContact}
          onClose={() => setDrawerContact(null)}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  onOpenContact,
}: {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
  onOpenContact: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: 12,
        padding: "12px 14px",
        opacity: task.done ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={task.done}
        onChange={onToggle}
        style={{ width: 18, height: 18, cursor: "pointer", accentColor: tokens.accent }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            textDecoration: task.done ? "line-through" : "none",
          }}
        >
          {task.title}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 3, flexWrap: "wrap" }}>
          {task.due_at && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: tokens.muted }}>
              <Clock size={13} />
              {formatDateTime(task.due_at)}
            </span>
          )}
          {task.contacts && task.contact_id && (
            <button
              onClick={() => onOpenContact(task.contact_id!)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: tokens.accent,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              <User size={13} />
              {task.contacts.name || "Kontakt"}
            </button>
          )}
        </div>
      </div>
      <button
        onClick={onDelete}
        aria-label="Usuń"
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          border: `1px solid ${tokens.border}`,
          background: "#fff",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <Trash2 size={15} color={tokens.muted} />
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: tokens.muted,
        margin: "0 0 10px",
      }}
    >
      {children}
    </h2>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 14,
        color: tokens.muted,
        background: tokens.card,
        border: `1px dashed ${tokens.border}`,
        borderRadius: 12,
        padding: 16,
        marginBottom: 28,
      }}
    >
      {children}
    </p>
  );
}
