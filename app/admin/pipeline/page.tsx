// app/admin/pipeline/page.tsx — wczytuje kontakty + definicje właściwości,
// renderuje klientową tablicę kanban.
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import PipelineBoard from "@/components/PipelineBoard";
import type { Contact, PropertyDef } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: contacts }, { data: defs }] = await Promise.all([
    supabase
      .from("contacts")
      .select("*")
      .eq("owner", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("property_defs")
      .select("*")
      .eq("owner", user.id)
      .order("position", { ascending: true }),
  ]);

  return (
    <PipelineBoard
      initialContacts={(contacts ?? []) as Contact[]}
      propertyDefs={(defs ?? []) as PropertyDef[]}
    />
  );
}
