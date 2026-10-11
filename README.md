# Gold Miner ($MINER) — Play-to-Earn on Solana

The classic Gold Miner game as a Solana memecoin project. pump.fun creator rewards fund a
reward pool; every **15 minutes** the top 10 players split the pool in SOL, proportionally to score.

## Status

- [x] Phase 1 — landing page + playable Gold Miner (practice mode)
- [ ] Phase 2 — wallet connect, server-side replay verification, leaderboard
- [ ] Phase 3 — 100k $MINER hold check, 15-minute epochs, automatic SOL payouts, public payout log

## Run locally

```bash
npm install
npm run dev
```

## How the anti-cheat works

The game engine (`src/game/engine.ts`) is a pure, deterministic simulation: fixed 60 Hz timestep,
seeded PRNG, no wall-clock. The browser only records *inputs* (`{tick, action}`) — it never reports
a score. The server regenerates the level from the seed it issued, replays the inputs through the
same engine and computes the score itself. Impossible input timings, duplicate replays and
bot-like patterns are rejected before a run can enter the leaderboard.

## Reward model

| | |
|---|---|
| Epoch | 15 minutes |
| Winners | top 10 by best run score, pool split proportionally to score |
| Eligibility | wallet holds ≥ 100,000 $MINER at play time and at payout |
| Runs per wallet per epoch | 5 |
| Creator reward split | 70% players · 20% buyback/marketing · 10% infra |

## Config

Token address, links and reward wallet live in `src/config.ts`.
