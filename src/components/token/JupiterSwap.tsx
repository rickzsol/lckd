"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import dynamic from "next/dynamic";
import {
  getQuote,
  getSwapTransaction,
  solToLamports,
  formatTokenAmount,
  type QuoteResponse,
} from "@/lib/jupiter";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton,
    ),
  { ssr: false },
);

const PRESETS = [0.05, 0.1, 0.5, 1.0] as const;
const SLIPPAGE_OPTIONS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "3%", bps: 300 },
] as const;

type SwapState = "idle" | "quoting" | "signing" | "sending" | "success" | "error";

export default function JupiterSwap({
  mintAddress,
  ticker,
}: {
  mintAddress?: string;
  ticker: string;
}) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [state, setState] = useState<SwapState>("idle");
  const [error, setError] = useState("");
  const [txSig, setTxSig] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchQuote = useCallback(
    async (solAmount: string, slippage: number) => {
      if (!mintAddress) return;
      const parsed = parseFloat(solAmount);
      if (!parsed || parsed <= 0) {
        setQuote(null);
        return;
      }

      setState("quoting");
      setError("");
      try {
        const q = await getQuote(mintAddress, solToLamports(parsed), slippage);
        setQuote(q);
        setState("idle");
      } catch (err) {
        setQuote(null);
        setState("error");
        setError(err instanceof Error ? err.message : "Failed to fetch quote");
      }
    },
    [mintAddress],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!amount || !mintAddress) {
      setQuote(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      fetchQuote(amount, slippageBps);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [amount, slippageBps, fetchQuote, mintAddress]);

  const handleSwap = async () => {
    if (!publicKey || !signTransaction || !quote || !mintAddress) return;

    setState("signing");
    setError("");
    try {
      const { swapTransaction } = await getSwapTransaction(
        quote,
        publicKey.toBase58(),
      );

      const txBuf = Buffer.from(swapTransaction, "base64");
      const tx = VersionedTransaction.deserialize(txBuf);
      const signed = await signTransaction(tx);

      setState("sending");
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      await connection.confirmTransaction(sig, "confirmed");
      setTxSig(sig);
      setState("success");

      setTimeout(() => {
        setState("idle");
        setTxSig("");
        setAmount("");
        setQuote(null);
      }, 5000);
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Swap failed");
    }
  };

  const priceImpact = quote ? parseFloat(quote.priceImpactPct) : 0;
  const isHighImpact = priceImpact > 5;
  const isMediumImpact = priceImpact > 1;

  if (!mintAddress) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[#888]">
          Swap
        </div>
        <div className="flex h-[120px] items-center justify-center">
          <p className="font-mono text-xs text-[#555]">Swap unavailable</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#888]">
          Swap SOL &rarr; {ticker}
        </span>
      </div>

      {/* Amount input */}
      <div className="mb-2.5">
        <label className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-[#555]">
          Amount (SOL)
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="form-input tabular-nums"
          disabled={state === "signing" || state === "sending"}
        />
      </div>

      {/* Preset buttons */}
      <div className="mb-3 flex gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setAmount(String(p))}
            className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] font-semibold transition-all ${
              amount === String(p)
                ? "border-emerald-accent/30 bg-emerald-accent/[0.08] text-emerald-accent"
                : "border-white/[0.06] text-[#555] hover:border-white/[0.12] hover:text-[#888]"
            }`}
            disabled={state === "signing" || state === "sending"}
          >
            {p} SOL
          </button>
        ))}
      </div>

      {/* Slippage */}
      <div className="mb-3">
        <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[#555]">
          Slippage
        </div>
        <div className="flex gap-1.5">
          {SLIPPAGE_OPTIONS.map((opt) => (
            <button
              key={opt.bps}
              onClick={() => setSlippageBps(opt.bps)}
              className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] font-semibold transition-all ${
                slippageBps === opt.bps
                  ? "border-emerald-accent/30 bg-emerald-accent/[0.08] text-emerald-accent"
                  : "border-white/[0.06] text-[#555] hover:border-white/[0.12] hover:text-[#888]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quote display */}
      {state === "quoting" && (
        <div className="mb-3 rounded-lg bg-black/30 px-3 py-2">
          <div className="font-mono text-[10px] text-[#555]">
            Fetching quote...
          </div>
        </div>
      )}

      {quote && state !== "quoting" && (
        <div className="mb-3 space-y-1 rounded-lg bg-black/30 px-3 py-2">
          <div className="flex justify-between font-mono text-[10px]">
            <span className="text-[#555]">You receive</span>
            <span className="font-semibold text-white">
              ~{formatTokenAmount(quote.outAmount)} {ticker}
            </span>
          </div>
          <div className="flex justify-between font-mono text-[10px]">
            <span className="text-[#555]">Min received</span>
            <span className="text-[#888]">
              {formatTokenAmount(quote.otherAmountThreshold)} {ticker}
            </span>
          </div>
          <div className="flex justify-between font-mono text-[10px]">
            <span className="text-[#555]">Price impact</span>
            <span
              className={`font-semibold ${
                isHighImpact
                  ? "text-red-400"
                  : isMediumImpact
                    ? "text-yellow-400"
                    : "text-[#888]"
              }`}
            >
              {priceImpact.toFixed(2)}%
            </span>
          </div>
          {quote.routePlan.length > 0 && (
            <div className="flex justify-between font-mono text-[10px]">
              <span className="text-[#555]">Route</span>
              <span className="text-[#888]">
                {quote.routePlan.map((r) => r.swapInfo.label).join(" → ")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {state === "error" && error && (
        <div className="mb-3 rounded-lg bg-red-500/[0.06] px-3 py-2 font-mono text-[10px] text-red-400">
          {error}
        </div>
      )}

      {/* Success */}
      {state === "success" && txSig && (
        <div className="mb-3 rounded-lg bg-emerald-accent/[0.06] px-3 py-2 font-mono text-[10px]">
          <span className="text-emerald-accent">Swap confirmed!</span>
          <a
            href={`https://solscan.io/tx/${txSig}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block text-[#888] underline underline-offset-2 hover:text-white"
          >
            View on Solscan
          </a>
        </div>
      )}

      {/* Spacer to push button to bottom */}
      <div className="flex-1" />

      {/* Swap button */}
      {!publicKey ? (
        <WalletMultiButton />
      ) : (
        <button
          onClick={handleSwap}
          disabled={
            !quote ||
            state === "quoting" ||
            state === "signing" ||
            state === "sending" ||
            state === "success"
          }
          className="btn-primary w-full py-3"
        >
          {state === "quoting"
            ? "Getting quote..."
            : state === "signing"
              ? "Confirm in wallet..."
              : state === "sending"
                ? "Sending..."
                : state === "success"
                  ? "Swap confirmed!"
                  : quote
                    ? `Swap for ~${formatTokenAmount(quote.outAmount)} ${ticker}`
                    : "Enter amount"}
        </button>
      )}

      {isHighImpact && quote && (
        <div className="mt-2 font-mono text-[10px] text-red-400">
          High price impact! You may receive significantly fewer tokens.
        </div>
      )}
    </div>
  );
}
