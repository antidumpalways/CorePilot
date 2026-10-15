import { stringToHex, type Hex } from "viem";

/** Funding rates and funding policy thresholds use signed bps per hour. 1 bps = 0.01%. */
export function fundingBpsToPercent(bps: number): number {
  return finite(bps, "funding bps") / 100;
}

/** Strategy leverage is stored as multiplier × 100 (300 means 3x). */
export function leverageBpsToMultiplier(leverageBps: number): number {
  return finite(leverageBps, "leverage bps") / 100;
}

export function leverageMultiplierToBps(multiplier: number): number {
  return integer(multiplier * 100, "leverage multiplier × 100");
}

/** Slippage uses conventional basis points (10,000 bps = 100%). */
export function slippageBpsToFraction(slippageBps: number): number {
  return finite(slippageBps, "slippage bps") / 10_000;
}

export function fractionToSlippageBps(fraction: number): number {
  return integer(finite(fraction, "slippage fraction") * 10_000, "slippage bps");
}

/** Contract notional is whole USD, without token decimals or cent scaling. */
export function notionalUsdToContract(value: number): bigint {
  return BigInt(integer(value, "notional USD"));
}

export function notionalUsdFromContract(value: bigint): number {
  return safeNumber(value, "notional USD");
}

/** Registry expiry is Unix seconds; domain timestamps and oracle snapshots use milliseconds. */
export function unixSecondsToMilliseconds(seconds: number): number {
  return finite(seconds, "Unix seconds") * 1_000;
}

export function millisecondsToUnixSeconds(milliseconds: number): number {
  return integer(finite(milliseconds, "Unix milliseconds") / 1_000, "Unix seconds");
}

/** Oracle mark price is scaled by 1e8; its timestamp is already Unix milliseconds. */
export function markPriceFromContract(scaledPrice: bigint): number {
  return safeNumber(scaledPrice, "scaled mark price") / 1e8;
}

export function markPriceToContract(priceUsd: number): bigint {
  const scaled = finite(priceUsd, "mark price USD") * 1e8;
  if (!Number.isSafeInteger(Math.round(scaled))) throw new RangeError("mark price exceeds safe numeric precision");
  return BigInt(Math.round(scaled));
}

/** Encode an ASCII market or strategy identifier as left-aligned bytes32. */
export function stringToBytes32(value: string): Hex {
  if (!value || value.length > 32 || !/^[\x20-\x7e]+$/.test(value)) {
    throw new RangeError("bytes32 identifier must contain 1–32 printable ASCII characters");
  }
  return stringToHex(value, { size: 32 });
}

/** Decode a left-aligned bytes32 ASCII market or strategy identifier. */
export function bytes32ToString(value: Hex): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError("expected a 32-byte hex value");
  const bytes = value.slice(2).match(/.{2}/g) ?? [];
  let decoded = "";
  let ended = false;
  for (const byte of bytes) {
    const code = Number.parseInt(byte, 16);
    if (code === 0) {
      ended = true;
      continue;
    }
    if (ended || code < 0x20 || code > 0x7e) throw new TypeError("bytes32 value is not a null-padded ASCII identifier");
    decoded += String.fromCharCode(code);
  }
  return decoded;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function integer(value: number, label: string): number {
  finite(value, label);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

function safeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds JavaScript safe integer precision`);
  return result;
}
