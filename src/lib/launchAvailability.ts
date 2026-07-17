type LaunchRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const GITHUB_ID_PATTERN = /^\d{1,20}$/;

export function shouldEnablePublicLaunches(
  environment: LaunchRuntimeEnvironment,
): boolean {
  const isLocalDevelopment = environment.NODE_ENV === "development" &&
    environment.VERCEL_ENV === undefined;
  const isIsolatedPreview = environment.VERCEL_ENV === "preview";
  return environment.PUBLIC_LAUNCHES_ENABLED === "true" &&
    (isLocalDevelopment || isIsolatedPreview);
}

export function arePublicLaunchesEnabled(): boolean {
  return shouldEnablePublicLaunches(process.env);
}

export function isLaunchTestUser(
  githubId: string | undefined,
  environment: LaunchRuntimeEnvironment = process.env,
): boolean {
  const configuredIds = environment.LAUNCH_TEST_GITHUB_IDS;
  if (!githubId || !GITHUB_ID_PATTERN.test(githubId) || !configuredIds) return false;

  const ids = configuredIds.split(",").map((value) => value.trim());
  if (ids.length === 0 || ids.some((value) => !GITHUB_ID_PATTERN.test(value))) {
    return false;
  }
  return new Set(ids).has(githubId);
}

export function canCreateLaunch(
  githubId: string | undefined,
  environment: LaunchRuntimeEnvironment = process.env,
): boolean {
  return shouldEnablePublicLaunches(environment) || isLaunchTestUser(githubId, environment);
}
