// lib/prospectHistory.ts — TRWAŁA historia kontaktu prospektu + licznik
// „Próby kontaktu". Wszystko żyje w prospects.props (jsonb) — bez migracji:
//   props.history          = ProspectEvent[] (append-only oś czasu)
//   props.contact_attempts = number (liczy WYŁĄCZNIE nieudane próby)
// Historia zastępuje dawną, sesyjną „Historię sesji" trybu dzwonienia i jest
// tym samym źródłem danych dla osi czasu w szufladzie prospektu.
import type { Prospect } from "@/lib/types";
import { notesFromProps } from "@/lib/prospectStatus";

export type ProspectEventType =
  | "note" // notatka
  | "no_answer" // nieudana próba kontaktu (podbija licznik)
  | "not_our_target" // oznaczenie „Nie nasz target" + archiwizacja
  | "converted" // konwersja na lead/deal
  | "status"; // inna zmiana statusu (np. przywrócenie po cofnięciu)

export type ProspectEvent = {
  id: string;
  type: ProspectEventType;
  /** Treść notatki (type 'note') lub dodatkowy opis. */
  body?: string;
  /** Numer próby kontaktu (1-based) — tylko dla 'no_answer'. */
  attempt?: number;
  created_at: string;
};

// Migawka pól prospektu zmienianych przez akcje — do cofania (Cofnij / toast).
export type ProspectSnapshot = {
  prospecting_status: string;
  archived_at: string | null;
  last_contact_attempt_at: string | null;
  props: Record<string, unknown>;
};

export function snapshotOf(p: Prospect): ProspectSnapshot {
  return {
    prospecting_status: p.prospecting_status,
    archived_at: p.archived_at ?? null,
    last_contact_attempt_at: p.last_contact_attempt_at ?? null,
    props: p.props ?? {},
  };
}

export function historyFromProps(props: Record<string, unknown> | null | undefined): ProspectEvent[] {
  const raw = props?.history;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is ProspectEvent =>
      !!e && typeof e === "object" && typeof (e as ProspectEvent).created_at === "string"
  );
}

export function attemptsFromProps(props: Record<string, unknown> | null | undefined): number {
  const n = props?.contact_attempts;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Pełna oś czasu do wyświetlenia: nowa historia + stare notatki (props.notes)
 * i pojedyncza notatka legacy (kolumna note) — scalone chronologicznie
 * (najnowsze pierwsze). Stare wpisy nie są nigdzie przepisywane — zero utraty.
 */
export function timelineOf(p: Prospect): ProspectEvent[] {
  const history = historyFromProps(p.props);
  const historyNoteIds = new Set(history.map((e) => e.id));
  const legacyNotes: ProspectEvent[] = notesFromProps(p.props)
    .filter((n) => !historyNoteIds.has(n.id))
    .map((n) => ({ id: n.id, type: "note" as const, body: n.body, created_at: n.created_at }));
  const legacySingle: ProspectEvent[] =
    p.note && p.note.trim()
      ? [
          {
            id: `legacy-note-${p.id}`,
            type: "note",
            body: p.note,
            created_at: p.last_contact_attempt_at ?? p.created_at,
          },
        ]
      : [];
  return [...history, ...legacyNotes, ...legacySingle].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1
  );
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function makeEvent(type: ProspectEventType, extra?: Partial<ProspectEvent>): ProspectEvent {
  return { id: makeId(), type, created_at: new Date().toISOString(), ...extra };
}

/** props z dopisanym wpisem historii (nie mutuje wejścia). */
export function propsWithEvent(
  props: Record<string, unknown> | null | undefined,
  event: ProspectEvent,
  patch?: Record<string, unknown>
): Record<string, unknown> {
  const base = { ...(props ?? {}) };
  return { ...base, ...patch, history: [...historyFromProps(base), event] };
}

// Etykieta wpisu osi czasu (spójna między trybem dzwonienia a szufladą).
export function eventLabel(e: ProspectEvent): string {
  switch (e.type) {
    case "note":
      return "Notatka";
    case "no_answer":
      return e.attempt ? `Nie odbiera · ${e.attempt}. próba` : "Nie odbiera";
    case "not_our_target":
      return "Nie nasz target";
    case "converted":
      return "Skonwertowano na lead";
    default:
      return e.body ?? "Zmiana statusu";
  }
}

export function eventIcon(e: ProspectEvent): string {
  switch (e.type) {
    case "note":
      return "sticky_note_2";
    case "no_answer":
      return "phone_missed";
    case "not_our_target":
      return "block";
    case "converted":
      return "check_circle";
    default:
      return "flag";
  }
}

export function eventColor(e: ProspectEvent, palette: { warning: string; danger: string; success: string; muted: string }): string {
  switch (e.type) {
    case "no_answer":
      return palette.warning;
    case "not_our_target":
      return palette.danger;
    case "converted":
      return palette.success;
    default:
      return palette.muted;
  }
}
