import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 pt-28 pb-16 text-center">
      <Image src="/logo.png" alt="" width={72} height={72} className="mb-2" priority={false} />
      <div className="font-mono text-[80px] font-bold leading-none text-accent/20">
        404
      </div>
      <h1 className="mt-4 font-sans text-2xl font-bold tracking-[-0.02em] text-text-1">
        Page not found
      </h1>
      <p className="mt-2 font-mono text-[13px] text-text-3">
        the page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link href="/" className="btn-primary mt-6 px-6 py-3">
        back to home &rarr;
      </Link>
    </div>
  );
}
