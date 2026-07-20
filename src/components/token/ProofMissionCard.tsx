"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PROOF_MISSION_MINT } from "@/lib/proof-missions/mission";
import type { ProofDecision, ProofMissionBoard } from "@/lib/proof-missions/types";
import ProofMissionParticipation from "./ProofMissionParticipation";
import ProofMissionResults from "./ProofMissionResults";

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : "The request could not be completed";
}

export default function ProofMissionCard({ mintAddress }: { mintAddress?: string | null }) {
  const { status } = useSession();
  const [board, setBoard] = useState<ProofMissionBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    if (mintAddress !== PROOF_MISSION_MINT) return false;
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/v1/proof-missions/current?mint=${encodeURIComponent(mintAddress)}`,
        { cache: "no-store", signal },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setBoard(await response.json());
      setLoadError(null);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      setLoadError(error instanceof Error ? error.message : "Proof missions are unavailable");
      return false;
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [mintAddress]);

  useEffect(() => {
    if (mintAddress !== PROOF_MISSION_MINT || status === "loading") return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [mintAddress, refresh, status]);

  if (mintAddress !== PROOF_MISSION_MINT) return null;

  const submitProof = async (evidenceUrl: string, evidenceNote: string) => {
    if (!board) return;
    await mutate("/api/v1/proof-missions/submissions", {
      missionKey: board.mission.key,
      evidenceUrl,
      evidenceNote,
    }, () => {
      setBoard((current) => current ? {
        ...current,
        counts: { ...current.counts, pending: current.counts.pending + 1 },
        viewer: { ...current.viewer, submissionStatus: "pending" },
      } : current);
    });
  };

  const reviewProof = async (id: string, decision: ProofDecision) => {
    await mutate(`/api/v1/proof-missions/submissions/${id}/reviews`, { decision }, () => {
      setBoard((current) => current ? {
        ...current,
        reviewQueue: current.reviewQueue.filter((proof) => proof.id !== id),
      } : current);
    });
  };

  const mutate = async (url: string, body: unknown, onCommitted: () => void) => {
    setIsActing(true);
    setActionError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseError(response));
      onCommitted();
      if (!await refresh()) {
        setActionError("Saved, but the latest board could not load. Reload to confirm its public state.");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The request could not be completed");
      throw error;
    } finally {
      setIsActing(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-[16px] border border-line-default bg-bg/65 shadow-[0_18px_50px_rgba(0,0,0,0.16)]" aria-labelledby="proof-mission-title">
      <div className="border-b border-line bg-[linear-gradient(115deg,rgba(43,209,126,0.08),transparent_52%)] px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-accent-400">
              Community proof mission / live weekly fieldwork
            </div>
            <h3 id="proof-mission-title" className="mt-2 font-sans text-xl font-bold tracking-[-0.025em] text-text-1 sm:text-2xl">
              {board?.mission.title ?? "Proof Missions"}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-2">
              {board?.mission.brief ?? "Contributors publish sourced token research. Independent reviewers decide what earns a public proof."}
            </p>
          </div>
          {board && (
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-control border border-line-default bg-line-default font-mono text-center">
              <Metric label="accepted" value={String(board.counts.accepted)} />
              <Metric label="review" value={String(board.counts.pending)} />
              <Metric label="points" value={String(board.mission.points)} />
            </div>
          )}
        </div>
      </div>

      {isLoading && !board ? (
        <div className="px-4 py-8 font-mono text-xs text-text-3 sm:px-6">Loading the proof board...</div>
      ) : loadError && !board ? (
        <div className="px-4 py-6 sm:px-6">
          <p role="status" className="font-mono text-xs text-text-3">{loadError}</p>
        </div>
      ) : board ? (
        <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="border-line p-4 sm:p-6 lg:border-r">
            <MissionBrief board={board} />
            <ProofMissionParticipation
              board={board}
              actionError={actionError}
              isActing={isActing}
              onReview={reviewProof}
              onSubmit={submitProof}
            />
          </div>
          <ProofMissionResults board={board} />
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-20 bg-surface/90 px-3 py-2.5">
      <div className="text-sm font-bold tabular-nums text-text-1">{value}</div>
      <div className="mt-0.5 text-[8px] uppercase tracking-[0.12em] text-text-4">{label}</div>
    </div>
  );
}

function MissionBrief({ board }: { board: ProofMissionBoard }) {
  const closes = new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC",
  }).format(new Date(board.mission.endsAt));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-text-2">Field brief</h3>
        <span className="font-mono text-[10px] text-text-4">closes {closes} UTC</span>
      </div>
      <ol className="grid gap-2.5">
        {board.mission.requirements.map((requirement, index) => (
          <li key={requirement} className="flex gap-3 rounded-control border border-line bg-surface-deep px-3 py-2.5">
            <span className="font-mono text-[10px] font-bold text-accent-400">0{index + 1}</span>
            <span className="text-xs leading-5 text-text-2">{requirement}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
