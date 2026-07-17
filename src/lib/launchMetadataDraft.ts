import type { LaunchConfig } from "@/types/index";

export const LAUNCH_METADATA_STORAGE_KEY = "lckd_launch_metadata";

export interface LaunchMetadataDraft {
  metadataUri: string;
  imageUri: string;
  name: string;
  ticker: string;
  description: string;
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function parseLaunchMetadataDraft(value: unknown): LaunchMetadataDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<LaunchMetadataDraft>;
  if (
    !isHttpsUrl(draft.metadataUri) ||
    !isHttpsUrl(draft.imageUri) ||
    typeof draft.name !== "string" ||
    typeof draft.ticker !== "string" ||
    typeof draft.description !== "string" ||
    ![draft.twitterUrl, draft.telegramUrl, draft.websiteUrl].every(
      (url) => url === null || isHttpsUrl(url),
    )
  ) return null;
  return draft as LaunchMetadataDraft;
}

export function metadataDraftMatchesConfig(
  draft: LaunchMetadataDraft,
  config: LaunchConfig,
): boolean {
  return draft.name === config.name &&
    draft.ticker === config.ticker &&
    draft.description === config.description &&
    draft.twitterUrl === config.twitterUrl &&
    draft.telegramUrl === config.telegramUrl &&
    draft.websiteUrl === config.websiteUrl;
}

export function readLaunchMetadataDraft(): LaunchMetadataDraft | null {
  if (typeof window === "undefined") return null;
  try {
    return parseLaunchMetadataDraft(JSON.parse(
      sessionStorage.getItem(LAUNCH_METADATA_STORAGE_KEY) ?? "null",
    ));
  } catch {
    return null;
  }
}

export function writeLaunchMetadataDraft(draft: LaunchMetadataDraft | null): void {
  if (typeof window === "undefined") return;
  if (!draft) {
    sessionStorage.removeItem(LAUNCH_METADATA_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(LAUNCH_METADATA_STORAGE_KEY, JSON.stringify(draft));
}
