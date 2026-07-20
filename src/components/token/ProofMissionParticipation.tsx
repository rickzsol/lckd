"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import type { ProofDecision, ProofMissionBoard } from "@/lib/proof-missions/types";

interface Props {
  board: ProofMissionBoard;
  actionError: string | null;
  isActing: boolean;
  onSubmit: (evidenceUrl: string, evidenceNote: string) => Promise<void>;
  onReview: (id: string, decision: ProofDecision) => Promise<void>;
}

export default function ProofMissionParticipation({
  board, actionError, isActing, onSubmit, onReview,
}: Props) {
  const { data: session } = useSession();
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await onSubmit(evidenceUrl, evidenceNote);
      setSubmitted(true);
    } catch {
      setSubmitted(false);
    }
  };

  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-text-2">Submit evidence</h3>
      {!board.isAcceptingSubmissions ? (
        <div className="mt-3 rounded-control border border-line-default bg-surface-deep p-4">
          <p className="text-sm leading-6 text-text-3">Submissions open when two independent mission reviewers are configured.</p>
        </div>
      ) : !board.viewer.isSignedIn ? (
        <div className="mt-3 rounded-control border border-line-default bg-surface-deep p-4">
          <p className="text-sm leading-6 text-text-3">GitHub identity and a linked Solana wallet keep each contribution attributable.</p>
          <button type="button" className="btn-primary mt-4 px-5" onClick={() => signIn("github", { callbackUrl: window.location.pathname })}>
            sign in with github
          </button>
        </div>
      ) : !board.viewer.hasLinkedWallet ? (
        <div className="mt-3 rounded-control border border-warn/25 bg-warn/5 p-4">
          <p className="text-sm leading-6 text-text-2">Link a wallet to your GitHub profile before submitting or reviewing proof.</p>
          <Link href={`/dev/${session?.github_username ?? ""}`} className="btn-secondary mt-4 inline-flex">link wallet</Link>
        </div>
      ) : board.viewer.canReview ? (
        <div className="mt-3 rounded-control border border-accent/25 bg-accent-dim p-4">
          <p className="text-sm leading-6 text-text-2">Reviewer identity active. Review the queue below; mission reviewers cannot submit proof.</p>
        </div>
      ) : board.viewer.submissionStatus ? (
        <div className="mt-3 rounded-control border border-accent/25 bg-accent-dim p-4 font-mono text-xs text-accent-400" role="status">
          {submitted || board.viewer.submissionStatus === "pending"
            ? "Proof submitted. Two independent approvals are required before publication."
            : "Proof accepted and published on this mission board."}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div>
            <label htmlFor="proof-evidence-url" className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Public evidence URL</label>
            <input
              id="proof-evidence-url"
              className="form-input"
              type="url"
              inputMode="url"
              required
              maxLength={2048}
              placeholder="https://github.com/..."
              value={evidenceUrl}
              onChange={(event) => setEvidenceUrl(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="proof-evidence-note" className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Method and limits</label>
            <textarea
              id="proof-evidence-note"
              className="form-input min-h-28"
              required
              minLength={40}
              maxLength={1000}
              placeholder="Summarize your sources, method, snapshot time, and anything still unknown."
              value={evidenceNote}
              onChange={(event) => setEvidenceNote(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary px-5" disabled={isActing}>submit proof</button>
            <span className="font-mono text-[10px] text-text-4">Public after 2 approvals</span>
          </div>
        </form>
      )}

      {actionError && <p className="mt-3 font-mono text-[10px] text-danger" role="alert">{actionError}</p>}
      {board.viewer.canReview && (
        <ReviewQueue board={board} isActing={isActing} onReview={onReview} />
      )}
    </div>
  );
}

function ReviewQueue({
  board, isActing, onReview,
}: Pick<Props, "board" | "isActing" | "onReview">) {
  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-text-2">Reviewer queue</h3>
        <span className="font-mono text-[10px] text-text-4">{board.reviewQueue.length} pending</span>
      </div>
      {board.reviewQueue.length === 0 ? (
        <p className="font-mono text-xs text-text-4">Queue clear.</p>
      ) : board.reviewQueue.map((proof) => (
        <article key={proof.id} className="border-t border-line py-3 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href={proof.evidenceUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-xs font-bold text-accent-400 hover:underline">
              @{proof.contributor} evidence &#8599;
            </a>
            {proof.isOwn && <span className="font-mono text-[9px] uppercase tracking-wider text-text-4">your proof</span>}
          </div>
          <p className="mt-2 text-xs leading-5 text-text-3">{proof.evidenceNote}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary px-4" disabled={isActing || proof.isOwn} onClick={() => void onReview(proof.id, "approve").catch(() => {})}>approve</button>
            <button type="button" className="btn-secondary" disabled={isActing || proof.isOwn} onClick={() => void onReview(proof.id, "reject").catch(() => {})}>reject</button>
          </div>
        </article>
      ))}
    </div>
  );
}
