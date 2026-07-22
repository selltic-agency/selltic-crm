// lib/prospectActions.ts — wspólne akcje na prospekcie (tryb dzwonienia,
// szuflada szczegółów, lista). Każda akcja zapisuje wpis do TRWAŁEJ historii
// (props.history) i zwraca zaktualizowany rekord + migawkę sprzed zmiany,
// żeby przycisk/toast „Cofnij" mógł w pełni odwrócić skutki (status +
// archiwum + licznik prób + wpis historii).
"use client";

import { createClient } from "@/lib/supabase/client";
import type { Prospect } from "@/lib/types";
import {
  attemptsFromProps,
  makeEvent,
  propsWithEvent,
  snapshotOf,
  type ProspectSnapshot,
} from "@/lib/prospectHistory";

type Supa = ReturnType<typeof createClient>;

export type ActionResult = { updated: Prospect; snapshot: ProspectSnapshot } | null;

async function applyUpdate(
  supabase: Supa,
  id: string,
  update: Record<string, unknown>
): Promise<Prospect | null> {
  const { data, error } = await supabase.from("prospects").update(update).eq("id", id).select("*").single();
  if (error) {
    console.error("prospectActions: aktualizacja nie powiodła się:", error.message);
    return null;
  }
  return data as Prospect;
}

/** „Nie odbiera": wpis historii z numerem próby + licznik prób + status. */
export async function logNoAnswer(supabase: Supa, p: Prospect): Promise<ActionResult> {
  const snapshot = snapshotOf(p);
  const attempt = attemptsFromProps(p.props) + 1;
  const props = propsWithEvent(p.props, makeEvent("no_answer", { attempt }), {
    contact_attempts: attempt,
  });
  const updated = await applyUpdate(supabase, p.id, {
    prospecting_status: "contact_attempted",
    last_contact_attempt_at: new Date().toISOString(),
    props,
  });
  return updated ? { updated, snapshot } : null;
}

/** „Nie nasz target": odrębny status + archiwizacja + wpis historii. */
export async function markNotOurTarget(supabase: Supa, p: Prospect): Promise<ActionResult> {
  const snapshot = snapshotOf(p);
  const props = propsWithEvent(p.props, makeEvent("not_our_target"));
  const updated = await applyUpdate(supabase, p.id, {
    prospecting_status: "not_interested",
    archived_at: new Date().toISOString(),
    props,
  });
  return updated ? { updated, snapshot } : null;
}

/** Notatka — trafia do tej samej trwałej osi czasu. */
export async function addProspectNote(supabase: Supa, p: Prospect, body: string): Promise<ActionResult> {
  const snapshot = snapshotOf(p);
  const props = propsWithEvent(p.props, makeEvent("note", { body }));
  const updated = await applyUpdate(supabase, p.id, { props });
  return updated ? { updated, snapshot } : null;
}

/** Wpis „Skonwertowano" po udanej konwersji (sam deal tworzy endpoint API). */
export async function appendConvertEvent(supabase: Supa, p: Prospect): Promise<Prospect | null> {
  const props = propsWithEvent(p.props, makeEvent("converted"));
  return applyUpdate(supabase, p.id, { props });
}

/** Pełne cofnięcie ostatniej akcji — przywraca migawkę sprzed zmiany. */
export async function revertProspect(
  supabase: Supa,
  id: string,
  snapshot: ProspectSnapshot
): Promise<Prospect | null> {
  return applyUpdate(supabase, id, {
    prospecting_status: snapshot.prospecting_status,
    archived_at: snapshot.archived_at,
    last_contact_attempt_at: snapshot.last_contact_attempt_at,
    props: snapshot.props,
  });
}
