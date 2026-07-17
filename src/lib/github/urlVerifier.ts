import "server-only";

import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const BLOCKED_HOST_SUFFIXES = [
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".test",
];

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("fec") || normalized.startsWith("fed") || normalized.startsWith("fee") || normalized.startsWith("fef")) return true;
  if (normalized.startsWith("ff") || normalized.startsWith("2001:db8:") || normalized.startsWith("2002:") || normalized.startsWith("64:ff9b:")) return true;

  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);

  const mappedHex = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mappedHex) return false;
  const high = Number.parseInt(mappedHex[1], 16);
  const low = Number.parseInt(mappedHex[2], 16);
  return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function resolvePublicAddress(url: URL): Promise<ResolvedAddress | null> {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    isIP(hostname) !== 0 ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return null;
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
      return null;
    }
    return addresses[0] as ResolvedAddress;
  } catch {
    return null;
  }
}

function parseSafeUrl(value: string, base?: URL): URL | null {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (
      url.protocol !== "https:" ||
      (url.port && url.port !== "443") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function headRequest(url: URL, resolved: ResolvedAddress) {
  return new Promise<{ status: number; location: string | null }>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "HEAD",
        headers: { Accept: "text/html,*/*;q=0.1", "User-Agent": "lckd-url-verifier/1.0" },
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.address, resolved.family);
        },
      },
      (response) => {
        response.resume();
        resolve({
          status: response.statusCode ?? 0,
          location: response.headers.location ?? null,
        });
      },
    );

    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error("URL verification timed out")));
    request.once("error", reject);
    request.end();
  });
}

export async function verifyLiveUrl(value: string): Promise<boolean> {
  let currentUrl = parseSafeUrl(value);
  if (!currentUrl) return false;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const resolved = await resolvePublicAddress(currentUrl);
    if (!resolved) return false;

    try {
      const response = await headRequest(currentUrl, resolved);
      if (response.status >= 200 && response.status < 300) return true;
      if (response.status < 300 || response.status >= 400 || !response.location) return false;

      const nextUrl = parseSafeUrl(response.location, currentUrl);
      if (!nextUrl) return false;
      currentUrl = nextUrl;
    } catch {
      return false;
    }
  }

  return false;
}
