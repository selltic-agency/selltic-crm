// components/NotificationBell.tsx — kompaktowy dzwonek powiadomień w nagłówku
// sidebara. Pokazuje licznik nieprzeczytanych; panel z listą otwiera się
// obok sidebara (position: fixed, kotwiczony do przycisku).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatDateTime, menuPanel } from "@/lib/ui";
import type { Notification } from "@/lib/types";
import MIcon from "@/components/MaterialIcon";

const PANEL_W = 320;

export default function NotificationBell({
  onOpenContact,
}: {
  onOpenContact: (contactId: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const unread = items.filter((n) => !n.read).length;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data as Notification[]) ?? []);
  }, [supabase]);

  // Pobierz przy montażu + odświeżaj cyklicznie (lekki polling co 60 s).
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Pozycja panelu: pod przyciskiem, przypięty do lewej krawędzi ekranu gdy
  // brakuje miejsca (sidebar jest wąski, panel szerszy).
  useEffect(() => {
    if (!open) return;
    function place() {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
      setPos({ top: r.bottom + 6, left });
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // Zamknij panel po kliknięciu poza nim.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  async function markAll() {
    if (unread === 0) return;
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    await supabase.from("notifications").update({ read: true }).eq("read", false);
  }

  async function openItem(n: Notification) {
    setOpen(false);
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
    }
    if (n.deal_id) onOpenContact(n.deal_id);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
        aria-label="Powiadomienia"
        style={{
          position: "relative",
          width: 28,
          height: 28,
          borderRadius: tokens.radiusSm,
          flexShrink: 0,
          border: "none",
          background: open ? tokens.bg : "transparent",
          color: tokens.muted,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          padding: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = open ? tokens.bg : "transparent")}
      >
        <MIcon name="notifications" size={18} />
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              minWidth: 15,
              height: 15,
              padding: "0 4px",
              borderRadius: 999,
              background: tokens.danger,
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              display: "grid",
              placeItems: "center",
              boxShadow: `0 0 0 2px ${tokens.card}`,
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          style={{
            ...menuPanel,
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: PANEL_W,
            maxWidth: "calc(100vw - 16px)",
            zIndex: 96,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              borderBottom: `1px solid ${tokens.borderSoft}`,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>Powiadomienia</span>
            <button
              onClick={markAll}
              disabled={unread === 0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                border: "none",
                background: "none",
                cursor: unread === 0 ? "default" : "pointer",
                color: unread === 0 ? tokens.muted : tokens.accent,
                fontSize: 12,
                fontWeight: 600,
                padding: 0,
              }}
            >
              <MIcon name="done_all" size={14} />
              Oznacz wszystkie
            </button>
          </div>

          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {items.length === 0 ? (
              <p style={{ padding: 22, textAlign: "center", color: tokens.muted, fontSize: 13, margin: 0 }}>
                Brak powiadomień.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  style={{
                    display: "flex",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 12px",
                    border: "none",
                    borderTop: `1px solid ${tokens.borderSoft}`,
                    background: n.read ? "transparent" : tokens.accentSoft,
                    cursor: n.deal_id ? "pointer" : "default",
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      flexShrink: 0,
                      background: tokens.card,
                      border: `1px solid ${tokens.border}`,
                      color: tokens.accent,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <MIcon name="person_add" size={14} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: tokens.text }}>
                      {n.body}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: tokens.muted }}>
                      {formatDateTime(n.created_at)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
