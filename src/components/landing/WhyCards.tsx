import type { ReactNode } from "react";

const LockIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
  >
    <rect x="4" y="11" width="16" height="10" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const GithubIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const BoltIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

interface Card {
  icon: ReactNode;
  title: string;
  body: string;
}

const CARDS: Card[] = [
  {
    icon: LockIcon,
    title: "Locked on launch",
    body: "Every dev allocation is locked via Streamflow before the first trade. No promises. Enforced on-chain.",
  },
  {
    icon: GithubIcon,
    title: "GitHub verified",
    body: "Connect your GitHub. Your commit history becomes your reputation. Real builders, real code.",
  },
  {
    icon: BoltIcon,
    title: "Proof, on-chain",
    body: "Transparent lock schedules anyone can verify. Dev bags visible. Lock duration public.",
  },
];

export default function WhyCards() {
  return (
    <section className="relative px-[clamp(16px,5vw,32px)] py-[clamp(64px,9vw,104px)]">
      <div className="mx-auto max-w-[1152px]">
        <h2 className="m-0 mb-[clamp(28px,5vw,48px)] text-center font-sans text-[clamp(26px,3.5vw,36px)] font-bold leading-[1.15] tracking-[-0.02em] text-text-1">
          Why LCKD
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
          {CARDS.map((card) => (
            <div
              key={card.title}
              className="rounded-card border border-white/[0.07] bg-surface p-7 transition-[border-color,transform] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-[rgba(43,209,126,0.3)]"
            >
              <div className="mb-[18px] flex h-11 w-11 items-center justify-center rounded-card border border-[rgba(43,209,126,0.25)] bg-accent-dim text-accent">
                {card.icon}
              </div>
              <div className="mb-2 font-sans text-[18px] font-bold text-text-1">
                {card.title}
              </div>
              <p className="m-0 font-mono text-[13px] font-medium leading-[1.7] text-text-3">
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
