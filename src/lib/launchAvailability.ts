type LaunchRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

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
