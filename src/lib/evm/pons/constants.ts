import { defineChain, type Address, type Hex } from "viem";

export const ROBINHOOD_CHAIN_ID = 4_663;
export const ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_EXPLORER_URL = "https://robinhoodchain.blockscout.com";
export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: ROBINHOOD_EXPLORER_URL } },
});

export const PONS_FACTORY_ADDRESS = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB" as Address;
export const PONS_LOCKER_ADDRESS = "0x736D76699C26D0d966744cAe304C000d471f7F35" as Address;
export const PONS_WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as Address;
export const PONS_UNISWAP_FACTORY_ADDRESS = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA" as Address;
export const PONS_POSITION_MANAGER_ADDRESS = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3" as Address;
export const PONS_ROUTER_ADDRESS = "0xCaf681a66D020601342297493863E78C959E5cb2" as Address;
export const PONS_OWNER_ADDRESS = "0xda4bCee76B29EFEc9697Fcf663601c2042043968" as Address;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export const PONS_RUNTIME_CODE_HASHES = {
  factory: "0x0a62b8ed1d88d30c7b342ea8361dfaf0ac336706992cf0c8ba38b129f06391d4",
  locker: "0xa7880a625a649da833de5597c9f41585bb75e20ef91d45830ccc6f4e49cc281c",
  weth: "0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353",
  uniswapFactory: "0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739",
  positionManager: "0x0a493d1af3d0f25fed8efa205244ebee14114267a08647fc38c515c7cd6ead4f",
  router: "0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc",
} as const satisfies Record<string, Hex>;

export const PONS_LAUNCH_CONFIG_ID = BigInt(0);
export const PONS_DEX_ID = BigInt(0);
export const PONS_LAUNCH_FEE_WEI = BigInt("500000000000000");
export const PONS_SUPPLY = BigInt("1000000000000000000000000000");
export const PONS_GRADUATION_THRESHOLD_WEI = BigInt("4200000000000000000");
export const PONS_INITIAL_TICK = -204_200;
export const PONS_MAX_WALLET_BPS = 500;
export const PONS_MAX_TX_BPS = 550;
export const PONS_RESTRICTION_BLOCKS = 366;
export const PONS_POOL_FEE = 10_000;
export const PONS_TICK_SPACING = 200;
export const PONS_PROTOCOL_FEE_SHARE = BigInt(30);
export const PONS_DEX_NAME = "uniswap v3";
