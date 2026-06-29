// components/ComingSoon.tsx — tymczasowy placeholder dla tras budowanych w kolejnych fazach.
import { tokens } from "@/lib/design";

export default function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700 }}>{title}</h1>
      <div
        style={{
          marginTop: 16,
          padding: 28,
          background: tokens.card,
          border: `1px solid ${tokens.border}`,
          borderRadius: 16,
          color: tokens.muted,
          fontSize: 14,
        }}
      >
        Ten moduł powstanie w {phase}.
      </div>
    </div>
  );
}
