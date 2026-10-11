// Epoch settlement: called by an external scheduler every 15 minutes
// (a couple of minutes after the boundary so late submissions are in).
//
// Pool for an epoch = PAYOUT_PCT % of the reward wallet balance at settlement
// time (default 5%). This spreads whatever creator fees were deposited over
// many rounds instead of dumping the wallet in one go, and refills naturally
// whenever more fees are claimed into the wallet.

import { getStore } from './store';
import { KEYS, TOP_N, epochEnd, epochOf, payoutPct } from './epoch';
import { isHolder, rewardKeypair, rewardWalletBalanceSol, sendSol } from './solana';

const GRACE_MS = 90_000;
const FEE_RESERVE_SOL = 0.01;
const MIN_PAYOUT_SOL = 0.0005;

export interface PayoutResult {
  epoch: number;
  status: 'paid' | 'skipped' | 'empty' | 'already' | 'not-ready' | 'no-wallet';
  poolSol?: number;
  payouts?: { wallet: string; sol: number; tx?: string; error?: string }[];
}

export async function runPayout(): Promise<PayoutResult> {
  const store = getStore();
  const now = Date.now();
  // Latest epoch that is fully closed (plus grace).
  let epoch = epochOf(now) - 1;
  if (now - epochEnd(epoch) < GRACE_MS) epoch -= 1;
  if (epoch < 0) return { epoch, status: 'not-ready' };

  if (!rewardKeypair()) return { epoch, status: 'no-wallet' };

  // Lock so two overlapping cron hits can't pay the same epoch twice.
  const locked = await store.setNx(KEYS.epochPaid(epoch), { startedAt: now }, 7 * 24 * 3600);
  if (!locked) return { epoch, status: 'already' };

  const top = await store.ztop(KEYS.leaderboard(epoch), TOP_N);
  if (top.length === 0) {
    await store.set(KEYS.epochPaid(epoch), { status: 'empty', at: now }, 7 * 24 * 3600);
    return { epoch, status: 'empty' };
  }

  const balance = await rewardWalletBalanceSol();
  const pool = Math.max(0, (balance - FEE_RESERVE_SOL) * (payoutPct() / 100));
  if (pool < MIN_PAYOUT_SOL) {
    await store.set(KEYS.epochPaid(epoch), { status: 'skipped', at: now, balance }, 7 * 24 * 3600);
    return { epoch, status: 'skipped', poolSol: pool };
  }

  // Re-check holder status at payout time: dumping right after playing forfeits the reward.
  const eligible: { wallet: string; score: number }[] = [];
  for (const r of top) {
    const h = await isHolder(r.member).catch(() => ({ ok: false, balance: 0 }));
    if (h.ok) eligible.push({ wallet: r.member, score: r.score });
  }
  const totalScore = eligible.reduce((a, r) => a + r.score, 0);
  const payouts: PayoutResult['payouts'] = [];
  let paidSum = 0;

  for (const r of eligible) {
    const sol = Math.floor(((pool * r.score) / totalScore) * 1e6) / 1e6;
    if (sol < MIN_PAYOUT_SOL) continue;
    try {
      const tx = await sendSol(r.wallet, sol);
      payouts.push({ wallet: r.wallet, sol, tx });
      paidSum += sol;
      await store.lpush(KEYS.payouts, { epoch, wallet: r.wallet, sol, tx, score: r.score, at: Date.now() }, 200);
    } catch (e) {
      payouts.push({ wallet: r.wallet, sol, error: (e as Error).message });
    }
  }

  const prev = (await store.get<number>(KEYS.paidTotal)) ?? 0;
  await store.set(KEYS.paidTotal, Math.round((prev + paidSum) * 1e6) / 1e6);
  await store.set(KEYS.epochPaid(epoch), { status: 'paid', at: Date.now(), pool, payouts }, 7 * 24 * 3600);
  await store.set(KEYS.epochResult(epoch), { top, pool, payouts }, 7 * 24 * 3600);
  return { epoch, status: 'paid', poolSol: pool, payouts };
}
