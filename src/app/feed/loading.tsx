export default function FeedLoading() {
  return (
    <div className="mx-auto max-w-[1100px] p-4">
      {/* Ticker skeleton */}
      <div className="mb-3.5 h-9 animate-pulse rounded-lg bg-white/[0.04]" />

      {/* Header skeleton */}
      <div className="mb-3 flex items-center justify-between">
        <div className="h-6 w-36 animate-pulse rounded bg-white/[0.04]" />
        <div className="flex gap-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 w-16 animate-pulse rounded bg-white/[0.04]" />
          ))}
        </div>
      </div>

      {/* Card skeletons */}
      <div className="flex flex-col gap-1.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-[10px] bg-white/[0.02] border border-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}
