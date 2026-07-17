import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Risk disclosure",
  description:
    "Material technical, transaction, token-lock, market, identity, and third-party risks when using LCKD.",
  alternates: { canonical: "/risk" },
  openGraph: {
    title: "Risk disclosure | LCKD",
    description: "Understand the limits of token locks and platform records.",
    url: "/risk",
    type: "article",
  },
};

const RISKS = [
  {
    title: "Two-transaction execution",
    body: "Token creation and token locking are separate transactions. Creation can confirm while locking fails, expires, is rejected, or lacks funds. In that state, the token exists and the purchased balance remains liquid until a later lock confirms.",
  },
  {
    title: "Limited lock scope",
    body: "A lock restricts only the amount deposited into its specific contract. It does not restrict other wallets, undisclosed allocations, liquidity, other token accounts, or tokens acquired later.",
  },
  {
    title: "Token and authority risk",
    body: "Review mint authority, freeze authority, Token-2022 extensions, metadata control, holder concentration, and associated token account ownership. A token lock does not neutralize those controls.",
  },
  {
    title: "Market and liquidity risk",
    body: "Prices can fall to zero. Liquidity can be thin or removed. Slippage, sandwiching, failed transactions, and market manipulation can create losses even when a creator allocation is locked.",
  },
  {
    title: "Identity and profile risk",
    body: "GitHub authentication proves control of a session at sign-in time. Repository, product, social, and website links can be incomplete, transferred, compromised, or misleading. Profile labels are not endorsements.",
  },
  {
    title: "Third-party and protocol risk",
    body: "LCKD depends on wallet adapters, RPC providers, pump.fun, Streamflow, Pons, Uniswap, IPFS services, GitHub, Supabase, DexScreener, Jupiter, Solana, Robinhood Chain, and other infrastructure. Outages, upgrades, defects, or changed fees can affect results.",
  },
  {
    title: "Platform record risk",
    body: "Displayed amounts, dates, badges, market data, and computed lock progress can be stale or unavailable. A stored transaction signature is not proof that the current on-chain state matches the page.",
  },
];

export default function RiskPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 pt-28 pb-16 sm:px-6">
      <h1 className="font-sans text-[clamp(34px,7vw,58px)] font-bold tracking-[-0.03em] text-text-1">
        Risk disclosure
      </h1>
      <p className="mt-5 text-base leading-8 text-text-2 sm:text-lg">
        LCKD is transaction tooling and a public directory. It is not an exchange, custodian,
        auditor, broker, or investment adviser. You remain responsible for every wallet
        approval and independent verification.
      </p>

      <div className="mt-10 space-y-4">
        {RISKS.map((risk, index) => (
          <section key={risk.title} className="rounded-card border border-line-default bg-surface p-5">
            <p className="font-mono text-[10px] font-bold tabular-nums text-accent">{String(index + 1).padStart(2, "0")}</p>
            <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.01em] text-text-1">{risk.title}</h2>
            <p className="mt-2 text-sm leading-7 text-text-2">{risk.body}</p>
          </section>
        ))}
      </div>

      <section className="mt-10 rounded-card border border-warn/25 bg-warn/[0.05] p-5">
        <h2 className="font-sans text-xl font-bold tracking-[-0.01em] text-text-1">Minimum verification checklist</h2>
        <ul className="mt-3 space-y-2 pl-5 text-sm leading-7 text-text-2">
          <li className="list-disc">Match the mint address across the launch page, wallet prompt, and explorers.</li>
          <li className="list-disc">Inspect both transaction signatures when a lock is claimed.</li>
          <li className="list-disc">Confirm the exact deposited amount, recipient, permissions, and unlock time.</li>
          <li className="list-disc">Simulate transactions and read all wallet warnings before signing.</li>
          <li className="list-disc">Never sign a transaction you do not understand.</li>
        </ul>
      </section>
    </article>
  );
}
