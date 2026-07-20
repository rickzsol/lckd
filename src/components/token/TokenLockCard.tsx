import type { DisplayToken } from "@/types/display";

export default function TokenLockCard({ token }: { token: DisplayToken }) {
  const hasLockRecord =
    token.lock.amount !== "--" &&
    token.lock.amount !== "0" &&
    token.lock.duration !== "--";

  return (
    <section
      className={`rounded-card border p-5 ${
        hasLockRecord
          ? "border-accent/20 bg-accent-dim"
          : "border-warn/25 bg-[rgba(224,167,62,0.04)]"
      }`}
    >
      <div className="mb-3.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
        Token lock record
      </div>

      {!token.metadata.hasLock ? (
        <div role="status" className="rounded-control border border-line-default bg-surface-deep p-4">
          <p className="font-mono text-sm font-bold text-text-1">Launched without a token lock</p>
          <p className="mt-2 font-sans text-sm leading-[1.6] text-text-3">
            The launch receipt confirms that no Streamflow lock was created.
          </p>
        </div>
      ) : hasLockRecord ? (
        <>
          <div className="mb-1.5 flex justify-between font-mono text-[11px] text-text-3 tabular-nums">
            <span>{token.lock.start}</span>
            <span>{token.lock.end}</span>
          </div>
          <div
            className="relative mb-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]"
            role="progressbar"
            aria-label="Estimated lock schedule elapsed"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={token.lock.pct}
          >
            <div
              className={`h-full rounded-full ${
                token.lock.pct < 30
                  ? "bg-accent"
                  : token.lock.pct < 60
                    ? "bg-warn"
                    : "bg-danger"
              }`}
              style={{ width: `${token.lock.pct}%` }}
            />
          </div>
          <p className="mb-4 font-mono text-xs leading-[1.6] text-text-3">
            {token.lock.pct}% elapsed · {100 - token.lock.pct}% remains on the recorded schedule.
          </p>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Metric label="Recorded tokens" value={token.lock.amount} />
            <Metric label="Recorded duration" value={token.lock.duration} />
          </div>
          <div className="callout-success !inline-flex">
            &#10003; lock receipt verified
          </div>
        </>
      ) : (
        <div role="status" className="warning-box !block leading-[1.6]">
          <p className="font-mono text-sm font-bold">Lock verification unavailable</p>
          <p className="mt-2 font-sans text-sm leading-[1.6] text-text-2">
            This record does not contain enough lock data to show a schedule.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {token.metadata.hasLock && (
          <a
            href="https://app.streamflow.finance/token-lock"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            Streamflow <span aria-hidden="true">&#8599;</span>
          </a>
        )}
        {token.mintAddress && (
          <a
            href={`https://solscan.io/token/${token.mintAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            Solscan <span aria-hidden="true">&#8599;</span>
          </a>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control bg-surface-deep px-3 py-2">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-text-1 tabular-nums">
        {value}
      </div>
    </div>
  );
}
