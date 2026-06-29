// app/admin/layout.tsx — powłoka panelu: sidebar + topbar + obszar treści.
// Strażnik sesji: middleware już chroni /admin, tu druga warstwa dla pewności.
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { tokens } from "@/lib/theme";
import Sidebar from "./sidebar";
import Topbar from "./topbar";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: tokens.bg }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar />
        <main style={{ flex: 1, padding: 28 }}>{children}</main>
      </div>
    </div>
  );
}
