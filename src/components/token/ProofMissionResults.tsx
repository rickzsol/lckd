import type { ProofMissionBoard } from "@/lib/proof-missions/types";

export default function ProofMissionResults({ board }: { board: ProofMissionBoard }) {
  return (
    <aside className="bg-surface-deep/45 p-4 sm:p-6">
      <section aria-labelledby="accepted-proofs-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="accepted-proofs-heading" className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-text-2">Accepted proofs</h3>
          <span className="rounded-full border border-accent/25 bg-accent-dim px-2 py-0.5 font-mono text-[9px] font-bold text-accent-400">2x reviewed</span>
        </div>
        {board.accepted.length === 0 ? (
          <div className="rounded-control border border-dashed border-line-default px-4 py-5">
            <p className="font-mono text-xs leading-5 text-text-4">No accepted proof yet. The first verified contribution claims the top slot.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {board.accepted.map((proof) => (
              <a key={proof.id} href={proof.evidenceUrl} target="_blank" rel="noopener noreferrer" className="block rounded-control border border-line-default bg-surface p-3 transition-colors hover:border-accent/35">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs font-bold text-text-1">@{proof.contributor}</span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-accent-400">accepted &#8599;</span>
                </div>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-text-3">{proof.evidenceNote}</p>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 border-t border-line pt-5" aria-labelledby="leaderboard-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="leaderboard-heading" className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-text-2">Weekly leaderboard</h3>
          <span className="font-mono text-[9px] text-text-4">proof points</span>
        </div>
        {board.leaderboard.length === 0 ? (
          <p className="font-mono text-xs text-text-4">Waiting for the first accepted proof.</p>
        ) : (
          <ol>
            {board.leaderboard.map((entry) => (
              <li key={entry.contributor} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 border-t border-line py-2.5 first:border-t-0">
                <span className="font-mono text-[10px] text-text-4">{String(entry.rank).padStart(2, "0")}</span>
                <span className="truncate font-mono text-xs font-bold text-text-2">@{entry.contributor}</span>
                <span className="font-mono text-xs font-bold tabular-nums text-accent-400">{entry.points}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="mt-6 border-t border-line pt-4 font-mono text-[9px] leading-4 text-text-4">
        Community proof records sourced research, not endorsement or trading advice.
      </p>
    </aside>
  );
}
