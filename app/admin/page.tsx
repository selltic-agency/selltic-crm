// app/admin/page.tsx — panel admina (lista formularzy).
// Chronione przez middleware; tu dodatkowy strażnik dla pewności.
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import LogoutButton from "./logout-button";

export const dynamic = "force-dynamic";

type FormRow = {
  id: string;
  title: string | null;
  slug: string | null;
  status: string | null;
  updated_at: string | null;
};

export default async function AdminPage() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: forms, error } = await supabase
    .from("forms")
    .select("id, title, slug, status, updated_at")
    .order("updated_at", { ascending: false });

  const rows = (forms ?? []) as FormRow[];

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "32px 24px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 28,
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 2px", fontSize: 24 }}>Panel</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
            Zalogowano jako {user.email}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #e5e7eb",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Formularze
        </div>

        {error ? (
          <p style={{ padding: 18, margin: 0, color: "#dc2626", fontSize: 14 }}>
            Nie udało się wczytać formularzy. Upewnij się, że schemat bazy
            (schema.sql) został wgrany w Supabase.
          </p>
        ) : rows.length === 0 ? (
          <p style={{ padding: 18, margin: 0, color: "#6b7280", fontSize: 14 }}>
            Brak formularzy. Kreator formularzy pojawi się w kolejnej fazie.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((f) => (
              <li
                key={f.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  borderTop: "1px solid #f1f3f5",
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {f.title || "Bez tytułu"}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {f.slug ? `/${f.slug}` : "brak adresu"}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: f.status === "published" ? "#dcfce7" : "#f3f4f6",
                    color: f.status === "published" ? "#166534" : "#6b7280",
                  }}
                >
                  {f.status === "published" ? "opublikowany" : "szkic"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
