/**
 * Optional enhanced paper entry that layers portfolio-level risk and
 * execution-cost simulation on top of the existing evaluateRiskGate.
 * Does not replace paper-risk.ts; call this from the Scanner when ready.
 */

import type { OpportunitySignal } from "./market-sources";
import {
  evaluateRiskGate,
  enterPaperPosition,
  paperEquityUsd,
  type PaperPortfolio,
  type RiskVerdict,
  type GateCheck,
} from "./paper-risk";
import {
  evaluatePortfolioRisk,
  recordTradeOutcome,
  type RiskState,
  type PortfolioRiskLimits,
  DEFAULT_PORTFOLIO_LIMITS,
} from "../trading/portfolio-risk";
import { simulateExecution, sizeFromLossBudget } from "../trading/execution-sim";

export type EnhancedVerdict = RiskVerdict & {
  portfolioAllowed: boolean;
  executionAcceptable: boolean;
  simulatedFillPrice: number | null;
  impactPct: number | null;
  totalCostPct: number | null;
  portfolioChecks: GateCheck[];
  riskState: RiskState;
};

/**
 * Full gate: existing per-idea checks + portfolio risk + execution cost.
 * If execution is too expensive, planned notional is reduced or rejected.
 */
export function evaluateEnhancedGate(
  signal: OpportunitySignal,
  portfolio: PaperPortfolio,
  riskState: RiskState,
  limits: PortfolioRiskLimits = DEFAULT_PORTFOLIO_LIMITS,
  now = Date.now(),
): EnhancedVerdict {
  const base = evaluateRiskGate(signal, portfolio, now);
  const equity = paperEquityUsd(portfolio);
  const portfolioVerdict = evaluatePortfolioRisk(equity, riskState, limits, now);

  const portfolioChecks: GateCheck[] = portfolioVerdict.checks.map(c => ({
    id: c.id,
    label: c.label,
    pass: c.pass,
    detail: c.detail,
  }));

  let planned = base.plannedNotionalUsd;
  let simulatedFillPrice: number | null = null;
  let impactPct: number | null = null;
  let totalCostPct: number | null = null;
  let executionAcceptable = true;

  const mid = signal.metrics.priceUsd;
  if (base.allowed && portfolioVerdict.allowed && mid && mid > 0 && planned > 0) {
    // Prefer loss-budget sizing when we know the 8% stop.
    const lossBudget = equity * 0.05 * 0.08; // 5% idea * 8% stop ≈ max loss
    const sized = sizeFromLossBudget(lossBudget, 0.08, signal.metrics.liquidityUsd);
    if (sized > 0 && sized < planned) planned = sized;

    const sim = simulateExecution({
      side: "buy",
      notionalUsd: planned,
      midPriceUsd: mid,
      liquidityUsd: signal.metrics.liquidityUsd,
    });
    simulatedFillPrice = sim.fillPriceUsd;
    impactPct = sim.impactPct;
    totalCostPct = sim.totalCostPct;
    executionAcceptable = sim.acceptable;
    if (!sim.acceptable) planned = 0;
  } else if (!mid || mid <= 0) {
    executionAcceptable = false;
  }

  const allChecks = [...base.checks, ...portfolioChecks];
  if (!executionAcceptable) {
    allChecks.push({
      id: "execution-cost",
      label: "Execution cost within budget",
      pass: false,
      detail:
        totalCostPct !== null
          ? `Estimated cost ${(totalCostPct * 100).toFixed(2)}% (impact/fees/gas)`
          : "Unable to simulate execution cost",
    });
  }

  return {
    ...base,
    plannedNotionalUsd: planned,
    allowed: base.allowed && portfolioVerdict.allowed && executionAcceptable && planned > 0,
    checks: allChecks,
    portfolioAllowed: portfolioVerdict.allowed,
    executionAcceptable,
    simulatedFillPrice,
    impactPct,
    totalCostPct,
    portfolioChecks,
    riskState: portfolioVerdict.state,
  };
}

/**
 * Enter using enhanced gate. On success, portfolio is updated; risk state is returned
 * for the caller to persist (consecutive losses are updated only on exit).
 */
export function enterEnhancedPaperPosition(
  portfolio: PaperPortfolio,
  signal: OpportunitySignal,
  riskState: RiskState,
  limits: PortfolioRiskLimits = DEFAULT_PORTFOLIO_LIMITS,
  now = Date.now(),
): {
  portfolio: PaperPortfolio;
  verdict: EnhancedVerdict;
  riskState: RiskState;
  entered: boolean;
} {
  const verdict = evaluateEnhancedGate(signal, portfolio, riskState, limits, now);
  if (!verdict.allowed || !signal.metrics.priceUsd || verdict.plannedNotionalUsd <= 0) {
    return { portfolio, verdict, riskState: verdict.riskState, entered: false };
  }

  // Temporarily patch signal metrics price to simulated fill so entry uses realistic price.
  const fillPrice = verdict.simulatedFillPrice ?? signal.metrics.priceUsd;
  const adjusted: OpportunitySignal = {
    ...signal,
    metrics: { ...signal.metrics, priceUsd: fillPrice },
  };

  // Re-run base enter with adjusted price; base will re-evaluate gates (still pass).
  const { portfolio: next, entered } = enterPaperPosition(
    { ...portfolio, decisions: portfolio.decisions }, // decisions already have base; we replace below
    adjusted,
    now,
  );

  // Force the enhanced verdict into the decision log.
  const withVerdict: PaperPortfolio = {
    ...next,
    decisions: [verdict, ...portfolio.decisions].slice(0, 150),
  };

  return {
    portfolio: withVerdict,
    verdict,
    riskState: verdict.riskState,
    entered,
  };
}

/** Call after a paper trade is closed to update consecutive-loss / day P&L. */
export function onPaperTradeClosed(
  riskState: RiskState,
  pnlUsd: number,
  limits: PortfolioRiskLimits = DEFAULT_PORTFOLIO_LIMITS,
  now = Date.now(),
): RiskState {
  return recordTradeOutcome(riskState, pnlUsd, limits, now);
}
