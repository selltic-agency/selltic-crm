// components/SavedViewTabs.tsx — pasek zapisanych widoków (Faza 8.6, styl HubSpot).
// Każdy widok to kombinacja: tryb (kanban/tabela) + filtry + sortowanie.
// Domyślne widoki ("Wszystkie", "Wygrane", "Przegrane") są zasiewane przy
// pierwszym uruchomieniu. Gdy tabela saved_views jest niedostępna (przed
// migracją), pasek po prostu się nie renderuje — reszta lejka działa dalej.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Reorder } from "framer-motion";
import { Plus, MoreHorizontal, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, ghostButton, primaryButton, inputStyle } from "@/lib/ui";
import { useStages } from "@/lib/stages";
import { useToast } from "@/components/Toast";
import { Filter } from "@/lib/filters";
import { SavedView, SortConfig } from "@/lib/types";

type CurrentState = {
  filters: Filter[];
  sort: SortConfig;
  viewMode: "kanban" | "table";
};

type SavedViewTabsProps = CurrentState & {
  // Czy pominąć automatyczne wczytanie widoku domyślnego (np. gdy filtry
  // przyszły z URL — wtedy URL ma pierwszeństwo i żaden widok nie jest aktywny).
  suppressInitialApply: boolean;
  onApply: (view: { filters: Filter[]; sort: SortConfig | null; view_mode: "kanban" | "table" }) => void;
};

// Porównanie bieżącego stanu z zapisanym widokiem (sort liczy się tylko w tabeli).
function isDirty(current: CurrentState, view: SavedView): boolean {
  if (current.viewMode !== view.view_mode) return true;
  if (JSON.stringify(current.filters) !== JSON.stringify(view.filters)) return true;
  if (current.viewMode === "table") {
    if (JSON.stringify(current.sort) !== JSON.stringify(view.sort)) return true;
  }
  return false;
}

export default function SavedViewTabs({
  filters,
  sort,
  viewMode,
  suppressInitialApply,
  onApply,
}: SavedViewTabsProps) {
  const supabase = useMemo(() => createClient(), []);
  const { stages, loading: stagesLoading } = useStages();
  const toast = useToast();

  const [views, setViews] = useState<SavedView[]>([]);
  const [available, setAvailable] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ mode: "create" | "rename"; id?: string; value: string } | null>(null);

  const seededRef = useRef(false);
  const initialAppliedRef = useRef(false);
  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("saved_views")
      .select("*")
      .order("position", { ascending: true });

    if (error) {
      setAvailable(false);
      return null;
    }
    const list = (data as SavedView[]) ?? [];
    setViews(list);
    return list;
  }, [supabase]);

  // Wczytanie + jednorazowy seed widoków domyślnych.
  useEffect(() => {
    if (stagesLoading) return; // poczekaj na etapy (klucze won/lost)
    (async () => {
      const list = await load();
      if (!list) return; // tabela niedostępna

      if (list.length === 0 && !seededRef.current) {
        seededRef.current = true;
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const wonKey = stages.find((s) => s.is_won)?.key ?? "won";
        const lostKey = stages.find((s) => s.is_lost)?.key ?? "lost";
        const defaults = [
          { name: "Wszystkie", view_mode: "kanban", filters: [], sort: null, position: 0, is_default: true },
          {
            name: "Wygrane",
            view_mode: "kanban",
            filters: [{ field: "stage", operator: "in", value: [wonKey] }],
            sort: null,
            position: 1,
            is_default: false,
          },
          {
            name: "Przegrane",
            view_mode: "kanban",
            filters: [{ field: "stage", operator: "in", value: [lostKey] }],
            sort: null,
            position: 2,
            is_default: false,
          },
        ].map((v) => ({ ...v, owner: user.id }));

        await supabase.from("saved_views").insert(defaults);
        await load();
      }
    })();
  }, [stagesLoading, stages, load, supabase]);

  // Po wczytaniu — automatycznie zastosuj widok domyślny (chyba że URL ma filtry).
  useEffect(() => {
    if (initialAppliedRef.current) return;
    if (suppressInitialApply || views.length === 0) return;
    initialAppliedRef.current = true;
    const def = views.find((v) => v.is_default) ?? views[0];
    setActiveId(def.id);
    onApply({ filters: def.filters ?? [], sort: def.sort ?? null, view_mode: def.view_mode });
  }, [views, suppressInitialApply, onApply]);

  // Zamykanie menu kontekstowego po kliknięciu gdziekolwiek indziej.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuFor]);

  const activeView = views.find((v) => v.id === activeId) ?? null;
  const dirty = activeView ? isDirty({ filters, sort, viewMode }, activeView) : false;

  function applyView(v: SavedView) {
    setActiveId(v.id);
    onApply({ filters: v.filters ?? [], sort: v.sort ?? null, view_mode: v.view_mode });
  }

  function persistOrder(next: SavedView[]) {
    setViews(next);
    if (posTimer.current) clearTimeout(posTimer.current);
    posTimer.current = setTimeout(() => {
      Promise.all(
        next.map((v, i) =>
          v.position === i
            ? Promise.resolve()
            : supabase.from("saved_views").update({ position: i }).eq("id", v.id)
        )
      );
    }, 500);
  }

  async function createView(name: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("saved_views")
      .insert({
        owner: user.id,
        name,
        view_mode: viewMode,
        filters,
        sort: viewMode === "table" ? sort : null,
        position: views.length,
        is_default: false,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error("Nie udało się zapisać widoku.");
      return;
    }
    await load();
    setActiveId((data as SavedView).id);
    toast.success("Widok zapisany.");
  }

  async function saveChanges() {
    if (!activeView) return;
    const patch = {
      view_mode: viewMode,
      filters,
      sort: viewMode === "table" ? sort : null,
    };
    const { error } = await supabase.from("saved_views").update(patch).eq("id", activeView.id);
    if (error) {
      toast.error("Nie udało się zapisać zmian.");
      return;
    }
    await load();
    toast.success("Zmiany zapisane.");
  }

  async function renameView(id: string, name: string) {
    await supabase.from("saved_views").update({ name }).eq("id", id);
    await load();
  }

  async function duplicateView(v: SavedView) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("saved_views")
      .insert({
        owner: user.id,
        name: `${v.name} (kopia)`,
        view_mode: v.view_mode,
        filters: v.filters,
        sort: v.sort,
        position: views.length,
        is_default: false,
      })
      .select()
      .single();
    await load();
    if (data) setActiveId((data as SavedView).id);
  }

  async function deleteView(v: SavedView) {
    if (!window.confirm(`Usunąć widok „${v.name}"?`)) return;
    await supabase.from("saved_views").delete().eq("id", v.id);
    if (activeId === v.id) setActiveId(null);
    await load();
    toast.success("Widok usunięty.");
  }

  async function setDefault(v: SavedView) {
    // Tylko jeden widok może być domyślny.
    await supabase.from("saved_views").update({ is_default: false }).eq("owner", v.owner);
    await supabase.from("saved_views").update({ is_default: true }).eq("id", v.id);
    await load();
    toast.success(`„${v.name}" jest teraz widokiem domyślnym.`);
  }

  if (!available || views.length === 0) {
    // Brak tabeli (przed migracją) lub jeszcze przed zasiewem — nie blokuj lejka.
    return null;
  }

  return (
    <div style={{ marginBottom: 16, borderBottom: `1px solid ${tokens.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <Reorder.Group
          axis="x"
          values={views}
          onReorder={persistOrder}
          style={{ display: "flex", alignItems: "center", gap: 4, listStyle: "none", margin: 0, padding: 0, flexWrap: "wrap" }}
        >
          {views.map((v) => {
            const active = v.id === activeId;
            return (
              <Reorder.Item
                key={v.id}
                value={v}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "9px 12px",
                  cursor: "pointer",
                  borderBottom: `2px solid ${active ? tokens.accent : "transparent"}`,
                  color: active ? tokens.accent : tokens.muted,
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
                onClick={() => applyView(v)}
              >
                <span>{v.name}</span>
                {v.is_default && (
                  <span style={{ fontSize: 10, color: tokens.muted, fontWeight: 700 }} title="Widok domyślny">
                    ★
                  </span>
                )}
                {active && dirty && (
                  <span
                    title="Niezapisane zmiany"
                    style={{ width: 6, height: 6, borderRadius: "50%", background: tokens.warning }}
                  />
                )}
                <button
                  aria-label="Opcje widoku"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor(menuFor === v.id ? null : v.id);
                  }}
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    color: tokens.muted,
                    display: "grid",
                    placeItems: "center",
                    padding: 2,
                    borderRadius: 6,
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>

                {menuFor === v.id && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: 4,
                      zIndex: 40,
                      background: tokens.card,
                      border: `1px solid ${tokens.border}`,
                      borderRadius: 10,
                      boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
                      minWidth: 170,
                      padding: 6,
                    }}
                  >
                    <MenuItem label="Zmień nazwę" onClick={() => { setNaming({ mode: "rename", id: v.id, value: v.name }); setMenuFor(null); }} />
                    <MenuItem label="Duplikuj" onClick={() => { duplicateView(v); setMenuFor(null); }} />
                    <MenuItem label="Ustaw jako domyślny" onClick={() => { setDefault(v); setMenuFor(null); }} disabled={v.is_default} />
                    <MenuItem label="Usuń" danger onClick={() => { deleteView(v); setMenuFor(null); }} />
                  </div>
                )}
              </Reorder.Item>
            );
          })}
        </Reorder.Group>

        <button
          aria-label="Zapisz bieżący widok"
          title="Zapisz bieżący widok jako nowy"
          onClick={() => setNaming({ mode: "create", value: "" })}
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            color: tokens.muted,
            display: "grid",
            placeItems: "center",
            padding: "8px 10px",
          }}
        >
          <Plus size={16} />
        </button>

        {dirty && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, paddingBottom: 6 }}>
            <button
              onClick={saveChanges}
              style={{ ...primaryButton, padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
            >
              <Check size={14} />
              Zapisz zmiany
            </button>
            <button
              onClick={() => setNaming({ mode: "create", value: "" })}
              style={{ ...ghostButton, padding: "6px 12px", fontSize: 12 }}
            >
              Zapisz jako nowy
            </button>
          </div>
        )}
      </div>

      {naming && (
        <NameModal
          title={naming.mode === "create" ? "Zapisz widok" : "Zmień nazwę widoku"}
          initial={naming.value}
          onCancel={() => setNaming(null)}
          onSubmit={(name) => {
            if (naming.mode === "create") createView(name);
            else if (naming.id) renameView(naming.id, name);
            setNaming(null);
          }}
        />
      )}
    </div>
  );
}

function MenuItem({ label, onClick, danger, disabled }: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        border: "none",
        background: "none",
        borderRadius: 7,
        cursor: disabled ? "default" : "pointer",
        fontSize: 13,
        fontWeight: 500,
        color: disabled ? tokens.muted : danger ? tokens.danger : tokens.text,
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = tokens.bg; }}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {label}
    </button>
  );
}

function NameModal({
  title,
  initial,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();

  return (
    <>
      <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 50 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(380px, calc(100vw - 32px))",
          background: tokens.card,
          borderRadius: tokens.radius,
          border: `1px solid ${tokens.border}`,
          boxShadow: "0 24px 60px rgba(15,18,28,0.18)",
          zIndex: 51,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{title}</h2>
          <button onClick={onCancel} aria-label="Zamknij" style={{ border: "none", background: "none", cursor: "pointer", color: tokens.muted }}>
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) onSubmit(trimmed);
          }}
          style={{ display: "grid", gap: 14 }}
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Nazwa widoku"
            style={inputStyle}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" onClick={onCancel} style={ghostButton}>
              Anuluj
            </button>
            <button type="submit" disabled={!trimmed} style={{ ...primaryButton, opacity: trimmed ? 1 : 0.5 }}>
              Zapisz
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
