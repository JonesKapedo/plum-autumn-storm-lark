/**
 * Portfolio-level risk engine for Monroe Sniper.
 * Complements per-idea gates with daily loss, drawdown, consecutive-loss,
 * cooldown, and a global kill switch. Pure functions — no side effects.
 */

export type RiskState = {
  /** Highest equity observed (for drawdown). */
  peakEquityUsd: number;
  /** Realized + unrealized P&L since UTC midnight (reset by caller on day change). */
  dayPnlUsd: number;
  /** Consecutive closed losing trades. */
  consecutiveLosses: number;
  /** Timestamp when trading was last paused by risk rules. */
  cooldownUntil: number | null;
  /** Operator or automatic kill switch. When true, new entries are blocked. */
  killSwitch: boolean;
  /** Human-readable reason the kill switch is on (if any). */
  killReason: string | null;
  /** Last time equity was marked. */
  lastMarkedAt: number;
};

export type PortfolioRiskLimits = {
  /** Max daily loss as fraction of starting-of-day equity (e.g. 0.05 = 5%). */
  maxDailyLossPct: number;
  /** Max peak-to-trough drawdown as fraction of peak equity. */
  maxDrawdownPct: number;
  /** Number of consecutive losses before a cooldown. */
  maxConsecutiveLosses: number;
  /** Cooldown duration in ms after consecutive-loss trigger. */
  cooldownMs: number;
  /** Hard floor: stop if equity falls below this absolute USD value. */
  minEquityUsd: number;
};

export const DEFAULT_PORTFOLIO_LIMITS: PortfolioRiskLimits = {
  maxDailyLossPct: 0.05,
  maxDrawdownPct: 0.15,
  maxConsecutiveLosses: 3,
  cooldownMs: 4 * 60 * 60 * 1000, // 4 hours
  minEquityUsd: 1_000,
};

export function createRiskState(startingEquity: number, now = Date.now()): RiskState {
  return {
    peakEquityUsd: Math.max(0, startingEquity),
    dayPnlUsd: 0,
    consecutiveLosses: 0,
    cooldownUntil: null,
    killSwitch: false,
    killReason: null,
    lastMarkedAt: now,
  };
}

export type PortfolioRiskCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type PortfolioRiskVerdict = {
  allowed: boolean;
  checks: PortfolioRiskCheck[];
  state: RiskState;
};

/**
 * Evaluate whether new entries are permitted given current equity and risk state.
 * Does not mutate; returns an updated state snapshot with peak / day tracking applied.
 */
export function evaluatePortfolioRisk(
  equityUsd: number,
  state: RiskState,
  limits: PortfolioRiskLimits = DEFAULT_PORTFOLIO_LIMITS,
  now = Date.now(),
): PortfolioRiskVerdict {
  const peak = Math.max(state.peakEquityUsd, equityUsd);
  const drawdownPct = peak > 0 ? (peak - equityUsd) / peak : 0;
  const dayLossPct =
    state.peakEquityUsd > 0 ? Math.max(0, -state.dayPnlUsd) / state.peakEquityUsd : 0;

  const inCooldown = state.cooldownUntil !== null && now < state.cooldownUntil;
  const cooldownRemainingMs = inCooldown ? (state.cooldownUntil! - now) : 0;

  const checks: PortfolioRiskCheck[] = [
    {
      id: "kill-switch",
      label: "Kill switch is off",
      pass: !state.killSwitch,
      detail: state.killSwitch
        ? `Kill switch active: ${state.killReason ?? "operator or automatic halt"}`
        : "Kill switch is off",
    },
    {
      id: "cooldown",
      label: "Not in consecutive-loss cooldown",
      pass: !inCooldown,
      detail: inCooldown
        ? `Cooldown active for ${Math.ceil(cooldownRemainingMs / 60_000)} more minute(s)`
        : "No active cooldown",
    },
    {
      id: "daily-loss",
      label: `Daily loss ≤ ${(limits.maxDailyLossPct * 100).toFixed(0)}%`,
      pass: dayLossPct <= limits.maxDailyLossPct + 1e-9,
      detail: `Day P&L ${state.dayPnlUsd.toFixed(2)}; loss ${((dayLossPct) * 100).toFixed(2)}% of peak`,
    },
    {
      id: "drawdown",
      label: `Drawdown ≤ ${(limits.maxDrawdownPct * 100).toFixed(0)}% of peak`,
      pass: drawdownPct <= limits.maxDrawdownPct + 1e-9,
      detail: `Peak ${peak.toFixed(2)}; equity ${equityUsd.toFixed(2)}; drawdown ${((drawdownPct) * 100).toFixed(2)}%`,
    },
    {
      id: "min-equity",
      label: `Equity ≥ $${limits.minEquityUsd.toLocaleString()}`,
      pass: equityUsd >= limits.minEquityUsd,
      detail: `Equity ${equityUsd.toFixed(2)}`,
    },
  ];

  const next: RiskState = {
    ...state,
    peakEquityUsd: peak,
    lastMarkedAt: now,
  };

  // Auto-arm kill switch on hard breaches (caller may still override).
  if (!next.killSwitch) {
    if (drawdownPct > limits.maxDrawdownPct) {
      next.killSwitch = true;
      next.killReason = `Max drawdown ${(limits.maxDrawdownPct * 100).toFixed(0)}% breached`;
    } else if (dayLossPct > limits.maxDailyLossPct) {
      next.killSwitch = true;
      next.killReason = `Daily loss limit ${(limits.maxDailyLossPct * 100).toFixed(0)}% breached`;
    } else if (equityUsd < limits.minEquityUsd) {
      next.killSwitch = true;
      next.killReason = `Equity below floor $${limits.minEquityUsd}`;
    }
  }

  // Re-evaluate kill-switch check after possible auto-arm.
  const killIdx = checks.findIndex(c => c.id === "kill-switch");
  if (killIdx >= 0) {
    checks[killIdx] = {
      id: "kill-switch",
      label: "Kill switch is off",
      pass: !next.killSwitch,
      detail: next.killSwitch
        ? `Kill switch active: ${next.killReason ?? "halt"}`
        : "Kill switch is off",
    };
  }

  return {
    allowed: checks.every(c => c.pass),
    checks,
    state: next,
  };
}

/** Record a closed trade P&L and update consecutive-loss / cooldown state. */
export function recordTradeOutcome(
  state: RiskState,
  pnlUsd: number,
  limits: PortfolioRiskLimits = DEFAULT_PORTFOLIO_LIMITS,
  now = Date.now(),
): RiskState {
  const consecutiveLosses = pnlUsd < 0 ? state.consecutiveLosses + 1 : 0;
  let cooldownUntil = state.cooldownUntil;
  if (consecutiveLosses >= limits.maxConsecutiveLosses) {
    cooldownUntil = now + limits.cooldownMs;
  }
  return {
    ...state,
    dayPnlUsd: state.dayPnlUsd + pnlUsd,
    consecutiveLosses,
    cooldownUntil,
    lastMarkedAt: now,
  };
}

/** Operator-controlled kill switch. */
export function setKillSwitch(state: RiskState, on: boolean, reason?: string): RiskState {
  return {
    ...state,
    killSwitch: on,
    killReason: on ? (reason ?? "Operator halt") : null,
  };
}

/** Reset daily P&L (call at UTC midnight or session start). */
export function resetDayPnl(state: RiskState, now = Date.now()): RiskState {
  return { ...state, dayPnlUsd: 0, lastMarkedAt: now };
}

/** Mark equity for peak tracking without evaluating gates. */
export function markEquity(state: RiskState, equityUsd: number, now = Date.now()): RiskState {
  return {
    ...state,
    peakEquityUsd: Math.max(state.peakEquityUsd, equityUsd),
    lastMarkedAt: now,
  };
}
