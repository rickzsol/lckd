"use client";

import { useState } from "react";
import MatchLockDuration from "./MatchLockDuration";
import MatchRepoSelect from "./MatchRepoSelect";

type SubmitState = "idle" | "submitting" | "success" | "unavailable";

export default function MatchForm({ username }: { username: string }) {
  const [projectName, setProjectName] = useState("");
  const [ticker, setTicker] = useState("");
  const [pitch, setPitch] = useState("");
  const [repo, setRepo] = useState("");
  const [buyAmountSol, setBuyAmountSol] = useState(1);
  const [lockDurationDays, setLockDurationDays] = useState(90);
  const [contact, setContact] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (projectName.trim().length < 2 || projectName.trim().length > 64) {
      next.projectName = "Project name must be 2 to 64 characters";
    }
    if (ticker && !/^[A-Z0-9]{1,10}$/.test(ticker)) {
      next.ticker = "Ticker must be up to 10 uppercase letters and numbers";
    }
    if (pitch.trim().length < 1 || pitch.length > 500) {
      next.pitch = "Pitch is required, up to 500 characters";
    }
    if (buyAmountSol < 0.1 || buyAmountSol > 100) {
      next.buyAmountSol = "Buy amount must be between 0.1 and 100 SOL";
    }
    if (contact && contact.length > 64) {
      next.contact = "Contact must be 64 characters or fewer";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    setSubmitState("submitting");
    setSubmitError(null);

    try {
      const response = await fetch("/api/v1/match/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: projectName.trim(),
          ticker: ticker || null,
          pitch: pitch.trim(),
          repo: repo || null,
          buyAmountSol,
          lockDurationDays,
          contact: contact.trim() || null,
        }),
      });

      if (response.status === 503) {
        setSubmitState("unavailable");
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setSubmitState("idle");
        setSubmitError(body?.error ?? "Application could not be submitted");
        return;
      }

      setSubmitState("success");
    } catch {
      setSubmitState("unavailable");
    }
  }

  if (submitState === "success") {
    return (
      <div className="callout-success">
        application received. we review submissions by hand and will reach out to
        @{username} if your launch is selected.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="mb-1 flex items-center gap-2.5 rounded-control border border-accent/20 bg-accent-dim px-3.5 py-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="font-mono text-xs text-text-2">
          applying as <span className="font-bold text-accent">@{username}</span>
        </span>
      </div>

      {submitState === "unavailable" && (
        <div className="error-box">
          <span className="callout-title">applications unavailable</span>
          applications are temporarily unavailable, try again later.
        </div>
      )}

      <div>
        <label htmlFor="project-name" className="form-label">
          Project Name *
        </label>
        <input
          id="project-name"
          className={`form-input ${errors.projectName ? "form-input-error" : ""}`}
          maxLength={64}
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
        {errors.projectName && (
          <div className="mt-1 font-mono text-[11px] text-danger">{errors.projectName}</div>
        )}
      </div>

      <div>
        <label htmlFor="ticker" className="form-label">
          Ticker (optional)
        </label>
        <input
          id="ticker"
          className={`form-input uppercase ${errors.ticker ? "form-input-error" : ""}`}
          maxLength={10}
          placeholder="$NSWAP"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
        />
        {errors.ticker && <div className="mt-1 font-mono text-[11px] text-danger">{errors.ticker}</div>}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="pitch" className="form-label mb-0">
            Pitch *
          </label>
          <span
            className={`font-mono text-[10px] tabular-nums ${pitch.length > 500 ? "text-danger" : "text-text-4"}`}
          >
            {pitch.length} / 500
          </span>
        </div>
        <textarea
          id="pitch"
          rows={4}
          maxLength={500}
          placeholder="What are you building, and why does it need to exist?"
          className={`form-input resize-y ${errors.pitch ? "form-input-error" : ""}`}
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
        />
        {errors.pitch && <div className="mt-1 font-mono text-[11px] text-danger">{errors.pitch}</div>}
      </div>

      <MatchRepoSelect username={username} value={repo} onChange={setRepo} />

      <div>
        <label htmlFor="buy-amount" className="form-label">
          Planned Dev Buy (SOL) *
        </label>
        <input
          id="buy-amount"
          type="number"
          min={0.1}
          max={100}
          step={0.1}
          className={`form-input tabular-nums ${errors.buyAmountSol ? "form-input-error" : ""}`}
          value={buyAmountSol}
          onChange={(e) => setBuyAmountSol(Number.parseFloat(e.target.value) || 0)}
        />
        {errors.buyAmountSol && (
          <div className="mt-1 font-mono text-[11px] text-danger">{errors.buyAmountSol}</div>
        )}
      </div>

      <MatchLockDuration value={lockDurationDays} onChange={setLockDurationDays} />

      <div>
        <label htmlFor="contact" className="form-label">
          Contact (optional)
        </label>
        <input
          id="contact"
          placeholder="X or Telegram handle"
          maxLength={64}
          className={`form-input ${errors.contact ? "form-input-error" : ""}`}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
        {errors.contact && <div className="mt-1 font-mono text-[11px] text-danger">{errors.contact}</div>}
      </div>

      {submitError && (
        <div className="error-box">
          <span className="callout-title">application failed</span>
          {submitError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitState === "submitting"}
        className="btn-primary mt-2 w-full py-3"
      >
        {submitState === "submitting" ? "submitting..." : "submit application"}
      </button>
    </form>
  );
}
