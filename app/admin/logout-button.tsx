// app/admin/logout-button.tsx — wylogowanie (czyści sesję i wraca na /login).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ghostButton } from "@/lib/ui";

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
      style={{ ...ghostButton, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}
    >
      {loading ? "Wylogowywanie…" : "Wyloguj"}
    </button>
  );
}
