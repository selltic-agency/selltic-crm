// app/admin/layout.tsx — szkielet panelu: sidebar + górny pasek + obszar treści.
// Server Component — pilnuje sesji; renderuje klientowy sidebar (aktywna trasa).
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Search, Bell } from "lucide-react";
import { createSupabaseServer } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import LogoutButton from "./logout-button";
import { tokens } from "@/lib/design";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const initial = (user.email ?? "D").charAt(0).toUpperCase();

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: tokens.bg }}>
      <Sidebar />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            height: 62,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 26px",
            background: tokens.card,
            borderBottom: `1px solid ${tokens.border}`,
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
            <Search
              size={16}
              color={tokens.muted}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
              }}
            />
            <input
              placeholder="Szukaj kontaktów…"
              style={{
                width: "100%",
                padding: "9px 12px 9px 36px",
                border: `1px solid ${tokens.border}`,
                borderRadius: 10,
                fontSize: 13.5,
                background: tokens.bg,
              }}
            />
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
            <button
              aria-label="Powiadomienia"
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                border: `1px solid ${tokens.border}`,
                background: tokens.card,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: tokens.muted,
              }}
            >
              <Bell size={18} />
            </button>

            <LogoutButton />

            <div
              title={user.email ?? ""}
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: tokens.accent,
                color: "#fff",
                fontWeight: 700,
                fontSize: 15,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {initial}
            </div>
          </div>
        </header>

        <main style={{ flex: 1, padding: "28px 26px", minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}
