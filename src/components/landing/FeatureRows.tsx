import type { ReactNode } from "react";
import Reveal from "./Reveal";

const LockIcon = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
  >
    <rect x="4" y="11" width="16" height="10" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const GithubIcon = (
  <svg
    width="18"
    height="18"
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
    width="18"
    height="18"
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

interface FeatureRow {
  index: string;
  icon: ReactNode;
  title: string;
  body: string;
  kicker: string;
}

const ROWS: FeatureRow[] = [
  {
    index: "01",
    icon: LockIcon,
    title: "Locked on launch.",
    body: "No more begging devs to lock. No more gambling on promises. Every allocation is locked before the first trade.",
    kicker: "streamflow token lock. enforced. on-chain.",
  },
  {
    index: "02",
    icon: GithubIcon,
    title: "Built for builders.",
    body: "Connect your GitHub. Prove your code. Your commit history becomes your reputation. Ship code, lock tokens, earn your tier.",
    kicker: "github-verified profiles. real builders only.",
  },
  {
    index: "03",
    icon: BoltIcon,
    title: "Proof, on-chain.",
    body: "Transparent lock schedules anyone can verify. Dev bags visible. Lock duration public. The chart speaks. The contract proves it.",
    kicker: "no backroom deals. just proof.",
  },
];

export default function FeatureRows() {
  return (
    <section className="relative px-[clamp(16px,5vw,32px)] pb-[clamp(64px,9vw,104px)] pt-12">
      <div className="mx-auto max-w-[1152px]">
        {ROWS.map((row) => (
          <div
            key={row.index}
            className="flex flex-wrap gap-[clamp(24px,4vw,40px)] border-t border-white/[0.05] py-[clamp(40px,6vw,64px)]"
          >
            <Reveal className="min-w-0 flex-[1_1_380px]">
              <div className="mb-[18px] flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[rgba(43,209,126,0.25)] bg-accent-dim text-accent">
                  {row.icon}
                </div>
                <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-accent-700">
                  {row.index}
                </span>
              </div>
              <h2 className="m-0 mb-4 font-sans text-[clamp(30px,5vw,56px)] font-bold leading-[1.05] tracking-[-0.03em] text-text-1">
                {row.title}
              </h2>
              <p className="m-0 mb-5 font-mono text-[clamp(13px,1.8vw,15px)] font-medium leading-[1.8] text-text-3">
                {row.body}
              </p>
              <div
                className="mb-3.5 h-px"
                style={{
                  background:
                    "linear-gradient(to right, rgba(43,209,126,0.4), rgba(43,209,126,0.1), transparent)",
                }}
              />
              <p className="m-0 font-mono text-[12px] font-semibold tracking-[0.02em] text-accent-400">
                {row.kicker}
              </p>
            </Reveal>
          </div>
        ))}
      </div>
    </section>
  );
}
