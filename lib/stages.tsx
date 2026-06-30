// lib/stages.tsx — kontekst konfigurowalnych etapów lejka (Faza 8.3).
// Pobiera pipeline_stages dla zalogowanego właściciela; przy pierwszym
// uruchomieniu (pusta tabela) zasiewa etapy domyślne. Gdy tabela jest
// niedostępna (przed migracją), używa etapów domyślnych jako fallback,
// żeby aplikacja nie przestała działać.
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
  DEFAULT_STAGES,
  stageMetaFrom,
  type PipelineStage,
  type Stage,
  type StageLike,
} from "@/lib/types";

type StagesApi = {
  stages: PipelineStage[];
  loading: boolean;
  stageMeta: (key: Stage) => StageLike;
  reload: () => Promise<void>;
};

const StagesCtx = createContext<StagesApi | null>(null);

// Etapy domyślne jako obiekty zgodne kształtem (fallback bez bazy).
function fallbackStages(): PipelineStage[] {
  return DEFAULT_STAGES.map((s, i) => ({
    id: s.key,
    owner: "",
    key: s.key,
    label: s.label,
    color: s.color,
    position: i,
    is_won: s.is_won,
    is_lost: s.is_lost,
  }));
}

export function StagesProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("*")
      .order("position", { ascending: true });

    // Tabela niedostępna (np. przed migracją) → fallback.
    if (error) {
      setStages(fallbackStages());
      setLoading(false);
      return;
    }

    // Pusto → zasiej domyślne etapy dla właściciela, potem wczytaj ponownie.
    if (!data || data.length === 0) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("pipeline_stages").insert(
          DEFAULT_STAGES.map((s, i) => ({
            owner: user.id,
            key: s.key,
            label: s.label,
            color: s.color,
            position: i,
            is_won: s.is_won,
            is_lost: s.is_lost,
          }))
        );
        const { data: seeded } = await supabase
          .from("pipeline_stages")
          .select("*")
          .order("position", { ascending: true });
        setStages((seeded as PipelineStage[]) ?? fallbackStages());
      } else {
        setStages(fallbackStages());
      }
      setLoading(false);
      return;
    }

    setStages(data as PipelineStage[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  const stageMeta = useCallback(
    (key: Stage) => stageMetaFrom(stages.length ? stages : fallbackStages(), key),
    [stages]
  );

  const api: StagesApi = { stages, loading, stageMeta, reload };

  return <StagesCtx.Provider value={api}>{children}</StagesCtx.Provider>;
}

export function useStages(): StagesApi {
  const ctx = useContext(StagesCtx);
  if (!ctx) {
    // Bezpieczny fallback poza providerem.
    const fb = fallbackStages();
    return {
      stages: fb,
      loading: false,
      stageMeta: (key: Stage) => stageMetaFrom(fb, key),
      reload: async () => {},
    };
  }
  return ctx;
}
