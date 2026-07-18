// Next.js ships a browser Buffer polyfill without the BigInt read/write
// methods, so client bundles crash on (read|write)BigUInt64LE. DataView is
// available everywhere and byte-identical.
export function readU64LE(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
    .getBigUint64(offset, true);
}

export function writeU64LE(data: Uint8Array, value: bigint, offset: number): void {
  new DataView(data.buffer, data.byteOffset, data.byteLength)
    .setBigUint64(offset, value, true);
}
