"use client";

import { useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import HeroTerminal from "./HeroTerminal";
import StatsBoard from "./StatsBoard";
import CLIShowcase from "./CLIShowcase";
import ValueProps from "./ValueProps";
import Badge from "@/components/ui/Badge";
import CommitGraph from "@/components/ui/CommitGraph";
import { TrustTier } from "@/types/index";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const TRUST_PILLS = [
  "Streamflow Vesting",
  "Pump.fun Liquidity",
  "GitHub Verified",
];

const STEPS = [
  { num: "01", title: "Token Identity" },
  { num: "02", title: "Live Trading" },
  { num: "03", title: "On-Chain Metrics" },
  { num: "04", title: "Verified Vesting" },
];

const NAV_H = 49;

export default function TokenShowcase() {
  const containerRef = useRef<HTMLDivElement>(null);
  const assemblyRef = useRef<HTMLDivElement>(null);
  const chartLineRef = useRef<SVGPathElement>(null);
  const chartFillRef = useRef<SVGPathElement>(null);

  useGSAP(
    () => {
      if (!assemblyRef.current) return;

      const mm = gsap.matchMedia();

      // ─── Hero entrance (all breakpoints) ────────────────
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
      gsap.set(".gsap-hero-heading", { y: 60, scale: 0.95, transformOrigin: "center bottom" });
      gsap.set(".gsap-hero-glow", { opacity: 0, scale: 0.8 });

      const heroTl = gsap.timeline({ delay: 0.15 });

      heroTl.to(".gsap-hero-glow", {
        opacity: 1,
        scale: 1,
        duration: 1.4,
        ease: "power2.out",
      }, 0);

      heroTl.to(".gsap-hero-terminal", {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: "expo.out",
      }, 0.1);

      heroTl.to(".gsap-hero-heading", {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.9,
        ease: "expo.out",
      }, 0.25);

      heroTl.to(".gsap-hero-sub", {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: "power4.out",
      }, 0.45);

      heroTl.to(".gsap-hero-ctas", {
        opacity: 1,
        y: 0,
        duration: 0.6,
        ease: "back.out(1.4)",
      }, 0.6);

      heroTl.to(".gsap-hero-pills", {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: "power3.out",
      }, 0.75);

      heroTl.to(".gsap-hero-stats", {
        opacity: 1,
        y: 0,
        duration: 0.6,
        ease: "power4.out",
      }, 0.85);

      heroTl.to(".gsap-hero-scroll", {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: "power3.out",
      }, 1.1);

      // ─── Desktop: pinned scrub timeline ──────────────────
      mm.add("(min-width: 768px)", () => {
        const isLg = window.matchMedia("(min-width: 1024px)").matches;
        const scrollLen = window.innerHeight * 2.5;

        // Initial hidden states — varied distances for organic feel
        gsap.set(".gsap-back", { opacity: 0, y: 15 });
        gsap.set(".gsap-token-header", { opacity: 0, y: 50, scale: 0.97, transformOrigin: "left top" });
        gsap.set(".gsap-chart", { opacity: 0, y: 40, scale: 0.98, transformOrigin: "center top" });
        gsap.set(".gsap-stats", { opacity: 0, y: 35 });
        gsap.set(".gsap-lock", { opacity: 0, y: 45, scale: 0.97, transformOrigin: "center center" });
        gsap.set(".gsap-dev", { opacity: 0, y: 45, scale: 0.97, transformOrigin: "center center" });
        if (isLg) gsap.set(".gsap-swap", { opacity: 0, x: 40, scale: 0.97 });
        gsap.set(".gsap-ambient", { opacity: 0, scale: 0.85 });

        // Chart line draw setup
        if (chartLineRef.current) {
          const len = chartLineRef.current.getTotalLength();
          gsap.set(chartLineRef.current, {
            strokeDasharray: len,
            strokeDashoffset: len,
          });
        }
        if (chartFillRef.current) gsap.set(chartFillRef.current, { opacity: 0 });

        // Step indicator setup
        gsap.set(".gsap-progress-fill", {
          scaleY: 0,
          transformOrigin: "top center",
        });
        STEPS.forEach((_, i) => gsap.set(`.gsap-step-${i}`, { opacity: 0.12 }));

        // ── Build scrubbed timeline ───────────────────
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: assemblyRef.current,
            pin: true,
            start: `top ${NAV_H}`,
            end: `+=${scrollLen}`,
            scrub: 0.5,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        // Continuous progress line
        tl.to(
          ".gsap-progress-fill",
          { scaleY: 1, ease: "none", duration: 4 },
          0
        );

        // Ambient glow — slow breathe in
        tl.to(
          ".gsap-ambient",
          { opacity: 1, scale: 1, duration: 2.5, ease: "expo.out" },
          0.1
        );

        // ── 01 Token Identity ─────────────────────────
        tl.to(
          ".gsap-back",
          { opacity: 1, y: 0, duration: 0.3, ease: "power4.out" },
          0
        );
        tl.to(
          ".gsap-token-header",
          { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "expo.out" },
          0.06
        );
        tl.to(`.gsap-step-0`, { opacity: 1, duration: 0.25 }, 0.05);

        // ── 02 Live Trading ───────────────────────────
        tl.to(`.gsap-step-0`, { opacity: 0.25, duration: 0.2 }, 0.8);
        tl.to(
          ".gsap-chart",
          { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "expo.out" },
          0.85
        );
        if (chartLineRef.current) {
          tl.to(
            chartLineRef.current,
            { strokeDashoffset: 0, duration: 1.0, ease: "expo.inOut" },
            0.95
          );
        }
        if (chartFillRef.current) {
          tl.to(
            chartFillRef.current,
            { opacity: 1, duration: 0.6, ease: "power3.in" },
            1.7
          );
        }
        if (isLg) {
          tl.to(
            ".gsap-swap",
            { opacity: 1, x: 0, scale: 1, duration: 0.7, ease: "expo.out" },
            1.1
          );
        }
        tl.to(`.gsap-step-1`, { opacity: 1, duration: 0.25 }, 0.85);

        // ── 03 On-Chain Metrics ───────────────────────
        tl.to(`.gsap-step-1`, { opacity: 0.25, duration: 0.2 }, 1.9);
        tl.to(
          ".gsap-stats",
          { opacity: 1, y: 0, duration: 0.7, ease: "expo.out" },
          2.0
        );
        tl.to(`.gsap-step-2`, { opacity: 1, duration: 0.25 }, 2.0);

        // ── 04 Verified Vesting ───────────────────────
        tl.to(`.gsap-step-2`, { opacity: 0.25, duration: 0.2 }, 2.7);
        tl.to(
          ".gsap-lock",
          { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "expo.out" },
          2.8
        );
        tl.to(
          ".gsap-dev",
          { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "expo.out" },
          3.0
        );
        tl.to(`.gsap-step-3`, { opacity: 1, duration: 0.25 }, 2.8);

        // Brief hold
        tl.to({}, { duration: 0.6 });
      });

      // ─── Mobile / small tablet: scroll reveals ──────────
      mm.add("(max-width: 767px)", () => {
        const reveals: { sel: string; y: number; scale?: number }[] = [
          { sel: ".gsap-back", y: 20 },
          { sel: ".gsap-token-header", y: 40, scale: 0.97 },
          { sel: ".gsap-chart", y: 35, scale: 0.98 },
          { sel: ".gsap-swap", y: 30 },
          { sel: ".gsap-stats", y: 30 },
          { sel: ".gsap-lock", y: 35, scale: 0.97 },
          { sel: ".gsap-dev", y: 35, scale: 0.97 },
        ];

        reveals.forEach(({ sel, y, scale }) => {
          const el = document.querySelector(sel);
          if (!el) return;

          gsap.from(el, {
            opacity: 0,
            y,
            scale: scale ?? 1,
            duration: 0.8,
            ease: "expo.out",
            scrollTrigger: {
              trigger: el,
              start: "top 88%",
              toggleActions: "play none none reverse",
            },
          });
        });

        // Chart line draw on mobile
        if (chartLineRef.current) {
          const len = chartLineRef.current.getTotalLength();
          gsap.set(chartLineRef.current, {
            strokeDasharray: len,
            strokeDashoffset: len,
          });
          gsap.to(chartLineRef.current, {
            strokeDashoffset: 0,
            duration: 1.2,
            ease: "expo.inOut",
            scrollTrigger: {
              trigger: ".gsap-chart",
              start: "top 75%",
              toggleActions: "play none none reverse",
            },
          });
        }
        if (chartFillRef.current) {
          gsap.from(chartFillRef.current, {
            opacity: 0,
            duration: 0.5,
            delay: 0.6,
            scrollTrigger: {
              trigger: ".gsap-chart",
              start: "top 75%",
              toggleActions: "play none none reverse",
            },
          });
        }
      });

      // ─── CTA entrance (all breakpoints) ─────────────────
      gsap.set(".gsap-cta-tag", { opacity: 0, y: 20 });
      gsap.set(".gsap-cta-heading", { opacity: 0, y: 50, scale: 0.96, transformOrigin: "center bottom" });
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

      ctaTl.to(".gsap-cta-heading", {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.8,
        ease: "expo.out",
      }, "-=0.3");

      ctaTl.to(".gsap-cta-desc", {
        opacity: 1,
        y: 0,
        duration: 0.6,
        ease: "power4.out",
      }, "-=0.4");

      ctaTl.to(".gsap-cta-buttons", {
        opacity: 1,
        y: 0,
        duration: 0.6,
        ease: "back.out(1.4)",
      }, "-=0.3");
    },
    { scope: containerRef }
  );

  return (
    <div ref={containerRef}>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative flex min-h-[calc(100dvh-49px)] flex-col items-center justify-center px-4 text-center">
        <div className="hero-glow gsap-hero-glow" aria-hidden="true" />

        <div className="relative z-10 w-full max-w-[680px]">
          <div className="gsap-hero-terminal">
            <HeroTerminal />
          </div>
          <h1 className="gsap-hero-heading mx-auto mb-3.5 font-sans text-[clamp(32px,8vw,60px)] leading-[1.05] font-extrabold tracking-[-0.03em] text-white">
            Dev Bags
            <br />
            <span className="text-emerald-accent">Locked on Launch</span>
          </h1>
          <p className="gsap-hero-sub mx-auto mb-7 max-w-[440px] font-mono text-[clamp(11px,2.3vw,14px)] leading-[1.7] text-[#777]">
            Verified developers. Locked bags. On-chain proof.
            <br />
            Built on pump.fun + Streamflow.
          </p>
          <div className="gsap-hero-ctas flex flex-wrap justify-center gap-2.5">
            <Link href="/launch" className="btn-primary px-6 py-3">
              launch token &rarr;
            </Link>
            <Link href="/feed" className="btn-secondary px-6 py-3">
              explore builders
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

      {/* ── Value Props ────────────────────────────────── */}
      <ValueProps />

      {/* ── Assembly Zone ────────────────────────────────── */}
      <section
        ref={assemblyRef}
        className="relative md:h-[calc(100dvh-49px)]"
      >
        {/* Ambient glow */}
        <div
          className="gsap-ambient pointer-events-none absolute left-1/2 top-[12%] -translate-x-1/2 rounded-full"
          style={{
            width: "min(700px, 90vw)",
            height: "min(400px, 50vw)",
            background:
              "radial-gradient(ellipse, rgba(16,185,129,0.06) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="mx-auto max-w-[1100px] px-4 pt-4 md:px-6">
          {/* Back to feed */}
          <div className="gsap-back">
            <span className="mb-3 inline-block font-mono text-xs text-[#555] transition-colors hover:text-[#888]">
              &larr; back to feed
            </span>
          </div>

          {/* ── 01 Token header ──────────────────────── */}
          <div className="gsap-token-header mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-emerald-accent/20 bg-emerald-accent/[0.06]">
                  <span className="font-mono text-sm font-bold text-emerald-accent">
                    ND
                  </span>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-sans text-[clamp(20px,5vw,28px)] font-extrabold text-white">
                      NeoDev
                    </h2>
                    <span className="font-mono text-[13px] text-[#555]">
                      $NDEV
                    </span>
                    <Badge tier={TrustTier.BUILDER} label="BUILDER" />
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-[#666]">
                    <span className="text-emerald-accent">@synthetic_dev</span>
                    {" \u00B7 5y on GitHub \u00B7 47 repos"}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[clamp(18px,4vw,24px)] font-bold text-white">
                  $0.00042
                </div>
                <div className="mt-0.5 font-mono text-xs font-semibold text-emerald-accent">
                  +12.4% 24h
                </div>
              </div>
            </div>
          </div>

          {/* ── 02 Chart + Swap ──────────────────────── */}
          <div className="mb-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
              {/* Chart */}
              <div className="gsap-chart rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                <svg
                  viewBox="0 0 400 120"
                  className="h-[110px] w-full lg:h-[150px]"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#10b981"
                        stopOpacity="0.15"
                      />
                      <stop
                        offset="100%"
                        stopColor="#10b981"
                        stopOpacity="0"
                      />
                    </linearGradient>
                  </defs>
                  {[30, 60, 90].map((y) => (
                    <line
                      key={y}
                      x1="0"
                      y1={y}
                      x2="400"
                      y2={y}
                      stroke="rgba(255,255,255,0.03)"
                    />
                  ))}
                  <path
                    ref={chartLineRef}
                    d="M0,95 C40,90 60,85 100,78 C140,70 160,82 200,65 C240,48 260,55 300,38 C340,25 360,30 400,15"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    ref={chartFillRef}
                    d="M0,95 C40,90 60,85 100,78 C140,70 160,82 200,65 C240,48 260,55 300,38 C340,25 360,30 400,15 L400,120 L0,120 Z"
                    fill="url(#cf)"
                  />
                </svg>
              </div>

              {/* Swap */}
              <div className="gsap-swap hidden rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 lg:block">
                <div className="mb-2.5 font-mono text-[10px] uppercase tracking-wider text-[#444]">
                  Jupiter Swap
                </div>
                <div className="space-y-2">
                  <div className="rounded-lg bg-black/30 px-3 py-2.5">
                    <div className="font-mono text-[9px] text-[#555]">
                      You pay
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-base text-white">
                        1.0
                      </span>
                      <span className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-white">
                        SOL
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-black/30 px-3 py-2.5">
                    <div className="font-mono text-[9px] text-[#555]">
                      You receive
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-base text-emerald-accent">
                        ~238,095
                      </span>
                      <span className="rounded border border-emerald-accent/20 bg-emerald-accent/10 px-2 py-0.5 font-mono text-[10px] text-emerald-accent">
                        NDEV
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-gradient-to-r from-emerald-accent to-emerald-700 py-2.5 text-center font-mono text-xs font-bold text-black">
                    Swap
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── 03 Stats strip ───────────────────────── */}
          <div className="gsap-stats">
            <div className="stats-strip">
              {[
                { l: "MCap", v: "$420K" },
                { l: "Volume", v: "$89K" },
                { l: "Holders", v: "1,247" },
                { l: "Locked", v: "5M NDEV" },
                { l: "Duration", v: "12 months" },
              ].map((stat) => (
                <div
                  key={stat.l}
                  className="bg-[rgba(8,8,12,0.8)] px-2.5 py-3"
                >
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[#444]">
                    {stat.l}
                  </div>
                  <div className="font-mono text-[clamp(12px,2.5vw,15px)] font-bold text-white">
                    {stat.v}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 04 Lock + Dev ─────────────────────────── */}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Lock card */}
            <div className="gsap-lock rounded-xl border border-emerald-accent/15 bg-emerald-accent/[0.03] p-5">
              <div className="mb-3 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-[#888]">
                <span>Vesting Lock &mdash; Streamflow</span>
                <span className="text-[10px] font-normal normal-case tracking-normal text-[#555]">
                  verify &rarr;
                </span>
              </div>
              <div className="mb-1.5 flex justify-between font-mono text-[11px] text-[#666]">
                <span>Jan 2025</span>
                <span>Jan 2026</span>
              </div>
              <div className="relative mb-3 h-2 w-full overflow-visible rounded bg-white/[0.04]">
                <div className="gsap-lock-bar h-full w-[28%] rounded bg-gradient-to-r from-emerald-accent to-emerald-700" />
                <div className="gsap-lock-marker absolute -top-[3px] left-[28%] h-3.5 w-0.5 bg-emerald-accent shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              </div>
              <div className="mb-4 text-center">
                <span className="font-mono text-[22px] font-bold text-white">
                  72%
                </span>
                <span className="ml-1.5 font-mono text-xs text-[#555]">
                  still locked
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-black/30 px-3 py-2">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-[#555]">
                    Tokens
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-[#e5e5e5]">
                    5M NDEV
                  </div>
                </div>
                <div className="rounded-lg bg-black/30 px-3 py-2">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-[#555]">
                    Duration
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-[#e5e5e5]">
                    12 months
                  </div>
                </div>
              </div>
            </div>

            {/* Dev profile */}
            <div className="gsap-dev rounded-xl border border-white/[0.06] bg-white/[0.015] p-5">
              <div className="mb-3.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#888]">
                Developer Profile
              </div>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-emerald-accent/30 bg-emerald-accent/10 font-mono text-[13px] font-bold text-emerald-accent">
                  SD
                </div>
                <div>
                  <span className="font-mono text-sm font-bold text-white">
                    @synthetic_dev
                  </span>
                  <div className="font-mono text-[10px] text-[#555]">
                    47 repos &middot; 2,100 commits &middot; 5y
                  </div>
                </div>
              </div>
              <div className="mb-3">
                <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-[#555]">
                  commit activity (16 weeks)
                </div>
                <CommitGraph />
              </div>
              <div className="rounded-lg bg-black/30 px-3 py-2.5 font-mono text-xs">
                <span className="text-[#555]">latest &rarr; </span>
                <span className="text-emerald-accent">2 days ago</span>
                <div className="mt-1 text-[11px] text-[#777]">
                  &ldquo;refactor: optimize vesting claim flow&rdquo;
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Step indicators (lg+) ──────────────────── */}
        <div className="pointer-events-none absolute right-5 top-0 hidden h-full items-center lg:flex xl:right-8">
          <div className="relative flex flex-col gap-9">
            {/* Progress track line */}
            <div className="absolute left-[calc(100%-5px)] top-[6px] h-[calc(100%-12px)] w-px bg-white/[0.04]">
              <div className="gsap-progress-fill h-full w-full bg-gradient-to-b from-emerald-accent/50 via-emerald-accent/30 to-emerald-accent/10" />
            </div>

            {STEPS.map((step, i) => (
              <div
                key={i}
                className={`gsap-step-${i} flex items-center gap-3`}
              >
                <div className="text-right">
                  <div className="font-mono text-[9px] tracking-[0.15em] text-emerald-accent/60">
                    {step.num}
                  </div>
                  <div className="font-sans text-[13px] leading-tight font-semibold text-white/80">
                    {step.title}
                  </div>
                </div>
                <div className="relative z-10 h-2.5 w-2.5 shrink-0 rounded-full border border-emerald-accent/30 bg-emerald-accent/15" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLI Showcase ────────────────────────────────── */}
      <CLIShowcase />

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="gsap-cta flex min-h-[calc(100dvh-49px)] flex-col items-center justify-center px-4 text-center">
        <div>
          <div className="gsap-cta-tag mb-3 font-mono text-[11px] tracking-[0.15em] text-emerald-accent/60">
            EVERY TOKEN. VERIFIED.
          </div>
          <h2 className="gsap-cta-heading mb-4 font-sans text-[clamp(28px,6vw,48px)] font-extrabold text-white">
            Ready to{" "}
            <span className="text-emerald-accent">build trust</span>?
          </h2>
          <p className="gsap-cta-desc mb-8 max-w-md font-mono text-[13px] leading-relaxed text-[#555]">
            Launch your token with locked dev bags. Let the code speak for
            itself.
          </p>
          <div className="gsap-cta-buttons flex flex-wrap justify-center gap-3">
            <Link href="/launch" className="btn-primary px-8 py-3.5">
              launch token &rarr;
            </Link>
            <Link href="/feed" className="btn-secondary px-8 py-3.5">
              explore feed
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
