// lib/savedViews.ts — zapisane widoki (HubSpot-style) dla Leadów i Prospectingu.
// Zakładka = kombinacja filtrów + sortowania + trybu widoku, zapisana w bazie.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Filter, Sort } from "@/lib/filters";

export type SavedViewPage = "deals" | "prospecting";
export type ViewMode = "kanban" | "table";

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

export function useSavedViews(page: SavedViewPage, seedDefaults: () => Promise<SeedView[]>) {
  const supabase = useMemo(() => createClient(), []);
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("saved_views")
      .select("*")
      .eq("page", page)
      .order("position", { ascending: true });

    let rows = (data as SavedView[]) ?? [];

    if (rows.length === 0) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const seeds = await seedDefaults();
        const { data: inserted } = await supabase
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
        rows = (inserted as SavedView[]) ?? [];
      }
    }

    setViews(rows);
    setActiveId((prev) => prev ?? rows[0]?.id ?? null);
    setLoading(false);
  }, [supabase, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const activeView = useMemo(() => views.find((v) => v.id === activeId) ?? null, [views, activeId]);

  const createView = useCallback(
    async (name: string, state: { filters: Filter[]; sort: Sort | null; view_mode: ViewMode }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
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
      if (error || !data) return null;
      const created = data as SavedView;
      setViews((v) => [...v, created]);
      setActiveId(created.id);
      return created;
    },
    [supabase, page, views.length]
  );

  const updateView = useCallback(
    async (id: string, patch: Partial<Pick<SavedView, "name" | "view_mode" | "filters" | "sort">>) => {
      const { data, error } = await supabase.from("saved_views").update(patch).eq("id", id).select("*").single();
      if (error || !data) return;
      const updated = data as SavedView;
      setViews((list) => list.map((v) => (v.id === id ? updated : v)));
    },
    [supabase]
  );

  const deleteView = useCallback(
    async (id: string) => {
      const target = views.find((v) => v.id === id);
      if (!target || target.is_default) return;
      await supabase.from("saved_views").delete().eq("id", id);
      setViews((list) => list.filter((v) => v.id !== id));
      setActiveId((prev) => (prev === id ? views.find((v) => v.id !== id)?.id ?? null : prev));
    },
    [supabase, views]
  );

  return {
    views,
    activeId,
    activeView,
    loading,
    selectView: setActiveId,
    createView,
    updateView,
    deleteView,
    reload: load,
  };
}
