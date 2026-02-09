"use client";

import Link from "next/link";

interface ShinyButtonProps {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}

export default function ShinyButton({
  children,
  href,
  onClick,
  className = "",
}: ShinyButtonProps) {
  const inner = <span className="shiny-btn__content">{children}</span>;
  const cls = `shiny-btn ${className}`;

  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
