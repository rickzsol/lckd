export interface PendingManualLaunch {
  id: string;
  status: "pending_manual_launch";
  name: string;
  ticker: string;
  description: string;
  image: string;
  contractAddress: string | null;
  links: {
    website: string;
    x: string;
    github: string;
  };
}

function trustedHttpsUrl(value: string, expectedHost: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== expectedHost) {
    throw new Error(`Untrusted pending launch URL: ${value}`);
  }
  return url.toString();
}

export const PENDING_MANUAL_LAUNCHES: readonly PendingManualLaunch[] = [
  {
    id: "lckd-manual-launch",
    status: "pending_manual_launch",
    name: "Lckd",
    ticker: "$Lckd",
    description:
      "The official LCKD platform token. Its contract address will be published after the manual launch.",
    image: "/lckd-token.png",
    contractAddress: null,
    links: {
      website: trustedHttpsUrl("https://lckd.tech/", "lckd.tech"),
      x: trustedHttpsUrl("https://x.com/launchlckd", "x.com"),
      github: trustedHttpsUrl("https://github.com/rickzsol/lckd", "github.com"),
    },
  },
];
