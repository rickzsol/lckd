import {
  encodePacked,
  keccak256,
  type Address,
  type Hex,
} from "viem";

export interface PonsRecoveryContract {
  chainId: number;
  factory: Address;
  launcher: Address;
  salt: Hex;
}

export function ponsRecoveryKey(contract: PonsRecoveryContract): Hex {
  return keccak256(encodePacked(
    ["uint256", "address", "address", "bytes32"],
    [BigInt(contract.chainId), contract.factory, contract.launcher, contract.salt],
  ));
}
