import type { OfficialLaunchEvent, OfficialLockEvent } from "./launchMonitor";

export function mergeLaunchState(
  current: OfficialLaunchEvent | null,
  event: OfficialLaunchEvent,
): OfficialLaunchEvent | null {
  if (current && event.slot < current.slot) return current;
  if (event.status === "retracted") {
    return current?.signature === event.signature ? null : current;
  }
  if (
    current?.signature === event.signature &&
    current.status === "confirmed" &&
    event.status === "processed"
  ) return current;
  const retainedLock = current?.signature === event.signature ? current.lock : null;
  return { ...event, lock: event.lock ?? retainedLock };
}

export function mergeLockState(
  launch: OfficialLaunchEvent | null,
  lock: OfficialLockEvent,
): OfficialLaunchEvent | null {
  if (!launch || lock.slot < launch.slot) return launch;
  const current = launch.lock;
  if (current) {
    if (lock.slot < current.slot) return launch;
    if (lock.status === "retracted" && lock.signature !== current.signature) return launch;
    if (lock.slot === current.slot && lock.signature !== current.signature) return launch;
    if (current.status === "confirmed" && lock.status === "processed") return launch;
  } else if (lock.status === "retracted") {
    return launch;
  }
  return { ...launch, lock: lock.status === "retracted" ? null : lock };
}

export function isMintCandidateAllowed(
  configuredMint: string | null,
  confirmedMint: string | null,
  current: OfficialLaunchEvent | null,
  candidateMint: string,
): boolean {
  return (!configuredMint || configuredMint === candidateMint) &&
    (!confirmedMint || confirmedMint === candidateMint) &&
    (!current || current.mintAddress === candidateMint);
}
