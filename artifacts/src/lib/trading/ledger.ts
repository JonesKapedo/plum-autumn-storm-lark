/**
 * Canonical trading ledger types.
 * Intended as the single source of truth for accounts, orders, fills, and positions
 * once the original stock desk and the Scanner paper book are unified.
 * Browser storage may cache presentation data; the ledger is the authority.
 */

export type InstrumentId = string; // e.g. "ethereum:0xabc..." or "equity:AAPL"

export type Account = {
  id: string;
  label: string;
  currency: "USD";
  cash: number;
  /** Peak equity for drawdown tracking. */
  peakEquity: number;
  createdAt: number;
  updatedAt: number;
};

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";
export type OrderStatus =
  | "pending"
  | "submitted"
  | "partial"
  | "filled"
  | "cancelled"
  | "rejected"
  | "expired";

export type Order = {
  id: string;
  clientOrderId: string; // idempotency key
  accountId: string;
  instrumentId: InstrumentId;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice: number | null;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number | null;
  strategyId: string | null;
  createdAt: number;
  updatedAt: number;
  rejectReason: string | null;
};

export type Fill = {
  id: string;
  orderId: string;
  instrumentId: InstrumentId;
  side: OrderSide;
  qty: number;
  price: number;
  feeUsd: number;
  gasUsd: number;
  executedAt: number;
  source: "paper" | "testnet" | "live";
};

export type Position = {
  id: string;
  accountId: string;
  instrumentId: InstrumentId;
  qty: number;
  avgEntryPrice: number;
  realizedPnlUsd: number;
  openedAt: number;
  updatedAt: number;
  strategyId: string | null;
  stopPrice: number | null;
  targetPrice: number | null;
};

export type LedgerEvent =
  | { type: "order_created"; at: number; order: Order }
  | { type: "order_updated"; at: number; order: Order }
  | { type: "fill"; at: number; fill: Fill }
  | { type: "position_opened"; at: number; position: Position }
  | { type: "position_closed"; at: number; position: Position; reason: string }
  | { type: "cash_adjust"; at: number; accountId: string; delta: number; reason: string }
  | { type: "risk_halt"; at: number; reason: string }
  | { type: "risk_resume"; at: number };

export type Ledger = {
  version: 1;
  accounts: Account[];
  orders: Order[];
  fills: Fill[];
  positions: Position[];
  events: LedgerEvent[];
};

export function createEmptyLedger(): Ledger {
  return {
    version: 1,
    accounts: [],
    orders: [],
    fills: [],
    positions: [],
    events: [],
  };
}

export function createPaperAccount(id = "paper-main", cash = 25_000, now = Date.now()): Account {
  return {
    id,
    label: "Paper",
    currency: "USD",
    cash,
    peakEquity: cash,
    createdAt: now,
    updatedAt: now,
  };
}

/** Append an event, keeping a bounded history. */
export function appendEvent(ledger: Ledger, event: LedgerEvent, maxEvents = 2_000): Ledger {
  return {
    ...ledger,
    events: [event, ...ledger.events].slice(0, maxEvents),
  };
}
