import type {
  AllocationBucket,
  AllocationClassification,
  AllocationSnapshot,
  AllocationTransfer,
  AllocationWallet,
} from "@/types";

// Pure aggregation from ledger rows to the shape the token page renders.
// All amounts stay raw base unit strings; the client formats them.

export interface BucketSummary {
  id: string;
  category: string;
  label: string;
  status: string;
  declaredAmount: string;
  currentBalance: string;
  distributed: string;
  sold: string;
  burned: string;
  wallets: Array<{
    address: string;
    isCreatorWallet: boolean;
    balanceAtDeclaration: string;
  }>;
  declaredAt: string;
  retiredAt: string | null;
}

export interface AllocationSummary {
  buckets: BucketSummary[];
  totals: Record<AllocationClassification, string>;
  hasUnreconciledDrift: boolean;
  recentTransfers: Array<{
    signature: string;
    walletAddress: string;
    direction: "in" | "out";
    amount: string;
    counterpartyWallet: string | null;
    classification: AllocationClassification;
    blockTime: string | null;
    isFinal: boolean;
    counterpartyTracked: boolean | null;
  }>;
}

const CLASSIFICATIONS: AllocationClassification[] = [
  "distributed",
  "sold",
  "internal",
  "burned",
  "received",
  "unknown",
];

function latestBalanceByWallet(
  snapshots: readonly AllocationSnapshot[],
): Map<string, AllocationSnapshot> {
  const latest = new Map<string, AllocationSnapshot>();
  for (const snapshot of snapshots) {
    const existing = latest.get(snapshot.wallet_address);
    if (!existing || snapshot.captured_at > existing.captured_at) {
      latest.set(snapshot.wallet_address, snapshot);
    }
  }
  return latest;
}

function sumByWallet(
  transfers: readonly AllocationTransfer[],
  wallets: ReadonlySet<string>,
  classification: AllocationClassification,
): bigint {
  let total = BigInt(0);
  for (const transfer of transfers) {
    if (
      transfer.direction === "out" &&
      transfer.classification === classification &&
      wallets.has(transfer.wallet_address)
    ) {
      total += BigInt(transfer.amount);
    }
  }
  return total;
}

export function buildAllocationSummary(
  buckets: readonly AllocationBucket[],
  wallets: readonly AllocationWallet[],
  transfers: readonly AllocationTransfer[],
  snapshots: readonly AllocationSnapshot[],
): AllocationSummary {
  const latestSnapshots = latestBalanceByWallet(snapshots);
  const trackedWallets = new Set(wallets.map((wallet) => wallet.wallet_address));
  const walletsByBucket = new Map<string, AllocationWallet[]>();
  for (const wallet of wallets) {
    const list = walletsByBucket.get(wallet.bucket_id) ?? [];
    list.push(wallet);
    walletsByBucket.set(wallet.bucket_id, list);
  }

  const bucketSummaries: BucketSummary[] = buckets.map((bucket) => {
    const bucketWallets = walletsByBucket.get(bucket.id) ?? [];
    const addressSet = new Set(bucketWallets.map((wallet) => wallet.wallet_address));

    let currentBalance = BigInt(0);
    for (const wallet of bucketWallets) {
      const snapshot = latestSnapshots.get(wallet.wallet_address);
      currentBalance += BigInt(snapshot?.balance ?? wallet.balance_at_declaration);
    }

    return {
      id: bucket.id,
      category: bucket.category,
      label: bucket.label,
      status: bucket.status,
      declaredAmount: bucket.declared_amount,
      currentBalance: currentBalance.toString(),
      distributed: sumByWallet(transfers, addressSet, "distributed").toString(),
      sold: sumByWallet(transfers, addressSet, "sold").toString(),
      burned: sumByWallet(transfers, addressSet, "burned").toString(),
      wallets: bucketWallets.map((wallet) => ({
        address: wallet.wallet_address,
        isCreatorWallet: wallet.is_creator_wallet,
        balanceAtDeclaration: wallet.balance_at_declaration,
      })),
      declaredAt: bucket.declared_at,
      retiredAt: bucket.retired_at,
    };
  });

  const totals = {} as Record<AllocationClassification, string>;
  for (const classification of CLASSIFICATIONS) {
    let total = BigInt(0);
    for (const transfer of transfers) {
      if (transfer.direction === "out" && transfer.classification === classification) {
        total += BigInt(transfer.amount);
      }
    }
    totals[classification] = total.toString();
  }

  return {
    buckets: bucketSummaries,
    totals,
    hasUnreconciledDrift: [...latestSnapshots.values()].some(
      (snapshot) => snapshot.drift !== null,
    ),
    recentTransfers: transfers.slice(0, 25).map((transfer) => ({
      signature: transfer.signature,
      walletAddress: transfer.wallet_address,
      direction: transfer.direction,
      amount: transfer.amount,
      counterpartyWallet: transfer.counterparty_wallet,
      classification: transfer.classification,
      blockTime: transfer.block_time,
      // Current ingestion reads at confirmed commitment and does not persist a
      // finalized checkpoint. Fail closed until the finalized sweep ships.
      isFinal: false,
      counterpartyTracked: transfer.counterparty_wallet
        ? trackedWallets.has(transfer.counterparty_wallet)
        : null,
    })),
  };
}
