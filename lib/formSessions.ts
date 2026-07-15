// lib/formSessions.ts — §2/§3. Typy sesji i zdarzeń formularza (współdzielone).
// Sesja = jedna próba jednego gościa wypełnienia jednego formularza.

export type SessionStatus = "viewed" | "started" | "abandoned" | "completed";

export type FormSession = {
  id: string;
  form_id: string;
  owner: string;
  visitor_id: string;
  status: SessionStatus;
  started_at: string;
  last_seen_at: string;
  completed_at: string | null;
  max_step: number;
  last_step: number;
  total_steps: number;
  answers: Record<string, unknown>;
  meta: SessionMeta;
  consent: boolean;
  submission_id: string | null;
  created_at: string;
};

// Metadane żądania zebrane przy pierwszym zdarzeniu „view” (§3).
export type SessionMeta = {
  referrer?: string | null;
  url?: string | null;
  utm?: Record<string, string>;
  fbclid?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ua?: string | null;
  ip?: string | null;
  [key: string]: unknown;
};

export type FormEventType =
  | "form_viewed"
  | "step_viewed"
  | "step_completed"
  | "submitted"
  | "capi";

export type FormEvent = {
  id: string;
  session_id: string;
  form_id: string;
  owner: string;
  type: FormEventType;
  step_index: number | null;
  meta: Record<string, unknown>;
  created_at: string;
};

// §2. Domyślny próg porzucenia (minuty) — nadpisywalny w app_settings.
export const DEFAULT_ABANDON_MINUTES = 30;

// §2. Okno ciągłości sesji (minuty) — odświeżenie strony nie tworzy nowej sesji.
export const SESSION_CONTINUITY_MINUTES = 30;

// Czy sesja liczy się jako „porzucona” (started, ale nieukończona).
export function isAbandoned(s: Pick<FormSession, "status">): boolean {
  return s.status === "started" || s.status === "abandoned";
}

// Etykieta kroku porzucenia „3/6 — «Pytanie»” (§6). `total` z migawki sesji.
export function dropOffLabel(lastStep: number, total: number, question?: string | null): string {
  const pos = `${Math.min(lastStep + 1, Math.max(total, 1))}/${Math.max(total, 1)}`;
  const q = (question || "").trim();
  return q ? `${pos} — „${q}”` : pos;
}
