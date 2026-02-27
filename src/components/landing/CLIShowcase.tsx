"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const NAV_H = 49;

const CLI_STEPS = [
  { num: "01", title: "Install & Run" },
  { num: "02", title: "Configure Token" },
  { num: "03", title: "Review & Sign" },
  { num: "04", title: "Launch Complete" },
];

const BANNER_LINES = [
  "\u2588\u2588\u2557     \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 ",
  "\u2588\u2588\u2551    \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2551 \u2588\u2588\u2554\u255d\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557",
  "\u2588\u2588\u2551    \u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2554\u255d \u2588\u2588\u2551  \u2588\u2588\u2551",
  "\u2588\u2588\u2551    \u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2588\u2588\u2557 \u2588\u2588\u2551  \u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d",
  "\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u255d ",
];

function TermLine({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`whitespace-pre font-mono leading-[1.6] ${className}`}>
      {children}
    </div>
  );
}

export default function CLIShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!sectionRef.current) return;

      const mm = gsap.matchMedia();

      // ─── Desktop / Tablet: pinned scrub ─────────────────
      mm.add("(min-width: 768px)", () => {
        const scrollLen = window.innerHeight * 2.5;

        // Measure content overflow for terminal auto-scroll
        const content = contentRef.current;
        const body = bodyRef.current;
        const scrollDist =
          content && body
            ? Math.max(0, content.scrollHeight - body.clientHeight + 20)
            : 0;

        // Initial states
        gsap.set(
          [
            ".cli-command",
            ".cli-banner",
            ".cli-prompts",
            ".cli-review",
            ".cli-exec",
            ".cli-result",
          ],
          { opacity: 0 }
        );
        gsap.set(".cli-ambient", { opacity: 0, scale: 0.9 });
        gsap.set(".cli-progress-fill", {
          scaleY: 0,
          transformOrigin: "top center",
        });
        CLI_STEPS.forEach((_, i) =>
          gsap.set(`.cli-step-${i}`, { opacity: 0.12 })
        );

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: sectionRef.current,
            pin: true,
            start: `top ${NAV_H}`,
            end: `+=${scrollLen}`,
            scrub: 0.5,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            refreshPriority: -1,
          },
        });

        // Progress bar + glow
        tl.to(
          ".cli-progress-fill",
          { scaleY: 1, ease: "none", duration: 4 },
          0
        );
        tl.to(
          ".cli-ambient",
          { opacity: 1, scale: 1, duration: 2, ease: "power2.inOut" },
          0.2
        );

        // Terminal content auto-scroll
        if (scrollDist > 0 && contentRef.current) {
          tl.to(
            contentRef.current,
            { y: -scrollDist, ease: "power1.inOut", duration: 4 },
            0
          );
        }

        // ── 01 Install & Run ──────────────────────────
        tl.to(
          ".cli-command",
          { opacity: 1, duration: 0.3, ease: "power2.out" },
          0
        );
        tl.to(
          ".cli-banner",
          { opacity: 1, duration: 0.5, ease: "power3.out" },
          0.25
        );
        tl.to(".cli-step-0", { opacity: 1, duration: 0.25 }, 0.05);

        // ── 02 Configure Token ────────────────────────
        tl.to(".cli-step-0", { opacity: 0.25, duration: 0.2 }, 0.8);
        tl.to(
          ".cli-prompts",
          { opacity: 1, duration: 0.6, ease: "power3.out" },
          0.85
        );
        tl.to(".cli-step-1", { opacity: 1, duration: 0.25 }, 0.85);

        // ── 03 Review & Sign ──────────────────────────
        tl.to(".cli-step-1", { opacity: 0.25, duration: 0.2 }, 1.9);
        tl.to(
          ".cli-review",
          { opacity: 1, duration: 0.6, ease: "power3.out" },
          2.0
        );
        tl.to(".cli-step-2", { opacity: 1, duration: 0.25 }, 2.0);

        // ── 04 Launch Complete ────────────────────────
        tl.to(".cli-step-2", { opacity: 0.25, duration: 0.2 }, 2.7);
        tl.to(
          ".cli-exec",
          { opacity: 1, duration: 0.5, ease: "power3.out" },
          2.8
        );
        tl.to(
          ".cli-result",
          { opacity: 1, duration: 0.6, ease: "power3.out" },
          3.1
        );
        tl.to(".cli-step-3", { opacity: 1, duration: 0.25 }, 2.8);

        // Brief hold
        tl.to({}, { duration: 0.6 });
      });

      // ─── Mobile: scroll reveals ─────────────────────────
      mm.add("(max-width: 767px)", () => {
        const sections = gsap.utils.toArray<HTMLElement>(
          ".cli-command, .cli-banner, .cli-prompts, .cli-review, .cli-exec, .cli-result"
        );
        sections.forEach((el) => {
          gsap.from(el, {
            opacity: 0,
            y: 25,
            duration: 0.7,
            ease: "power3.out",
            scrollTrigger: {
              trigger: el,
              start: "top 88%",
              toggleActions: "play none none reverse",
            },
          });
        });
      });
    },
    { scope: sectionRef }
  );

  return (
    <section
      ref={sectionRef}
      className="relative md:h-[calc(100dvh-49px)]"
    >
      {/* Ambient glow */}
      <div
        className="cli-ambient pointer-events-none absolute left-1/2 top-[12%] -translate-x-1/2 rounded-full"
        style={{
          width: "min(700px, 90vw)",
          height: "min(400px, 50vw)",
          background:
            "radial-gradient(ellipse, rgba(139,92,246,0.05) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />

      <div className="mx-auto max-w-[900px] px-4 pt-4 md:px-6 lg:pr-44">
        {/* Section label */}
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-accent/50">
          CLI Experience
        </div>

        {/* Terminal window */}
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[rgba(8,8,18,0.95)]">
          {/* Title bar */}
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
            <div className="flex gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full bg-[#ff5f56]/60" />
              <span className="h-[7px] w-[7px] rounded-full bg-[#ffbd2e]/60" />
              <span className="h-[7px] w-[7px] rounded-full bg-[#27c93f]/60" />
            </div>
            <span className="font-mono text-[10px] text-[#444]">
              terminal &mdash; lckd
            </span>
          </div>

          {/* Terminal body */}
          <div
            ref={bodyRef}
            className="overflow-hidden px-4 py-4 sm:px-5 sm:py-5"
            style={{ maxHeight: "calc(100vh - 49px - 100px)" }}
          >
            <div
              ref={contentRef}
              style={{ willChange: "transform" }}
            >
              {/* ── Phase 1: Command + Banner ────────── */}
              <div className="cli-command mb-2">
                <TermLine className="text-[12px]">
                  <span className="text-[#555]">$ </span>
                  <span className="text-text-primary">npx lckd launch</span>
                </TermLine>
              </div>

              <div className="cli-banner mb-4">
                <div className="overflow-x-auto">
                  {BANNER_LINES.map((line, i) => (
                    <TermLine
                      key={i}
                      className="text-[9px] leading-[1.35] text-accent sm:text-[10px] md:text-[11px]"
                    >
                      {"  "}{line}
                    </TermLine>
                  ))}
                </div>
                <TermLine className="mt-1 text-[10px] text-[#555] sm:text-[11px]">
                  {"     builders who ship. tokens that lock. lckd.tech"}
                </TermLine>
              </div>

              {/* ── Phase 2: Prompts ─────────────────── */}
              <div className="cli-prompts mb-4">
                <TermLine className="mb-2 text-[11px] text-[#555]">
                  {"  Fill in your token details:"}
                </TermLine>
                {[
                  { q: "Token name", a: "NeoDev" },
                  { q: "Ticker", a: "$NDEV" },
                  { q: "Image path", a: "./neodev.png" },
                  { q: "Initial buy (SOL)", a: "1.5" },
                  { q: "Lock duration (days)", a: "365" },
                  { q: "Lock percentage", a: "100" },
                ].map((prompt) => (
                  <TermLine key={prompt.q} className="text-[11px]">
                    <span className="text-accent">? </span>
                    <span className="text-[#888]">{prompt.q}</span>
                    <span className="text-[#555]">{" \u203A "}</span>
                    <span className="text-text-primary">{prompt.a}</span>
                  </TermLine>
                ))}
              </div>

              {/* ── Phase 3: Review Box ──────────────── */}
              <div className="cli-review mb-4">
                <div className="my-2 rounded border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  {[
                    { k: "Token", v: "NeoDev ($NDEV)", highlight: true },
                    { k: "Buy", v: "1.5 SOL" },
                    { k: "Lock", v: "100% for 365 days" },
                    { k: "Wallet", v: "7xKX...gAsU" },
                    { k: "GitHub", v: "synthetic_dev" },
                  ].map((row) => (
                    <TermLine key={row.k} className="text-[11px]">
                      <span className="inline-block w-20 text-[#555]">
                        {row.k}
                      </span>
                      <span
                        className={
                          row.highlight
                            ? "text-accent"
                            : "text-text-primary"
                        }
                      >
                        {row.v}
                      </span>
                    </TermLine>
                  ))}
                </div>
                <TermLine className="mt-2 text-[11px]">
                  <span className="text-accent">? </span>
                  <span className="text-[#888]">Sign and submit?</span>
                  <span className="text-[#555]">{" \u203A "}</span>
                  <span className="font-semibold text-accent">Yes</span>
                </TermLine>
              </div>

              {/* ── Phase 4: Execution ────────────────── */}
              <div className="cli-exec mb-3">
                {[
                  "Metadata uploaded",
                  "Transaction built",
                  "Transaction signed",
                  "Transaction confirmed!",
                ].map((step) => (
                  <TermLine key={step} className="text-[11px]">
                    <span className="text-accent">{"\u2713"} </span>
                    <span className="text-accent">{step}</span>
                  </TermLine>
                ))}
              </div>

              {/* ── Result ────────────────────────────── */}
              <div className="cli-result">
                <TermLine className="text-[11px]">
                  <span className="inline-block w-20 text-[#555]">Mint</span>
                  <span className="text-text-primary">NdEv...4K2p</span>
                </TermLine>
                <TermLine className="text-[11px]">
                  <span className="inline-block w-20 text-[#555]">
                    Signature
                  </span>
                  <span className="text-text-primary">5fG8...xR2w</span>
                </TermLine>
                <div className="mt-2" />
                <TermLine className="text-[11px]">
                  <span className="inline-block w-20 text-[#555]">Token</span>
                  <span className="text-accent underline decoration-accent/30 underline-offset-2">
                    lckd.tech/token/NdEv...4K2p
                  </span>
                </TermLine>
                <TermLine className="text-[11px]">
                  <span className="inline-block w-20 text-[#555]">
                    Explorer
                  </span>
                  <span className="text-accent underline decoration-accent/30 underline-offset-2">
                    solscan.io/tx/5fG8...xR2w
                  </span>
                </TermLine>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Step indicators (lg+) ──────────────────── */}
      <div className="pointer-events-none absolute right-5 top-0 hidden h-full items-center lg:flex xl:right-8">
        <div className="relative flex flex-col gap-9">
          {/* Progress track */}
          <div className="absolute left-[calc(100%-5px)] top-[6px] h-[calc(100%-12px)] w-px bg-white/[0.04]">
            <div className="cli-progress-fill h-full w-full bg-gradient-to-b from-accent/50 via-accent/30 to-accent/10" />
          </div>

          {CLI_STEPS.map((step, i) => (
            <div
              key={i}
              className={`cli-step-${i} flex items-center gap-3`}
            >
              <div className="text-right">
                <div className="font-mono text-[9px] tracking-[0.15em] text-accent/60">
                  {step.num}
                </div>
                <div className="font-sans text-[13px] leading-tight font-semibold text-white/80">
                  {step.title}
                </div>
              </div>
              <div className="relative z-10 h-2.5 w-2.5 shrink-0 rounded-full border border-accent/30 bg-accent/15" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
