/**
 * Deterministic market-event replay scaffolding.
 * Records candidate scores / security results and can walk them in time order
 * so paper strategies can be evaluated without idealized fills.
 */

import type { OpportunitySignal } from "../data/market-sources";
import type { ExecutionSimResult } from "./execution-sim";
import { simulateExecution } from "./execution-sim";

export type MarketTick = {
  at: number;
  tokenId: string;
  priceUsd: number;
  liquidityUsd: number | null;
};

export type SignalSnapshot = {
  at: number;
  signal: OpportunitySignal;
};

export type ReplayEvent =
  | { kind: "tick"; tick: MarketTick }
  | { kind: "signal"; snapshot: SignalSnapshot }
  | { kind: "fill"; at: number; tokenId: string; sim: ExecutionSimResult; side: "buy" | "sell" };

export type ReplayLog = {
  version: 1;
  events: ReplayEvent[];
};

export function createReplayLog(): ReplayLog {
  return { version: 1, events: [] };
}

export function recordTick(log: ReplayLog, tick: MarketTick): ReplayLog {
  return { ...log, events: [...log.events, { kind: "tick", tick }] };
}

export function recordSignal(log: ReplayLog, signal: OpportunitySignal, at = Date.now()): ReplayLog {
  return {
    ...log,
    events: [...log.events, { kind: "signal", snapshot: { at, signal } }],
  };
}

/** Sort events chronologically for deterministic replay. */
export function sortedEvents(log: ReplayLog): ReplayEvent[] {
  return [...log.events].sort((a, b) => {
    const ta =
      a.kind === "tick" ? a.tick.at : a.kind === "signal" ? a.snapshot.at : a.at;
    const tb =
      b.kind === "tick" ? b.tick.at : b.kind === "signal" ? b.snapshot.at : b.at;
    return ta - tb;
  });
}

/**
 * Walk ticks and, when a signal is present, produce a simulated buy fill
 * using the execution simulator. Useful for offline evaluation of paper strategies.
 */
export function replayWithSimulatedEntries(
  log: ReplayLog,
  notionalUsd: number,
  feeRate = 0.003,
): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  const lastPrice = new Map<string, { price: number; liq: number | null }>();

  for (const ev of sortedEvents(log)) {
    out.push(ev);
    if (ev.kind === "tick") {
      lastPrice.set(ev.tick.tokenId, {
        price: ev.tick.priceUsd,
        liq: ev.tick.liquidityUsd,
      });
    } else if (ev.kind === "signal") {
      const m = lastPrice.get(ev.snapshot.signal.id);
      const mid = m?.price ?? ev.snapshot.signal.metrics.priceUsd;
      if (mid && mid > 0) {
        const sim = simulateExecution({
          side: "buy",
          notionalUsd,
          midPriceUsd: mid,
          liquidityUsd: m?.liq ?? ev.snapshot.signal.metrics.liquidityUsd,
          feeRate,
        });
        out.push({
          kind: "fill",
          at: ev.snapshot.at,
          tokenId: ev.snapshot.signal.id,
          sim,
          side: "buy",
        });
      }
    }
  }
  return out;
}
