// lib/savedViews.ts — zapisane widoki (HubSpot-style) dla Leadów i Prospectingu.
// Zakładka = kombinacja filtrów + sortowania + trybu widoku, zapisana w bazie.
//
// Odporność (jak lib/stages.tsx): gdy tabela `saved_views` jest niedostępna
// (np. nie uruchomiono migration_saved_views.sql albo PostgREST ma nieświeży
// cache schematu), NIE wolno cicho połykać błędów — wcześniej przez to
// „Zapisz widok" nie robiło nic i nie pojawiały się nawet domyślne zakładki.
// Teraz: spadamy na localStorage (widoki działają od razu, per przeglądarka),
// a UI dostaje `storage` + `error`, żeby pokazać co się dzieje i jak to
// naprawić na stałe (uruchomić migrację).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Filter, Sort } from "@/lib/filters";

export type SavedViewPage = "deals" | "prospecting";
export type ViewMode = "kanban" | "table";

// Gdzie faktycznie żyją widoki: baza ('db') czy zapasowo localStorage ('local').
export type SavedViewStorage = "db" | "local";

export type SavedView = {
  id: string;
  owner: string;
  page: SavedViewPage;
  name: string;
  view_mode: ViewMode;
  filters: Filter[];
  sort: Sort | null;
  position: number;
  is_default: boolean;
  created_at: string;
};

export type SeedView = {
  name: string;
  view_mode: ViewMode;
  filters: Filter[];
  sort: Sort | null;
};

// ── Zapasowy magazyn w localStorage (per strona, per użytkownik) ─────────
function localKey(page: SavedViewPage, userId: string | null): string {
  return `selltic_saved_views::${page}::${userId ?? "anon"}`;
}

function readLocalViews(key: string): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}

function writeLocalViews(key: string, views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(views));
  } catch {
    /* quota / tryb prywatny — best-effort */
  }
}

function makeLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param ready — pozwala poczekać z wczytaniem/zasiewem, aż dane wejściowe
 * `seedDefaults` będą gotowe (Leady: etapy lejka ładują się asynchronicznie;
 * bez tego domyślne widoki „Wygrane"/„Przegrane" potrafiły zostać zasiane
 * z pustymi filtrami i tak już zostać).
 */
export function useSavedViews(
  page: SavedViewPage,
  seedDefaults: () => Promise<SeedView[]>,
  ready: boolean = true
) {
  const supabase = useMemo(() => createClient(), []);
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [storage, setStorage] = useState<SavedViewStorage>("db");
  const [error, setError] = useState<string | null>(null);
  const storageKeyRef = useRef<string>(localKey(page, null));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: selErr } = await supabase
      .from("saved_views")
      .select("*")
      .eq("page", page)
      .order("position", { ascending: true });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    storageKeyRef.current = localKey(page, user?.id ?? null);

    // Tabela niedostępna (brak migracji / nieświeży cache PostgREST) →
    // widoki działają dalej, tylko lokalnie w tej przeglądarce.
    if (selErr) {
      console.error("saved_views: odczyt z bazy nie powiódł się, fallback localStorage:", selErr.message);
      let rows = readLocalViews(storageKeyRef.current);
      if (rows.length === 0) {
        const seeds = await seedDefaults();
        rows = seeds.map((s, i) => ({
          id: makeLocalId(),
          owner: user?.id ?? "local",
          page,
          name: s.name,
          view_mode: s.view_mode,
          filters: s.filters,
          sort: s.sort,
          position: i,
          is_default: true,
          created_at: new Date().toISOString(),
        }));
        writeLocalViews(storageKeyRef.current, rows);
      }
      setStorage("local");
      setViews(rows);
      // Brak auto-selekcji: stan początkowy to „Wszystkie" (activeId === null).
      setLoading(false);
      return;
    }

    let rows = (data as SavedView[]) ?? [];

    if (rows.length === 0 && user) {
      const seeds = await seedDefaults();
      const { data: inserted, error: insErr } = await supabase
        .from("saved_views")
        .insert(
          seeds.map((s, i) => ({
            owner: user.id,
            page,
            name: s.name,
            view_mode: s.view_mode,
            filters: s.filters,
            sort: s.sort,
            position: i,
            is_default: true,
          }))
        )
        .select("*");
      if (insErr) {
        setError(`Nie udało się utworzyć domyślnych widoków: ${insErr.message}`);
      }
      rows = (inserted as SavedView[]) ?? [];
    }

    setStorage("db");
    setViews(rows);
    // Brak auto-selekcji: stan początkowy to „Wszystkie" (activeId === null).
    setLoading(false);
  }, [supabase, page, seedDefaults]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const activeView = useMemo(() => views.find((v) => v.id === activeId) ?? null, [views, activeId]);

  const createView = useCallback(
    async (name: string, state: { filters: Filter[]; sort: Sort | null; view_mode: ViewMode }) => {
      setError(null);

      if (storage === "local") {
        const created: SavedView = {
          id: makeLocalId(),
          owner: "local",
          page,
          name,
          view_mode: state.view_mode,
          filters: state.filters,
          sort: state.sort,
          position: views.length,
          is_default: false,
          created_at: new Date().toISOString(),
        };
        const next = [...views, created];
        setViews(next);
        writeLocalViews(storageKeyRef.current, next);
        setActiveId(created.id);
        return created;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sesja wygasła — zaloguj się ponownie, aby zapisać widok.");
        return null;
      }
      const { data, error: insErr } = await supabase
        .from("saved_views")
        .insert({
          owner: user.id,
          page,
          name,
          view_mode: state.view_mode,
          filters: state.filters,
          sort: state.sort,
          position: views.length,
          is_default: false,
        })
        .select("*")
        .single();
      if (insErr || !data) {
        setError(`Nie udało się zapisać widoku: ${insErr?.message ?? "nieznany błąd"}`);
        return null;
      }
      const created = data as SavedView;
      setViews((v) => [...v, created]);
      setActiveId(created.id);
      return created;
    },
    [supabase, page, views, storage]
  );

  const updateView = useCallback(
    async (id: string, patch: Partial<Pick<SavedView, "name" | "view_mode" | "filters" | "sort">>) => {
      setError(null);

      if (storage === "local") {
        setViews((list) => {
          const next = list.map((v) => (v.id === id ? { ...v, ...patch } : v));
          writeLocalViews(storageKeyRef.current, next);
          return next;
        });
        return;
      }

      const { data, error: updErr } = await supabase
        .from("saved_views")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (updErr || !data) {
        setError(`Nie udało się zapisać zmian w widoku: ${updErr?.message ?? "nieznany błąd"}`);
        return;
      }
      const updated = data as SavedView;
      setViews((list) => list.map((v) => (v.id === id ? updated : v)));
    },
    [supabase, storage]
  );

  const deleteView = useCallback(
    async (id: string) => {
      const target = views.find((v) => v.id === id);
      if (!target || target.is_default) return;
      setError(null);

      if (storage === "local") {
        const next = views.filter((v) => v.id !== id);
        setViews(next);
        writeLocalViews(storageKeyRef.current, next);
        setActiveId((prev) => (prev === id ? next[0]?.id ?? null : prev));
        return;
      }

      const { error: delErr } = await supabase.from("saved_views").delete().eq("id", id);
      if (delErr) {
        setError(`Nie udało się usunąć widoku: ${delErr.message}`);
        return;
      }
      setViews((list) => list.filter((v) => v.id !== id));
      setActiveId((prev) => (prev === id ? views.find((v) => v.id !== id)?.id ?? null : prev));
    },
    [supabase, views, storage]
  );

  return {
    views,
    activeId,
    activeView,
    loading,
    storage,
    error,
    selectView: setActiveId,
    createView,
    updateView,
    deleteView,
    reload: load,
  };
}
