const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const IP_PATTERN = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}/;

export async function verifyLiveUrl(url: string): Promise<boolean> {
  try {
    if (!url.startsWith("https://")) return false;
    if (IP_PATTERN.test(url)) return false;

    let currentUrl = url;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(currentUrl, {
          method: "HEAD",
          signal: controller.signal,
          redirect: "manual",
        });

        clearTimeout(timeout);

        if (res.status >= 200 && res.status < 400) {
          if (res.status >= 300) {
            const location = res.headers.get("Location");
            if (!location) return false;

            currentUrl = location.startsWith("/")
              ? new URL(location, currentUrl).href
              : location;

            if (!currentUrl.startsWith("https://")) return false;
            continue;
          }
          return true;
        }

        return false;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    }

    return false;
  } catch {
    return false;
  }
}
