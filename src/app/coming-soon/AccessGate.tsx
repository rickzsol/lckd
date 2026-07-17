"use client";

import { useState } from "react";
import DitherWave from "@/components/landing/DitherWave";

export default function AccessGate() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!code || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (response.ok) {
        window.location.href = "/";
        return;
      }
      setError("invalid access code");
    } catch {
      setError("something went wrong, try again");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-bg px-4 text-center">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <DitherWave
          quality="low"
          speed={0.55}
          intensity={1.1}
          scale={6}
          downScale={2}
          opacity={0.4}
          primaryColor="#0B0D0C"
          secondaryColor="#155C3B"
          tertiaryColor="#2BD17E"
          className="h-full w-full"
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 60% 55% at 50% 50%, rgba(11,13,12,0.94) 0%, rgba(11,13,12,0.6) 60%, rgba(11,13,12,0.2) 100%)",
        }}
      />

      <div className="relative flex flex-col items-center">
        <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-card bg-accent">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#041710"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="4" y="11" width="16" height="10" rx="2.5" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <span className="mb-6 font-sans text-[22px] font-bold tracking-[-0.02em] text-text-1">
          LCK<span className="text-accent">D</span>
        </span>
        <h1 className="m-0 mb-3 font-sans text-[clamp(30px,6vw,52px)] font-bold leading-[1.05] tracking-[-0.03em] text-text-1">
          Coming <span className="text-accent">soon</span>.
        </h1>
        <p className="m-0 mb-9 max-w-[380px] font-mono text-[13px] font-medium leading-[1.8] text-text-3">
          the launchpad that checks receipts.
          <br />
          ship code. lock tokens. prove it on-chain.
        </p>

        <form onSubmit={handleSubmit} className="flex w-full max-w-[320px] flex-col gap-3">
          <input
            type="password"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setError(null);
            }}
            placeholder="access code"
            aria-label="Access code"
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            className={`form-input text-center ${error ? "form-input-error" : ""}`}
          />
          <button type="submit" disabled={!code || isSubmitting} className="btn-primary w-full">
            {isSubmitting ? "checking..." : "enter"}
          </button>
          <p
            role="alert"
            className={`m-0 min-h-[16px] font-mono text-[11px] font-medium text-danger ${error ? "" : "invisible"}`}
          >
            {error ?? "placeholder"}
          </p>
        </form>

        <a
          href="https://x.com/launchlckd"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 font-mono text-[11px] font-medium text-text-4 transition-colors duration-[180ms] hover:text-accent-400"
        >
          follow @launchlckd for the drop
        </a>
      </div>
    </div>
  );
}
