"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 pt-28 pb-16 text-center">
      <div className="font-mono text-[80px] font-bold leading-none text-danger/20">
        !
      </div>
      <h1 className="mt-4 font-sans text-2xl font-bold tracking-[-0.02em] text-text-1">
        Something went wrong
      </h1>
      <p className="mt-2 font-mono text-xs text-text-3">
        an unexpected error occurred. try again.
      </p>
      <div className="error-box mt-4 max-w-sm">
        The app hit an unhandled error while rendering this page.
      </div>
      <button onClick={reset} className="btn-secondary mt-6 px-6 py-3">
        try again &rarr;
      </button>
    </div>
  );
}
