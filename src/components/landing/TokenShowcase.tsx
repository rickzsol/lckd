"use client";

import { useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import HeroTerminal from "./HeroTerminal";
import StatsBoard from "./StatsBoard";
import { FallingPattern } from "@/components/ui/falling-pattern";
import ShinyButton from "@/components/ui/ShinyButton";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const TRUST_PILLS = [
  "Streamflow Token Lock",
  "Pump.fun Liquidity",
  "GitHub Verified",
];

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: "Locked on Launch",
    desc: "Every dev allocation is locked via Streamflow before the first trade. No promises — enforced on-chain.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
    title: "GitHub Verified",
    desc: "Connect your GitHub. Your commit history becomes your reputation. Real builders, real code.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    title: "On-Chain Proof",
    desc: "Transparent lock schedules anyone can verify. Dev bags visible. Lock duration public.",
  },
];

export default function TokenShowcase() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      // ─── Hero entrance ───────────────────────────────
      const heroEls = [
        ".gsap-hero-terminal",
        ".gsap-hero-heading",
        ".gsap-hero-sub",
        ".gsap-hero-ctas",
        ".gsap-hero-pills",
        ".gsap-hero-stats",
        ".gsap-hero-scroll",
      ];

      gsap.set(heroEls, { opacity: 0, y: 40 });
      gsap.set(".gsap-hero-heading", {
        y: 60,
        scale: 0.95,
        transformOrigin: "center bottom",
      });

      const heroTl = gsap.timeline({ delay: 0.15 });

      heroTl.to(
        ".gsap-hero-terminal",
        { opacity: 1, y: 0, duration: 0.7, ease: "expo.out" },
        0.1
      );

      heroTl.to(
        ".gsap-hero-heading",
        { opacity: 1, y: 0, scale: 1, duration: 0.9, ease: "expo.out" },
        0.25
      );

      heroTl.to(
        ".gsap-hero-sub",
        { opacity: 1, y: 0, duration: 0.7, ease: "power4.out" },
        0.45
      );

      heroTl.to(
        ".gsap-hero-ctas",
        { opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.4)" },
        0.6
      );

      heroTl.to(
        ".gsap-hero-pills",
        { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" },
        0.75
      );

      heroTl.to(
        ".gsap-hero-stats",
        { opacity: 1, y: 0, duration: 0.6, ease: "power4.out" },
        0.85
      );

      heroTl.to(
        ".gsap-hero-scroll",
        { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" },
        1.1
      );

      // ─── Feature cards ───────────────────────────────
      gsap.set(".gsap-features-tag", { opacity: 0, y: 20 });
      gsap.from(".gsap-features-tag", {
        opacity: 0,
        y: 20,
        duration: 0.6,
        ease: "power4.out",
        scrollTrigger: {
          trigger: ".gsap-features-tag",
          start: "top 85%",
          toggleActions: "play none none reverse",
        },
      });

      gsap.utils.toArray<HTMLElement>(".gsap-feature").forEach((el, i) => {
        gsap.set(el, { opacity: 0, y: 50, scale: 0.95 });
        gsap.to(el, {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.8,
          delay: i * 0.12,
          ease: "expo.out",
          scrollTrigger: {
            trigger: el,
            start: "top 88%",
            toggleActions: "play none none reverse",
          },
        });
      });

      // ─── CTA entrance ───────────────────────────────
      gsap.set(".gsap-cta-tag", { opacity: 0, y: 20 });
      gsap.set(".gsap-cta-heading", {
        opacity: 0,
        y: 50,
        scale: 0.96,
        transformOrigin: "center bottom",
      });
      gsap.set(".gsap-cta-desc", { opacity: 0, y: 25 });
      gsap.set(".gsap-cta-buttons", { opacity: 0, y: 30 });

      const ctaTl = gsap.timeline({
        scrollTrigger: {
          trigger: ".gsap-cta",
          start: "top 70%",
          toggleActions: "play none none reverse",
        },
      });

      ctaTl.to(".gsap-cta-tag", {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: "power4.out",
      });

      ctaTl.to(
        ".gsap-cta-heading",
        { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: "expo.out" },
        "-=0.3"
      );

      ctaTl.to(
        ".gsap-cta-desc",
        { opacity: 1, y: 0, duration: 0.6, ease: "power4.out" },
        "-=0.4"
      );

      ctaTl.to(
        ".gsap-cta-buttons",
        { opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.4)" },
        "-=0.3"
      );
    },
    { scope: containerRef }
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Full-page falling pattern background */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <FallingPattern
          color="#10b981"
          backgroundColor="#08080c"
          className="h-full opacity-40"
        />
      </div>

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative z-[1] flex min-h-[calc(100dvh-49px)] flex-col items-center justify-center px-4 text-center">
        <div className="relative w-full max-w-[680px]">
          <div className="gsap-hero-terminal">
            <HeroTerminal />
          </div>

          <h1 className="gsap-hero-heading mx-auto mb-3.5 font-sans text-[clamp(32px,8vw,60px)] leading-[1.05] font-extrabold tracking-[-0.03em] text-white">
            Builders who
            <br />
            <span className="text-emerald-accent">ship.</span>
          </h1>

          <p className="gsap-hero-sub mx-auto mb-7 max-w-[440px] font-mono text-[clamp(11px,2.3vw,14px)] leading-[1.7] text-[#777]">
            Ship code. Lock tokens. Prove it on-chain.
            <br />
            Built on pump.fun + Streamflow.
          </p>

          <div className="gsap-hero-ctas flex flex-wrap justify-center gap-3">
            <ShinyButton href="/launch">launch token &rarr;</ShinyButton>
            <Link href="/feed" className="btn-secondary px-6 py-3">
              explore launches
            </Link>
          </div>

          <div className="gsap-hero-pills mt-8 flex flex-wrap justify-center gap-1.5">
            {TRUST_PILLS.map((pill) => (
              <span
                key={pill}
                className="whitespace-nowrap rounded-full border border-white/[0.06] px-2.5 py-1 font-mono text-[10px] text-[#555]"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>

        <div className="gsap-hero-stats relative z-10 mt-9 w-full max-w-[440px] px-2">
          <StatsBoard />
        </div>

        <div className="gsap-hero-scroll absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
          <span className="font-mono text-[10px] text-[#333]">
            see how it works
          </span>
          <div className="flex h-5 w-3 items-start justify-center rounded-full border border-white/[0.08] pt-1">
            <div className="h-1 w-0.5 animate-bounce rounded-full bg-emerald-accent/60" />
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section className="relative z-[1] px-4 py-24 md:py-32">
        <div className="mx-auto max-w-[1000px]">
          <div className="gsap-features-tag mb-16 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-emerald-accent/50">
            Why Lockpad
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="gsap-feature group rounded-xl border border-white/[0.06] bg-white/[0.015] p-6 transition-colors hover:border-emerald-accent/15"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-accent/15 bg-emerald-accent/[0.04] text-emerald-accent transition-colors group-hover:bg-emerald-accent/[0.08]">
                  {f.icon}
                </div>
                <h3 className="mb-2 font-sans text-lg font-bold text-white">
                  {f.title}
                </h3>
                <p className="font-mono text-[13px] leading-relaxed text-[#777]">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="gsap-cta relative z-[1] flex min-h-[calc(100dvh-49px)] flex-col items-center justify-center px-4 text-center">
        <div>
          <div className="gsap-cta-tag mb-3 font-mono text-[11px] tracking-[0.15em] text-emerald-accent/60">
            EVERY TOKEN. LOCKED.
          </div>
          <h2 className="gsap-cta-heading mb-4 font-sans text-[clamp(28px,6vw,48px)] font-extrabold text-white">
            Ready to{" "}
            <span className="text-emerald-accent">ship</span>?
          </h2>
          <p className="gsap-cta-desc mb-8 max-w-md font-mono text-[13px] leading-relaxed text-[#555]">
            Launch your token with locked dev bags. Let the code speak for
            itself.
          </p>
          <div className="gsap-cta-buttons flex flex-wrap justify-center gap-3">
            <ShinyButton href="/launch">launch token &rarr;</ShinyButton>
            <Link href="/feed" className="btn-secondary px-8 py-3.5">
              explore feed
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
