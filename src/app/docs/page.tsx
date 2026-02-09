import type { Metadata } from "next";
import Badge from "@/components/ui/Badge";
import { TrustTier } from "@/types/index";
import DocsToc from "@/components/docs/DocsToc";
import {
  SectionHeading,
  SubHeading,
  Prose,
  Accent,
  FaqItem,
  FlowStep,
} from "@/components/docs/DocsPrimitives";

export const metadata: Metadata = {
  title: "Docs — Lockpad",
  description:
    "Learn how Lockpad enforces transparent token launches with locked dev allocations via Streamflow token locks.",
};

export default function DocsPage() {
  return (
    <div className="mx-auto flex max-w-5xl gap-10 px-4 pb-24 pt-10">
      <DocsToc />

      <article className="min-w-0 max-w-3xl flex-1 space-y-16">
        {/* ─── What is Lockpad? ──────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="what-is-lockpad">What is Lockpad?</SectionHeading>

          <Prose>
            Lockpad is a <Accent>trust-enforcement wrapper</Accent> around pump.fun. It
            is <strong className="text-white">not</strong> a competing DEX or launchpad.
            All trading still happens on pump.fun exactly as you{"'"}d expect — Lockpad
            only handles the launch transaction, adding mandatory token locks to the
            developer{"'"}s token allocation before the token ever goes live.
          </Prose>

          <Prose>
            The problem is simple: devs launch tokens, buy a bag during creation, and dump
            it on buyers within minutes. Lockpad makes that impossible by locking the dev
            buy through a <Accent>Streamflow token lock</Accent> — an audited, non-cancelable
            on-chain lock. If a dev launches through Lockpad, their tokens are locked.
            Period.
          </Prose>

          <div className="rounded-lg border border-emerald-accent/20 bg-emerald-accent/[0.04] px-4 py-3">
            <p className="font-mono text-xs font-bold text-emerald-accent">Key point</p>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">
              Lockpad does not custody funds, run a DEX, or deploy a custom on-chain
              program. It constructs a client-side transaction bundle that atomically
              creates, buys, and locks — all in one signature.
            </p>
          </div>
        </section>

        {/* ─── How It Works ─────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="how-it-works">How It Works</SectionHeading>

          <SubHeading>The Atomic Transaction</SubHeading>
          <Prose>
            When you launch a token through Lockpad, three instructions are bundled into
            a single Solana transaction:
          </Prose>

          <div className="space-y-3">
            <FlowStep
              n={1}
              label="Create token on pump.fun"
              sub="The token is created using pump.fun's bonding curve program, exactly as a normal pump.fun launch."
            />
            <FlowStep
              n={2}
              label="Dev buy executes"
              sub="Your initial SOL buy goes through the bonding curve. You receive tokens into your wallet."
            />
            <FlowStep
              n={3}
              label="Tokens are locked via Streamflow"
              sub="The purchased tokens are immediately deposited into a Streamflow token lock contract with your chosen duration."
            />
          </div>

          <div className="warning-box">
            If any step fails, the entire transaction reverts. You cannot end up with an
            unlocked buy — that{"'"}s the whole point. The atomicity is enforced at the
            Solana runtime level.
          </div>

          <SubHeading>The Flow</SubHeading>

          <div className="overflow-x-auto">
            <div className="flex min-w-[540px] items-center gap-0">
              {[
                { label: "Your SOL", color: "text-white" },
                { label: "pump.fun buy", color: "text-emerald-accent" },
                { label: "Tokens", color: "text-white" },
                { label: "Streamflow lock", color: "text-emerald-accent" },
                { label: "Lock schedule", color: "text-white" },
              ].map((step, i) => (
                <div key={step.label} className="flex items-center">
                  <div className="rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2">
                    <span className={`font-mono text-[11px] font-bold ${step.color}`}>
                      {step.label}
                    </span>
                  </div>
                  {i < 4 && (
                    <span className="px-1 font-mono text-xs text-text-muted">
                      {"\u2192"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <SubHeading>Streamflow Token Lock</SubHeading>
          <Prose>
            Streamflow is an <Accent>audited token lock protocol</Accent> on Solana.
            When Lockpad locks your tokens, it creates a Streamflow token lock contract
            with the following properties:
          </Prose>

          <ul className="space-y-2 pl-5 text-[15px] leading-[1.75] text-text-muted sm:text-base">
            <li className="list-disc">
              <strong className="text-white">Non-cancelable</strong> — once locked, the
              creator cannot withdraw tokens early
            </li>
            <li className="list-disc">
              <strong className="text-white">Cliff-based lock</strong> — tokens unlock
              in full at the end of the lock period
            </li>
            <li className="list-disc">
              <strong className="text-white">On-chain verifiable</strong> — anyone can
              inspect the lock on Streamflow{"'"}s explorer
            </li>
            <li className="list-disc">
              <strong className="text-white">Non-transferable</strong> — the lock
              recipient cannot be changed
            </li>
          </ul>
        </section>

        {/* ─── Trust Tiers ──────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="trust-tiers">Trust Tiers Explained</SectionHeading>

          <Prose>
            Every token launched on Lockpad receives a trust tier based on the
            developer{"'"}s profile and launch configuration. Tiers are
            computed <Accent>dynamically</Accent> — they can go up or down as conditions
            change.
          </Prose>

          {/* Tier comparison table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="pb-3 pr-4 font-mono text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    Tier
                  </th>
                  <th className="pb-3 pr-4 font-mono text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    Requirements
                  </th>
                  <th className="pb-3 font-mono text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    What it signals
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm leading-relaxed">
                <tr className="border-b border-white/[0.04]">
                  <td className="py-3 pr-4 align-top">
                    <Badge tier={TrustTier.LOCKED} label="LOCKED" />
                  </td>
                  <td className="py-3 pr-4 align-top text-text-muted">
                    Token launched with a token lock. No GitHub connected.
                  </td>
                  <td className="py-3 align-top text-text-muted">
                    Dev tokens are locked, but the developer is anonymous.
                  </td>
                </tr>
                <tr className="border-b border-white/[0.04]">
                  <td className="py-3 pr-4 align-top">
                    <Badge tier={TrustTier.VERIFIED} label="VERIFIED" />
                  </td>
                  <td className="py-3 pr-4 align-top text-text-muted">
                    Lock + GitHub account connected (public profile with history).
                  </td>
                  <td className="py-3 align-top text-text-muted">
                    Dev has a verifiable identity tied to their launch.
                  </td>
                </tr>
                <tr className="border-b border-white/[0.04]">
                  <td className="py-3 pr-4 align-top">
                    <Badge tier={TrustTier.BUILDER} label="BUILDER" />
                  </td>
                  <td className="py-3 pr-4 align-top text-text-muted">
                    Verified + linked public GitHub repo + lock duration of 30+ days.
                  </td>
                  <td className="py-3 align-top text-text-muted">
                    Dev is actively building something and has committed to a longer lock.
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 align-top">
                    <Badge tier={TrustTier.SHIPPED} label="SHIPPED" />
                  </td>
                  <td className="py-3 pr-4 align-top text-text-muted">
                    Builder + live product URL that resolves + recent repo activity.
                  </td>
                  <td className="py-3 align-top text-text-muted">
                    Dev has shipped a working product. Highest trust signal.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <FaqItem q="Can a tier go down?">
              Yes. Tiers are evaluated dynamically. If you disconnect GitHub, your tier
              drops back to <Badge tier={TrustTier.LOCKED} label="LOCKED" />. If your repo
              goes private or your live URL stops resolving, your tier adjusts accordingly.
            </FaqItem>
            <FaqItem q="Can I upgrade my tier after launch?">
              Yes. Connect GitHub, link a repo, or add a live URL at any time. Your tier
              will be recalculated the next time your token page is loaded.
            </FaqItem>
          </div>
        </section>

        {/* ─── For Developers ──────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="for-developers">For Developers</SectionHeading>

          <SubHeading>Launching a Token</SubHeading>
          <Prose>
            The launch wizard walks you through four steps:
          </Prose>

          <ol className="space-y-2 pl-5 text-[15px] leading-[1.75] text-text-muted sm:text-base">
            <li className="list-decimal">
              <strong className="text-white">Token details</strong> — name, ticker,
              description, and image
            </li>
            <li className="list-decimal">
              <strong className="text-white">Dev buy amount</strong> — how much SOL you
              want to buy at launch
            </li>
            <li className="list-decimal">
              <strong className="text-white">Lock configuration</strong> — lock
              duration and percentage of your buy to lock
            </li>
            <li className="list-decimal">
              <strong className="text-white">Review and sign</strong> — preview the
              transaction, then sign with your wallet
            </li>
          </ol>

          <SubHeading>GitHub Verification</SubHeading>
          <Prose>
            Sign in with GitHub via OAuth. Lockpad reads your public profile — account
            age, public repos, and contribution history. No private data is accessed. Your
            GitHub username is displayed on your token{"'"}s page so buyers can verify your
            identity.
          </Prose>

          <SubHeading>Lock Duration Guidance</SubHeading>
          <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
            <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
              <span className="font-mono text-xs text-text-muted">7 days</span>
              <span className="font-mono text-[10px] text-text-muted">
                Minimum. Shows intent but low commitment.
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
              <span className="font-mono text-xs text-emerald-accent">30+ days</span>
              <span className="font-mono text-[10px] text-text-muted">
                Required for <Badge tier={TrustTier.BUILDER} label="BUILDER" /> tier.
                Recommended.
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-emerald-accent">90+ days</span>
              <span className="font-mono text-[10px] text-text-muted">
                Strong signal. Shows long-term commitment to the project.
              </span>
            </div>
          </div>

          <SubHeading>
            Achieving <Badge tier={TrustTier.SHIPPED} label="SHIPPED" /> Status
          </SubHeading>
          <Prose>
            To reach the highest trust tier, you need all of:
          </Prose>
          <ul className="space-y-1.5 pl-5 text-[15px] leading-[1.75] text-text-muted sm:text-base">
            <li className="list-disc">GitHub connected with a linked public repo</li>
            <li className="list-disc">Lock duration of 30+ days</li>
            <li className="list-disc">
              A live product URL (must resolve to an actual page)
            </li>
            <li className="list-disc">
              Recent commit activity in the linked repo (within the last 30 days)
            </li>
          </ul>
        </section>

        {/* ─── For Buyers ──────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="for-buyers">For Buyers</SectionHeading>

          <SubHeading>Reading a Trust Tier</SubHeading>
          <Prose>
            Every token on Lockpad displays a tier badge. Higher tiers mean more
            verifiable signals of developer commitment. A{" "}
            <Badge tier={TrustTier.SHIPPED} label="SHIPPED" /> badge means the dev has a
            verified GitHub, a public repo, a live product, and a 30+ day lock. A{" "}
            <Badge tier={TrustTier.LOCKED} label="LOCKED" /> badge means the tokens are
            locked but the developer is anonymous.
          </Prose>

          <SubHeading>What the Lock Means for You</SubHeading>
          <Prose>
            A Streamflow token lock means the developer <Accent>cannot sell</Accent> their
            locked tokens until the lock period ends. This protects you from
            immediate dumps. However, a lock does not guarantee the project will succeed — it
            only guarantees the dev cannot rug by dumping their allocation.
          </Prose>

          <SubHeading>Verify Independently</SubHeading>
          <Prose>
            Every token page on Lockpad links to the Streamflow lock transaction. You can
            verify the lock directly on{" "}
            <a
              href="https://app.streamflow.finance"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-accent underline decoration-emerald-accent/30 underline-offset-2 hover:decoration-emerald-accent"
            >
              Streamflow{"'"}s app
            </a>{" "}
            or by inspecting the transaction on a Solana explorer. The lock parameters
            (duration, amount, recipient) are all on-chain.
          </Prose>

          <SubHeading>Red Flags to Watch For</SubHeading>
          <div className="warning-box space-y-1.5">
            <p>Even with locks, exercise caution:</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Very short lock durations (under 7 days)</li>
              <li>Low lock percentage (locking only 10% of a large buy)</li>
              <li>No GitHub connected (Tier 1 only)</li>
              <li>No linked repo or live URL</li>
              <li>
                Remember: locks prevent dumps, but the token could still lose value
                through normal market activity
              </li>
            </ul>
          </div>
        </section>

        {/* ─── FAQ ──────────────────────────────────────── */}
        <section className="space-y-4">
          <SectionHeading id="faq">FAQ</SectionHeading>

          <FaqItem q="Is this free?">
            Yes. During the MVP phase, Lockpad charges no additional fees. You only pay
            standard Solana transaction fees and the pump.fun creation fee.
          </FaqItem>

          <FaqItem q="Do I need GitHub to launch?">
            No. You can launch without GitHub, but you{"'"}ll only receive{" "}
            <Badge tier={TrustTier.LOCKED} label="LOCKED" /> status (Tier 1). Connecting
            GitHub unlocks higher trust tiers and gives buyers more confidence.
          </FaqItem>

          <FaqItem q="Can I cancel my lock?">
            No. Streamflow locks created through Lockpad are{" "}
            <strong className="text-white">non-cancelable by design</strong>. This is the
            entire value proposition — buyers can trust that the lock is permanent. Once
            signed, you wait for the lock period to end.
          </FaqItem>

          <FaqItem q="What if pump.fun changes their program?">
            Lockpad constructs transactions against pump.fun{"'"}s on-chain program. If
            pump.fun updates their program ID or instruction format, we monitor for changes
            and update our transaction builder accordingly. Your existing locks on
            Streamflow are unaffected by any pump.fun changes.
          </FaqItem>

          <FaqItem q="Is this audited?">
            <strong className="text-white">Streamflow</strong> is audited (by Sec3/Soteria
            and others).{" "}
            <strong className="text-white">Lockpad itself</strong> does not deploy a
            custom on-chain program — it bundles existing audited programs (pump.fun +
            Streamflow) into a single client-side transaction. There is no smart contract
            risk from Lockpad specifically; the risk surface is the same as using
            pump.fun and Streamflow directly.
          </FaqItem>

          <FaqItem q="What wallets are supported?">
            Phantom and Solflare. Both desktop extensions and mobile wallets are supported.
          </FaqItem>
        </section>
      </article>
    </div>
  );
}
