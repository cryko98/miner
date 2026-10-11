// 15-minute epochs aligned to the wall clock. Epoch id = floor(now / 15 min).

export const EPOCH_MS = 15 * 60 * 1000;
export const TOP_N = 10;
export const RUNS_PER_EPOCH = 5;

export function epochOf(ms = Date.now()): number {
  return Math.floor(ms / EPOCH_MS);
}

export function epochStart(epoch: number): number {
  return epoch * EPOCH_MS;
}

export function epochEnd(epoch: number): number {
  return (epoch + 1) * EPOCH_MS;
}

/** Percent of the reward wallet balance distributed per epoch (env PAYOUT_PCT, default 5). */
export function payoutPct(): number {
  const p = Number(process.env.PAYOUT_PCT ?? 5);
  return Number.isFinite(p) && p > 0 && p <= 100 ? p : 5;
}

export const KEYS = {
  leaderboard: (epoch: number) => `lb:${epoch}`,
  runs: (epoch: number, wallet: string) => `runs:${epoch}:${wallet}`,
  session: (id: string) => `sess:${id}`,
  nonce: (wallet: string) => `nonce:${wallet}`,
  payouts: 'payouts',
  paidTotal: 'paid:total',
  epochPaid: (epoch: number) => `paid:${epoch}`,
  epochResult: (epoch: number) => `result:${epoch}`,
};
