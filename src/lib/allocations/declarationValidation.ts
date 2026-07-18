import { isValidSolanaAddress } from "@/lib/api/validation";
import { ALLOCATION_CATEGORIES, type AllocationCategory } from "@/types";

// Semantic rules for a bucket declaration. Shape validation lives in the
// route's zod schema; everything here is pure so the rules are unit
// testable without Supabase or RPC access.

export interface DeclaredBucketInput {
  category: AllocationCategory;
  label: string;
  declaredAmount: string;
  wallets: string[];
}

export interface DeclarationContext {
  mintAddress: string;
  creatorWallet: string;
  escrowAddress: string | null;
  existingActiveWallets: ReadonlySet<string>;
}

export const MAX_BUCKETS_PER_DECLARATION = 6;
export const MAX_WALLETS_PER_BUCKET = 5;

// pump.fun supply is fixed at 1B tokens with 6 decimals.
export const MAX_TOTAL_SUPPLY_RAW = BigInt("1000000000000000");

const RAW_AMOUNT_PATTERN = /^\d{1,20}$/;
const CATEGORY_SET = new Set<string>(ALLOCATION_CATEGORIES);

export function validateDeclaration(
  buckets: readonly DeclaredBucketInput[],
  context: DeclarationContext,
): string | null {
  if (buckets.length < 1 || buckets.length > MAX_BUCKETS_PER_DECLARATION) {
    return "Declare between 1 and 6 buckets";
  }

  const seenWallets = new Set<string>();
  let totalDeclared = BigInt(0);

  for (const bucket of buckets) {
    if (!CATEGORY_SET.has(bucket.category)) {
      return "Unknown allocation category";
    }
    const label = bucket.label.trim();
    if (label.length < 1 || label.length > 40) {
      return "Bucket labels must be 1 to 40 characters";
    }
    if (!RAW_AMOUNT_PATTERN.test(bucket.declaredAmount)) {
      return "Declared amounts must be raw base unit integers";
    }
    const declared = BigInt(bucket.declaredAmount);
    if (declared <= BigInt(0)) {
      return "Declared amounts must be greater than zero";
    }
    totalDeclared += declared;

    if (bucket.wallets.length < 1 || bucket.wallets.length > MAX_WALLETS_PER_BUCKET) {
      return "Each bucket needs 1 to 5 wallets";
    }
    for (const wallet of bucket.wallets) {
      if (!isValidSolanaAddress(wallet)) {
        return "Bucket wallet is not a valid Solana address";
      }
      if (wallet === context.mintAddress) {
        return "The token mint cannot be a bucket wallet";
      }
      if (context.escrowAddress && wallet === context.escrowAddress) {
        return "The lock escrow is already tracked as the locked bucket";
      }
      if (seenWallets.has(wallet)) {
        return "A wallet can only appear in one bucket";
      }
      if (context.existingActiveWallets.has(wallet)) {
        return "A wallet is already tracked for this token";
      }
      seenWallets.add(wallet);
    }
  }

  if (totalDeclared > MAX_TOTAL_SUPPLY_RAW) {
    return "Declared amounts exceed the total token supply";
  }
  return null;
}

export function isCreatorWallet(
  wallet: string,
  context: DeclarationContext,
): boolean {
  return wallet === context.creatorWallet;
}
