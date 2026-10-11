import { CONFIG } from './config';
import { Game, type RunResult } from './game/game';
import { hashSeed } from './game/rng';
import { Renderer } from './game/render';
import { createState, SHOTS } from './game/engine';
import { api, ApiError, hasToken, setToken, type ApiConfig, type Leaderboard, type Me } from './api';
import { connectWallet, listWallets, type ConnectedWallet } from './wallet';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---- Static links ----------------------------------------------------------
($('x-link') as HTMLAnchorElement).href = CONFIG.xUrl;
($('tg-link') as HTMLAnchorElement).href = CONFIG.telegramUrl;
$('shots-info').textContent = `${SHOTS} shots`;

let cfg: ApiConfig | null = null;
let me: Me | null = null;
let wallet: ConnectedWallet | null = null;
let lb: Leaderboard | null = null;

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}
function sol(n: number): string {
  return `${n.toFixed(n >= 1 ? 2 : 4)} SOL`;
}

// ---- Config from the API ---------------------------------------------------
async function loadConfig(): Promise<void> {
  try {
    cfg = await api.config();
  } catch {
    cfg = null;
  }
  const mint = cfg?.mint || CONFIG.contractAddress;
  const buyUrl = mint ? `https://pump.fun/coin/${mint}` : CONFIG.pumpFunUrl;
  for (const id of ['buy-top', 'buy-hero', 'pf-link']) ($(id) as HTMLAnchorElement).href = buyUrl;
  if (mint) $('ca').textContent = mint;
  const rw = cfg?.rewardWallet || CONFIG.rewardWallet;
  if (rw) {
    $('reward-wallet').innerHTML = `<a href="https://solscan.io/account/${rw}" target="_blank" rel="noopener">${short(rw)}</a>`;
  }
  const launched = !!mint;
  $('holder-state').textContent = launched
    ? 'Token is live — holder check is active.'
    : 'Pre-launch: anyone can play ranked until the token goes live.';
  $('holder-banner').classList.toggle('active', launched);
}
$('copy-ca').addEventListener('click', async () => {
  const mint = cfg?.mint || CONFIG.contractAddress;
  if (!mint) return;
  await navigator.clipboard.writeText(mint);
  $('copy-ca').textContent = '�s�';
  setTimeout(() => ($('copy-ca').textContent = '⧉'), 1200);
});

// ---- Live leaderboard + stats (polled) ------------------------------------
async function refreshLeaderboard(): Promise<void> {
  try {
    lb = await api.leaderboard();
  } catch {
    return;
  }
  $('stat-pool').textContent = sol(lb.poolSol);
  $('stat-epoch-pool').textContent = sol(lb.epochPoolSol);
  $('stat-paid').textContent = sol(lb.paidTotalSol);
  $('lb-epoch').textContent = `#${lb.epoch}`;
  $('lb-players').textContent = String(lb.players);
  $('lb-pool').textContent = sol(lb.epochPoolSol);
  const list = $('lb-list');
  if (lb.top.length === 0) {
    list.innerHTML = '<li class="lb-empty">No scores yet this round. Be the first!</li>';
  } else {
    list.innerHTML = lb.top
      .map((r) => {
        const mine = wallet && r.wallet === wallet.address ? ' me' : '';
        return `<li class="lb-row${mine}">
          <span class="lb-rank">${r.rank <= 3 ? ['dzA�', 'dzA?', 'dzA�'][r.rank - 1] : r.rank}</span>
          <a class="lb-wallet" href="https://solscan.io/account/${r.wallet}" target="_blank" rel="noopener" title="${r.wallet}">${short(r.wallet)}</a>
          <span class="lb-score">${r.score} pts</span>
          <span class="lb-est" title="${(r.share * 100).toFixed(1)}% of the pool">${r.estSol > 0 ? '~' + r.estSol.toFixed(4) : '—'}</span>
        </li>`;
      })
      .join('');
  }
}

function tickTimer(): void {
  const ms = (cfg?.epochMinutes ?? CONFIG.epochMinutes) * 60_000;
  const endsAt = lb?.endsAt ?? Math.ceil(Date.now() / ms) * ms;
  const left = Math.max(0, endsAt - Date.now());
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  $('stat-timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  // New round started: refresh immediately.
  if (left === 0 && lb) {
    lb = null;
    void refreshLeaderboard();
    void refreshMe();
  }
}

async function refreshPayouts(): Promise<void> {
  let data;
  try {
    data = await api.payouts();
  } catch {
    return;
  }
  const rows = $('payout-rows');
  if (data.items.length === 0) return;
  rows.innerHTML = data.items
    .map(
      (p) => `<tr>
        <td>#${p.epoch}</td>
        <td><a href="https://solscan.io/account/${p.wallet}" target="_blank" rel="noopener" title="${p.wallet}">${short(p.wallet)}</a></td>
        <td>${p.score} pts</td>
        <td class="sol-amt">${p.sol.toFixed(4)} SOL</td>
        <td><a href="https://solscan.io/tx/${p.tx}" target="_blank" rel="noopener">${p.tx.slice(0, 8)}… ↗</a></td>
      </tr>`,
    )
    .join('');
}

// ---- Wallet / auth ---------------------------------------------------------
const walletBtn = $('wallet-btn') as HTMLButtonElement;
const modal = $('wallet-modal');

function renderWalletState(): void {
  const status = $('wallet-status');
  const runs = $('runs-left');
  if (!me) {
    walletBtn.textContent = 'Connect wallet';
    status.textContent = 'Not connected — practice mode (score not ranked)';
    runs.hidden = true;
    $('start-text').textContent = 'Connect your wallet to play ranked, or start a practice run.';
    return;
  }
  walletBtn.textContent = short(me.wallet);
  runs.hidden = false;
  runs.textContent = `${me.runsLeft} ranked runs left this round`;
  if (me.launched && !me.holder) {
    status.innerHTML = `Connected ${short(me.wallet)} · <span class="warn">holds ${Math.floor(me.balance).toLocaleString()} $MINER — need ${(cfg?.minHold ?? 100000).toLocaleString()} to play ranked</span>`;
    $('start-text').textContent = 'You need 100,000 $MINER to play ranked. Practice is free.';
  } else {
    status.textContent = `Connected ${short(me.wallet)} · ranked mode${me.bestThisEpoch ? ` · best this round ${me.bestThisEpoch} pts` : ''}`;
    $('start-text').textContent = 'Ranked run: the server deals the map and verifies your replay.';
  }
}

async function refreshMe(): Promise<void> {
  if (!hasToken()) {
    me = null;
    renderWalletState();
    return;
  }
  try {
    me = await api.me();
  } catch {
    me = null;
  }
  renderWalletState();
}

async function login(w: ConnectedWallet): Promise<void> {
  const { message } = await api.nonce(w.address);
  const signature = await w.signMessage(message);
  const { token } = await api.verify(w.address, signature);
  setToken(token);
  wallet = w;
  await refreshMe();
  void refreshLeaderboard();
}

function openWalletModal(): void {
  const list = $('wallet-list');
  const wallets = listWallets();
  if (wallets.length === 0) {
    list.innerHTML = `<p class="muted">No Solana wallet detected. Install <a href="https://phantom.app" target="_blank" rel="noopener">Phantom</a> or <a href="https://solflare.com" target="_blank" rel="noopener">Solflare</a> and reload.</p>`;
  } else {
    list.innerHTML = '';
    for (const w of wallets) {
      const b = document.createElement('button');
      b.className = 'wallet-opt';
      b.innerHTML = `<img src="${w.icon}" alt="" /><span>${w.name}</span>`;
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const cw = await connectWallet(w);
          await login(cw);
          modal.hidden = true;
        } catch (e) {
          alert(`Could not connect: ${(e as Error).message}`);
        } finally {
          b.disabled = false;
        }
      });
      list.appendChild(b);
    }
  }
  modal.hidden = false;
}

walletBtn.addEventListener('click', async () => {
  if (me) {
    if (confirm('Disconnect wallet?')) {
      await wallet?.disconnect().catch(() => undefined);
      wallet = null;
      setToken(null);
      me = null;
      renderWalletState();
    }
    return;
  }
  openWalletModal();
});
$('wallet-close').addEventListener('click', () => (modal.hidden = true));
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.hidden = true;
});

// ---- Game ------------------------------------------------------------------
const canvas = $('game') as HTMLCanvasElement;
const overlay = $('overlay');
const bestEl = $('best');
const statusEl = $('status');

let best = 0;
try {
  best = Number(localStorage.getItem('miner-best') || 0);
} catch {
  /* ignore */
}
bestEl.textContent = `${best} pts`;

let game: Game | null = null;
new Renderer(canvas).draw(createState(hashSeed('idle')));

function showOverlay(title: string, text: string, buttons: { label: string; cls: string; onClick: () => void }[]): void {
  overlay.classList.add('open');
  overlay.innerHTML = `
    <div class="start">
      <img src="/logo.png" alt="" />
      <h3>${title}</h3>
      <p>${text}</p>
      <div class="start-btns"></div>
    </div>`;
  const wrap = overlay.querySelector('.start-btns')!;
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = `btn ${b.cls}`;
    el.textContent = b.label;
    el.addEventListener('click', b.onClick);
    wrap.appendChild(el);
  }
}

function endButtons(): { label: string; cls: string; onClick: () => void }[] {
  return [
    { label: '▶ Play ranked', cls: 'btn-primary', onClick: startRanked },
    { label: 'Practice', cls: 'btn-ghost', onClick: startPractice },
  ];
}

function beginGame(seed: number, onEnd: (r: RunResult) => void): void {
  game?.stop();
  overlay.classList.remove('open');
  overlay.innerHTML = '';
  game = new Game(canvas, seed, onEnd);
  game.start();
}

function startPractice(): void {
  statusEl.textContent = 'Practice run in progress';
  beginGame(hashSeed(`practice-${Date.now()}`), (r) => {
    if (r.score > best) {
      best = r.score;
      bestEl.textContent = `${best} pts`;
      try {
        localStorage.setItem('miner-best', String(best));
      } catch {
        /* ignore */
      }
    }
    statusEl.textContent = `Practice run: ${r.score} pts`;
    showOverlay('Run over', `You scored <b>${r.score} pts</b> in practice. Best: ${best} pts.`, endButtons());
  });
}

async function startRanked(): Promise<void> {
  if (!me) {
    openWalletModal();
    return;
  }
  let session;
  try {
    session = await api.startRun();
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : 'Could not start a ranked run.';
    showOverlay('Not available', msg, endButtons());
    if (e instanceof ApiError && e.status === 401) await refreshMe();
    return;
  }
  statusEl.textContent = `Ranked run · round #${session.epoch}`;
  void refreshMe();
  beginGame(session.seed, async (r) => {
    statusEl.textContent = 'Verifying run on server…';
    showOverlay('Verifying…', `You scored <b>${r.score} pts</b>. Sending your replay to the server for verification.`, []);
    try {
      const res = await api.submitRun(session.sessionId, r.inputs);
      statusEl.textContent = `Ranked run verified: ${res.score} pts`;
      showOverlay(
        res.rank && res.rank <= 10 ? `#${res.rank} on the leaderboard!` : 'Run verified',
        `Server-verified score: <b>${res.score} pts</b>. Your best this round: <b>${res.best} pts</b>${res.rank ? ` (rank #${res.rank})` : ''}.`,
        endButtons(),
      );
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Submission failed.';
      statusEl.textContent = msg;
      showOverlay('Run not counted', msg, endButtons());
    }
    void refreshLeaderboard();
    void refreshMe();
  });
}

$('start-ranked').addEventListener('click', startRanked);
$('start-practice').addEventListener('click', startPractice);

// ---- Boot ------------------------------------------------------------------
void (async () => {
  await loadConfig();
  await Promise.all([refreshLeaderboard(), refreshPayouts(), refreshMe()]);
  tickTimer();
  setInterval(tickTimer, 1000);
  setInterval(refreshLeaderboard, 5000);
  setInterval(refreshPayouts, 30000);
})();
