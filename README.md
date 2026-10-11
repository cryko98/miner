# Gold Miner ($MINER) — Play-to-Earn on Solana

The classic Gold Miner game as a Solana memecoin project. pump.fun creator rewards fund a
reward wallet; every **15 minutes** the top 10 players split a slice of it in SOL, proportionally
to score. Holders only: 100,000 $MINER required to play ranked.

## Status

- [x] Landing page + playable Gold Miner (25 shots per run, continuous gold/rock spawning)
- [x] Wallet login (Wallet Standard: Phantom, Solflare, Backpack…) via signed message
- [x] Server-issued seeds, server-side replay verification, bot filters
- [x] Live leaderboard (polled every 5 s), one entry per wallet (best score), 5 runs per round
- [x] Payout job: top 10 proportional split, on-chain SOL transfers, public payout log with Solscan links
- [x] Holder check (100k $MINER) — activates automatically when `TOKEN_MINT` is set
- [ ] Production env (Upstash Redis, RPC, reward wallet, cron) — see below

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` serves the API too (`/api/*`) with an in-memory store, so the full ranked flow works
without any external service. Copy `.env.example` to `.env` to test against real Redis / RPC.

## Deploy (Vercel)

1. Import the repo on Vercel (framework: Vite). Every `/api/*` request is rewritten (`vercel.json`) to the single
   `api/index.ts` function with the sub-path in `?path=`.
2. Add **Upstash Redis** from the Vercel Marketplace (Storage tab) — it injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
3. Set env vars (see `.env.example`): `AUTH_SECRET`, `CRON_SECRET`, `SOLANA_RPC_URL` (Helius recommended),
   `REWARD_WALLET_SECRET` (base58 secret key of the **reward** wallet — a dedicated wallet, never the creator wallet),
   `PAYOUT_PCT` (default 5), and at launch `TOKEN_MINT`.
4. Schedule the payout job every 15 minutes with an external cron (cron-job.org, GitHub Actions…),
   at minutes **2, 17, 32, 47** so late submissions are included:
   `POST https://<domain>/api/cron/payout` with header `Authorization: Bearer <CRON_SECRET>`.

## How a ranked run works

1. `POST /api/run/start` — checks holder status and the 5-runs-per-round cap, issues a session id + random seed.
2. The browser plays the deterministic engine (`src/game/engine.ts`) and records inputs as `{tick, action}`.
3. `POST /api/run/submit` — the server replays the inputs through the same engine and computes the score.
   Rejected: replays of a used session, runs finishing faster than real time, inputs faster than a human tap,
   perfectly periodic firing. The client's own score is never read.
4. Score is written to the round's sorted set with `ZADD GT` — a wallet keeps only its best score.

## Payout model

| | |
|---|---|
| Round | 15 min, aligned to the clock |
| Winners | top 10 by best run; pool split proportionally to score |
| Pool per round | `PAYOUT_PCT`% (default 5%) of the reward wallet balance at settlement |
| Eligibility | ≥ 100,000 $MINER at play time **and** at payout time |
| Runs per wallet per round | 5 |
| Creator reward split | 70% → reward wallet · 20% buyback/marketing · 10% infra |

## Config

Env vars control the backend (`.env.example`). Social links live in `src/config.ts`.
