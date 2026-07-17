import type { Metadata } from "next";
import CodeBlock from "@/components/docs/CodeBlock";
import Toc, { type TocSection } from "@/components/docs/Toc";
import { Prose, SectionHeading, SubHeading } from "@/components/docs/DocsPrimitives";

const API_SECTIONS: TocSection[] = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "feed", label: "GET /feed" },
  { id: "token", label: "GET /token/:ca" },
  { id: "lock", label: "GET /token/:ca/lock" },
  { id: "developer", label: "GET /dev/:username" },
  { id: "dex", label: "POST /verify-dex" },
  { id: "launch", label: "POST /launch" },
  { id: "errors", label: "Errors and limits" },
];

export const metadata: Metadata = {
  title: "REST API reference",
  description:
    "Current LCKD REST endpoints, authentication boundaries, response shapes, and the limits of platform lock records.",
  alternates: { canonical: "/api-docs" },
  openGraph: {
    title: "REST API reference | LCKD",
    description: "Public read endpoints and authenticated browser launch endpoints.",
    url: "/api-docs",
    type: "article",
  },
};

function Method({ children }: { children: string }) {
  const isGet = children === "GET";
  return (
    <span
      className={`mr-2 inline-flex rounded-md border px-2 py-1 align-middle font-mono text-[10px] font-bold tracking-[0.08em] ${
        isGet
          ? "border-accent/40 bg-accent-dim text-accent-400"
          : "border-warn/40 bg-[rgba(224,167,62,0.07)] text-warn"
      }`}
    >
      {children}
    </span>
  );
}

function EndpointCard({
  method,
  path,
  children,
}: {
  method: "GET" | "POST";
  path: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line-default bg-surface p-4">
      <p className="mb-2 break-all font-mono text-xs text-text-1">
        <Method>{method}</Method>{path}
      </p>
      <p className="text-sm leading-6 text-text-2">{children}</p>
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-[1152px] bg-bg pb-24">
      <header className="border-b border-line px-4 pt-28 pb-12 sm:px-6 sm:pb-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-sans text-[32px] font-bold tracking-[-0.02em] text-text-1 sm:text-[clamp(32px,5vw,44px)]">
            Public data, explicit boundaries
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-[1.6] text-text-2">
            Read endpoints are public. Launch and upload endpoints use the authenticated
            browser session and do not form a standalone public launch SDK.
          </p>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 pt-6 lg:flex-row lg:gap-12 lg:pt-10">
        <Toc sections={API_SECTIONS} />
        <article className="min-w-0 max-w-3xl flex-1 space-y-20">
          <section className="space-y-5">
            <SectionHeading id="overview">Overview</SectionHeading>
            <Prose>
              The production base URL is{" "}
              <code className="rounded-md bg-surface-2 px-1.5 font-mono text-[13px] text-accent-300">
                https://lckd.tech/api/v1
              </code>
              . Responses are JSON. Success responses return the endpoint payload directly.
              Errors use{" "}
              <code className="rounded-md bg-surface-2 px-1.5 font-mono text-[13px] text-danger">{`{ "error": "message" }`}</code>.
            </Prose>
            <div className="grid gap-3 sm:grid-cols-2">
              <EndpointCard method="GET" path="/feed">Directory records with pagination metadata.</EndpointCard>
              <EndpointCard method="GET" path="/token/:ca">One platform token record by mint address or ID.</EndpointCard>
              <EndpointCard method="GET" path="/token/:ca/lock">A lock summary computed from stored platform fields.</EndpointCard>
              <EndpointCard method="GET" path="/dev/:username">Directory records associated with a GitHub username.</EndpointCard>
            </div>
            <div className="warning-box block text-[13px] leading-7">
              API lock fields are not fresh on-chain verification. Consumers must validate the
              lock transaction and contract state independently.
            </div>
          </section>

          <section className="space-y-5">
            <SectionHeading id="authentication">Authentication</SectionHeading>
            <Prose>
              Public read endpoints and the DexScreener lookup do not require a session. The
              metadata upload, launch transaction builder, GitHub repository list, and token
              record writer require a valid GitHub-authenticated session cookie.
            </Prose>
            <Prose>
              Cross-origin access is restricted by the server allowlist. There is no published
              API-key flow and no supported command-line package. Use the browser wizard for
              authenticated launches.
            </Prose>
          </section>

          <section className="space-y-5">
            <SectionHeading id="feed"><Method>GET</Method>/feed</SectionHeading>
            <Prose>Returns directory records and pagination metadata.</Prose>
            <SubHeading>Query parameters</SubHeading>
            <ul className="space-y-2 pl-5 text-sm leading-7 text-text-2">
              <li className="list-disc marker:text-text-3"><code className="rounded-md bg-surface-2 px-1.5 font-mono text-[13px] text-accent-300">tier</code>: locked, verified, builder, or shipped</li>
              <li className="list-disc marker:text-text-3"><code className="rounded-md bg-surface-2 px-1.5 font-mono text-[13px] text-accent-300">sort</code>: newest or oldest</li>
              <li className="list-disc marker:text-text-3"><code className="rounded-md bg-surface-2 px-1.5 font-mono text-[13px] text-accent-300">limit</code>: 1 to 100, default 20</li>
              <li className="list-disc marker:text-text-3"><code className="rounded-md bg-surface-2 px-1.5 font-mono text-[13px] text-accent-300">offset</code>: zero-based result offset</li>
            </ul>
            <CodeBlock lang="bash" code={`curl "https://lckd.tech/api/v1/feed?sort=newest&limit=20"`} />
            <CodeBlock lang="json" code={`{
  "tokens": [],
  "meta": { "total": 0, "limit": 20, "offset": 0, "sort": "newest" }
}`} />
          </section>

          <section className="space-y-5">
            <SectionHeading id="token"><Method>GET</Method>/token/:ca</SectionHeading>
            <Prose>
              Returns{" "}
              <code className="rounded-md bg-surface-2 px-1.5 font-mono text-[13px] text-accent-300">{`{ "token": DisplayToken }`}</code>{" "}
              for a known mint address or ID. Unknown records return 404.
            </Prose>
            <CodeBlock lang="bash" code={`curl "https://lckd.tech/api/v1/token/<mint-address>"`} />
            <Prose>
              Market fields can be unavailable and appear as{" "}
              <code className="rounded-md bg-surface-2 px-1.5 font-mono text-[13px] text-accent-300">--</code>.
              Treat missing values as unknown, not zero.
            </Prose>
          </section>

          <section className="space-y-5">
            <SectionHeading id="lock"><Method>GET</Method>/token/:ca/lock</SectionHeading>
            <Prose>
              Returns a schedule summary derived from the stored launch record. The response
              includes token name, ticker, verified amount and duration, cliff unlock state,
              days remaining, timestamps, and the finalized lock transaction.
            </Prose>
            <CodeBlock lang="bash" code={`curl "https://lckd.tech/api/v1/token/<mint-address>/lock"`} />
            <CodeBlock lang="json" code={`{
  "lock": {
    "tokenName": "Example",
    "ticker": "$EX",
    "lockAmount": "998,103",
    "lockDuration": "90d",
    "percentUnlocked": 0,
    "daysRemaining": 90,
    "start": "2026-07-17T12:00:00.000Z",
    "end": "2026-10-15T12:02:00.000Z",
    "status": "locked",
    "transaction": "<finalized-lock-signature>"
  }
}`} />
            <div className="warning-box block text-[13px] leading-7">
              A time lock reports 0 percent unlocked before its cliff and 100 percent at or
              after the unlock timestamp. Verify the linked Streamflow account independently
              before using this record for alerts, access control, or trading decisions.
            </div>
            <Prose>
              The recorded lock percentage is recomputed from the finalized Streamflow deposit
              and the wallet&apos;s finalized token purchase in the launch transaction. It is not
              derived from a later wallet balance or a client-supplied percentage.
            </Prose>
          </section>

          <section className="space-y-5">
            <SectionHeading id="developer"><Method>GET</Method>/dev/:username</SectionHeading>
            <Prose>Returns directory records associated with an exact GitHub username.</Prose>
            <CodeBlock lang="bash" code={`curl "https://lckd.tech/api/v1/dev/<github-username>"`} />
            <CodeBlock lang="json" code={`{
  "developer": "github-username",
  "tokens": []
}`} />
          </section>

          <section className="space-y-5">
            <SectionHeading id="dex"><Method>POST</Method>/token/:ca/verify-dex</SectionHeading>
            <Prose>
              Requests current DexScreener pairs for a mint and filters the result to Solana.
              It does not verify token ownership, lock state, or project legitimacy.
            </Prose>
            <CodeBlock lang="bash" code={`curl -X POST "https://lckd.tech/api/v1/token/<mint-address>/verify-dex"`} />
          </section>

          <section className="space-y-5">
            <SectionHeading id="launch"><Method>POST</Method>/launch</SectionHeading>
            <Prose>
              This authenticated browser endpoint validates the uploaded metadata, freezes the
              reviewed launch terms, and returns the exact address lookup table setup transaction.
              The browser generates the mint and Streamflow metadata keypairs locally. Private
              keys never leave the browser.
            </Prose>
            <CodeBlock lang="json" code={`POST /api/v1/launch
Content-Type: application/json
Cookie: <authenticated session>

{
  "walletPublicKey": "<wallet-public-key>",
  "mintPublicKey": "<client-generated-mint-public-key>",
  "metadataPublicKey": "<client-generated-streamflow-metadata-public-key>",
  "metadataUri": "https://...",
  "imageUri": "https://...",
  "name": "Example",
  "ticker": "EX",
  "description": "Example token",
  "buyAmountSol": 1,
  "lockDurationDays": 90,
  "lockPercentage": 99
}`} />
            <CodeBlock lang="json" code={`{
  "transaction": "<base64 lookup-setup transaction>",
  "mintPublicKey": "<client-generated-mint-public-key>",
  "metadataPublicKey": "<client-generated-streamflow-metadata-public-key>",
  "lookupTableAddress": "<lookup-table-address>",
  "quotedTokenAmount": "<base-units>",
  "lockAmount": "<base-units>",
  "status": "prepared"
}`} />
            <div className="error-box block text-[13px] leading-7">
              The exact lookup setup must be signed, checkpointed, and finalized before
              <code> /api/v1/launch/atomic</code> returns the single create, buy, and Streamflow
              lock transaction. Both endpoints are bound to the authenticated browser workflow.
            </div>
          </section>

          <section className="space-y-5">
            <SectionHeading id="errors">Errors and limits</SectionHeading>
            <ul className="space-y-3 pl-5 text-sm leading-7 text-text-2">
              <li className="list-disc marker:text-text-3">400 for invalid parameters</li>
              <li className="list-disc marker:text-text-3">401 for a missing authenticated session on protected endpoints</li>
              <li className="list-disc marker:text-text-3">403 when authenticated identity does not match requested account data</li>
              <li className="list-disc marker:text-text-3">404 for an unknown directory record</li>
              <li className="list-disc marker:text-text-3">429 when a route rate limit is exceeded</li>
              <li className="list-disc marker:text-text-3">5xx when an upstream service or server operation fails</li>
            </ul>
            <Prose>
              Rate-limit values are operational settings and may change. Clients should honor
              status codes, use bounded retries with backoff, and never interpret a failed
              response as a successful launch or lock.
            </Prose>
          </section>
        </article>
      </div>
    </div>
  );
}
