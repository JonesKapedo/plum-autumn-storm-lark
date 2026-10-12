import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateImpactPct, simulateExecution, sizeFromLossBudget } from "./execution-sim.ts";

describe("execution-sim", () => {
  it("estimates higher impact for thin pools", () => {
    const thin = estimateImpactPct(1_000, 5_000);
    const deep = estimateImpactPct(1_000, 500_000);
    assert.ok(thin > deep);
    assert.ok(thin <= 0.5);
  });

  it("rejects trades when total cost exceeds budget", () => {
    const result = simulateExecution({
      side: "buy",
      notionalUsd: 5_000,
      midPriceUsd: 1,
      liquidityUsd: 8_000, // very thin relative to size
      maxCostPct: 0.03,
    });
    assert.equal(result.acceptable, false);
    assert.ok(result.reasons.length > 0);
  });

  it("accepts reasonable trades in deep liquidity", () => {
    const result = simulateExecution({
      side: "buy",
      notionalUsd: 500,
      midPriceUsd: 1,
      liquidityUsd: 250_000,
      gasUsd: 1,
      maxCostPct: 0.05,
    });
    assert.equal(result.acceptable, true);
    assert.ok(result.fillPriceUsd > 1);
    assert.ok(result.qty > 0);
  });

  it("buy fill price is above mid; sell is below", () => {
    const buy = simulateExecution({
      side: "buy",
      notionalUsd: 100,
      midPriceUsd: 10,
      liquidityUsd: 50_000,
    });
    const sell = simulateExecution({
      side: "sell",
      notionalUsd: 100,
      midPriceUsd: 10,
      liquidityUsd: 50_000,
    });
    assert.ok(buy.fillPriceUsd > 10);
    assert.ok(sell.fillPriceUsd < 10);
  });

  it("sizeFromLossBudget returns positive notional for sane inputs", () => {
    const n = sizeFromLossBudget(100, 0.08, 100_000);
    assert.ok(n > 0);
    assert.ok(n < 5_000); // should be constrained by stop + costs
  });
});
