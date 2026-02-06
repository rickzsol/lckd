export default function TokenLoading() {
  return (
    <div className="mx-auto max-w-[1100px] p-4">
      {/* Back link skeleton */}
      <div className="mb-4 h-4 w-24 animate-pulse rounded bg-white/[0.04]" />

      {/* Header skeleton */}
      <div className="mb-5 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 animate-pulse rounded-xl bg-white/[0.04]" />
          <div>
            <div className="h-6 w-40 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-1.5 h-3 w-56 animate-pulse rounded bg-white/[0.04]" />
          </div>
        </div>
        <div className="text-right">
          <div className="h-6 w-24 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-4 w-16 animate-pulse rounded bg-white/[0.04]" />
        </div>
      </div>

      {/* Stats strip skeleton */}
      <div className="mb-5 h-16 animate-pulse rounded-[10px] bg-white/[0.04]" />

      {/* Detail grid skeleton */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl bg-white/[0.03]" />
        <div className="h-64 animate-pulse rounded-xl bg-white/[0.03]" />
      </div>
    </div>
  );
}
