// app/admin/forms/page.tsx — lista formularzy (siatka kart).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, FileText, ExternalLink, Share2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, primaryButton } from "@/lib/ui";
import { blankForm, randomSlug, type FormRow } from "@/lib/forms";
import ShareModal from "./share-modal";

type FormCard = Pick<FormRow, "id" | "title" | "slug" | "status" | "created_at">;

export default function FormsPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [forms, setForms] = useState<FormCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [shareForm, setShareForm] = useState<FormCard | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("forms")
      .select("id, title, slug, status, created_at")
      .order("created_at", { ascending: false });
    setForms((data as FormCard[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function newForm() {
    if (creating) return;
    setCreating(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      return;
    }
    const schema = blankForm();
    const { data, error } = await supabase
      .from("forms")
      .insert({
        owner: user.id,
        title: schema.title,
        slug: randomSlug(),
        schema,
        status: "draft",
      })
      .select("id")
      .single();
    setCreating(false);
    if (!error && data) router.push(`/admin/forms/${data.id}`);
  }

  async function remove(id: string) {
    if (!confirm("Usunąć ten formularz? Tej operacji nie można cofnąć.")) return;
    const snapshot = forms;
    setForms((list) => list.filter((f) => f.id !== id));
    const { error } = await supabase.from("forms").delete().eq("id", id);
    if (error) setForms(snapshot);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Formularze</h1>
        <button
          onClick={newForm}
          disabled={creating}
          style={{ ...primaryButton, display: "flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={16} />
          {creating ? "Tworzenie…" : "Nowy formularz"}
        </button>
      </div>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : forms.length === 0 ? (
        <div
          style={{
            background: tokens.card,
            border: `1px dashed ${tokens.border}`,
            borderRadius: tokens.radius,
            padding: 40,
            textAlign: "center",
            color: tokens.muted,
          }}
        >
          <FileText size={28} style={{ opacity: 0.5 }} />
          <p style={{ fontSize: 14, margin: "10px 0 0" }}>
            Brak formularzy. Utwórz pierwszy, klikając „Nowy formularz”.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          {forms.map((f) => (
            <div
              key={f.id}
              onClick={() => router.push(`/admin/forms/${f.id}`)}
              style={{
                background: tokens.card,
                border: `1px solid ${tokens.border}`,
                borderRadius: tokens.radius,
                padding: 18,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                minHeight: 130,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: tokens.accentSoft,
                    color: tokens.accent,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <FileText size={18} />
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(f.id);
                  }}
                  aria-label="Usuń"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    border: `1px solid ${tokens.border}`,
                    background: "#fff",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <Trash2 size={14} color={tokens.muted} />
                </button>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{f.title || "Bez tytułu"}</div>
                <div style={{ fontSize: 12, color: tokens.muted, marginTop: 2 }}>
                  {new Date(f.created_at).toLocaleDateString("pl-PL", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: f.status === "published" ? "#E7F7EE" : tokens.bg,
                    color: f.status === "published" ? tokens.success : tokens.muted,
                  }}
                >
                  {f.status === "published" ? "Opublikowany" : "Szkic"}
                </span>
                {f.status === "published" && f.slug && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShareForm(f);
                      }}
                      aria-label="Udostępnij / kod osadzenia"
                      title="Udostępnij"
                      style={{
                        border: "none",
                        background: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: tokens.muted,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Share2 size={15} />
                    </button>
                    <a
                      href={`/f/${f.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: tokens.muted, display: "grid", placeItems: "center" }}
                      aria-label="Otwórz publiczny formularz"
                    >
                      <ExternalLink size={15} />
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {shareForm?.slug && (
        <ShareModal
          slug={shareForm.slug}
          title={shareForm.title}
          onClose={() => setShareForm(null)}
        />
      )}
    </div>
  );
}
