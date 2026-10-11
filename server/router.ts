// Framework-agnostic API router. Used by the Vercel function (api/[...path].ts)
// and by the Vite dev-server middleware so local dev needs no extra tooling.

import { randomBytes, randomInt } from 'node:crypto';
import { getStore, isPersistent, StoreNotConfigured } from './store';
import { EPOCH_MS, KEYS, RUNS_PER_EPOCH, TOP_N, epochEnd, epochOf, payoutPct } from './epoch';
import { issueNonce, isValidWallet, loginMessage, verifyLogin, verifyToken } from './auth';
import { MIN_HOLD_TOKENS, isHolder, rewardWalletAddress, rewardWalletBalanceSol, tokenMint } from './solana';
import { simulateDetailed, SHOTS, TICK_RATE, MAX_TICKS, type Input } from '../src/game/engine';
import { runPayout } from './payout';

export interface ApiRequest {
  method: string;
  path: string; // e.g. "leaderboard" or "run/start"
  body: unknown;
  headers: Record<string, string | undefined>;
}
export interface ApiResponse {
  status: number;
  body: unknown;
}

const SESSION_TTL_SEC = 15 * 60;
const MIN_INPUT_GAP_TICKS = 5; // ~83 ms — faster than any human double-tap
const MAX_INPUTS = 400;

interface Session {
  id: string;
  wallet: string;
  seed: number;
  epoch: number;
  startedAt: number;
  done?: boolean;
}

interface PayoutRecord {
  epoch: number;
  wallet: string;
  sol: number;
  tx: string;
  score: number;
  at: number;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });
const err = (status: number, error: string): ApiResponse => json(status, { error });

function auth(req: ApiRequest): string | null {
  const h = req.headers.authorization || '';
  return verifyToken(h.startsWith('Bearer ') ? h.slice(7) : undefined);
}

// Cheap in-process cache for the pool figure (RPC call).
let poolCache: { at: number; sol: number } | undefined;
async function poolSol(): Promise<number> {
  if (poolCache && Date.now() - poolCache.at < 30_000) return poolCache.sol;
  let sol = 0;
  try {
    sol = await rewardWalletBalanceSol();
  } catch {
    sol = poolCache?.sol ?? 0;
  }
  poolCache = { at: Date.now(), sol };
  return sol;
}

export async function handle(req: ApiRequest): Promise<ApiResponse> {
  const { method, path } = req;
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    const store = getStore();
    // ---- public --------------------------------------------------------
    if (method === 'GET' && path === 'config') {
      const mint = tokenMint();
      return json(200, {
        mint,
        launched: !!mint,
        minHold: MIN_HOLD_TOKENS,
        rewardWallet: rewardWalletAddress(),
        epochMinutes: EPOCH_MS / 60000,
        topN: TOP_N,
        runsPerEpoch: RUNS_PER_EPOCH,
        shots: SHOTS,
        payoutPct: payoutPct(),
        persistent: isPersistent(),
      });
    }

    if (method === 'GET' && path === 'leaderboard') {
      const epoch = epochOf();
      const [top, players, pool, paidTotal] = await Promise.all([
        store.ztop(KEYS.leaderboard(epoch), TOP_N),
        store.zcard(KEYS.leaderboard(epoch)),
        poolSol(),
        store.get<number>(KEYS.paidTotal),
      ]);
      const totalScore = top.reduce((a, r) => a + r.score, 0);
      const epochPool = (pool * payoutPct()) / 100;
      return json(200, {
        epoch,
        endsAt: epochEnd(epoch),
        players,
        poolSol: pool,
        epochPoolSol: epochPool,
        paidTotalSol: paidTotal ?? 0,
        top: top.map((r, i) => ({
          rank: i + 1,
          wallet: r.member,
          score: r.score,
          share: totalScore > 0 ? r.score / totalScore : 0,
          estSol: totalScore > 0 ? (epochPool * r.score) / totalScore : 0,
        })),
      });
    }

    if (method === 'GET' && path === 'payouts') {
      const items = await store.lrange<PayoutRecord>(KEYS.payouts, 0, 29);
      const total = (await store.get<number>(KEYS.paidTotal)) ?? 0;
      return json(200, { items, totalSol: total });
    }

    // ---- auth ----------------------------------------------------------
    if (method === 'POST' && path === 'auth/nonce') {
      const wallet = body.wallet;
      if (!isValidWallet(wallet)) return err(400, 'invalid wallet');
      const nonce = await issueNonce(wallet);
      return json(200, { nonce, message: loginMessage(wallet, nonce) });
    }

    if (method === 'POST' && path === 'auth/verify') {
      const { wallet, signature } = body;
      if (!isValidWallet(wallet) || typeof signature !== 'string') return err(400, 'bad request');
      const token = await verifyLogin(wallet, signature);
      if (!token) return err(401, 'signature verification failed');
      return json(200, { token, wallet });
    }

    // ---- authenticated ------------------------------------------------
    const wallet = auth(req);
    if (!wallet) return err(401, 'login required');

    if (method === 'GET' && path === 'me') {
      const epoch = epochOf();
      const [holder, runs, best] = await Promise.all([
        isHolder(wallet).catch(() => ({ ok: false, balance: 0 })),
        store.get<number>(KEYS.runs(epoch, wallet)),
        store.zscore(KEYS.leaderboard(epoch), wallet),
      ]);
      return json(200, {
        wallet,
        holder: holder.ok,
        balance: holder.balance,
        launched: !!tokenMint(),
        runsLeft: Math.max(0, RUNS_PER_EPOCH - (runs ?? 0)),
        bestThisEpoch: best ?? 0,
        epoch,
      });
    }

    if (method === 'POST' && path === 'run/start') {
      const epoch = epochOf();
      const holder = await isHolder(wallet).catch(() => ({ ok: false, balance: 0 }));
      if (!holder.ok) return err(403, `You need at least ${MIN_HOLD_TOKENS.toLocaleString()} $MINER to play ranked.`);
      // Don't start a run that can't finish before the epoch closes.
      if (epochEnd(epoch) - Date.now() < 20_000) return err(409, 'Round is closing — wait for the next one.');
      const runs = await store.incr(KEYS.runs(epoch, wallet), 2 * 3600);
      if (runs > RUNS_PER_EPOCH) return err(429, `Run limit reached for this round (${RUNS_PER_EPOCH}). Next round starts soon.`);
      const session: Session = {
        id: randomBytes(16).toString('hex'),
        wallet,
        seed: randomInt(0, 0xffffffff),
        epoch,
        startedAt: Date.now(),
      };
      await store.set(KEYS.session(session.id), session, SESSION_TTL_SEC);
      return json(200, { sessionId: session.id, seed: session.seed, epoch, endsAt: epochEnd(epoch), runsLeft: RUNS_PER_EPOCH - runs });
    }

    if (method === 'POST' && path === 'run/submit') {
      const sessionId = body.sessionId;
      if (typeof sessionId !== 'string' || !/^[a-f0-9]{32}$/.test(sessionId)) return err(400, 'bad session');
      const session = await store.get<Session>(KEYS.session(sessionId));
      if (!session || session.wallet !== wallet) return err(404, 'session not found');
      if (session.done) return err(409, 'run already submitted');

      const inputs = parseInputs(body.inputs);
      if (!inputs) return err(400, 'bad inputs');

      // Mark the session consumed first so a replayed request can't double-submit.
      await store.set(KEYS.session(sessionId), { ...session, done: true }, SESSION_TTL_SEC);

      const { state: result, reactionDelays } = simulateDetailed(session.seed, inputs);
      const reason = antiBot(inputs, reactionDelays, result.tick, Date.now() - session.startedAt);
      if (reason) return err(422, `Run rejected: ${reason}`);

      // Score lands in the epoch the run started in. A run that ends shortly
      // after the boundary still counts; the payout job waits a grace period.
      const nowEpoch = epochOf();
      if (nowEpoch > session.epoch && Date.now() - epochEnd(session.epoch) > 90_000) {
        return err(410, 'Round already closed');
      }
      await store.zaddMax(KEYS.leaderboard(session.epoch), result.money, wallet, 24 * 3600);
      const best = await store.zscore(KEYS.leaderboard(session.epoch), wallet);
      const top = await store.ztop(KEYS.leaderboard(session.epoch), 100);
      const rank = top.findIndex((r) => r.member === wallet) + 1;
      return json(200, { score: result.money, best: best ?? result.money, rank: rank || null, epoch: session.epoch });
    }

    // ---- cron (external scheduler, every 15 min) ------------------------
    if (method === 'POST' && path === 'cron/payout') {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers.authorization !== `Bearer ${secret}`) return err(401, 'unauthorized');
      const out = await runPayout();
      return json(200, out);
    }

    return err(404, 'not found');
  } catch (e) {
    if (e instanceof StoreNotConfigured) return err(503, e.message);
    console.error('[api]', path, e);
    return err(500, 'internal error');
  }
}

function parseInputs(raw: unknown): Input[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_INPUTS) return null;
  const out: Input[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') return null;
    const { t, a } = x as { t: unknown; a: unknown };
    if (!Number.isInteger(t) || (t as number) < 0 || (t as number) > MAX_TICKS) return null;
    if (a !== 'fire' && a !== 'dynamite') return null;
    out.push({ t: t as number, a });
  }
  return out;
}

/**
 * Heuristics that a real browser session passes trivially but a script does not.
 * Returns a rejection reason or null.
 */
function antiBot(inputs: Input[], reactionDelays: number[], ticks: number, elapsedMs: number): string | null {
  // 1. Can't finish faster than real time (the sim runs at 60 Hz wall clock).
  const simMs = (ticks / TICK_RATE) * 1000;
  if (elapsedMs < simMs * 0.9 - 1500) return 'finished faster than real time';
  const sorted = [...inputs].sort((a, b) => a.t - b.t);
  // 2. Inputs can't be closer together than a human can tap.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].t - sorted[i - 1].t < MIN_INPUT_GAP_TICKS) return 'inhuman input timing';
  }
  // 3. Reaction time (hook ready → fire) with near-zero variance is a script.
  //    A human aiming at different targets varies by hundreds of ms.
  if (reactionDelays.length >= 8) {
    const mean = reactionDelays.reduce((a, b) => a + b, 0) / reactionDelays.length;
    const sd = Math.sqrt(reactionDelays.reduce((a, g) => a + (g - mean) * (g - mean), 0) / reactionDelays.length);
    if (sd < 3) return 'robotic input pattern';
  }
  return null;
}
