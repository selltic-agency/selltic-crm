// app/admin/logout-button.tsx — wylogowanie (czyści sesję i wraca na /login).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/theme";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={logout}
      disabled={loading}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "8px 12px",
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        color: tokens.muted,
        cursor: loading ? "default" : "pointer",
      }}
    >
      <LogOut size={16} />
      {loading ? "Wylogowywanie…" : "Wyloguj"}
    </button>
  );
}
