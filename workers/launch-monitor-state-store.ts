import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { parseOfficialLaunchEvent, type OfficialLaunchEvent } from "../src/lib/launchMonitor";

export interface StoredLaunchMonitorState {
  launch: OfficialLaunchEvent | null;
  officialMintAddress: string | null;
  version: number;
}

export function loadLaunchMonitorState(path: string | null): StoredLaunchMonitorState | null {
  if (!path) return null;
  if (!isAbsolute(path)) throw new Error("LAUNCH_MONITOR_STATE_PATH must be absolute");
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!value || typeof value !== "object") throw new Error("Launch monitor state is invalid");
  const launchValue = Reflect.get(value, "launch");
  const officialMintAddress = Reflect.get(value, "officialMintAddress");
  const version = Reflect.get(value, "version");
  const launch = launchValue === null ? null : parseOfficialLaunchEvent(launchValue);
  let isValidMint = officialMintAddress === null;
  if (typeof officialMintAddress === "string") {
    try {
      isValidMint = new PublicKey(officialMintAddress).toBase58() === officialMintAddress;
    } catch {
      isValidMint = false;
    }
  }
  if (
    (launchValue !== null && !launch) ||
    !isValidMint ||
    !Number.isSafeInteger(version) ||
    Number(version) < 0 ||
    (launch && officialMintAddress !== null && officialMintAddress !== launch.mintAddress)
  ) throw new Error("Launch monitor state is invalid");
  return { launch, officialMintAddress, version: Number(version) };
}

export function saveLaunchMonitorState(path: string | null, state: StoredLaunchMonitorState) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}
