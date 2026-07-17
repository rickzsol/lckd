"use client";

const DURATION_PRESETS = [30, 90, 180, 365];

export default function MatchLockDuration({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor="lock-duration" className="form-label mb-0">
          Lock Duration
        </label>
        <span className="font-mono text-sm font-bold tabular-nums text-accent">
          {value} days
        </span>
      </div>
      <input
        id="lock-duration"
        type="range"
        min={30}
        max={365}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
      <div className="mt-2 flex gap-1.5">
        {DURATION_PRESETS.map((duration) => (
          <button
            key={duration}
            type="button"
            onClick={() => onChange(duration)}
            className={`flex-1 rounded-control border py-1.5 font-mono text-[10px] font-bold transition-colors duration-[180ms] ${
              value === duration
                ? "border-accent/40 bg-accent-dim text-accent"
                : "border-line-default bg-surface-2 text-text-3 hover:border-line-strong hover:text-text-2"
            }`}
          >
            {duration}d
          </button>
        ))}
      </div>
    </div>
  );
}
