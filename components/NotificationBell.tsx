// components/NotificationBell.tsx — dzwonek powiadomień w topbarze.
// Pokazuje licznik nieprzeczytanych, a po kliknięciu panel z listą.
// Klik w pozycję otwiera kontakt; „Oznacz wszystkie” czyści nieprzeczytane.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCheck, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatDateTime } from "@/lib/ui";
import type { Notification } from "@/lib/types";

export default function NotificationBell({
  onOpenContact,
}: {
  onOpenContact: (contactId: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

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

  // Zamknij panel po kliknięciu poza nim.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
    if (n.contact_id) onOpenContact(n.contact_id);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
        aria-label="Powiadomienia"
        style={iconBtn}
      >
        <Bell size={18} color={tokens.muted} />
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 999,
              background: tokens.danger,
              color: "#fff",
              fontSize: 11,
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

      {open && (
        <div
          style={{
            position: "absolute",
            top: 46,
            right: 0,
            width: 320,
            maxWidth: "calc(100vw - 24px)",
            background: tokens.card,
            border: `1px solid ${tokens.border}`,
            borderRadius: 14,
            boxShadow: "0 16px 50px rgba(15,18,28,0.18)",
            zIndex: 80,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderBottom: `1px solid ${tokens.border}`,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700 }}>Powiadomienia</span>
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
              <CheckCheck size={14} />
              Oznacz wszystkie
            </button>
          </div>

          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {items.length === 0 ? (
              <p style={{ padding: 24, textAlign: "center", color: tokens.muted, fontSize: 14, margin: 0 }}>
                Brak powiadomień.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  style={{
                    display: "flex",
                    gap: 11,
                    width: "100%",
                    textAlign: "left",
                    padding: "11px 14px",
                    border: "none",
                    borderTop: `1px solid ${tokens.border}`,
                    background: n.read ? "transparent" : tokens.accentSoft,
                    cursor: n.contact_id ? "pointer" : "default",
                  }}
                >
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      flexShrink: 0,
                      background: tokens.card,
                      border: `1px solid ${tokens.border}`,
                      color: tokens.accent,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <UserPlus size={15} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: tokens.text }}>
                      {n.body}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: tokens.muted }}>
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

const iconBtn: React.CSSProperties = {
  position: "relative",
  width: 38,
  height: 38,
  borderRadius: 10,
  flexShrink: 0,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
