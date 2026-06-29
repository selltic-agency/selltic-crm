// app/admin/logout-button.tsx — wylogowanie (czyści sesję i wraca na /login).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
        padding: "8px 14px",
        background: "#fff",
        border: "1px solid #d1d5db",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: loading ? "default" : "pointer",
      }}
    >
      {loading ? "Wylogowywanie…" : "Wyloguj"}
    </button>
  );
}
