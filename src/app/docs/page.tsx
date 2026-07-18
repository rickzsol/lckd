import type { Metadata } from "next";
import Link from "next/link";
import Toc, { type TocSection } from "@/components/docs/Toc";
import {
  Accent,
  FaqItem,
  FlowStep,
  Prose,
  SectionHeading,
  SubHeading,
} from "@/components/docs/DocsPrimitives";

const DOC_SECTIONS: TocSection[] = [
  { id: "overview", label: "Overview" },
  { id: "launch-flow", label: "Launch flow" },
  { id: "lock-behavior", label: "Lock behavior" },
  { id: "verification", label: "Verification" },
  { id: "profiles", label: "Profile labels" },
  { id: "buyers", label: "For buyers" },
  { id: "faq", label: "FAQ" },
];

export const metadata: Metadata = {
  title: "Product documentation",
  description:
    "How LCKD authentication, the atomic pump.fun create, buy, and Streamflow lock transaction, lookup-table recovery, and independent verification work.",
  alternates: { canonical: "/docs" },
  openGraph: {
    title: "Product documentation | LCKD",
    description: "Understand the atomic create-and-lock workflow before signing.",
    url: "/docs",
    type: "article",
  },
};

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="warning-box max-w-none !block text-[13px] leading-7">{children}</div>;
}

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-[1152px] bg-bg pb-24">
      <header className="border-b border-line px-4 pt-28 pb-12 sm:px-6 sm:pb-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-sans text-[32px] font-bold tracking-[-0.02em] text-text-1 sm:text-[clamp(32px,5vw,44px)]">
            Know what you are signing
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-[1.6] text-text-2">
            LCKD coordinates token creation and a required token time lock. Both execute in
            one atomic transaction: no token is created without its lock.
          </p>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 pt-6 lg:flex-row lg:gap-12 lg:pt-10">
        <Toc sections={DOC_SECTIONS} />
        <article className="min-w-0 max-w-3xl flex-1 space-y-20">
          <section className="space-y-5">
            <SectionHeading id="overview">Overview</SectionHeading>
            <Prose>
              The browser wizard requires <Accent>GitHub authentication</Accent> before it
              uploads metadata or requests a launch transaction. A Solana wallet is connected
              separately and keeps control of every wallet signature.
            </Prose>
            <Prose>
              Token creation uses pump.fun infrastructure. The browser validates a
              server-built transaction that creates the token, executes the initial buy,
              deposits the selected amount into a Streamflow time lock, and deactivates the
              launch lookup table in a single atomic transaction.
            </Prose>
            <Notice>
              If any instruction in the launch transaction fails, the entire transaction
              fails and no token is created. The only state a failed launch can leave behind
              is its address lookup table, which the wizard deactivates and closes so the
              wallet reclaims the rent.
            </Notice>
          </section>

          <section className="space-y-6">
            <SectionHeading id="launch-flow">Launch flow</SectionHeading>
            <div className="space-y-5 rounded-card border border-line-default bg-surface p-5">
              <FlowStep n={1} label="Authenticate" sub="Sign in with GitHub. This creates the session required by launch and metadata endpoints." />
              <FlowStep n={2} label="Configure" sub="Add token metadata, choose an initial SOL buy, and select the time-lock duration and percentage." />
              <FlowStep n={3} label="Prepare the lookup table" sub="The first wallet signature creates an address lookup table that lets the launch fit in one transaction." />
              <FlowStep n={4} label="Approve the atomic launch" sub="The second signature creates the token, executes the buy, deposits the Streamflow lock, and deactivates the lookup table in one transaction." />
              <FlowStep n={5} label="Verify receipts" sub="Check the launch signature and lock state independently before relying on any platform label." />
            </div>

            <SubHeading>Partial failure</SubHeading>
            <Prose>
              If the lookup table lands but the atomic launch cannot complete, no token
              exists. The wizard walks the same wallet through deactivating and closing the
              table, then unlocks a fresh launch. There is no state where a token exists
              without its recorded lock.
            </Prose>

            <SubHeading>Estimated costs</SubHeading>
            <Prose>
              The review screen estimates the initial buy plus network, account-rent,
              protocol, and priority costs. Actual charges can change. Read the transaction
              simulation and wallet prompt before approving.
            </Prose>
          </section>

          <section className="space-y-5">
            <SectionHeading id="lock-behavior">Lock behavior</SectionHeading>
            <Prose>
              The current builder creates a self-directed Streamflow token lock. It uses the
              connected wallet as sender and recipient, disables cancellation and transfer
              permissions, and schedules the locked amount for release at the end of the
              selected period.
            </Prose>
            <ul className="space-y-3 pl-5 text-[15px] leading-[1.6] text-text-2">
              <li className="list-disc marker:text-text-3">The lock amount is computed from the exact token quote of the launch buy.</li>
              <li className="list-disc marker:text-text-3">A percentage below 100 leaves the remainder liquid.</li>
              <li className="list-disc marker:text-text-3">Streamflow fees mean the deposited amount can be slightly below the selected percentage.</li>
              <li className="list-disc marker:text-text-3">The recorded percentage is recomputed from the finalized deposit and the tokens acquired in the launch transaction.</li>
              <li className="list-disc marker:text-text-3">LCKD does not offer an unlocked launch path.</li>
            </ul>
            <Prose>
              Streamflow documents token locks as inaccessible before the unlock date. Review
              the current product documentation at{" "}
              <a className="font-mono text-accent-300 underline underline-offset-4 hover:text-accent-400" href="https://docs.streamflow.finance/en/articles/9339705-token-lock" target="_blank" rel="noreferrer">
                Streamflow Token Lock
              </a>
              . Protocol behavior and fees can change.
            </Prose>
          </section>

          <section className="space-y-5">
            <SectionHeading id="verification">Verify independently</SectionHeading>
            <Prose>
              LCKD records submitted signatures and displays schedule summaries. Those records
              are convenient indexes, not an on-chain audit. Before relying on a lock, verify
              the mint, token amount, sender, recipient, cancellation settings, transfer
              settings, and unlock time using independent tools.
            </Prose>
            <div className="grid gap-3 sm:grid-cols-2">
              <a className="btn-secondary min-h-12 justify-between" href="https://app.streamflow.finance/token-lock" target="_blank" rel="noreferrer">
                Streamflow lock explorer <span aria-hidden="true">&#8599;</span>
              </a>
              <a className="btn-secondary min-h-12 justify-between" href="https://solscan.io" target="_blank" rel="noreferrer">
                Solscan <span aria-hidden="true">&#8599;</span>
              </a>
            </div>
            <Notice>
              An absent signature, unavailable explorer result, or mismatch between the page
              and chain should be treated as unverified.
            </Notice>
          </section>

          <section className="space-y-5">
            <SectionHeading id="profiles">Profile labels</SectionHeading>
            <Prose>
              GitHub sign-in proves control of a GitHub session at authentication time. A
              submitted repository or product URL is a profile link, not proof of code quality,
              ownership, availability, or token safety.
            </Prose>
            <Prose>
              Directory labels such as Locked, Verified, Builder, or Shipped are platform
              metadata. They are not endorsements, audits, or guarantees. Always inspect the
              linked accounts and on-chain records yourself.
            </Prose>
          </section>

          <section className="space-y-5">
            <SectionHeading id="buyers">For buyers</SectionHeading>
            <Prose>
              A valid lock restricts only the deposited amount for its configured period. It
              does not restrict other wallets, prevent mint or freeze authority abuse, secure
              liquidity, guarantee development, or prevent price loss.
            </Prose>
            <ul className="space-y-3 pl-5 text-[15px] leading-[1.6] text-text-2">
              <li className="list-disc marker:text-text-3">Confirm the mint address across every page and explorer.</li>
              <li className="list-disc marker:text-text-3">Check the exact locked amount, percentage, and unlock date.</li>
              <li className="list-disc marker:text-text-3">Review holder concentration, authorities, liquidity, and Token-2022 extensions.</li>
              <li className="list-disc marker:text-text-3">Treat badges, boosts, repository links, and product links as signals, not proof.</li>
            </ul>
            <Link href="/risk" className="btn-secondary inline-flex">Read the full risk disclosure</Link>
          </section>

          <section className="space-y-4">
            <SectionHeading id="faq">FAQ</SectionHeading>
            <FaqItem q="Does launch and lock use one transaction?">
              Yes. Creation, the initial buy, and the Streamflow lock execute in a single
              atomic transaction. If any part fails, the whole transaction fails.
            </FaqItem>
            <FaqItem q="Can token creation succeed while locking fails?">
              No. The lock is part of the same transaction as creation. A failed launch
              leaves no token; at most the prepared lookup table remains, and the wizard
              cleans it up before the next launch.
            </FaqItem>
            <FaqItem q="Is GitHub optional?">
              GitHub authentication is required to use the browser launch workflow. Linking a
              repository or live product URL is optional.
            </FaqItem>
            <FaqItem q="Does a lock make a token safe?">
              No. It restricts only the deposited tokens for the configured period. Other
              technical, market, liquidity, and operator risks remain.
            </FaqItem>
          </section>
        </article>
      </div>
    </div>
  );
}
