// components/SavedViewTabs.tsx — pasek zakładek zapisanych widoków (HubSpot-style).
// Współdzielony przez Leady i Prospecting: przełącza filtry/sort/tryb widoku,
// pozwala tworzyć nowe widoki i edytować/usuwać własne (nie systemowe).
"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { tokens, inputStyle, ghostButton, primaryButton } from "@/lib/ui";
import type { SavedView } from "@/lib/savedViews";

export default function SavedViewTabs({
  views,
  activeId,
  loading,
  isDirty,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onSaveChanges,
}: {
  views: SavedView[];
  activeId: string | null;
  loading: boolean;
  isDirty: boolean;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSaveChanges: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (loading) return null;

  const activeView = views.find((v) => v.id === activeId) ?? null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {views.map((v) => (
        <div key={v.id} style={{ position: "relative" }}>
          {renaming === v.id ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
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
                style={{ ...inputStyle, width: 140, padding: "6px 10px", fontSize: 13 }}
              />
              <button
                onClick={() => {
                  if (renameValue.trim()) onRename(v.id, renameValue.trim());
                  setRenaming(null);
                }}
                style={{ ...primaryButton, padding: "6px 10px", fontSize: 12 }}
              >
                OK
              </button>
            </div>
          ) : (
            <button
              onClick={() => onSelect(v.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 999,
                border: `1px solid ${activeId === v.id ? tokens.accent : tokens.border}`,
                background: activeId === v.id ? tokens.accentSoft : "#fff",
                color: activeId === v.id ? tokens.accent : tokens.text,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {v.name}
              {!v.is_default && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor(menuFor === v.id ? null : v.id);
                  }}
                  style={{ display: "flex", padding: 2, borderRadius: 4 }}
                >
                  <MoreHorizontal size={14} />
                </span>
              )}
            </button>
          )}

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
      ))}

      <div style={{ position: "relative" }}>
        <button
          onClick={() => setShowNew(!showNew)}
          title="Zapisz jako nowy widok"
          style={{
            width: 30,
            height: 30,
            borderRadius: 999,
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
              marginTop: 6,
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
                if (e.key === "Enter" && newName.trim()) {
                  onCreate(newName.trim());
                  setNewName("");
                  setShowNew(false);
                }
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => {
                if (newName.trim()) {
                  onCreate(newName.trim());
                  setNewName("");
                  setShowNew(false);
                }
              }}
              style={{ ...primaryButton, padding: "9px 14px" }}
            >
              Zapisz
            </button>
          </div>
        )}
      </div>

      {isDirty && activeView && (
        <button
          onClick={onSaveChanges}
          style={{
            ...ghostButton,
            fontSize: 12.5,
            fontWeight: 600,
            padding: "6px 12px",
            color: tokens.accent,
            borderColor: tokens.accent,
          }}
        >
          Zapisz zmiany w „{activeView.name}"
        </button>
      )}
    </div>
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
