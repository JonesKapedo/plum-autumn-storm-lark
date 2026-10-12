# Monroe Sniper Roadmap

## Current status (2026-10-11)

Paper-only trading desk + market-intelligence scanner with risk-gated simulated entries/exits.
No live orders, no background service, no on-chain event stream.

## Phase 1 — Finish the paper-trading foundation

| Item | Status |
|------|--------|
| Market discovery (DexScreener) + dual security providers | Done |
| Fail-closed risk gate (score, security, liquidity, slots, exposure) | Done |
| Paper position lifecycle (stop, scale-out, trailing, time, liquidity-drop) | Done |
| Portfolio-level loss protection (daily loss, max drawdown, kill switch, consecutive-loss cooldown) | **Added** (`src/lib/trading/portfolio-risk.ts`) |
| Execution-cost simulator (slippage, fees, price impact, size-from-loss-budget) | **Added** (`src/lib/trading/execution-sim.ts`) |
| Canonical ledger types (accounts, orders, fills, positions, events) | **Added** (`src/lib/trading/ledger.ts`) |
| Deterministic replay scaffolding | **Added** (`src/lib/trading/replay.ts`) |
| Wire portfolio risk + execution sim into Scanner paper gate / UI | Remaining |
| Unify stock-desk + Scanner portfolios onto ledger | Remaining |
| Historical market-data recording store | Remaining |
| Broader tests (stale prices, correlated losses, interrupted monitoring) | Partial (unit tests for new modules) |

## Phase 2 — Real-time sniping engine

- [ ] Continuously running backend worker (UI-independent)
- [ ] On-chain event listener for **one** chain first
- [ ] Launch / liquidity-pool discovery pipeline
- [ ] Faster security evaluation queue
- [ ] Testnet / fork execution adapter
- [ ] Persistent event + signal + execution logs

## Phase 3 — Real-money execution (strict controls)

- [ ] Chain-specific execution adapter + **server-side** signing
- [ ] Transaction simulation before submit
- [ ] Fill confirmation + position reconciliation
- [ ] Emergency controls + operator alerts (Telegram etc.)
- [ ] Explicit trading enablement flag and capital limits (disabled by default)

## Phase 4 — Expand strategies and venues

- [ ] Additional chains / DEXs
- [ ] CEX adapters
- [ ] Independent strategy modules (shared risk engine)
- [ ] Out-of-sample / walk-forward backtests before capital

## Explicitly out of scope until later

Live mainnet trading, client-side private keys, full Solana security+execution path, futures/perps.

## How to integrate the new modules

```ts
import { evaluatePortfolioRisk, createRiskState, recordTradeOutcome } from "./trading/portfolio-risk";
import { simulateExecution, sizeFromLossBudget } from "./trading/execution-sim";
import { createEmptyLedger, createPaperAccount } from "./trading/ledger";
import { createReplayLog, recordSignal, replayWithSimulatedEntries } from "./trading/replay";
```

1. Keep a `RiskState` beside the paper portfolio; call `evaluatePortfolioRisk` before `enterPaperPosition`.
2. Call `simulateExecution` with planned notional + pool liquidity; reject if `!acceptable`.
3. Prefer `sizeFromLossBudget` over pure %-of-equity when stop distance is known.
4. Persist `RiskState` + ledger events with the paper book (localStorage or backend).
