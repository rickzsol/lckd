"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { AllocationSummary, BucketSummary } from "@/lib/allocations/summary";
import { formatRawAmount, percentOfSupply } from "@/lib/allocations/format";
import AllocationDeclareForm from "./AllocationDeclareForm";

interface AllocationPanelProps {
  summary: AllocationSummary;
  creatorWallet: string;
  lockedAmountRaw: string | null;
  mintAddress: string;
}

const SEGMENT_SHADES = [
  "bg-white/30",
  "bg-white/22",
  "bg-white/16",
  "bg-white/12",
  "bg-white/9",
  "bg-white/7",
];

const CLASSIFICATION_STYLES: Record<string, { label: string; className: string }> = {
  distributed: { label: "distributed", className: "text-accent-400" },
  sold: { label: "sold", className: "text-danger" },
  internal: { label: "moved", className: "text-text-3" },
  burned: { label: "burned", className: "text-warn" },
  received: { label: "received", className: "text-text-3" },
  unknown: { label: "unindexed", className: "text-text-3" },
};

function shortAddress(address: string | null): string {
  if (!address) return "--";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function useIsCreator(creatorWallet: string): boolean {
  const { status } = useSession();
  const [linkedWallet, setLinkedWallet] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let isActive = true;
    fetch("/api/profile/link-wallet")
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (isActive && typeof body?.walletAddress === "string") {
          setLinkedWallet(body.walletAddress);
        }
      })
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, [status]);

  return linkedWallet !== null && linkedWallet === creatorWallet;
}

function BucketRow({
  label,
  chip,
  isEnforced,
  declared,
  current,
  distributed,
  sold,
}: {
  label: string;
  chip: string;
  isEnforced: boolean;
  declared: string;
  current: string;
  distributed: string;
  sold: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line py-2.5 sm:grid-cols-[minmax(140px,1.4fr)_repeat(4,minmax(70px,1fr))] sm:items-center">
      <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
        <span className="font-mono text-xs font-bold text-text-1">{label}</span>
        <span
          className={`rounded-[6px] border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
            isEnforced
              ? "border-accent-700 text-accent-400"
              : "border-line-strong text-text-3"
          }`}
        >
          {chip}
        </span>
      </div>
      {[
        { l: "declared", v: declared },
        { l: "current", v: current },
        { l: "distributed", v: distributed },
        { l: "sold", v: sold },
      ].map((cell) => (
        <div key={cell.l}>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-4 sm:hidden">
            {cell.l}
          </div>
          <div className="font-mono text-xs font-semibold text-text-2 tabular-nums">
            {cell.v}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AllocationPanel({
  summary,
  creatorWallet,
  lockedAmountRaw,
  mintAddress,
}: AllocationPanelProps) {
  const isCreator = useIsCreator(creatorWallet);
  const activeBuckets = summary.buckets.filter((bucket) => bucket.status === "active");
  const retiredCount = summary.buckets.length - activeBuckets.length;
  const hasAnything = activeBuckets.length > 0 || lockedAmountRaw !== null;

  const segments: Array<{ key: string; raw: string; className: string }> = [];
  if (lockedAmountRaw) {
    segments.push({ key: "locked", raw: lockedAmountRaw, className: "bg-accent" });
  }
  activeBuckets.forEach((bucket, index) => {
    segments.push({
      key: bucket.id,
      raw: bucket.declaredAmount,
      className: SEGMENT_SHADES[index % SEGMENT_SHADES.length],
    });
  });

  return (
    <div className="mb-5 rounded-card border border-line-default bg-surface p-5">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
        <span>Supply allocation</span>
        {summary.hasUnreconciledDrift && (
          <span className="normal-case tracking-normal text-warn">
            ledger drift under reconciliation
          </span>
        )}
      </div>

      {hasAnything ? (
        <>
          <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div className="flex h-full">
              {segments.map((segment) => (
                <div
                  key={segment.key}
                  className={segment.className}
                  style={{ width: `${percentOfSupply(segment.raw)}%` }}
                />
              ))}
            </div>
          </div>
          <div className="mb-3 font-mono text-[10px] text-text-4">
            share of total supply
          </div>

          <div className="hidden gap-x-3 pb-1 sm:grid sm:grid-cols-[minmax(140px,1.4fr)_repeat(4,minmax(70px,1fr))]">
            <span />
            {["declared", "current", "distributed", "sold"].map((label) => (
              <span
                key={label}
                className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3"
              >
                {label}
              </span>
            ))}
          </div>

          {lockedAmountRaw && (
            <BucketRow
              label="locked"
              chip="locked on-chain"
              isEnforced
              declared={formatRawAmount(lockedAmountRaw)}
              current={formatRawAmount(lockedAmountRaw)}
              distributed="0"
              sold="0"
            />
          )}
          {activeBuckets.map((bucket: BucketSummary) => (
            <BucketRow
              key={bucket.id}
              label={bucket.label}
              chip="declared"
              isEnforced={false}
              declared={formatRawAmount(bucket.declaredAmount)}
              current={formatRawAmount(bucket.currentBalance)}
              distributed={formatRawAmount(bucket.distributed)}
              sold={formatRawAmount(bucket.sold)}
            />
          ))}
          {retiredCount > 0 && (
            <p className="mt-2 font-mono text-[10px] text-text-4">
              {retiredCount} amended {retiredCount === 1 ? "bucket" : "buckets"} kept in
              the public history
            </p>
          )}

          {summary.recentTransfers.length > 0 && (
            <div className="mt-4 border-t border-line pt-3.5">
              <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
                Recent movements
              </div>
              <div className="flex flex-col gap-1.5">
                {summary.recentTransfers.slice(0, 8).map((transfer) => {
                  const style =
                    CLASSIFICATION_STYLES[transfer.classification] ??
                    CLASSIFICATION_STYLES.unknown;
                  return (
                    <a
                      key={`${transfer.signature}-${transfer.walletAddress}-${transfer.direction}-${transfer.amount}`}
                      href={`https://solscan.io/tx/${transfer.signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-text-3 tabular-nums transition-colors duration-180 ease-out hover:text-text-2"
                    >
                      <span className={`w-[76px] font-semibold ${style.className}`}>
                        {style.label}
                      </span>
                      <span className="text-text-2">{formatRawAmount(transfer.amount)}</span>
                      <span>
                        {transfer.direction === "out" ? "to" : "from"}{" "}
                        {shortAddress(transfer.counterpartyWallet)}
                      </span>
                      {transfer.blockTime && (
                        <span className="ml-auto text-text-4">
                          {new Date(transfer.blockTime).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="font-mono text-xs leading-[1.6] text-text-3">
          No allocations declared for this token yet.
        </p>
      )}

      <p className="mt-4 border-t border-line pt-3.5 font-mono text-[11px] leading-[1.6] text-text-3">
        Declared buckets are labels published by the creator and tracked on-chain by
        LCKD. Only the locked bucket is enforced by contract; treat the rest as
        signals, not guarantees.
      </p>

      {isCreator && (
        <div className="mt-4">
          <AllocationDeclareForm mintAddress={mintAddress} />
        </div>
      )}
    </div>
  );
}
