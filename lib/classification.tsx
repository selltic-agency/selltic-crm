// lib/classification.tsx — kontekst klasyfikacji leadów: KATEGORIE branż
// (Feature 1) i CELE KONTAKTU (Feature 2). Wzorowany na lib/stages.tsx:
// pobiera lead_categories / contact_purposes dla właściciela, a przy pierwszym
// uruchomieniu (pusta tabela) zasiewa wartości domyślne. Gdy tabele są
// niedostępne (przed migracją), używa wartości domyślnych jako fallback, żeby
// aplikacja nie przestała działać.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_PURPOSES,
  type ContactPurpose,
  type LeadCategory,
} from "@/lib/types";

type ClassificationApi = {
  categories: LeadCategory[];
  purposes: ContactPurpose[];
  loading: boolean;
  // Metadane po kluczu (z fallbackiem), żeby badge zawsze miał etykietę/kolor.
  categoryMeta: (key: string | null | undefined) => LeadCategory | null;
  purposeMeta: (key: string | null | undefined) => ContactPurpose | null;
  reload: () => Promise<void>;
};

const Ctx = createContext<ClassificationApi | null>(null);

function fallbackCategories(): LeadCategory[] {
  return DEFAULT_CATEGORIES.map((c, i) => ({
    id: c.key,
    owner: "",
    key: c.key,
    label: c.label,
    color: c.color,
    position: i,
  }));
}

function fallbackPurposes(): ContactPurpose[] {
  return DEFAULT_PURPOSES.map((p, i) => ({
    id: p.key,
    owner: "",
    key: p.key,
    label: p.label,
    color: p.color,
    position: i,
  }));
}

export function ClassificationProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<LeadCategory[]>([]);
  const [purposes, setPurposes] = useState<ContactPurpose[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // ── Kategorie ──────────────────────────────────────────────────────
    const catRes = await supabase.from("lead_categories").select("*").order("position", { ascending: true });
    if (catRes.error) {
      setCategories(fallbackCategories());
    } else if ((catRes.data?.length ?? 0) === 0 && user) {
      await supabase.from("lead_categories").insert(
        DEFAULT_CATEGORIES.map((c, i) => ({ owner: user.id, key: c.key, label: c.label, color: c.color, position: i }))
      );
      const { data } = await supabase.from("lead_categories").select("*").order("position", { ascending: true });
      setCategories((data as LeadCategory[]) ?? fallbackCategories());
    } else {
      setCategories((catRes.data as LeadCategory[]) ?? fallbackCategories());
    }

    // ── Cele kontaktu ──────────────────────────────────────────────────
    const purRes = await supabase.from("contact_purposes").select("*").order("position", { ascending: true });
    if (purRes.error) {
      setPurposes(fallbackPurposes());
    } else if ((purRes.data?.length ?? 0) === 0 && user) {
      await supabase.from("contact_purposes").insert(
        DEFAULT_PURPOSES.map((p, i) => ({ owner: user.id, key: p.key, label: p.label, color: p.color, position: i }))
      );
      const { data } = await supabase.from("contact_purposes").select("*").order("position", { ascending: true });
      setPurposes((data as ContactPurpose[]) ?? fallbackPurposes());
    } else {
      setPurposes((purRes.data as ContactPurpose[]) ?? fallbackPurposes());
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  const categoryMeta = useCallback(
    (key: string | null | undefined) => {
      if (!key) return null;
      const list = categories.length ? categories : fallbackCategories();
      return list.find((c) => c.key === key) ?? null;
    },
    [categories]
  );

  const purposeMeta = useCallback(
    (key: string | null | undefined) => {
      if (!key) return null;
      const list = purposes.length ? purposes : fallbackPurposes();
      return list.find((p) => p.key === key) ?? null;
    },
    [purposes]
  );

  const api: ClassificationApi = { categories, purposes, loading, categoryMeta, purposeMeta, reload };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useClassification(): ClassificationApi {
  const ctx = useContext(Ctx);
  if (!ctx) {
    const fc = fallbackCategories();
    const fp = fallbackPurposes();
    return {
      categories: fc,
      purposes: fp,
      loading: false,
      categoryMeta: (key) => (key ? fc.find((c) => c.key === key) ?? null : null),
      purposeMeta: (key) => (key ? fp.find((p) => p.key === key) ?? null : null),
      reload: async () => {},
    };
  }
  return ctx;
}
