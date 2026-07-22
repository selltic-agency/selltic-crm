// lib/savedViews.ts — zapisane widoki (Attio-style) dla Leadów i Prospectingu.
// Zakładka = zapisany widok: filtry + sortowanie + tryb (tabela/kanban) +
// konfiguracja kolumn i kanbana (saved_views.config, migration_attio_redesign).
//
// Odporność: gdy tabela `saved_views` jest niedostępna (np. nie uruchomiono
// migration_saved_views.sql albo PostgREST ma nieświeży cache schematu),
// spadamy na localStorage (widoki działają od razu, per przeglądarka), a UI
// dostaje `storage` + `error`. Gdy istnieje tabela, ale bez kolumny `config`
// (przed migration_attio_redesign.sql), zapisy ponawiamy bez config.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Filter, Sort } from "@/lib/filters";

export type SavedViewPage = "deals" | "prospecting";
export type ViewMode = "kanban" | "table";

// Gdzie faktycznie żyją widoki: baza ('db') czy zapasowo localStorage ('local').
export type SavedViewStorage = "db" | "local";

// Preferencja pojedynczej kolumny tabeli w widoku.
export type ColumnPref = { key: string; visible: boolean; position: number };

// Konfiguracja widoku (per widok, nie globalna).
export type ViewConfig = {
  columns?: ColumnPref[];
  kanban?: {
    /** Klucze etapów UKRYTYCH w tym widoku (domyślnie wszystkie widoczne). */
    hiddenStages?: string[];
    /** Pola widoczne na kartach kanbana (domyślnie wszystkie). */
    cardFields?: string[];
  };
};

export type SavedView = {
  id: string;
  owner: string;
  page: SavedViewPage;
  name: string;
  view_mode: ViewMode;
  filters: Filter[];
  sort: Sort | null;
  config: ViewConfig;
  position: number;
  is_default: boolean;
  created_at: string;
};

export type ViewState = {
  filters: Filter[];
  sort: Sort | null;
  view_mode: ViewMode;
  config: ViewConfig;
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
    return Array.isArray(parsed) ? (parsed as SavedView[]).map(normalizeView) : [];
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

// Wiersz z bazy sprzed migracji nie ma `config` — normalizujemy do {}.
function normalizeView(v: SavedView): SavedView {
  return { ...v, config: (v.config ?? {}) as ViewConfig, filters: v.filters ?? [] };
}

// Czy błąd Supabase wygląda na brak kolumny `config` (przed migracją)?
function isMissingConfigColumn(message: string | undefined): boolean {
  return !!message && /config/.test(message) && /(column|schema)/i.test(message);
}

export function useSavedViews(page: SavedViewPage) {
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
      setStorage("local");
      setViews(readLocalViews(storageKeyRef.current));
      setLoading(false);
      return;
    }

    setStorage("db");
    setViews(((data as SavedView[]) ?? []).map(normalizeView));
    setLoading(false);
  }, [supabase, page]);

  useEffect(() => {
    load();
  }, [load]);

  const activeView = useMemo(() => views.find((v) => v.id === activeId) ?? null, [views, activeId]);

  const createView = useCallback(
    async (name: string, state: ViewState) => {
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
          config: state.config,
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
      const row = {
        owner: user.id,
        page,
        name,
        view_mode: state.view_mode,
        filters: state.filters,
        sort: state.sort,
        position: views.length,
        is_default: false,
      };
      let { data, error: insErr } = await supabase
        .from("saved_views")
        .insert({ ...row, config: state.config })
        .select("*")
        .single();
      if (insErr && isMissingConfigColumn(insErr.message)) {
        // Przed migration_attio_redesign.sql — zapisz bez konfiguracji kolumn.
        ({ data, error: insErr } = await supabase.from("saved_views").insert(row).select("*").single());
        if (!insErr) setError("Widok zapisany bez układu kolumn — uruchom migration_attio_redesign.sql, aby zapisywać pełną konfigurację.");
      }
      if (insErr || !data) {
        setError(`Nie udało się zapisać widoku: ${insErr?.message ?? "nieznany błąd"}`);
        return null;
      }
      const created = normalizeView(data as SavedView);
      setViews((v) => [...v, created]);
      setActiveId(created.id);
      return created;
    },
    [supabase, page, views, storage]
  );

  const updateView = useCallback(
    async (id: string, patch: Partial<Pick<SavedView, "name" | "view_mode" | "filters" | "sort" | "config" | "position">>) => {
      setError(null);

      // Optymistycznie w stanie lokalnym (autosave nie może migać).
      setViews((list) => list.map((v) => (v.id === id ? { ...v, ...patch } : v)));

      if (storage === "local") {
        setViews((list) => {
          writeLocalViews(storageKeyRef.current, list);
          return list;
        });
        return;
      }

      let { error: updErr } = await supabase.from("saved_views").update(patch).eq("id", id);
      if (updErr && isMissingConfigColumn(updErr.message) && "config" in patch) {
        const { config: _config, ...rest } = patch;
        if (Object.keys(rest).length > 0) {
          ({ error: updErr } = await supabase.from("saved_views").update(rest).eq("id", id));
        } else {
          updErr = null;
        }
        setError("Układ kolumn nie zapisuje się na stałe — uruchom migration_attio_redesign.sql.");
      }
      if (updErr) {
        setError(`Nie udało się zapisać zmian w widoku: ${updErr.message}`);
      }
    },
    [supabase, storage]
  );

  const duplicateView = useCallback(
    async (id: string) => {
      const src = views.find((v) => v.id === id);
      if (!src) return null;
      return createView(`${src.name} (kopia)`, {
        filters: src.filters,
        sort: src.sort,
        view_mode: src.view_mode,
        config: src.config,
      });
    },
    [views, createView]
  );

  const deleteView = useCallback(
    async (id: string) => {
      const target = views.find((v) => v.id === id);
      if (!target) return;
      setError(null);

      if (storage === "local") {
        const next = views.filter((v) => v.id !== id);
        setViews(next);
        writeLocalViews(storageKeyRef.current, next);
        setActiveId((prev) => (prev === id ? null : prev));
        return;
      }

      const { error: delErr } = await supabase.from("saved_views").delete().eq("id", id);
      if (delErr) {
        setError(`Nie udało się usunąć widoku: ${delErr.message}`);
        return;
      }
      setViews((list) => list.filter((v) => v.id !== id));
      setActiveId((prev) => (prev === id ? null : prev));
    },
    [supabase, views, storage]
  );

  /** Przesuń widok o jedną pozycję w lewo/prawo (kolejność zakładek). */
  const moveView = useCallback(
    async (id: string, dir: -1 | 1) => {
      const ordered = [...views].sort((a, b) => a.position - b.position);
      const i = ordered.findIndex((v) => v.id === id);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= ordered.length) return;
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      const renumbered = ordered.map((v, idx) => ({ ...v, position: idx }));
      setViews(renumbered);

      if (storage === "local") {
        writeLocalViews(storageKeyRef.current, renumbered);
        return;
      }
      await Promise.all(
        renumbered.map((v) => supabase.from("saved_views").update({ position: v.position }).eq("id", v.id))
      );
    },
    [views, storage, supabase]
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
    duplicateView,
    deleteView,
    moveView,
    reload: load,
  };
}
