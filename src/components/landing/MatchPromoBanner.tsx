"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SLIDES = [
  {
    eyebrow: "Limited time",
    title: "Approved partner buys get a 100% match.",
    body: "If we select your launch, LCKD matches the SOL you commit at launch.",
  },
  {
    eyebrow: "Locked with you",
    title: "Our match follows your lock term.",
    body: "We use the same duration and unlock date. The matched tokens do not move early.",
  },
  {
    eyebrow: "Yours at unlock",
    title: "You receive the full matched supply.",
    body: "When the lock ends, the tokens from our matched buy are sent to you.",
  },
] as const;

const SLIDE_INTERVAL_MS = 5200;

export default function MatchPromoBanner() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const interval = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % SLIDES.length);
    }, SLIDE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [isPaused]);

  return (
    <aside
      aria-label="Partner launch matching program"
      className="relative w-full max-w-[1152px] overflow-hidden rounded-card border border-accent/25 bg-surface shadow-card"
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-accent-dim" aria-hidden="true" />
      <div className="relative grid min-h-[116px] grid-cols-[44px_minmax(0,1fr)] items-center gap-3 px-4 py-4 sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:gap-5 sm:px-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-control border border-accent/30 bg-accent-dim text-accent sm:h-[52px] sm:w-[52px]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </div>

        <div className="min-w-0 overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{ transform: `translateX(-${activeSlide * 100}%)` }}
          >
            {SLIDES.map((slide, index) => (
              <div
                key={slide.title}
                className="min-w-full pr-1"
                aria-hidden={activeSlide !== index}
              >
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-accent">
                  {slide.eyebrow}
                </div>
                <div className="mt-1 font-sans text-[15px] font-bold leading-snug text-text-1 sm:text-lg">
                  {slide.title}
                </div>
                <p className="mt-1 max-w-[620px] font-sans text-xs leading-5 text-text-2 sm:text-sm">
                  {slide.body}
                </p>
              </div>
            ))}
          </div>
        </div>

        <Link
          href="/match"
          className="btn-primary col-span-2 ml-[56px] justify-center sm:col-span-1 sm:ml-0 sm:px-5"
        >
          apply for matching
        </Link>
      </div>

      <div className="relative flex min-h-10 items-center justify-center gap-0.5 border-t border-line px-3">
        {SLIDES.map((slide, index) => (
          <button
            key={slide.title}
            type="button"
            onClick={() => {
              setActiveSlide(index);
              setIsPaused(true);
            }}
            aria-label={`Show offer ${index + 1}`}
            aria-current={activeSlide === index ? "true" : undefined}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-md"
          >
            <span
              className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${
                activeSlide === index ? "w-6 bg-accent" : "w-1.5 bg-line-strong"
              }`}
              aria-hidden="true"
            />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setIsPaused((current) => !current)}
          aria-pressed={isPaused}
          className="focus-ring ml-1 min-h-8 rounded-md px-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-text-3 hover:text-text-1"
        >
          {isPaused ? "resume" : "pause"}
        </button>
      </div>
    </aside>
  );
}
