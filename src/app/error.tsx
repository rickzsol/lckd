"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[calc(100vh-49px)] flex-col items-center justify-center px-4 text-center">
      <div className="font-mono text-[80px] font-bold leading-none text-red-500/20">
        !
      </div>
      <h1 className="mt-4 font-sans text-2xl font-bold text-white">
        Something went wrong
      </h1>
      <p className="mt-2 font-mono text-xs text-[#555]">
        An unexpected error occurred. Try again.
      </p>
      <button onClick={reset} className="btn-primary mt-6 px-6 py-3">
        try again &rarr;
      </button>
    </div>
  );
}
