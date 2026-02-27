import type { Metadata } from "next";
import ApiToc from "@/components/docs/ApiToc";
import CodeBlock from "@/components/docs/CodeBlock";
import QuickStart from "@/components/landing/QuickStart";
import {
  SectionHeading,
  SubHeading,
  Prose,
  Accent,
} from "@/components/docs/DocsPrimitives";

export const metadata: Metadata = {
  title: "API Docs — LCKD",
  description:
    "REST API documentation for LCKD — launch tokens, query lock status, and integrate with your tools.",
};

function ParamRow({ name, type, desc }: { name: string; type: string; desc: string }) {
  return (
    <tr className="border-b border-white/[0.04]">
      <td className="py-2 pr-4 align-top font-mono text-xs text-accent">{name}</td>
      <td className="py-2 pr-4 align-top font-mono text-[11px] text-text-muted">{type}</td>
      <td className="py-2 align-top text-sm text-text-muted">{desc}</td>
    </tr>
  );
}

function ParamTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-white/[0.08]">
            <th className="pb-2 pr-4 font-mono text-[10px] font-bold uppercase tracking-wider text-text-muted">Param</th>
            <th className="pb-2 pr-4 font-mono text-[10px] font-bold uppercase tracking-wider text-text-muted">Type</th>
            <th className="pb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-text-muted">Description</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  const color = method === "GET" ? "text-blue-400 border-blue-400/20 bg-blue-400/[0.06]" : "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]";
  return (
    <span className={`inline-block rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${color}`}>
      {method}
    </span>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="mx-auto flex max-w-5xl gap-10 px-4 pb-24 pt-10">
      <ApiToc />

      <article className="min-w-0 max-w-3xl flex-1 space-y-16">
        {/* ─── Quick Start ─────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="quick-start">Quick Start</SectionHeading>
          <Prose>
            Get up and running in seconds. Pick your preferred method below.
          </Prose>
          <QuickStart />
        </section>

        {/* ─── Overview ──────────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="overview">API Overview</SectionHeading>

          <Prose>
            The lckd.tech REST API lets you integrate token launches, lock queries, and
            developer profiles into CLIs, bots, CI/CD pipelines, and dashboards. All
            endpoints return JSON and support CORS.
          </Prose>

          <div className="space-y-3">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
              <p className="mb-2 font-mono text-xs font-bold text-white">Base URL</p>
              <code className="font-mono text-sm text-accent">https://www.lckd.tech/api/v1</code>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
              <p className="mb-2 font-mono text-xs font-bold text-white">Response Format</p>
              <p className="text-sm text-text-muted">
                All responses are JSON. Successful responses return the data directly.
                Errors return <code className="font-mono text-xs text-red-400">{"{ \"error\": \"message\" }"}</code> with
                an appropriate HTTP status code.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-accent/20 bg-accent/[0.04] px-4 py-3">
            <p className="font-mono text-xs font-bold text-accent">No auth required</p>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">
              All GET endpoints are public. POST endpoints require valid input parameters
              but no API key during the MVP phase.
            </p>
          </div>
        </section>

        {/* ─── CLI ───────────────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="cli">CLI</SectionHeading>

          <Prose>
            Launch tokens directly from your terminal. The CLI wraps the REST API and
            handles wallet signing locally — your private key never leaves your machine.
          </Prose>

          <SubHeading>Installation</SubHeading>
          <CodeBlock lang="bash" code="npx lckd launch" />

          <SubHeading>Commands</SubHeading>
          <div className="space-y-2">
            {[
              { cmd: "lckd launch", desc: "Interactive token launch wizard" },
              { cmd: "lckd status <mint-address>", desc: "Check lock status for a token" },
              { cmd: "lckd profile <github-username>", desc: "View all tokens by a developer" },
              { cmd: "lckd verify-dex <mint-address>", desc: "Check DexScreener data for a token" },
              { cmd: "lckd tokens", desc: "List recent token launches" },
            ].map((item) => (
              <div key={item.cmd} className="flex items-start gap-3 rounded-lg border border-white/[0.04] bg-white/[0.015] px-4 py-3">
                <code className="shrink-0 font-mono text-xs text-accent">{item.cmd}</code>
                <span className="text-sm text-text-muted">{item.desc}</span>
              </div>
            ))}
          </div>

          <SubHeading>Launch Wizard Output</SubHeading>
          <CodeBlock lang="terminal" code={`$ lckd launch

  lckd.tech — builders who ship. tokens that lock.

  ? Token name: MyToken
  ? Ticker: $MTK
  ? Description: A community token with locked dev allocation
  ? Image path: ./token-logo.png
  ? Initial buy (SOL): 1.5
  ? Lock duration (days): 90
  ? Lock percentage: 100
  ? GitHub username (optional): myuser
  ? GitHub repo (optional): myuser/mytoken

  Uploading metadata to IPFS... done
  Building create transaction... done

  Review:
    Token:     MyToken ($MTK)
    Buy:       1.5 SOL
    Lock:      100% for 90 days
    Mint:      7xKX...AsU

  ? Sign and submit? Yes

  Transaction submitted: 5xYZ...abc
  Token live at: https://www.lckd.tech/token/7xKX...AsU`} />
        </section>

        {/* ─── Config File ───────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="config-file">Config File</SectionHeading>

          <Prose>
            For CI/CD and automated launches, use a <Accent>lckd.json</Accent> config
            file instead of the interactive wizard.
          </Prose>

          <CodeBlock lang="json" code={`{
  "name": "MyToken",
  "ticker": "MTK",
  "description": "A community token with locked dev allocation",
  "image": "./token-logo.png",
  "buyAmountSol": 1.5,
  "lockDurationDays": 90,
  "lockPercentage": 100,
  "githubUsername": "myuser",
  "githubRepo": "myuser/mytoken",
  "liveUrl": "https://mytoken.app",
  "twitterUrl": "https://x.com/mytoken",
  "telegramUrl": "https://t.me/mytoken",
  "websiteUrl": "https://mytoken.app"
}`} />

          <Prose>
            Then run: <code className="font-mono text-xs text-accent">lckd launch --config lckd.json</code>
          </Prose>
        </section>

        {/* ─── POST /launch ──────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="post-launch">
            <MethodBadge method="POST" /> /launch
          </SectionHeading>

          <Prose>
            Builds a pump.fun create+buy transaction with an ephemeral mint keypair.
            Returns serialized transaction bytes for client-side signing.
          </Prose>

          <SubHeading>Request</SubHeading>
          <CodeBlock lang="json" code={`POST /api/v1/launch
Content-Type: application/json

{
  "walletPublicKey": "YourWalletPublicKeyBase58",
  "metadataUri": "https://...",
  "name": "MyToken",
  "ticker": "MTK",
  "description": "A community token",
  "buyAmountSol": 1.5,
  "lockDurationDays": 90,
  "lockPercentage": 100,
  "githubUsername": "myuser",
  "githubRepo": "myuser/mytoken"
}`} />

          <ParamTable>
            <ParamRow name="walletPublicKey" type="string" desc="Solana wallet public key (base58)" />
            <ParamRow name="metadataUri" type="string" desc="IPFS URI from /metadata/upload" />
            <ParamRow name="name" type="string" desc="Token name" />
            <ParamRow name="ticker" type="string" desc="Token ticker (max 10 chars)" />
            <ParamRow name="buyAmountSol" type="number" desc="Initial dev buy in SOL (> 0)" />
            <ParamRow name="lockDurationDays" type="number" desc="Lock duration in days (>= 1)" />
            <ParamRow name="lockPercentage" type="number" desc="Percentage of tokens to lock (1-100)" />
          </ParamTable>

          <SubHeading>Response</SubHeading>
          <CodeBlock lang="json" code={`{
  "transaction": "base64-encoded-transaction-bytes",
  "mintPublicKey": "EphemeralMintPublicKeyBase58",
  "mintSecretKey": "base64-encoded-mint-secret-key"
}`} />

          <div className="rounded-lg border border-accent/20 bg-accent/[0.04] px-4 py-3">
            <p className="font-mono text-xs font-bold text-accent">Why mintSecretKey?</p>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">
              The mint keypair is ephemeral — generated per-launch for the token{"'"}s mint
              account. Your client needs it to co-sign the create transaction. The server
              never touches your wallet{"'"}s private key.
            </p>
          </div>
        </section>

        {/* ─── POST /metadata/upload ─────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="post-metadata-upload">
            <MethodBadge method="POST" /> /metadata/upload
          </SectionHeading>

          <Prose>
            Uploads token image and metadata to IPFS via pump.fun{"'"}s endpoint. Returns a
            metadata URI for use in the /launch endpoint.
          </Prose>

          <SubHeading>Request</SubHeading>
          <CodeBlock lang="bash" code={`curl -X POST https://www.lckd.tech/api/v1/metadata/upload \\
  -F "file=@token-logo.png" \\
  -F "name=MyToken" \\
  -F "symbol=MTK" \\
  -F "description=A community token" \\
  -F "twitter=https://x.com/mytoken" \\
  -F "website=https://mytoken.app"`} />

          <ParamTable>
            <ParamRow name="file" type="File" desc="Token image (PNG/JPG)" />
            <ParamRow name="name" type="string" desc="Token name (required)" />
            <ParamRow name="symbol" type="string" desc="Token symbol (required)" />
            <ParamRow name="description" type="string" desc="Token description" />
            <ParamRow name="twitter" type="string" desc="Twitter URL (optional)" />
            <ParamRow name="telegram" type="string" desc="Telegram URL (optional)" />
            <ParamRow name="website" type="string" desc="Website URL (optional)" />
          </ParamTable>

          <SubHeading>Response</SubHeading>
          <CodeBlock lang="json" code={`{
  "metadataUri": "https://arweave.net/..."
}`} />
        </section>

        {/* ─── GET /token/:ca ────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="get-token">
            <MethodBadge method="GET" /> /token/:ca
          </SectionHeading>

          <Prose>
            Returns the full token profile by mint address or ID.
          </Prose>

          <SubHeading>Request</SubHeading>
          <CodeBlock lang="bash" code="GET /api/v1/token/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" />

          <SubHeading>Response</SubHeading>
          <CodeBlock lang="json" code={`{
  "token": {
    "id": 1,
    "name": "NeuralSwap",
    "ticker": "$NSWAP",
    "tier": 4,
    "tierLabel": "SHIPPED",
    "image": "NS",
    "dev": {
      "github": "alexchen",
      "avatar": "AC",
      "accountAge": "3yr"
    },
    "lock": {
      "amount": "4.2M",
      "duration": "180d",
      "pct": 12,
      "start": "Jan 15",
      "end": "Jul 14"
    },
    "mcap": "$482K",
    "vol": "$89K",
    "price": "$0.000482",
    "chg": "+34.2%",
    "holders": 1847
  }
}`} />
        </section>

        {/* ─── GET /token/:ca/lock ───────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="get-token-lock">
            <MethodBadge method="GET" /> /token/:ca/lock
          </SectionHeading>

          <Prose>
            Returns the lock status for a token — useful for monitoring dashboards
            and automated alerts.
          </Prose>

          <SubHeading>Request</SubHeading>
          <CodeBlock lang="bash" code="GET /api/v1/token/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU/lock" />

          <SubHeading>Response</SubHeading>
          <CodeBlock lang="json" code={`{
  "lock": {
    "tokenName": "NeuralSwap",
    "ticker": "$NSWAP",
    "lockAmount": "4.2M",
    "lockDuration": "180d",
    "percentUnlocked": 12,
    "daysRemaining": 158,
    "start": "Jan 15",
    "end": "Jul 14",
    "status": "locked"
  }
}`} />

          <ParamTable>
            <ParamRow name="status" type="string" desc="One of: fully_locked, locked, fully_unlocked" />
            <ParamRow name="percentUnlocked" type="number" desc="0-100 representing lock progress" />
            <ParamRow name="daysRemaining" type="number" desc="Days until fully unlocked" />
          </ParamTable>
        </section>

        {/* ─── GET /dev/:username ────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="get-dev">
            <MethodBadge method="GET" /> /dev/:username
          </SectionHeading>

          <Prose>
            Returns all tokens launched by a specific GitHub user.
          </Prose>

          <SubHeading>Request</SubHeading>
          <CodeBlock lang="bash" code="GET /api/v1/dev/alexchen" />

          <SubHeading>Response</SubHeading>
          <CodeBlock lang="json" code={`{
  "developer": "alexchen",
  "tokens": [
    {
      "id": 1,
      "name": "NeuralSwap",
      "ticker": "$NSWAP",
      "tier": 4,
      "tierLabel": "SHIPPED",
      ...
    }
  ]
}`} />
        </section>

        {/* ─── POST /verify-dex ──────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="post-verify-dex">
            <MethodBadge method="POST" /> /token/:ca/verify-dex
          </SectionHeading>

          <Prose>
            Fetches DexScreener data for a token mint address. Returns trading pair
            information including price, volume, liquidity, and fully diluted valuation.
          </Prose>

          <SubHeading>Request</SubHeading>
          <CodeBlock lang="bash" code="POST /api/v1/token/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU/verify-dex" />

          <SubHeading>Response</SubHeading>
          <CodeBlock lang="json" code={`{
  "found": true,
  "pairs": [
    {
      "dex": "raydium",
      "pairAddress": "...",
      "baseToken": "NSWAP",
      "quoteToken": "SOL",
      "priceUsd": "0.000482",
      "volume24h": 89000,
      "liquidityUsd": 45000,
      "fdv": 482000
    }
  ]
}`} />
        </section>

        {/* ─── GET /feed ─────────────────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="get-feed">
            <MethodBadge method="GET" /> /feed
          </SectionHeading>

          <Prose>
            Returns a paginated list of tokens. Supports filtering by trust tier and
            sorting by creation date.
          </Prose>

          <SubHeading>Query Parameters</SubHeading>
          <ParamTable>
            <ParamRow name="tier" type="string" desc="Filter by tier: locked, verified, builder, shipped" />
            <ParamRow name="sort" type="string" desc="Sort order: newest (default), oldest" />
            <ParamRow name="limit" type="number" desc="Results per page (default 20, max 100)" />
            <ParamRow name="offset" type="number" desc="Skip N results for pagination" />
          </ParamTable>

          <SubHeading>Request</SubHeading>
          <CodeBlock lang="bash" code="GET /api/v1/feed?tier=shipped&sort=newest&limit=10" />

          <SubHeading>Response</SubHeading>
          <CodeBlock lang="json" code={`{
  "tokens": [ ... ],
  "meta": {
    "total": 2,
    "limit": 10,
    "offset": 0,
    "sort": "newest"
  }
}`} />
        </section>

        {/* ─── Integration Examples ──────────────────────── */}
        <section className="space-y-5">
          <SectionHeading id="integration-examples">Integration Examples</SectionHeading>

          <SubHeading>GitHub Actions (CI/CD Launch)</SubHeading>
          <CodeBlock lang="yaml" code={`name: Launch Token
on:
  workflow_dispatch:

jobs:
  launch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Upload metadata
        id: metadata
        run: |
          RESPONSE=$(curl -s -X POST https://www.lckd.tech/api/v1/metadata/upload \\
            -F "file=@./token-logo.png" \\
            -F "name=\${{ vars.TOKEN_NAME }}" \\
            -F "symbol=\${{ vars.TOKEN_TICKER }}" \\
            -F "description=\${{ vars.TOKEN_DESC }}")
          echo "uri=$(echo $RESPONSE | jq -r '.metadataUri')" >> $GITHUB_OUTPUT

      - name: Build launch transaction
        run: |
          curl -s -X POST https://www.lckd.tech/api/v1/launch \\
            -H "Content-Type: application/json" \\
            -d '{
              "walletPublicKey": "\${{ secrets.WALLET_PUBKEY }}",
              "metadataUri": "\${{ steps.metadata.outputs.uri }}",
              "name": "\${{ vars.TOKEN_NAME }}",
              "ticker": "\${{ vars.TOKEN_TICKER }}",
              "buyAmountSol": 1.0,
              "lockDurationDays": 90,
              "lockPercentage": 100
            }'`} />

          <SubHeading>Bot Integration (TypeScript)</SubHeading>
          <CodeBlock lang="typescript" code={`const BASE = "https://www.lckd.tech/api/v1";

async function getTokenLockStatus(mintAddress: string) {
  const res = await fetch(\`\${BASE}/token/\${mintAddress}/lock\`);
  const data = await res.json();

  if (data.error) throw new Error(data.error);

  const { lock } = data;
  console.log(\`\${lock.tokenName} (\${lock.ticker})\`);
  console.log(\`Status: \${lock.status}\`);
  console.log(\`\${lock.percentUnlocked}% unlocked, \${lock.daysRemaining}d remaining\`);

  return lock;
}

async function getDevTokens(username: string) {
  const res = await fetch(\`\${BASE}/dev/\${username}\`);
  return res.json();
}`} />

          <SubHeading>Lock Status Monitor (Polling)</SubHeading>
          <CodeBlock lang="typescript" code={`const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const POLL_INTERVAL = 60_000; // 1 minute

async function pollLockStatus() {
  const res = await fetch(
    \`https://www.lckd.tech/api/v1/token/\${MINT}/lock\`
  );
  const { lock } = await res.json();

  if (lock.status === "fully_unlocked") {
    console.log("ALERT: Dev tokens are fully unlocked!");
    // Send notification...
    return;
  }

  console.log(\`\${lock.percentUnlocked}% unlocked — \${lock.daysRemaining}d left\`);
  setTimeout(pollLockStatus, POLL_INTERVAL);
}

pollLockStatus();`} />
        </section>
      </article>
    </div>
  );
}
