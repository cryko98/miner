import type { Input } from './game/engine';

export interface ApiConfig {
  mint: string;
  launched: boolean;
  minHold: number;
  rewardWallet: string;
  epochMinutes: number;
  topN: number;
  runsPerEpoch: number;
  shots: number;
  payoutPct: number;
  persistent: boolean;
}
export interface LeaderboardRow {
  rank: number;
  wallet: string;
  score: number;
  share: number;
  estSol: number;
}
export interface Leaderboard {
  epoch: number;
  endsAt: number;
  players: number;
  poolSol: number;
  epochPoolSol: number;
  paidTotalSol: number;
  top: LeaderboardRow[];
}
export interface Payout {
  epoch: number;
  wallet: string;
  sol: number;
  tx: string;
  score: number;
  at: number;
}
export interface Me {
  wallet: string;
  holder: boolean;
  balance: number;
  launched: boolean;
  runsLeft: number;
  bestThisEpoch: number;
  epoch: number;
}

let token: string | null = null;
try {
  token = localStorage.getItem('miner-token');
} catch {
  /* ignore */
}

export function setToken(t: string | null): void {
  token = t;
  try {
    if (t) localStorage.setItem('miner-token', t);
    else localStorage.removeItem('miner-token');
  } catch {
    /* ignore */
  }
}
export function hasToken(): boolean {
  return !!token;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== 'auth/verify') setToken(null);
    throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  config: () => call<ApiConfig>('GET', 'config'),
  leaderboard: () => call<Leaderboard>('GET', 'leaderboard'),
  payouts: () => call<{ items: Payout[]; totalSol: number }>('GET', 'payouts'),
  nonce: (wallet: string) => call<{ nonce: string; message: string }>('POST', 'auth/nonce', { wallet }),
  verify: (wallet: string, signature: string) => call<{ token: string }>('POST', 'auth/verify', { wallet, signature }),
  me: () => call<Me>('GET', 'me'),
  startRun: () => call<{ sessionId: string; seed: number; epoch: number; endsAt: number; runsLeft: number }>('POST', 'run/start'),
  submitRun: (sessionId: string, inputs: Input[]) =>
    call<{ score: number; best: number; rank: number | null; epoch: number }>('POST', 'run/submit', { sessionId, inputs }),
};
