// app/admin/layout.tsx — szkielet panelu (sidebar + topbar).
// Strażnik sesji po stronie serwera (oprócz middleware).
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import Shell from "./shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <Shell email={user.email ?? ""}>{children}</Shell>;
}
