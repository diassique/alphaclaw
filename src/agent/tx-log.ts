/**
 * In-memory ring buffer for transaction log entries.
 * Stores the last MAX_ENTRIES x402 payment transactions for the live feed.
 */

const MAX_ENTRIES = 50;

export interface TxEntry {
  timestamp: string;
  service: string;
  fromAddr: string;
  toAddr: string;
  amount: string;
  txHash?: string;
  network: string;
  status: "paid" | "demo" | "failed";
}

const buffer: TxEntry[] = [];

export function recordTx(entry: TxEntry): void {
  buffer.unshift(entry);
  if (buffer.length > MAX_ENTRIES) buffer.length = MAX_ENTRIES;
}

export function getRecentTxs(limit = 20): TxEntry[] {
  return buffer.slice(0, Math.min(limit, MAX_ENTRIES));
}
