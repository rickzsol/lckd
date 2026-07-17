export default function FeedLoading() {
  return (
    <div className="mx-auto max-w-[1152px] px-4 pt-28 pb-16 sm:px-6">
      {/* Header skeleton */}
      <div className="mb-6">
        <div className="h-9 w-48 animate-pulse rounded-card bg-white/[0.04]" />
        <div className="mt-2 h-4 w-full max-w-2xl animate-pulse rounded-control bg-white/[0.04]" />
      </div>

      {/* Filter bar skeleton */}
      <div className="mb-5 flex items-center justify-between border-y border-line py-3">
        <div className="h-4 w-32 animate-pulse rounded-control bg-white/[0.04]" />
        <div className="flex gap-1.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 w-16 animate-pulse rounded-full bg-white/[0.04]" />
          ))}
        </div>
      </div>

      {/* Card skeletons */}
      <div className="flex flex-col gap-2.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-card border border-white/[0.04] bg-white/[0.02]" />
        ))}
      </div>
    </div>
  );
}
