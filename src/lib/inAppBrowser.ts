// In-app webviews (X, Discord, Instagram, Facebook, TikTok, Line) partition or
// drop cookies during OAuth redirects, which breaks the NextAuth state check
// with "State cookie was missing" errors. Detect them so sign-in points can
// tell the visitor to open a real browser instead of failing opaquely.
const IN_APP_TOKENS = [
  "FBAN",
  "FBAV",
  "Instagram",
  "Twitter",
  "TikTok",
  "musical_ly",
  "Line/",
  "Discord",
  "GSA/",
  "; wv)",
];

export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent ?? "";
  return IN_APP_TOKENS.some((token) => userAgent.includes(token));
}
