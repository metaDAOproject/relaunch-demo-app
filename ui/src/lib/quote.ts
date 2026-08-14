// Integer swap math, mirroring the SDK/program formulas exactly so the
// number the user sees is the number the program computes.

// 12.5M new tokens (6 decimals) to depositors; the other 12.5M + all USDC
// seed the futarchy AMM (program constants).
export const TOKENS_TO_DEPOSITORS = 12_500_000n * 10n ** 6n;
export const TOKENS_TO_FUTARCHY_LIQUIDITY = 12_500_000n * 10n ** 6n;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export type BuyQuote = {
  grossIn: bigint; // expected cost including the pool fee
  maxQuoteIn: bigint; // slippage-capped instruction argument
  fee: bigint; // the 25 bps portion of grossIn
};

// Exact-output buy on Raydium AMM v4: the constant-product input is
// ceil-rounded, with the 25 bps fee ceil-rounded on top (fee stays in the
// pool). Matches RelaunchClient.depositViaBuy's Raydium branch.
export function buyQuote(
  baseOut: bigint,
  tokenReserve: bigint,
  quoteReserve: bigint,
  slippageBps = 100n,
): BuyQuote | null {
  if (baseOut <= 0n || baseOut >= tokenReserve) return null;
  const inBeforeFee = ceilDiv(quoteReserve * baseOut, tokenReserve - baseOut);
  const grossIn = ceilDiv(inBeforeFee * 10_000n, 9_975n);
  const maxQuoteIn = (grossIn * (10_000n + slippageBps)) / 10_000n;
  return { grossIn, maxQuoteIn, fee: grossIn - inBeforeFee };
}

export type SellQuote = {
  grossOut: bigint; // expected proceeds
  minQuoteOut: bigint; // slippage floor for the instruction
};

// Selling into the pool: the 25 bps fee is ceil-rounded off the input and
// stays in the pool. Matches RelaunchClient.executeSell's Raydium branch.
export function sellQuote(
  baseIn: bigint,
  tokenReserve: bigint,
  quoteReserve: bigint,
  slippageBps = 100n,
): SellQuote | null {
  if (baseIn <= 0n) return null;
  const netIn = baseIn - (baseIn * 25n + 9_999n) / 10_000n;
  const grossOut = (quoteReserve * netIn) / (tokenReserve + netIn);
  return {
    grossOut,
    minQuoteOut: (grossOut * (10_000n - slippageBps)) / 10_000n,
  };
}

// WSOL → USDC on the pinned whirlpool: spot output from sqrtPrice, floored
// by slippage (which must also cover the 4 bps swap fee + price impact).
// Matches RelaunchClient.executeUsdcSwap.
export function usdcSwapQuote(
  wsolIn: bigint,
  sqrtPrice: bigint,
  slippageBps = 100n,
): { spotOut: bigint; minUsdcOut: bigint } {
  const spotOut = (wsolIn * sqrtPrice * sqrtPrice) >> 128n;
  return {
    spotOut,
    minUsdcOut: (spotOut * (10_000n - slippageBps)) / 10_000n,
  };
}

// Pro-rata claim: amount × 12.5M / totalDeposited, floored (program math).
export function claimAmount(deposited: bigint, totalDeposited: bigint): bigint {
  if (totalDeposited === 0n) return 0n;
  return (deposited * TOKENS_TO_DEPOSITORS) / totalDeposited;
}
