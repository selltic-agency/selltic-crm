// lib/sms/values.ts — budowa wartości zmiennych szablonu z rekordu CRM.
// CZYSTY moduł (tylko typy) — używany przez /api/sms/send oraz przypomnienia.
import type { Assignee, Deal } from "@/lib/types";

const ASSIGNEE_LABEL: Record<Assignee, string> = { dominik: "Dominik", kuba: "Kuba" };

function firstToken(s: string | null | undefined): string {
  return (s || "").trim().split(/\s+/)[0] || "";
}

// Data spotkania po polsku, np. „24 lipca".
export function formatMeetingDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
}

// Godzina spotkania, np. „14:00".
export function formatMeetingTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

// Zmienne szablonu SMS dla deala (leada). `meeting` opcjonalne (przypomnienia).
export function dealSmsValues(
  deal: Pick<Deal, "name" | "company" | "assignee">,
  meeting?: { dueAt: string | null }
): Record<string, string> {
  return {
    first_name: firstToken(deal.name),
    company: deal.company ?? "",
    owner_name: deal.assignee ? ASSIGNEE_LABEL[deal.assignee] : "",
    meeting_date: meeting ? formatMeetingDate(meeting.dueAt) : "",
    meeting_time: meeting ? formatMeetingTime(meeting.dueAt) : "",
  };
}
