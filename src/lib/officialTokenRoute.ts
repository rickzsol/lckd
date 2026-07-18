import type { Metadata } from "next";
import type { OfficialLaunchEvent } from "./launchMonitor";

export const OFFICIAL_TOKEN_PATH = "/token/lckd";
export const OFFICIAL_MINT_ADDRESS = "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump";
export const OFFICIAL_TOKEN_IMAGE =
  "https://ipfs.io/ipfs/bafkreie2jzdw4biujohhinewjdnvecjvdszizshwsnt7m4qo653yktuvle";

export const OFFICIAL_TOKEN_METADATA: Metadata = {
  title: "LCKD ($LCKD)",
  description: "Live contract address, chart, market data, and Streamflow lock record for the official LCKD token.",
  alternates: { canonical: OFFICIAL_TOKEN_PATH },
  openGraph: {
    title: "LCKD ($LCKD)",
    description: "The live on-chain record for the official LCKD token.",
    images: [{ url: OFFICIAL_TOKEN_IMAGE, width: 512, height: 512, alt: "LCKD token" }],
    url: OFFICIAL_TOKEN_PATH,
  },
};

export function isOfficialTokenMint(
  id: string,
  launch: Pick<OfficialLaunchEvent, "mintAddress"> | null,
): boolean {
  return id === OFFICIAL_MINT_ADDRESS || launch?.mintAddress === id;
}
