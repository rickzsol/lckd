export default function Bar({ pct }: { pct: number }) {
  // pct = % unlocked. Low = mostly locked = trustworthy (green), high = risky (red)
  const color = pct < 30 ? "var(--color-accent)" : pct < 60 ? "var(--color-warn)" : "var(--color-danger)";
  return (
    <div
      className="h-[4px] w-full overflow-hidden rounded-full bg-white/6"
      role="progressbar"
      aria-label="Estimated lock schedule elapsed"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
