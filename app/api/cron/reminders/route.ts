// app/api/cron/reminders/route.ts — przypomnienia o terminach zadań.
// Wywoływane przez Vercel Cron (vercel.json) raz dziennie o 3:00.
// Wysyła właścicielowi e-mail o zadaniach, których termin wypada w ciągu
// najbliższych 24 godzin (okno dopasowane do dziennej częstotliwości crona).
//
// Ochrona: w środowisku produkcyjnym wymagamy nagłówka
//   Authorization: Bearer <CRON_SECRET>
// Vercel Cron dołącza go automatycznie, gdy ustawisz zmienną CRON_SECRET.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/ui";

export const dynamic = "force-dynamic";

// Jak daleko w przód patrzymy na terminy (godziny).
const WINDOW_HOURS = 24;

export async function GET(req: Request) {
  // ── Autoryzacja ────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Bez sekretu w produkcji endpoint byłby otwarty — blokujemy.
    console.error("[cron/reminders] Brak CRON_SECRET — endpoint zablokowany.");
    return NextResponse.json({ error: "Cron nie skonfigurowany" }, { status: 503 });
  }

  const db = createSupabaseAdmin();
  const now = new Date();
  const until = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);

  // Zadania z terminem w oknie, jeszcze niewykonane.
  const { data: tasks, error } = await db
    .from("tasks")
    .select("id, owner, title, due_at")
    .eq("done", false)
    .not("due_at", "is", null)
    .gte("due_at", now.toISOString())
    .lte("due_at", until.toISOString())
    .order("due_at", { ascending: true });

  if (error) {
    console.error("[cron/reminders]", error);
    return NextResponse.json({ error: "Błąd zapytania" }, { status: 500 });
  }

  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, tasks: 0 });
  }

  // Pogrupuj zadania po właścicielu — jeden zbiorczy e-mail na osobę.
  const byOwner = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = byOwner.get(t.owner) ?? [];
    list.push(t);
    byOwner.set(t.owner, list);
  }

  // Ustawienia powiadomień właścicieli (tylko ci z włączonym przypomnieniem).
  const owners = [...byOwner.keys()];
  const { data: settings } = await db
    .from("app_settings")
    .select("owner, email_task_due, notify_email")
    .in("owner", owners);

  const settingsByOwner = new Map((settings ?? []).map((s) => [s.owner, s]));

  let sent = 0;
  for (const [owner, ownerTasks] of byOwner) {
    const s = settingsByOwner.get(owner);
    if (!s?.email_task_due || !s.notify_email) continue;
    const ok = await sendReminder(s.notify_email, ownerTasks);
    if (ok) sent++;
  }

  return NextResponse.json({ ok: true, sent, tasks: tasks.length });
}

async function sendReminder(
  to: string,
  tasks: { title: string; due_at: string | null }[]
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    // Brak konfiguracji maila — traktujemy jako „nic do wysłania”, bez błędu.
    return false;
  }
  const rows = tasks
    .map((t) => `<li><b>${escapeHtml(t.title)}</b> — ${formatDateTime(t.due_at)}</li>`)
    .join("");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "Selltic <leady@twoja-domena.pl>",
        to,
        subject: `⏰ Przypomnienie: ${tasks.length} ${plural(tasks.length)} z terminem`,
        html: `<h2>Zbliżające się terminy zadań</h2><ul>${rows}</ul>`,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error("[cron/reminders] send", e);
    return false;
  }
}

function plural(n: number) {
  if (n === 1) return "zadanie";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "zadania";
  return "zadań";
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
