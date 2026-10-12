/**
 * Execution-cost simulator for paper (and future live) fills.
 * Estimates slippage, pool price impact, protocol fees, and gas so a high
 * signal score is not treated as an executable opportunity.
 */

export type ExecutionSide = "buy" | "sell";

export type ExecutionSimInput = {
  side: ExecutionSide;
  /** Desired notional in USD. */
  notionalUsd: number;
  /** Mid / reference price (USD per token). */
  midPriceUsd: number;
  /** Observed pool liquidity in USD (null if unknown). */
  liquidityUsd: number | null;
  /** Expected protocol / DEX fee rate (e.g. 0.003 = 0.3%). */
  feeRate?: number;
  /** Network gas cost in USD (estimate). */
  gasUsd?: number;
  /** Additional fixed slippage buffer (fraction). */
  slippageBuffer?: number;
  /** Maximum acceptable total cost as fraction of notional. */
  maxCostPct?: number;
};

export type ExecutionSimResult = {
  /** Effective fill price after impact + buffer. */
  fillPriceUsd: number;
  /** Estimated quantity received/sold. */
  qty: number;
  /** Notional actually used (may be reduced if impact too high). */
  effectiveNotionalUsd: number;
  /** Estimated price impact as fraction of mid. */
  impactPct: number;
  /** Protocol fee in USD. */
  feeUsd: number;
  /** Gas in USD. */
  gasUsd: number;
  /** Total friction (impact + fee + gas + buffer) as fraction of notional. */
  totalCostPct: number;
  /** Whether the trade still satisfies the cost budget. */
  acceptable: boolean;
  /** Human-readable reasons when not acceptable. */
  reasons: string[];
};

const DEFAULT_FEE = 0.003;
const DEFAULT_GAS = 2; // conservative L2-ish; caller can override for L1
const DEFAULT_BUFFER = 0.005; // 0.5%
const DEFAULT_MAX_COST = 0.04; // 4%

/**
 * Simple constant-product style impact approximation:
 * impact ≈ notional / (2 * liquidity) for small trades.
 * Caps at 50% so extreme sizes remain bounded for simulation.
 */
export function estimateImpactPct(notionalUsd: number, liquidityUsd: number | null): number {
  if (!liquidityUsd || liquidityUsd <= 0 || notionalUsd <= 0) return 0.02; // unknown → assume 2%
  const raw = notionalUsd / (2 * liquidityUsd);
  return Math.min(0.5, Math.max(0, raw));
}

export function simulateExecution(input: ExecutionSimInput): ExecutionSimResult {
  const feeRate = input.feeRate ?? DEFAULT_FEE;
  const gasUsd = input.gasUsd ?? DEFAULT_GAS;
  const buffer = input.slippageBuffer ?? DEFAULT_BUFFER;
  const maxCost = input.maxCostPct ?? DEFAULT_MAX_COST;
  const mid = input.midPriceUsd;
  const notional = Math.max(0, input.notionalUsd);
  const reasons: string[] = [];

  if (!(mid > 0) || !Number.isFinite(mid)) {
    return {
      fillPriceUsd: 0,
      qty: 0,
      effectiveNotionalUsd: 0,
      impactPct: 0,
      feeUsd: 0,
      gasUsd,
      totalCostPct: 1,
      acceptable: false,
      reasons: ["Invalid mid price"],
    };
  }

  const impactPct = estimateImpactPct(notional, input.liquidityUsd);
  // Buy pays higher; sell receives lower.
  const fillPrice =
    input.side === "buy"
      ? mid * (1 + impactPct + buffer)
      : mid * (1 - impactPct - buffer);

  const feeUsd = notional * feeRate;
  const totalFrictionUsd = notional * (impactPct + buffer) + feeUsd + gasUsd;
  const totalCostPct = notional > 0 ? totalFrictionUsd / notional : 1;

  const qty =
    input.side === "buy"
      ? (notional - feeUsd - gasUsd) / fillPrice
      : notional / mid; // sell qty is what we hold; value after friction is lower

  if (totalCostPct > maxCost) {
    reasons.push(
      `Total expected cost ${(totalCostPct * 100).toFixed(2)}% exceeds budget ${(maxCost * 100).toFixed(2)}%`,
    );
  }
  if (input.liquidityUsd !== null && input.liquidityUsd < notional * 5) {
    reasons.push("Pool liquidity is thin relative to intended size (<5× notional)");
  }
  if (qty <= 0) {
    reasons.push("Effective quantity after costs is non-positive");
  }

  return {
    fillPriceUsd: fillPrice,
    qty: Math.max(0, qty),
    effectiveNotionalUsd: notional,
    impactPct,
    feeUsd,
    gasUsd,
    totalCostPct,
    acceptable: reasons.length === 0,
    reasons,
  };
}

/**
 * Given a loss budget (max $ willing to lose if stop is hit) and stop distance,
 * compute the maximum notional that keeps expected loss within budget after costs.
 */
export function sizeFromLossBudget(
  lossBudgetUsd: number,
  stopDistancePct: number,
  liquidityUsd: number | null,
  feeRate = DEFAULT_FEE,
  gasUsd = DEFAULT_GAS,
  buffer = DEFAULT_BUFFER,
): number {
  if (lossBudgetUsd <= 0 || stopDistancePct <= 0) return 0;
  // Approximate: loss ≈ notional * (stopDistance + impact + buffer + fee) + gas
  // Solve for notional; iterate once with impact that depends on notional.
  let notional = lossBudgetUsd / (stopDistancePct + feeRate + buffer + 0.01);
  const impact = estimateImpactPct(notional, liquidityUsd);
  const denom = stopDistancePct + impact + buffer + feeRate;
  if (denom <= 0) return 0;
  notional = Math.max(0, (lossBudgetUsd - gasUsd) / denom);
  return notional;
}
