export default function Bar({ pct }: { pct: number }) {
  // pct = % unlocked. Low = mostly locked = trustworthy (green), high = risky (red)
  const color = pct < 30 ? "#10b981" : pct < 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-sm bg-white/[0.06]">
      <div
        className="h-full rounded-sm"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
