import type { ReactNode } from "react";
import type { DisplayToken } from "@/types/display";

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function shorten(value: string): string {
  return `${value.slice(0, 7)}…${value.slice(-7)}`;
}

function normalizeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalizedValue = value.trim();
  if (!normalizedValue) return null;
  return /^https?:\/\//i.test(normalizedValue)
    ? normalizedValue
    : `https://${normalizedValue}`;
}

export default function TokenMetadataCard({ token }: { token: DisplayToken }) {
  const { metadata } = token;
  const links = [
    { label: "Website", href: normalizeExternalUrl(metadata.websiteUrl) },
    { label: "X", href: normalizeExternalUrl(metadata.twitterUrl) },
    { label: "Telegram", href: normalizeExternalUrl(metadata.telegramUrl) },
    { label: "Live product", href: normalizeExternalUrl(token.live) },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  return (
    <section className="min-w-0 rounded-card border border-line-default bg-surface p-5">
      <div className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
        Recorded metadata
      </div>

      <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <MetadataRow label="Creator wallet" value={shorten(metadata.creatorWallet)}>
          <a
            href={`https://solscan.io/account/${metadata.creatorWallet}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400 hover:underline"
            title={metadata.creatorWallet}
          >
            {shorten(metadata.creatorWallet)} &#8599;
          </a>
        </MetadataRow>
        <MetadataRow label="Initial buy" value={`${metadata.buyAmountSol} SOL`} />
        <MetadataRow label="Created" value={formatDate(metadata.createdAt)} />
        <MetadataRow label="Unlock" value={formatDate(metadata.unlockAt)} />
        <MetadataRow label="Launch verified" value={formatDate(metadata.launchVerifiedAt)} />
        <MetadataRow label="Lock verified" value={formatDate(metadata.lockVerifiedAt)} />
      </dl>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Finalized receipts
        </div>
        <div className="flex flex-wrap gap-2">
          <ReceiptLink label="Launch transaction" signature={metadata.launchTx} />
          <ReceiptLink label="Lock transaction" signature={metadata.lockTx} />
        </div>
      </div>

      {links.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
            Submitted links
          </div>
          <div className="flex flex-wrap gap-2">
            {links.map((link) => (
              <a
                key={`${link.label}-${link.href}`}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                {link.label} &#8599;
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function MetadataRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
        {label}
      </dt>
      <dd className="mt-1 break-words font-mono text-xs leading-[1.5] text-text-1">
        {children ?? value}
      </dd>
    </div>
  );
}

function ReceiptLink({ label, signature }: { label: string; signature: string }) {
  return (
    <a
      href={`https://solscan.io/tx/${signature}`}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-secondary"
      title={signature}
    >
      {label} · {shorten(signature)} &#8599;
    </a>
  );
}
