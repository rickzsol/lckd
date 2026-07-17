import type { RicomapsHolder } from "@/lib/ricomaps.types";
import { truncateAddress } from "@/lib/ricomaps.types";

function holderFlags(holder: RicomapsHolder): string[] {
  const flags: string[] = [];
  if (holder.isSniper) flags.push("sniper");
  if (holder.isBundled) flags.push("bundled");
  if (holder.isCabal) flags.push("cabal");
  return flags;
}

export default function TopHoldersTable({ holders }: { holders: RicomapsHolder[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-control border border-line-default">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line-default bg-surface-deep">
            <th className="px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
              holder
            </th>
            <th className="px-3 py-2 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
              % supply
            </th>
            <th className="hidden px-3 py-2 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3 sm:table-cell">
              flags
            </th>
          </tr>
        </thead>
        <tbody>
          {holders.map((holder, index) => (
            <tr
              key={holder.address}
              className={`border-b border-line-default/50 last:border-b-0 ${index >= 10 ? "hidden sm:table-row" : ""}`}
            >
              <td className="px-3 py-2">
                <a
                  href={`https://solscan.io/account/${holder.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-text-2 hover:text-accent-400"
                >
                  {truncateAddress(holder.address)}
                </a>
              </td>
              <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-text-1">
                {holder.pct.toFixed(2)}%
              </td>
              <td className="hidden px-3 py-2 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-text-3 sm:table-cell">
                {holderFlags(holder).join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
