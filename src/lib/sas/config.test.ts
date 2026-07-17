import assert from "node:assert/strict";
import test from "node:test";

import { assertRpcMatchesCluster, SasConfigError } from "./config";
import type { SolanaClient } from "gill";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

/** Minimal client stub whose getGenesisHash returns a fixed value. */
function clientWithGenesis(hash: string): SolanaClient {
  return {
    rpc: {
      getGenesisHash() {
        return { send: async () => hash };
      },
    },
  } as unknown as SolanaClient;
}

test("passes when the RPC genesis matches the cluster", async () => {
  await assertRpcMatchesCluster(clientWithGenesis(DEVNET_GENESIS), "devnet");
  await assertRpcMatchesCluster(clientWithGenesis(MAINNET_GENESIS), "mainnet");
});

// F12: a devnet cluster label against a mainnet RPC must be refused before any
// signing, so it can never persist a false cluster or issue on the wrong chain.
test("rejects a devnet cluster served by a mainnet RPC", async () => {
  await assert.rejects(
    () => assertRpcMatchesCluster(clientWithGenesis(MAINNET_GENESIS), "devnet"),
    SasConfigError,
  );
});

test("rejects a mainnet cluster served by a devnet RPC", async () => {
  await assert.rejects(
    () => assertRpcMatchesCluster(clientWithGenesis(DEVNET_GENESIS), "mainnet"),
    SasConfigError,
  );
});
