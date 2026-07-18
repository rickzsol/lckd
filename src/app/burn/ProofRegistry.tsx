const SOLSCAN_ACCOUNT = "https://solscan.io/account";
const SOLSCAN_TOKEN = "https://solscan.io/token";

const PROOF_ADDRESSES = [
  {
    label: "Buyback burn program",
    address: "7e37mm6Q8aW13jfZP27mEa1QRjue4fZ6NzNtzJyo8FZV",
    href: `${SOLSCAN_ACCOUNT}/7e37mm6Q8aW13jfZP27mEa1QRjue4fZ6NzNtzJyo8FZV`,
    detail: "Enforces the exact 100,000,000 lamport input and atomic burn.",
  },
  {
    label: "Program authority PDA",
    address: "Gje8nJvSsgSAvmNFMYZS1hwbQYBpJLjiapPBpWtb1AvD",
    href: `${SOLSCAN_ACCOUNT}/Gje8nJvSsgSAvmNFMYZS1hwbQYBpJLjiapPBpWtb1AvD`,
    detail: "Controls the dedicated swap token accounts. Only this program can sign for the PDA.",
  },
  {
    label: "PDA LCKD account",
    address: "EdgwsuZNTKoLgh2ziaog8aJ4ETkJdVonCRVWDADMryFT",
    href: `${SOLSCAN_ACCOUNT}/EdgwsuZNTKoLgh2ziaog8aJ4ETkJdVonCRVWDADMryFT`,
    detail: "Receives the purchased LCKD before the same transaction burns it.",
  },
  {
    label: "PDA wrapped SOL account",
    address: "GMTnjt93picf6btEazKb8NxcKHPXVF1SncjQxuydcVp1",
    href: `${SOLSCAN_ACCOUNT}/GMTnjt93picf6btEazKb8NxcKHPXVF1SncjQxuydcVp1`,
    detail: "Funds the Pump swap with the fixed 0.1 SOL launch fee.",
  },
  {
    label: "LCKD mint",
    address: "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump",
    href: `${SOLSCAN_TOKEN}/7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump`,
    detail: "Token-2022 mint with no mint authority. Its supply can only decrease.",
  },
  {
    label: "Canonical Pump pool",
    address: "88mrzw7YhK9XSM4PFUGGqcHMtsEJGWRBVXgf3pNEDxqG",
    href: `${SOLSCAN_ACCOUNT}/88mrzw7YhK9XSM4PFUGGqcHMtsEJGWRBVXgf3pNEDxqG`,
    detail: "The program accepts only the derived LCKD and wrapped SOL pool.",
  },
  {
    label: "Protocol lookup table",
    address: "CLPNMAiLVQKjL7dTFzvaJcMtMR4BRi5hbtCXiaXUUByj",
    href: `${SOLSCAN_ACCOUNT}/CLPNMAiLVQKjL7dTFzvaJcMtMR4BRi5hbtCXiaXUUByj`,
    detail: "Contains reviewed protocol addresses used by the atomic launch.",
  },
  {
    label: "Upgrade authority",
    address: "9S8mjC1NFLejZpwJjtUJ8mjuy7BtykZNTvDWM2g42QJH",
    href: `${SOLSCAN_ACCOUNT}/9S8mjC1NFLejZpwJjtUJ8mjuy7BtykZNTvDWM2g42QJH`,
    detail: "Squads vault 0 is the program's on-chain upgrade authority.",
  },
  {
    label: "Squads multisig",
    address: "7LPtyk1WxCqx2BXcYgzoPSyk44J4dkfUU6r75CZJehUV",
    href: "https://app.squads.so/squads/7LPtyk1WxCqx2BXcYgzoPSyk44J4dkfUU6r75CZJehUV/treasury",
    detail: "Threshold 2 with 3 members. Its config authority is disabled.",
  },
] as const;

export function ProofRegistry() {
  return (
    <section className="space-y-5" aria-labelledby="proof-heading">
      <div className="space-y-2">
        <h2
          id="proof-heading"
          className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2"
        >
          Proof map
        </h2>
        <p className="max-w-2xl font-sans text-sm leading-[1.6] text-text-2">
          These are the exact mainnet accounts used by every fee-enabled launch. Open
          any address to verify ownership, program data, balances, and transaction history.
        </p>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {PROOF_ADDRESSES.map((proof) => (
          <a
            key={proof.label}
            href={proof.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-card border border-line-default bg-surface-deep p-4 transition-colors duration-180 ease-out hover:border-accent/35"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
                {proof.label}
              </span>
              <span className="font-mono text-xs text-accent-400" aria-hidden="true">
                &#8599;
              </span>
            </div>
            <div className="mt-2 break-all font-mono text-[11px] leading-[1.55] text-text-1 group-hover:text-accent-400">
              {proof.address}
            </div>
            <p className="mt-2 font-sans text-xs leading-[1.55] text-text-3">
              {proof.detail}
            </p>
          </a>
        ))}
      </div>

      <div className="rounded-control border border-line-default bg-surface px-4 py-3 font-mono text-[10px] leading-[1.65] text-text-3">
        <span className="font-semibold uppercase tracking-[0.08em] text-text-2">
          Deployed SBF SHA-256
        </span>{" "}
        <span className="break-all">2d2126842fbf7ce3db71fd0494ea5c8e2803cc471c18865c3622d0bb5bfc4796</span>
      </div>
    </section>
  );
}
