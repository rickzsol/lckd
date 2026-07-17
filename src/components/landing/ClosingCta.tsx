import Image from "next/image";
import Link from "next/link";
import Reveal from "./Reveal";

interface ClosingCtaProps {
  showMascot?: boolean;
}

export default function ClosingCta({ showMascot = true }: ClosingCtaProps) {
  return (
    <section className="relative overflow-hidden px-[clamp(16px,5vw,32px)] pb-[clamp(64px,9vw,100px)] pt-[clamp(72px,10vw,120px)] text-center">
      <div
        className="pointer-events-none absolute bottom-[-260px] left-1/2 h-[500px] w-[800px] -translate-x-1/2"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse, rgba(43,209,126,0.08) 0%, transparent 65%)",
        }}
      />
      <Reveal className="relative">
        <h2 className="m-0 mb-4 font-sans text-[clamp(30px,5.5vw,56px)] font-bold leading-[1.05] tracking-[-0.03em] text-text-1">
          Ready to <span className="text-accent">ship</span>?
        </h2>
        <p className="mx-auto mb-8 max-w-[420px] font-mono text-[13px] font-medium leading-[1.8] text-text-3">
          Create your token. Lock selected creator tokens.
          <br />
          Verify both finalized receipts.
        </p>
        <div className="mb-11 flex flex-wrap justify-center gap-3">
          <span
            className="inline-flex h-12 cursor-not-allowed items-center gap-2 rounded-control bg-accent px-7 font-mono text-[14px] font-bold text-accent-ink opacity-70"
            aria-disabled="true"
          >
            public launches soon
          </span>
          <Link
            href="/feed"
            className="h-12 rounded-control border border-white/10 bg-surface-2 px-[26px] font-mono text-[13px] font-semibold text-text-1 inline-flex items-center gap-2 transition-[border-color,transform] duration-[180ms] ease-[ease] hover:border-[rgba(43,209,126,0.4)] active:translate-y-px"
          >
            explore feed
          </Link>
        </div>
        {showMascot && (
          <div className="inline-flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="LCKD mascot"
              width={44}
              height={44}
              className="h-11 w-11 object-contain"
            />
            <span className="font-mono text-[11px] font-medium text-text-4">
              your wallet signs every transaction.
            </span>
          </div>
        )}
      </Reveal>
    </section>
  );
}
