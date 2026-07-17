// app/api/cron/sms/route.ts — godzinowy cron SMS. Wołany przez GitHub Actions
// (.github/workflows/sms-cron.yml) z nagłówkiem Authorization: Bearer <CRON_SECRET>
// — jak abandon-sessions (plan Vercel Hobby nie daje godzinowego crona). Robi dwie
// rzeczy, obie idempotentne:
//   1) drenaż wysyłek ZAPLANOWANYCH (opóźnione potwierdzenia z formularzy),
//   2) PRZYPOMNIENIA o spotkaniach (zadania z terminem w ciągu 24 h, z numerem,
//      bez wcześniej wysłanego przypomnienia).
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { deliverQueuedRow, dispatchSms } from "@/lib/sms/service";
import { buildDlrNotifyUrl, getAppBaseUrl } from "@/lib/sms/provider";
import { toE164 } from "@/lib/phone";
import { dealSmsValues } from "@/lib/sms/values";
import { renderSmsTemplate } from "@/lib/sms/templates";
import type { Assignee, SmsMessage, SmsTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

const WINDOW_HOURS = 24;
const DRAIN_LIMIT = 200;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[cron/sms] Brak CRON_SECRET — endpoint zablokowany.");
    return NextResponse.json({ error: "Cron nie skonfigurowany" }, { status: 503 });
  }

  const db = createSupabaseAdmin();
  const notifyUrl = buildDlrNotifyUrl(getAppBaseUrl());

  const drained = await drainScheduled(db, notifyUrl);
  const reminders = await sendMeetingReminders(db, notifyUrl);

  return NextResponse.json({ ok: true, drained, reminders });
}

// 1) Wysyłki zaplanowane, których termin już minął.
async function drainScheduled(
  db: ReturnType<typeof createSupabaseAdmin>,
  notifyUrl?: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: rows } = await db
    .from("sms_messages")
    .select("*")
    .eq("status", "queued")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", nowIso)
    .limit(DRAIN_LIMIT);

  let sent = 0;
  for (const row of (rows ?? []) as SmsMessage[]) {
    const outcome = await deliverQueuedRow(db, row, notifyUrl);
    if (outcome.ok) sent++;
  }
  return sent;
}

// 2) Przypomnienia o spotkaniach: zadania z terminem w oknie 24 h, z numerem
//    telefonu na dealu i bez wysłanego wcześniej przypomnienia.
async function sendMeetingReminders(
  db: ReturnType<typeof createSupabaseAdmin>,
  notifyUrl?: string
): Promise<number> {
  const now = new Date();
  const until = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);

  const { data: tasks } = await db
    .from("tasks")
    .select("id, owner, title, due_at, deal_id, deals(id, name, phone, company, assignee)")
    .eq("done", false)
    .is("sms_reminder_sent_at", null)
    .not("due_at", "is", null)
    .not("deal_id", "is", null)
    .gte("due_at", now.toISOString())
    .lte("due_at", until.toISOString())
    .limit(DRAIN_LIMIT);

  if (!tasks || tasks.length === 0) return 0;

  // Szablon przypomnień per właściciel (app_settings.sms_reminder_template_id).
  const owners = [...new Set(tasks.map((t) => t.owner as string))];
  const { data: settings } = await db
    .from("app_settings")
    .select("owner, sms_reminder_template_id")
    .in("owner", owners);
  const templateIdByOwner = new Map(
    (settings ?? []).map((s) => [s.owner as string, s.sms_reminder_template_id as string | null])
  );
  const templateCache = new Map<string, SmsTemplate | null>();

  async function templateFor(owner: string): Promise<SmsTemplate | null> {
    const tid = templateIdByOwner.get(owner);
    if (!tid) return null;
    if (templateCache.has(tid)) return templateCache.get(tid)!;
    const { data } = await db.from("sms_templates").select("*").eq("id", tid).maybeSingle();
    const tpl = (data as SmsTemplate) ?? null;
    templateCache.set(tid, tpl);
    return tpl;
  }

  let sent = 0;
  for (const task of tasks) {
    // Supabase typuje osadzoną relację jako tablicę bez wygenerowanych typów DB;
    // przy relacji do-jednego to obiekt. Rzutujemy przez unknown.
    const deal = (task.deals ?? null) as unknown as
      | { id: string; name: string | null; phone: string | null; company: string | null; assignee: Assignee | null }
      | null;
    if (!deal?.phone) continue;
    const to = toE164(deal.phone);
    if (!to) continue; // numer nie do odzyskania — pomijamy (nie oznaczamy jako wysłane)
    const tpl = await templateFor(task.owner as string);
    if (!tpl) continue;

    const values = dealSmsValues(deal, { dueAt: task.due_at as string });
    const { text } = renderSmsTemplate(tpl.body, values, "graceful");

    const outcome = await dispatchSms(db, {
      owner: task.owner as string,
      to,
      body: text,
      kind: "transactional", // przypomnienie o umówionym spotkaniu = transakcyjne
      trigger: "meeting_reminder",
      relatedType: "deal",
      relatedId: deal.id,
      templateId: tpl.id,
      notifyUrl,
      logActivity: true,
    });

    // Oznacz jako wysłane niezależnie od wyniku providera, żeby nie ponawiać w kółko
    // (błąd zostawia wiersz `failed` — audytowalny).
    if (outcome.ok || outcome.reason === "provider") {
      await db.from("tasks").update({ sms_reminder_sent_at: new Date().toISOString() }).eq("id", task.id);
    }
    if (outcome.ok) sent++;
  }
  return sent;
}
