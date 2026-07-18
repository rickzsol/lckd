"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ALLOCATION_CATEGORIES, type AllocationCategory } from "@/types";
import { parseTokenAmountToRaw } from "@/lib/allocations/format";

interface BucketDraft {
  category: AllocationCategory;
  label: string;
  amount: string;
  wallet: string;
}

const EMPTY_BUCKET: BucketDraft = {
  category: "treasury",
  label: "",
  amount: "",
  wallet: "",
};

const MAX_BUCKETS = 6;

export default function AllocationDeclareForm({ mintAddress }: { mintAddress: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [drafts, setDrafts] = useState<BucketDraft[]>([{ ...EMPTY_BUCKET }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateDraft = (index: number, patch: Partial<BucketDraft>) => {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  };

  const submit = async () => {
    setError(null);
    const buckets = [];
    for (const draft of drafts) {
      const declaredAmount = parseTokenAmountToRaw(draft.amount);
      if (!draft.label.trim()) {
        setError("every bucket needs a label");
        return;
      }
      if (!declaredAmount) {
        setError("amounts must be plain token numbers, up to 6 decimals");
        return;
      }
      if (!draft.wallet.trim()) {
        setError("every bucket needs a wallet address");
        return;
      }
      buckets.push({
        category: draft.category,
        label: draft.label.trim(),
        declaredAmount,
        wallets: [draft.wallet.trim()],
      });
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/v1/token/${mintAddress}/allocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buckets }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "declaration failed");
        return;
      }
      setIsOpen(false);
      setDrafts([{ ...EMPTY_BUCKET }]);
      router.refresh();
    } catch {
      setError("declaration failed, try again");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <button type="button" onClick={() => setIsOpen(true)} className="btn-secondary">
        declare allocations
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-control border border-line-default bg-surface-deep p-4">
      <div className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">
        Declare allocation buckets
      </div>
      <p className="mb-4 font-mono text-[11px] leading-[1.6] text-text-3">
        Declarations are public and append-only. Wallets you list are tracked
        on-chain from this point; changed buckets stay visible as amended.
      </p>

      <div className="flex flex-col gap-3">
        {drafts.map((draft, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[130px_1fr_140px] lg:grid-cols-[130px_160px_140px_1fr_auto]">
            <select
              value={draft.category}
              onChange={(event) =>
                updateDraft(index, { category: event.target.value as AllocationCategory })
              }
              className="form-input"
              aria-label="bucket category"
            >
              {ALLOCATION_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <input
              value={draft.label}
              onChange={(event) => updateDraft(index, { label: event.target.value })}
              placeholder="label"
              maxLength={40}
              className="form-input"
              aria-label="bucket label"
            />
            <input
              value={draft.amount}
              onChange={(event) => updateDraft(index, { amount: event.target.value })}
              placeholder="amount (tokens)"
              inputMode="decimal"
              className="form-input tabular-nums"
              aria-label="declared token amount"
            />
            <input
              value={draft.wallet}
              onChange={(event) => updateDraft(index, { wallet: event.target.value })}
              placeholder="wallet address"
              className="form-input font-mono"
              aria-label="bucket wallet address"
            />
            {drafts.length > 1 && (
              <button
                type="button"
                onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
                className="btn-ghost self-center"
                aria-label="remove bucket"
              >
                remove
              </button>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div role="alert" className="error-box mt-3 !block">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {drafts.length < MAX_BUCKETS && (
          <button
            type="button"
            onClick={() => setDrafts((current) => [...current, { ...EMPTY_BUCKET }])}
            className="btn-ghost"
          >
            add bucket
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={isSubmitting}
          className="btn-primary"
        >
          {isSubmitting ? "declaring..." : "declare allocations"}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="btn-ghost"
        >
          cancel
        </button>
      </div>
    </div>
  );
}
