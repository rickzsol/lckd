import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100vh-49px)] flex-col items-center justify-center px-4 text-center">
      <div className="font-mono text-[80px] font-bold leading-none text-accent/20">
        404
      </div>
      <h1 className="mt-4 font-sans text-2xl font-bold text-white">
        Page not found
      </h1>
      <p className="mt-2 font-mono text-xs text-[#555]">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link href="/" className="btn-primary mt-6 px-6 py-3">
        back to home &rarr;
      </Link>
    </div>
  );
}
