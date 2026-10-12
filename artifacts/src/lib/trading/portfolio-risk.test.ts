import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createRiskState,
  evaluatePortfolioRisk,
  recordTradeOutcome,
  setKillSwitch,
  resetDayPnl,
  DEFAULT_PORTFOLIO_LIMITS,
} from "./portfolio-risk.ts";

describe("portfolio-risk", () => {
  it("allows entries when healthy", () => {
    const state = createRiskState(25_000);
    const v = evaluatePortfolioRisk(25_000, state);
    assert.equal(v.allowed, true);
    assert.equal(v.checks.every(c => c.pass), true);
  });

  it("blocks when kill switch is on", () => {
    let state = createRiskState(25_000);
    state = setKillSwitch(state, true, "manual");
    const v = evaluatePortfolioRisk(25_000, state);
    assert.equal(v.allowed, false);
    assert.ok(v.checks.some(c => c.id === "kill-switch" && !c.pass));
  });

  it("auto-arms kill switch on max drawdown", () => {
    const state = createRiskState(25_000);
    // Equity down 20% from peak → exceeds 15% default
    const v = evaluatePortfolioRisk(20_000, state);
    assert.equal(v.allowed, false);
    assert.equal(v.state.killSwitch, true);
    assert.ok(v.state.killReason?.includes("drawdown"));
  });

  it("tracks consecutive losses and sets cooldown", () => {
    let state = createRiskState(25_000);
    const limits = { ...DEFAULT_PORTFOLIO_LIMITS, maxConsecutiveLosses: 2, cooldownMs: 60_000 };
    state = recordTradeOutcome(state, -100, limits, 1_000);
    state = recordTradeOutcome(state, -50, limits, 2_000);
    assert.equal(state.consecutiveLosses, 2);
    assert.equal(state.cooldownUntil, 2_000 + 60_000);

    const v = evaluatePortfolioRisk(24_850, state, limits, 2_500);
    assert.equal(v.allowed, false);
    assert.ok(v.checks.some(c => c.id === "cooldown" && !c.pass));
  });

  it("resets consecutive losses on a win", () => {
    let state = createRiskState(25_000);
    state = recordTradeOutcome(state, -10);
    state = recordTradeOutcome(state, 20);
    assert.equal(state.consecutiveLosses, 0);
  });

  it("resetDayPnl clears day P&L", () => {
    let state = createRiskState(25_000);
    state = recordTradeOutcome(state, -200);
    assert.equal(state.dayPnlUsd, -200);
    state = resetDayPnl(state);
    assert.equal(state.dayPnlUsd, 0);
  });
});
