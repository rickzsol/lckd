import type { ReactNode } from "react";

export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-24 font-sans text-2xl font-bold tracking-tight text-white sm:text-3xl"
    >
      {children}
    </h2>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-sans text-lg font-semibold tracking-tight text-white">
      {children}
    </h3>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <p className="text-[15px] leading-[1.75] text-text-muted sm:text-base">
      {children}
    </p>
  );
}

export function Accent({ children }: { children: ReactNode }) {
  return <span className="font-medium text-emerald-accent">{children}</span>;
}

export function FaqItem({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
      <p className="mb-2 font-sans text-sm font-semibold text-white">{q}</p>
      <div className="text-[14px] leading-[1.7] text-text-muted">{children}</div>
    </div>
  );
}

export function FlowStep({ n, label, sub }: { n: number; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="review-num shrink-0">{n}</div>
      <div>
        <p className="font-mono text-xs font-bold text-white">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{sub}</p>
      </div>
    </div>
  );
}
