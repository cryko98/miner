import { CONFIG } from './config';
import { Game } from './game/game';
import { hashSeed } from './game/rng';
import { Renderer } from './game/render';
import { createState } from './game/engine';

// ---- Links & contract address -------------------------------------------
const buyUrl = CONFIG.contractAddress ? `https://pump.fun/coin/${CONFIG.contractAddress}` : CONFIG.pumpFunUrl;
for (const id of ['buy-top', 'buy-hero', 'pf-link']) {
  const el = document.getElementById(id) as HTMLAnchorElement | null;
  if (el) el.href = buyUrl;
}
(document.getElementById('x-link') as HTMLAnchorElement).href = CONFIG.xUrl;
(document.getElementById('tg-link') as HTMLAnchorElement).href = CONFIG.telegramUrl;

const caEl = document.getElementById('ca')!;
if (CONFIG.contractAddress) caEl.textContent = CONFIG.contractAddress;
if (CONFIG.rewardWallet) document.getElementById('reward-wallet')!.textContent = CONFIG.rewardWallet;
document.getElementById('copy-ca')!.addEventListener('click', async () => {
  if (!CONFIG.contractAddress) return;
  await navigator.clipboard.writeText(CONFIG.contractAddress);
  const b = document.getElementById('copy-ca')!;
  b.textContent = '✓';
  setTimeout(() => (b.textContent = '⧉'), 1200);
});

// ---- Payout countdown (client-side preview of the 15 minute epoch) ------
const timerEl = document.getElementById('stat-timer')!;
function tickTimer(): void {
  const ms = CONFIG.epochMinutes * 60_000;
  const left = ms - (Date.now() % ms);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
tickTimer();
setInterval(tickTimer, 1000);

// ---- Game -----------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const bestEl = document.getElementById('best')!;
const statusEl = document.getElementById('status')!;

let best = 0;
try {
  best = Number(localStorage.getItem('miner-best') || 0);
} catch {
  /* storage unavailable */
}
bestEl.textContent = `$${best}`;

let game: Game | null = null;

// Draw an idle map behind the start overlay instead of a black box.
new Renderer(canvas, '/logo.png').draw(createState(hashSeed('idle')));

function showStart(title: string, text: string, label: string): void {
  overlay.classList.add('open');
  overlay.innerHTML = `
    <div class="start">
      <img src="/logo.png" alt="" />
      <h3>${title}</h3>
      <p>${text}</p>
      <button class="btn btn-primary" id="start-btn">${label}</button>
    </div>`;
  document.getElementById('start-btn')!.addEventListener('click', startRun);
}

function startRun(): void {
  game?.stop();
  overlay.classList.remove('open');
  overlay.innerHTML = '';
  // Practice mode: seed comes from the clock. In P2E mode the server issues
  // the seed together with a session id, so the client can't pick a map.
  const seed = hashSeed(`practice-${Date.now()}`);
  statusEl.textContent = 'Practice mode · run in progress';
  game = new Game(canvas, overlay, seed, {
    onEnd(r) {
      if (r.score > best) {
        best = r.score;
        bestEl.textContent = `$${best}`;
        try {
          localStorage.setItem('miner-best', String(best));
        } catch {
          /* ignore */
        }
      }
      statusEl.textContent = `Practice mode · last run $${r.score} · ${r.inputs.length} inputs recorded`;
      showStart(
        r.won ? 'You cleared all 5 levels! 🏆' : `Game over on level ${r.level}`,
        `You mined <b>$${r.score}</b>. ${r.won ? 'Legendary.' : 'Goal not reached in time.'} Best: $${best}`,
        '▶ Play again',
      );
    },
  });
  game.start();
}

document.getElementById('start-btn')!.addEventListener('click', startRun);
