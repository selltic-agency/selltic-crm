// components/ViewTabs.tsx — zakładki zapisanych widoków (Attio-style, płaskie).
// Współdzielone przez Leady i Prospecting.
//
// Model:
//   • „Wszystkie" — stała pierwsza zakładka: brak filtrów (stan domyślny).
//   • zapisane widoki — po jednej zakładce na widok; menu ⋯: zmiana nazwy,
//     duplikacja, przesunięcie w lewo/prawo (kolejność), usunięcie.
//   • „+" — zapisz bieżący stan jako nowy widok.
//   • zmiany na AKTYWNYM widoku zapisują się automatycznie (autosave) —
//     zakładka tymczasowa istnieje tylko na „Wszystkie" (adhoc), skąd można
//     stan zapisać jako nowy widok.
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tokens, inputStyle, primaryButton, menuPanel } from "@/lib/ui";
import type { SavedView, SavedViewStorage } from "@/lib/savedViews";
import MIcon from "@/components/MaterialIcon";

export default function ViewTabs({
  views,
  activeId,
  adhoc,
  loading,
  storage = "db",
  error = null,
  archiveTab = null,
  onSelectAll,
  onSelectView,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onMove,
}: {
  views: SavedView[];
  activeId: string | null;
  /** true → na „Wszystkie" leży niezapisany stan (filtry/sort/kolumny). */
  adhoc: boolean;
  loading: boolean;
  storage?: SavedViewStorage;
  error?: string | null;
  /** Opcjonalna zakładka „Archiwum" (Prospecting). */
  archiveTab?: { active: boolean; count: number; onSelect: () => void } | null;
  onSelectAll: () => void;
  onSelectView: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (loading) return <div style={{ height: 34, marginBottom: 10 }} />;

  const allActive = activeId === null && !archiveTab?.active;

  function submitNew() {
    if (newName.trim()) {
      onCreate(newName.trim());
      setNewName("");
      setShowNew(false);
    }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        className="selltic-scroll-x"
        style={{ display: "flex", alignItems: "center", gap: 2, borderBottom: `1px solid ${tokens.border}`, overflowX: "auto" }}
      >
        <Tab active={allActive} onClick={onSelectAll} label="Wszystkie" adhoc={allActive && adhoc} />

        {archiveTab && (
          <Tab
            active={archiveTab.active}
            onClick={archiveTab.onSelect}
            label="Archiwum"
            count={archiveTab.count > 0 ? archiveTab.count : undefined}
          />
        )}

        {views.map((v, i) => {
          const isActive = activeId === v.id;
          if (renaming === v.id) {
            return (
              <div key={v.id} style={{ display: "flex", alignItems: "center", padding: "3px 4px" }}>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renameValue.trim()) {
                      onRename(v.id, renameValue.trim());
                      setRenaming(null);
                    }
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => {
                    if (renameValue.trim()) onRename(v.id, renameValue.trim());
                    setRenaming(null);
                  }}
                  style={{ ...inputStyle, width: 140, padding: "4px 8px", fontSize: 12.5 }}
                />
              </div>
            );
          }
          return (
            <div key={v.id} style={{ position: "relative", flexShrink: 0 }}>
              <Tab
                active={isActive}
                onClick={() => onSelectView(v.id)}
                label={v.name}
                // Menu widoku (zmiana nazwy / duplikacja / kolejność / usuń)
                // tylko na AKTYWNEJ zakładce — mniej wizualnego szumu, a samo
                // menu renderujemy przez portal (niżej), by nie przycinał go
                // poziomy pasek przewijania zakładek.
                trailing={
                  isActive ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Menu widoku"
                      data-viewmenu-open={menuFor === v.id ? "1" : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor(menuFor === v.id ? null : v.id);
                      }}
                      style={{ display: "flex", padding: 1, borderRadius: 4, marginLeft: 2, color: tokens.muted }}
                    >
                      <MIcon name="expand_more" size={15} />
                    </span>
                  ) : null
                }
              />
              {menuFor === v.id && (
                <ViewMenu
                  canMoveLeft={i > 0}
                  canMoveRight={i < views.length - 1}
                  onClose={() => setMenuFor(null)}
                  onRename={() => {
                    setRenameValue(v.name);
                    setRenaming(v.id);
                    setMenuFor(null);
                  }}
                  onDuplicate={() => {
                    onDuplicate(v.id);
                    setMenuFor(null);
                  }}
                  onMoveLeft={() => {
                    onMove(v.id, -1);
                    setMenuFor(null);
                  }}
                  onMoveRight={() => {
                    onMove(v.id, 1);
                    setMenuFor(null);
                  }}
                  onDelete={() => {
                    if (window.confirm(`Usunąć widok „${v.name}"? Tej operacji nie można cofnąć.`)) {
                      onDelete(v.id);
                    }
                    setMenuFor(null);
                  }}
                />
              )}
            </div>
          );
        })}

        {/* „+" — zapisz bieżący stan jako nowy widok. */}
        <div style={{ position: "relative", padding: "3px 2px", flexShrink: 0 }}>
          <button
            onClick={() => setShowNew((s) => !s)}
            title="Nowy widok z bieżącego stanu"
            aria-label="Nowy widok"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: tokens.muted,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <MIcon name="add" size={16} />
          </button>

          {showNew && (
            <div
              style={{
                ...menuPanel,
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 4,
                zIndex: 30,
                padding: 12,
                display: "flex",
                gap: 8,
                alignItems: "center",
                minWidth: 260,
              }}
            >
              <input
                autoFocus
                placeholder="Nazwa widoku…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                  if (e.key === "Escape") setShowNew(false);
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={submitNew} style={primaryButton}>
                Zapisz
              </button>
            </div>
          )}
        </div>
      </div>

      {(error || storage === "local") && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginTop: 6,
            fontSize: 12,
            fontWeight: 500,
            color: error ? tokens.danger : tokens.warning,
          }}
        >
          <MIcon name="warning" size={14} style={{ marginTop: 1 }} />
          <span>
            {error ??
              "Widoki zapisują się tylko w tej przeglądarce — tabela saved_views nie istnieje w bazie. Uruchom migration_saved_views.sql (Supabase → SQL Editor), aby zapisywać je na stałe."}
          </span>
        </div>
      )}
    </div>
  );
}

// Płaska zakładka: aktywna = ciemny tekst + akcentowe podkreślenie.
function Tab({
  active,
  onClick,
  label,
  count,
  adhoc,
  trailing,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  /** Kropka „niezapisane zmiany" (stan tymczasowy na „Wszystkie"). */
  adhoc?: boolean;
  trailing?: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "7px 10px",
        border: "none",
        borderBottom: `2px solid ${active ? tokens.accent : "transparent"}`,
        background: "transparent",
        color: active ? tokens.text : hover ? tokens.text : tokens.muted,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
        maxWidth: 220,
        flexShrink: 0,
        marginBottom: -1,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {typeof count === "number" && (
        <span style={{ fontSize: 11, fontWeight: 500, color: tokens.muted, background: tokens.bg, borderRadius: 999, padding: "0 6px", lineHeight: "16px" }}>
          {count}
        </span>
      )}
      {adhoc && (
        <span
          title="Niezapisany stan — zapisz jako widok przyciskiem +"
          style={{ width: 6, height: 6, borderRadius: "50%", background: tokens.accent, flexShrink: 0 }}
        />
      )}
      {trailing}
    </button>
  );
}

// Menu widoku renderowane PRZEZ PORTAL do <body> i pozycjonowane „fixed" —
// dzięki temu nie przycina go poziomy pasek przewijania zakładek (wcześniej
// menu było niewidoczne i nie dało się usuwać widoków).
function ViewMenu({
  canMoveLeft,
  canMoveRight,
  onClose,
  onRename,
  onDuplicate,
  onMoveLeft,
  onMoveRight,
  onDelete,
}: {
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Kotwica: aktywny trigger „⋯" oznaczony atrybutem data-viewmenu-open.
  useLayoutEffect(() => {
    const trigger = document.querySelector('[data-viewmenu-open="1"]') as HTMLElement | null;
    const r = trigger?.getBoundingClientRect();
    if (r) {
      const width = 176;
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
      setPos({ top: r.bottom + 6, left });
    }
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        ...menuPanel,
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        zIndex: 120,
        minWidth: 176,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <MenuItem icon="edit" label="Zmień nazwę" onClick={onRename} />
      <MenuItem icon="content_copy" label="Duplikuj" onClick={onDuplicate} />
      {canMoveLeft && <MenuItem icon="arrow_back" label="Przesuń w lewo" onClick={onMoveLeft} />}
      {canMoveRight && <MenuItem icon="arrow_forward" label="Przesuń w prawo" onClick={onMoveRight} />}
      <MenuItem icon="delete" label="Usuń widok" danger onClick={onDelete} />
    </div>,
    document.body
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        textAlign: "left",
        padding: "7px 11px",
        border: "none",
        background: "none",
        cursor: "pointer",
        fontSize: 13,
        color: danger ? tokens.danger : tokens.text,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      <MIcon name={icon} size={15} color={danger ? tokens.danger : tokens.muted} />
      {label}
    </button>
  );
}
