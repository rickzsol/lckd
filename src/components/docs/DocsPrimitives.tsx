import type { ReactNode } from "react";

export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-36 font-sans text-2xl font-bold tracking-[-0.01em] text-text-1 lg:scroll-mt-24"
    >
      {children}
    </h2>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-sans text-lg font-semibold text-text-1">
      {children}
    </h3>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <p className="text-[15px] leading-[1.6] text-text-2">
      {children}
    </p>
  );
}

export function Accent({ children }: { children: ReactNode }) {
  return <span className="font-mono font-medium text-accent-300">{children}</span>;
}

export function FaqItem({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="rounded-card border border-line-default bg-surface p-4">
      <h3 className="mb-2 font-sans text-sm font-semibold text-text-1">{q}</h3>
      <div className="text-[14px] leading-[1.7] text-text-2">{children}</div>
    </div>
  );
}

export function FlowStep({ n, label, sub }: { n: number; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="review-num shrink-0">{n}</div>
      <div>
        <p className="font-mono text-xs font-bold text-text-1">{label}</p>
        <p className="mt-0.5 font-mono text-xs leading-relaxed text-text-3">{sub}</p>
      </div>
    </div>
  );
}
