// components/ViewTabs.tsx — zakładki zapisanych widoków w stylu kart przeglądarki
// (Chrome-tabs). Współdzielone przez Leady i Prospecting — IDENTYCZNY komponent,
// interakcje i wygląd na obu stronach.
//
// Model:
//   • „Wszystkie" — stała pierwsza zakładka: brak filtrów (stan domyślny).
//   • zapisane widoki — po jednej zakładce na widok (przełączanie / zmiana
//     nazwy / usuwanie), ŻADEN nie jest aktywny na wejściu.
//   • „+" — zapisz bieżący stan jako nowy widok (nowa zakładka).
//   • filtr tymczasowy (ad-hoc) — gdy bieżące filtry różnią się od aktywnej
//     zakładki, pojawia się WYRÓŻNIONA (przerywana) zakładka tymczasowa,
//     nałożona na bieżącą. Wyczyszczenie jej NIE rusza żadnego zapisanego
//     widoku; można ją zapisać jako nowy widok lub (na widoku) zapisać zmiany.
"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, MoreHorizontal, Plus, Save, X } from "lucide-react";
import { tokens, inputStyle, primaryButton } from "@/lib/ui";
import type { SavedView, SavedViewStorage } from "@/lib/savedViews";

export default function ViewTabs({
  views,
  activeId,
  adhoc,
  loading,
  storage = "db",
  error = null,
  onSelectAll,
  onSelectView,
  onCreate,
  onRename,
  onDelete,
  onSaveChanges,
  onClearAdhoc,
}: {
  views: SavedView[];
  activeId: string | null;
  /** true → na bieżącej zakładce leży niezapisany filtr tymczasowy. */
  adhoc: boolean;
  loading: boolean;
  storage?: SavedViewStorage;
  error?: string | null;
  onSelectAll: () => void;
  onSelectView: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSaveChanges: () => void;
  onClearAdhoc: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (loading) return null;

  const activeView = views.find((v) => v.id === activeId) ?? null;
  // Zakładka „bazowa" jest aktywna tylko, gdy NIE leży na niej filtr tymczasowy.
  const allActive = activeId === null && !adhoc;

  function submitNew() {
    if (newName.trim()) {
      onCreate(newName.trim());
      setNewName("");
      setShowNew(false);
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 4, borderBottom: `1px solid ${tokens.border}`, paddingBottom: 0 }}>
        {/* Zakładka „Wszystkie" — stan domyślny (brak filtrów). */}
        <Tab active={allActive} onClick={onSelectAll} label="Wszystkie" />

        {/* Zakładki zapisanych widoków. */}
        {views.map((v) => {
          const isActive = activeId === v.id && !adhoc;
          if (renaming === v.id) {
            return (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 6px" }}>
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
                  style={{ ...inputStyle, width: 140, padding: "6px 10px", fontSize: 13 }}
                />
              </div>
            );
          }
          return (
            <div key={v.id} style={{ position: "relative" }}>
              <Tab
                active={isActive}
                onClick={() => onSelectView(v.id)}
                label={v.name}
                trailing={
                  !v.is_default ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Menu widoku"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor(menuFor === v.id ? null : v.id);
                      }}
                      style={{ display: "flex", padding: 2, borderRadius: 4, marginLeft: 2, color: isActive ? tokens.accent : tokens.muted }}
                    >
                      <MoreHorizontal size={14} />
                    </span>
                  ) : null
                }
              />
              {menuFor === v.id && (
                <ViewMenu
                  onClose={() => setMenuFor(null)}
                  onRename={() => {
                    setRenameValue(v.name);
                    setRenaming(v.id);
                    setMenuFor(null);
                  }}
                  onDelete={() => {
                    onDelete(v.id);
                    setMenuFor(null);
                  }}
                />
              )}
            </div>
          );
        })}

        {/* Zakładka tymczasowa (ad-hoc) — wyróżniona, nietrwała. */}
        {adhoc && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10,
              border: `1px dashed ${tokens.accent}`,
              borderBottom: "none",
              background: tokens.accentSoft,
              color: tokens.accent,
              fontSize: 13,
              fontWeight: 600,
              fontStyle: "italic",
              position: "relative",
              top: 1,
            }}
            title="Filtr tymczasowy — nałożony na bieżącą zakładkę, niezapisany."
          >
            <span>Filtr tymczasowy</span>
            <button
              onClick={onClearAdhoc}
              aria-label="Wyczyść filtr tymczasowy"
              title="Wyczyść filtr tymczasowy"
              style={{ border: "none", background: "none", cursor: "pointer", display: "flex", padding: 0, color: tokens.accent }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* „+" — zapisz bieżący stan jako nowy widok. */}
        <div style={{ position: "relative", padding: "4px 4px 6px" }}>
          <button
            onClick={() => setShowNew((s) => !s)}
            title="Zapisz jako nowy widok"
            aria-label="Zapisz jako nowy widok"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: `1px dashed ${tokens.border}`,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: tokens.muted,
            }}
          >
            <Plus size={15} />
          </button>

          {showNew && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 4,
                zIndex: 30,
                background: "#fff",
                border: `1px solid ${tokens.border}`,
                borderRadius: 12,
                boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
                padding: 14,
                display: "flex",
                gap: 8,
                alignItems: "center",
                minWidth: 260,
              }}
            >
              <input
                autoFocus
                placeholder="Nazwa widoku..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                  if (e.key === "Escape") setShowNew(false);
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={submitNew} style={{ ...primaryButton, padding: "9px 14px" }}>
                Zapisz
              </button>
            </div>
          )}
        </div>

        {/* Zapisz zmiany do aktywnego widoku (gdy leży na nim filtr tymczasowy). */}
        {adhoc && activeView && (
          <button
            onClick={onSaveChanges}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginLeft: 4,
              marginBottom: 6,
              alignSelf: "center",
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${tokens.accent}`,
              background: "#fff",
              color: tokens.accent,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Save size={13} />
            Zapisz zmiany w „{activeView.name}"
          </button>
        )}
      </div>

      {(error || storage === "local") && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginTop: 8,
            fontSize: 12,
            fontWeight: 600,
            color: error ? tokens.danger : tokens.warning,
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {error ??
              "Widoki zapisują się tylko w tej przeglądarce — tabela saved_views nie istnieje w bazie. Uruchom migration_saved_views.sql (Supabase → SQL Editor), aby zapisywać je na stałe."}
          </span>
        </div>
      )}
    </div>
  );
}

// Pojedyncza zakładka w stylu karty przeglądarki: zaokrąglona góra, aktywna
// „wtapia się" w treść (tło karty, brak dolnej krawędzi).
function Tab({
  active,
  onClick,
  label,
  trailing,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "8px 14px",
        borderTopLeftRadius: 10,
        borderTopRightRadius: 10,
        border: `1px solid ${active ? tokens.border : "transparent"}`,
        borderBottom: active ? `1px solid ${tokens.card}` : "1px solid transparent",
        background: active ? tokens.card : "transparent",
        color: active ? tokens.text : tokens.muted,
        fontSize: 13,
        fontWeight: active ? 700 : 600,
        cursor: "pointer",
        position: "relative",
        top: 1,
        maxWidth: 220,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {trailing}
    </button>
  );
}

function ViewMenu({ onClose, onRename, onDelete }: { onClose: () => void; onRename: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 4,
        zIndex: 40,
        background: "#fff",
        border: `1px solid ${tokens.border}`,
        borderRadius: 10,
        boxShadow: "0 10px 25px rgba(0,0,0,0.12)",
        minWidth: 140,
        overflow: "hidden",
      }}
    >
      <MenuItem label="Zmień nazwę" onClick={onRename} />
      <MenuItem label="Usuń" danger onClick={onDelete} />
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "9px 12px",
        border: "none",
        background: "none",
        cursor: "pointer",
        fontSize: 13,
        color: danger ? tokens.danger : tokens.text,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {label}
    </button>
  );
}
