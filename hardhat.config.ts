import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

const ROBINHOOD_RPC_URL =
  process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  networks: {
    robinhoodFork: {
      type: "edr-simulated",
      chainType: "generic",
      chainId: 4663,
      forking: {
        url: ROBINHOOD_RPC_URL,
        blockNumber: 12_282_000,
      },
    },
  },
});
