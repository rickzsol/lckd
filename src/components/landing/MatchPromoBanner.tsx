"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

const SLIDES = [
  {
    kicker: "LOCKED WITH YOU",
    title: "Our match follows your lock term.",
    body: "We use the same duration and unlock date. The matched tokens do not move early.",
  },
  {
    kicker: "YOURS AT UNLOCK",
    title: "You receive the full matched supply.",
    body: "When the lock ends, the tokens from our matched buy are sent to you.",
  },
  {
    kicker: "MATCHED BUY",
    title: "We buy alongside your launch.",
    body: "Approved launches get a matched buy from LCKD, locked on your exact schedule.",
  },
] as const;

const SLIDE_INTERVAL_MS = 5_500;

interface MatchPromoBannerProps {
  autoRotate?: boolean;
  showClose?: boolean;
}

export default function MatchPromoBanner({
  autoRotate = true,
  showClose = true,
}: MatchPromoBannerProps) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isDismissedLocally, setIsDismissedLocally] = useState(false);

  useEffect(() => {
    if (
      !autoRotate ||
      isPaused ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) return;

    const timeout = window.setTimeout(() => {
      setActiveSlide((current) => (current + 1) % SLIDES.length);
      setCycle((current) => current + 1);
    }, SLIDE_INTERVAL_MS);

    return () => window.clearTimeout(timeout);
  }, [autoRotate, cycle, isPaused]);

  if (isDismissedLocally) return null;

  const showSlide = (index: number) => {
    setActiveSlide(index);
    setCycle((current) => current + 1);
  };

  const resumeRotation = () => {
    setIsPaused(false);
    setCycle((current) => current + 1);
  };

  const dismiss = () => {
    setIsDismissedLocally(true);
  };

  return (
    <aside
      aria-label="Partner launch matching program"
      className="relative w-full max-w-[1160px] overflow-hidden rounded-banner border border-line-default bg-surface-banner shadow-banner"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) resumeRotation();
      }}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget as Node) &&
          !event.currentTarget.matches(":hover")
        ) resumeRotation();
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,var(--color-accent-banner-wash),transparent_60%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute top-0 left-0 h-px w-[140px] bg-[linear-gradient(90deg,transparent,var(--color-accent-400),transparent)] motion-reduce:hidden"
        style={{
          animation: "banner-glide var(--duration-banner-cycle) linear infinite",
          animationPlayState: isPaused ? "paused" : "running",
        }}
        aria-hidden="true"
      />

      {showClose && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss partner launch announcement"
          className="focus-ring group absolute -top-0.5 -right-0.5 z-20 flex h-11 w-11 items-center justify-center rounded-control text-text-faint"
        >
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] transition-colors duration-180 group-hover:bg-line-default group-hover:text-text-1">
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
        </button>
      )}

      <div className="relative grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3.5 px-4 pt-4 sm:grid-cols-[52px_minmax(0,1fr)] sm:px-6 sm:pt-5 md:grid-cols-[52px_minmax(0,1fr)_auto] md:gap-5 lg:grid-cols-[1fr_auto_1fr]">
        <Image
          src="/lckd-banner-lock.png"
          alt="LCKD lock"
          width={52}
          height={52}
          quality={75}
          loading="eager"
          fetchPriority="high"
          className="h-12 w-12 justify-self-start rounded-[12px] border border-accent/30 object-cover sm:h-[52px] sm:w-[52px] sm:rounded-[13px]"
        />

        <div className="relative min-h-[82px] min-w-0 sm:min-h-[92px] md:min-h-20 lg:h-20 lg:min-h-0 lg:w-[680px]">
          {SLIDES.map((slide, index) => {
            const isActive = activeSlide === index;
            return (
              <div
                key={slide.title}
                aria-hidden={!isActive}
                className={`flex flex-col items-start justify-center gap-[5px] pr-5 text-left transition-[opacity,transform] duration-[var(--duration-banner-transition)] ease-out motion-reduce:transition-none lg:items-center lg:pr-0 lg:text-center ${
                  isActive
                    ? "relative min-h-[82px] translate-y-0 opacity-100 sm:min-h-[92px] md:min-h-20 lg:h-20 lg:min-h-0"
                    : "pointer-events-none absolute inset-0 translate-y-2 opacity-0"
                }`}
              >
                <span className="font-mono text-[9px] font-bold tracking-[0.18em] text-accent-400 sm:text-[10.5px] sm:tracking-[0.2em]">
                  {slide.kicker}
                </span>
                <span className="font-sans text-[15px] font-bold leading-[1.2] tracking-[-0.01em] text-text-1 sm:text-[17px] lg:text-[19px]">
                  {slide.title}
                </span>
                <span className="max-w-[640px] font-sans text-[11.5px] leading-[1.45] text-text-2 sm:text-[12.5px] lg:text-[13.5px]">
                  {slide.body}
                </span>
              </div>
            );
          })}
        </div>

        <Link
          href="/match"
          className="focus-ring col-span-2 inline-flex min-h-10 items-center justify-center justify-self-stretch rounded-[9px] border border-accent/45 bg-accent-dim px-4 font-mono text-[11px] font-bold whitespace-nowrap text-accent-400 shadow-[inset_0_0_16px_var(--color-accent-banner-shadow)] transition-colors duration-180 hover:border-accent hover:bg-accent hover:text-accent-ink sm:col-span-1 sm:col-start-2 sm:min-h-11 sm:justify-self-center sm:rounded-[10px] sm:px-5 sm:text-[13px] md:col-start-auto md:mr-5 md:justify-self-end"
        >
          apply for matching
        </Link>
      </div>

      <div className="relative mt-[14px] h-[27px] border-t border-line px-6">
        <div className="absolute top-[2px] left-1/2 flex -translate-x-1/2 items-center gap-0.5">
          {SLIDES.map((slide, index) => {
            const isActive = activeSlide === index;
            return (
              <button
                key={slide.title}
                type="button"
                onClick={() => showSlide(index)}
                aria-label={`Show announcement ${index + 1}`}
                aria-current={isActive ? "true" : undefined}
                className="focus-ring group flex h-6 w-[34px] items-center justify-center rounded-full"
              >
                <span className="h-[5px] w-[26px] overflow-hidden rounded-full bg-line-strong transition-colors group-hover:bg-text-faint" aria-hidden="true">
                  {isActive && (
                    <span
                      key={`${index}-${cycle}`}
                      className={`block h-full rounded-full bg-accent motion-reduce:w-full ${autoRotate ? "" : "w-full"}`}
                      style={{
                        animation: autoRotate
                          ? "banner-progress var(--duration-banner-cycle) linear forwards"
                          : undefined,
                        animationPlayState: isPaused ? "paused" : "running",
                      }}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
