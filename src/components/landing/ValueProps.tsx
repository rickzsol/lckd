"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const PROPS = [
  {
    label: "01",
    heading: "Locked on Launch.",
    lines: [
      "No more begging devs to lock.",
      "No more gambling on promises.",
      "Every allocation is locked before the first trade.",
    ],
    accent: "Streamflow token lock. Enforced. On-chain.",
    icon: "LK",
  },
  {
    label: "02",
    heading: "Built for Builders.",
    lines: [
      "Connect your GitHub. Prove your code.",
      "Your commit history becomes your reputation.",
      "Ship code, lock tokens, earn your tier.",
    ],
    accent: "GitHub-verified profiles. Real builders only.",
    icon: "GH",
  },
  {
    label: "03",
    heading: "Proof, On-Chain.",
    lines: [
      "Transparent lock schedules anyone can verify.",
      "Dev bags visible. Lock duration public.",
      "The chart speaks. The contract proves it.",
    ],
    accent: "No backroom deals. Just proof.",
    icon: "TX",
  },
];

export default function ValueProps() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!containerRef.current) return;

      const mm = gsap.matchMedia();

      // ─── Desktop: dramatic staggered reveals ───────────
      mm.add("(min-width: 768px)", () => {
        // Section tag entrance
        gsap.set(".vp-section-tag", { opacity: 0, y: 20 });
        gsap.from(".vp-section-tag", {
          opacity: 0,
          y: 20,
          duration: 0.6,
          ease: "power4.out",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 80%",
            toggleActions: "play none none reverse",
          },
        });

        PROPS.forEach((_, i) => {
          const block = `.vp-block-${i}`;
          const icon = `.vp-icon-${i}`;
          const heading = `.vp-heading-${i}`;
          const lines = `.vp-line-${i}`;
          const accent = `.vp-accent-${i}`;
          const rule = `.vp-rule-${i}`;
          const glow = `.vp-glow-${i}`;

          // Initial states with varied transforms for organic feel
          gsap.set(icon, { opacity: 0, scale: 0.5, rotation: -15 });
          gsap.set(heading, {
            opacity: 0,
            y: 70,
            scale: 0.9,
            skewY: 2,
            transformOrigin: "left bottom",
          });
          gsap.set(lines, { opacity: 0, x: -30, y: 15 });
          gsap.set(accent, { opacity: 0, y: 20, x: -10 });
          gsap.set(rule, { scaleX: 0, transformOrigin: "left center" });
          gsap.set(glow, { opacity: 0, scale: 0.6 });

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: block,
              start: "top 72%",
              end: "top 20%",
              toggleActions: "play none none reverse",
            },
          });

          // Background glow breathe
          tl.to(glow, {
            opacity: 1,
            scale: 1,
            duration: 1.2,
            ease: "power2.out",
          }, 0);

          // Icon: playful pop
          tl.to(icon, {
            opacity: 1,
            scale: 1,
            rotation: 0,
            duration: 0.6,
            ease: "back.out(2.5)",
          }, 0.05);

          // Heading: dramatic snap with skew resolve
          tl.to(heading, {
            opacity: 1,
            y: 0,
            scale: 1,
            skewY: 0,
            duration: 0.85,
            ease: "expo.out",
          }, 0.1);

          // Lines: staggered slide-in from left
          tl.to(lines, {
            opacity: 1,
            x: 0,
            y: 0,
            duration: 0.6,
            stagger: { amount: 0.35, from: "start" },
            ease: "power4.out",
          }, "-=0.5");

          // Rule: sharp draw
          tl.to(rule, {
            scaleX: 1,
            duration: 0.5,
            ease: "expo.inOut",
          }, "-=0.3");

          // Accent text: slide up
          tl.to(accent, {
            opacity: 1,
            y: 0,
            x: 0,
            duration: 0.5,
            ease: "power4.out",
          }, "-=0.2");
        });
      });

      // ─── Mobile: snappy scroll reveals ──────────────────
      mm.add("(max-width: 767px)", () => {
        gsap.from(".vp-section-tag", {
          opacity: 0,
          y: 15,
          duration: 0.5,
          ease: "power4.out",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 85%",
            toggleActions: "play none none reverse",
          },
        });

        PROPS.forEach((_, i) => {
          const block = `.vp-block-${i}`;
          const icon = `.vp-icon-${i}`;
          const heading = `.vp-heading-${i}`;
          const lines = `.vp-line-${i}`;
          const accent = `.vp-accent-${i}`;

          gsap.set(icon, { opacity: 0, scale: 0.6 });
          gsap.set(heading, { opacity: 0, y: 40, scale: 0.95 });
          gsap.set(lines, { opacity: 0, y: 20 });
          gsap.set(accent, { opacity: 0, y: 15 });

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: block,
              start: "top 85%",
              toggleActions: "play none none reverse",
            },
          });

          tl.to(icon, {
            opacity: 1,
            scale: 1,
            duration: 0.5,
            ease: "back.out(2)",
          });

          tl.to(heading, {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.7,
            ease: "expo.out",
          }, "-=0.3");

          tl.to(lines, {
            opacity: 1,
            y: 0,
            duration: 0.5,
            stagger: 0.08,
            ease: "power4.out",
          }, "-=0.35");

          tl.to(accent, {
            opacity: 1,
            y: 0,
            duration: 0.4,
            ease: "power3.out",
          }, "-=0.2");
        });
      });
    },
    { dependencies: [] }
  );

  return (
    <section ref={containerRef} className="relative w-full px-4 py-24 md:py-40">
      {/* Full-width ambient glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: "min(1200px, 100vw)",
          height: "min(800px, 80vw)",
          background:
            "radial-gradient(ellipse, rgba(16,185,129,0.04) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto max-w-[1100px]">
        {/* Section tag */}
        <div className="vp-section-tag mb-16 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-emerald-accent/50 md:mb-24">
          Why Lockpad
        </div>

        {/* Value blocks — full-width grid */}
        <div className="grid grid-cols-1 gap-16 md:gap-0">
          {PROPS.map((prop, i) => (
            <div
              key={i}
              className={`vp-block-${i} relative border-b border-white/[0.04] py-12 last:border-b-0 md:py-20`}
            >
              {/* Per-block ambient glow */}
              <div
                className={`vp-glow-${i} pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 rounded-full`}
                style={{
                  width: "min(500px, 60vw)",
                  height: "min(300px, 40vw)",
                  background:
                    "radial-gradient(ellipse, rgba(16,185,129,0.03) 0%, transparent 70%)",
                }}
                aria-hidden="true"
              />

              <div className="relative grid grid-cols-1 gap-6 md:grid-cols-[auto_1fr] md:gap-12">
                {/* Left: number + icon */}
                <div className="flex items-start gap-4 md:w-[140px] md:flex-col md:gap-3">
                  <div className="font-mono text-[11px] font-bold tracking-[0.2em] text-emerald-accent/40">
                    {prop.label}
                  </div>
                  <div
                    className={`vp-icon-${i} flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-accent/15 bg-emerald-accent/[0.04] font-mono text-sm font-bold text-emerald-accent`}
                  >
                    {prop.icon}
                  </div>
                </div>

                {/* Right: content */}
                <div className="flex-1">
                  {/* Big heading */}
                  <h2
                    className={`vp-heading-${i} mb-5 font-sans text-[clamp(32px,7vw,64px)] leading-[1.0] font-extrabold tracking-[-0.03em] text-white md:mb-7`}
                  >
                    {prop.heading}
                  </h2>

                  {/* Description lines */}
                  <div className="mb-5 space-y-1.5 md:mb-7">
                    {prop.lines.map((line, j) => (
                      <p
                        key={j}
                        className={`vp-line-${i} font-mono text-[clamp(13px,2.5vw,16px)] leading-[1.7] text-[#777]`}
                      >
                        {line}
                      </p>
                    ))}
                  </div>

                  {/* Divider rule */}
                  <div
                    className={`vp-rule-${i} mb-4 h-px bg-gradient-to-r from-emerald-accent/40 via-emerald-accent/15 to-transparent`}
                  />

                  {/* Accent line */}
                  <p
                    className={`vp-accent-${i} font-mono text-[clamp(11px,2vw,13px)] font-semibold tracking-wide text-emerald-accent/80`}
                  >
                    {prop.accent}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
