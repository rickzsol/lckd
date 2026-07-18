import Link from "next/link";
import DitherWave from "./DitherWave";
import HeroStats from "./HeroStats";
import type { OfficialLaunchEvent } from "@/lib/launchMonitor";

const RISE = "rise 600ms cubic-bezier(0.16,1,0.3,1) both";

interface Props {
  launchMonitorUrl: string | null;
  officialLaunch: OfficialLaunchEvent | null;
}

export default function Hero({ launchMonitorUrl, officialLaunch }: Props) {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center px-[clamp(16px,5vw,32px)] pb-12 pt-[150px] text-center">
      {/* Background: dither canvas + vignette overlays (behind the fixed navbar) */}
      <div className="pointer-events-none absolute inset-0 z-[-1]" aria-hidden="true">
        <DitherWave
          quality="low"
          speed={0.55}
          intensity={1.1}
          scale={6}
          downScale={2}
          opacity={0.55}
          primaryColor="#0B0D0C"
          secondaryColor="#155C3B"
          tertiaryColor="#2BD17E"
          className="h-full w-full"
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 z-[-1]"
        aria-hidden="true"
        style={{
          background:
            "linear-gradient(180deg, rgba(11,13,12,0.3) 0%, rgba(11,13,12,0.1) 55%, #0B0D0C 100%), radial-gradient(ellipse 66% 58% at 50% 44%, rgba(11,13,12,0.92) 0%, rgba(11,13,12,0.55) 60%, rgba(11,13,12,0) 100%)",
        }}
      />

      <h1
        className="m-0 mb-5 font-sans text-[clamp(34px,7.5vw,76px)] font-bold leading-[1.02] tracking-[-0.03em] text-text-1"
        style={{ animation: RISE, animationDelay: "80ms" }}
      >
        Builders who ship.
        <br />
        <span className="text-accent">Tokens that lock.</span>
      </h1>

      <p
        className="m-0 mb-9 max-w-[460px] font-mono text-[clamp(12px,3.2vw,15px)] font-medium leading-[1.8] text-text-3"
        style={{ animation: RISE, animationDelay: "160ms" }}
      >
        Create, buy, and lock in one atomic transaction. Built on pump.fun +
        Streamflow.
      </p>

      <div
        className="mb-[52px] flex flex-wrap justify-center gap-3"
        style={{ animation: RISE, animationDelay: "240ms" }}
      >
        <Link href="/launch" className="shiny-btn">
          <span className="shiny-btn__content">launch token</span>
        </Link>
        <Link
          href="/feed"
          className="h-12 rounded-control border border-white/10 bg-surface-2 px-[26px] font-mono text-[13px] font-semibold text-text-1 inline-flex items-center gap-2 transition-[border-color,transform] duration-[180ms] ease-[ease] hover:border-[rgba(43,209,126,0.4)] active:translate-y-px"
        >
          explore launches
        </Link>
      </div>

      <div
        className="flex w-full justify-center"
        style={{ animation: RISE, animationDelay: "320ms" }}
      >
        <HeroStats
          initialLaunch={officialLaunch}
          monitorUrl={launchMonitorUrl}
        />
      </div>

      <div className="absolute bottom-[22px] left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1.5 md:flex">
        <span className="font-mono text-[10px] font-medium text-text-4">
          see how it works
        </span>
        <div className="flex h-5 w-3 justify-center rounded-full border border-white/10 pt-1">
          <div className="pulse-dot h-1 w-0.5 rounded-[1px] bg-accent" />
        </div>
      </div>
    </section>
  );
}
