// Helper function to calculate integer square root for BN

import { BN } from "@coral-xyz/anchor";

// Same algorithm as spl-math approximations::sqrt
export function bnSqrt(radicand: BN): BN {
  // Handle edge cases
  if (radicand.isNeg())
    throw new Error("Cannot compute square root of negative number");
  if (radicand.isZero()) return new BN(0); // do nothing for 0

  // Find the number of bits in the number
  const bitLength = radicand.bitLength();

  // Compute bit, the largest power of 4 <= n
  // Start with the highest bit pair (since we're looking for sqrt, we work with pairs of bits)
  const shift = (bitLength - 1) & ~1; // Ensure even number (bitLength - 1, then clear lowest bit)
  let bit = new BN(1).shln(shift); // bit = 1 << shift

  let n = radicand.clone();
  let result = new BN(0);

  while (!bit.isZero()) {
    const resultWithBit = result.add(bit);
    if (n.gte(resultWithBit)) {
      n = n.sub(resultWithBit);
      result = result.shrn(1).add(bit); // result = (result >> 1) + bit
    } else {
      result = result.shrn(1); // result = result >> 1
    }
    bit = bit.shrn(2); // bit = bit >> 2 (divide by 4)
  }

  return result;
}

export enum SlippageToleranceBP {
  None = 0, // 0%
  Low = 50, // 0.5%
  Medium = 100, // 1%
  High = 200, // 2%
  Extreme = 500, // 5%
}

// Calculate optimal liquidity amounts with slippage protection
export function calculateOptimalAmounts(
  amountADesired: BN,
  amountBDesired: BN,
  reserveA: BN,
  reserveB: BN,
  slippageTolerance: SlippageToleranceBP = SlippageToleranceBP.Low // 0.5% default
): {
  amountA: BN;
  amountB: BN;
  amountAMin: BN;
  amountBMin: BN;
  slippageTolerance?: SlippageToleranceBP;
} {
  // For initial liquidity (empty pool), no need for ratio calculations
  if (reserveA.isZero() || reserveB.isZero()) {
    return {
      amountA: amountADesired,
      amountB: amountBDesired,
      amountAMin: amountADesired, // No slippage on initial deposit
      amountBMin: amountBDesired,
    };
  }

  // Calculate optimal B amount if we use all of amountADesired
  const amountBOptimal = amountADesired.mul(reserveB).div(reserveA);

  if (amountBOptimal.lte(amountBDesired)) {
    // Use amountADesired, amountBOptimal
    // slippageTolerance is in basis points (e.g., 50 = 0.5%)
    // To get minimum amount: amount * (10000 - slippageBP) / 10000
    const slippageBP = 10000 - slippageTolerance; // Convert BP to remaining percentage
    const amountAMin = amountADesired
      .mul(new BN(slippageBP))
      .div(new BN(10000));
    const amountBMin = amountBOptimal
      .mul(new BN(slippageBP))
      .div(new BN(10000));

    return {
      amountA: amountADesired,
      amountB: amountBOptimal,
      amountAMin,
      amountBMin,
    };
  } else {
    // Calculate optimal A amount if we use all of amountBDesired
    const amountAOptimal = amountBDesired.mul(reserveA).div(reserveB);

    // slippageTolerance is in basis points (e.g., 50 = 0.5%)
    const slippageBP = 10000 - slippageTolerance; // Convert BP to remaining percentage
    const amountAMin = amountAOptimal
      .mul(new BN(slippageBP))
      .div(new BN(10000));
    const amountBMin = amountBDesired
      .mul(new BN(slippageBP))
      .div(new BN(10000));

    return {
      amountA: amountAOptimal,
      amountB: amountBDesired,
      amountAMin,
      amountBMin,
    };
  }
}

// Calculate output amount using constant product formula (matches Solana implementation)
export function calculateSwapOutput({
  amountIn,
  reserveIn,
  reserveOut,
  feeBp,
}: {
  amountIn: BN;
  reserveIn: BN;
  reserveOut: BN;
  feeBp: number;
}) {
  // Calculates: ceil((amount * fee_bp) / 10000)
  const feeAmount = amountIn
    .mul(new BN(feeBp))
    .add(new BN(10000 - 1))
    .div(new BN(10000));

  const amountInAfterFee = amountIn.sub(feeAmount);

  // Constant Product Formula: amount_out = (amount_in_after_fee * reserve_out) / (reserve_in + amount_in_after_fee)
  const numerator = amountInAfterFee.mul(reserveOut);
  const denominator = reserveIn.add(amountInAfterFee);
  const amountOut = numerator.div(denominator);

  return { amountOut, feeAmount };
}

// Calculate minimum amount out with slippage protection
export function calculateMinimumAmountOut({
  amountIn,
  reserveIn,
  reserveOut,
  feeBp,
  slippageTolerance = SlippageToleranceBP.Low,
}: {
  amountIn: BN;
  reserveIn: BN;
  reserveOut: BN;
  feeBp: number;
  slippageTolerance: SlippageToleranceBP;
}) {
  // Calculate expected output using constant product formula
  const { amountOut: expectedAmountOut, feeAmount } = calculateSwapOutput({
    amountIn,
    reserveIn,
    reserveOut,
    feeBp,
  });

  // Apply slippage tolerance
  const amountOutMinAfterSlippage = expectedAmountOut
    .mul(new BN(10000 - slippageTolerance))
    .div(new BN(10000));

  return { expectedAmountOut, amountOutMinAfterSlippage, feeAmount };
}

// Calculate price impact percentage on swap
export function calculateSwapPriceImpact(
  amountIn: BN,
  reserveIn: BN,
  reserveOut: BN
): number {
  const currentPrice = reserveOut.mul(new BN(1000000)).div(reserveIn);

  // Calculate amount out using constant product
  const amountOut = amountIn.mul(reserveOut).div(reserveIn.add(amountIn));

  const newReserveIn = reserveIn.add(amountIn);
  const newReserveOut = reserveOut.sub(amountOut);
  const newPrice = newReserveOut.mul(new BN(1000000)).div(newReserveIn);

  const priceDiff = currentPrice.sub(newPrice).abs();
  const priceImpact = priceDiff.mul(new BN(1000000)).div(currentPrice);

  return (priceImpact.toNumber() / 1000000) * 100; // Convert to percentage
}

export function calculateRemoveLiquidityAmounts({
  lpAmount,
  lpSupply,
  reserveA,
  reserveB,
  slippageTolerance,
}: {
  lpAmount: BN;
  lpSupply: BN;
  reserveA: BN;
  reserveB: BN;
  slippageTolerance: SlippageToleranceBP;
}) {
  const slippageBP = 10000 - slippageTolerance; // Convert BP to remaining percentage

  const minARemoved = lpAmount
    .mul(new BN(reserveA))
    .mul(new BN(slippageBP))
    .div(new BN(lpSupply))
    .div(new BN(10000));

  const minBRemoved = lpAmount
    .mul(new BN(reserveB))
    .mul(new BN(slippageBP))
    .div(new BN(lpSupply))
    .div(new BN(10000));

  return { minARemoved, minBRemoved };
}
