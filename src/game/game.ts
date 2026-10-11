// Browser-side game controller: runs the deterministic engine at a fixed
// tick rate, records every input with its tick (the replay that will be
// sent to the server for verification), and drives the renderer + shop UI.

import {
  State,
  Input,
  InputAction,
  createState,
  step,
  hookTip,
  TICK_RATE,
  OFFER_INFO,
  MAX_LEVELS,
  LEVEL_GOALS,
} from './engine';
import { Renderer } from './render';

export interface GameCallbacks {
  onEnd(result: { seed: number; score: number; won: boolean; level: number; inputs: Input[] }): void;
}

export class Game {
  private state: State;
  private inputs: Input[] = [];
  private pending: InputAction[] = [];
  private renderer: Renderer;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private seenEvents = 0;
  private lastInputAt = 0;
  private overlay: HTMLElement;

  constructor(
    private canvas: HTMLCanvasElement,
    overlay: HTMLElement,
    private seed: number,
    private cb: GameCallbacks,
  ) {
    this.overlay = overlay;
    this.state = createState(seed);
    this.renderer = new Renderer(canvas, '/logo.png');
    this.bind();
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    this.loop(this.last);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private bind(): void {
    const fire = (e: Event) => {
      e.preventDefault();
      this.queue('fire');
    };
    this.canvas.addEventListener('pointerdown', fire);
    window.addEventListener('keydown', (e) => {
      if (!this.running) return;
      if (e.code === 'Space' || e.code === 'ArrowDown') {
        e.preventDefault();
        this.queue('fire');
      } else if (e.code === 'KeyD') {
        this.queue('dynamite');
      }
    });
  }

  queue(a: InputAction): void {
    if (!this.running) return;
    // Basic client-side debounce; the server applies its own stricter checks.
    const now = performance.now();
    if (a === 'fire' && now - this.lastInputAt < 40) return;
    this.lastInputAt = now;
    this.pending.push(a);
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    const dtMs = Math.min(now - this.last, 250);
    this.last = now;
    this.acc += dtMs / 1000;
    const dt = 1 / TICK_RATE;
    while (this.acc >= dt) {
      const actions = this.pending;
      this.pending = [];
      for (const a of actions) this.inputs.push({ t: this.state.tick, a });
      step(this.state, actions);
      this.acc -= dt;
      this.handleEvents();
      if (this.state.phase === 'over' || this.state.phase === 'won') {
        this.finish();
        return;
      }
    }
    this.renderer.draw(this.state);
    this.raf = requestAnimationFrame(this.loop);
  };

  private handleEvents(): void {
    const s = this.state;
    for (; this.seenEvents < s.events.length; this.seenEvents++) {
      const ev = s.events[this.seenEvents];
      if (ev.kind === 'collect' || ev.kind === 'bag') {
        const tip = hookTip(s.hook);
        this.renderer.flash(tip.x - 20, Math.max(110, tip.y), `+$${ev.value}`, ev.kind === 'bag' ? '#9ff3ff' : '#ffe34d');
      } else if (ev.kind === 'dynamite') {
        const tip = hookTip(s.hook);
        this.renderer.flash(tip.x - 20, tip.y, 'BOOM', '#ff5a3c');
      } else if (ev.kind === 'levelup') {
        this.showShop();
      }
    }
  }

  private showShop(): void {
    const s = this.state;
    const o = this.overlay;
    o.innerHTML = '';
    o.classList.add('open');
    const box = document.createElement('div');
    box.className = 'shop';
    box.innerHTML = `
      <h3>Level ${s.level} cleared!</h3>
      <p class="shop-money">You have <b>$${s.money}</b>. Next goal: <b>$${s.goal < 0 ? 0 : LEVEL_GOAL(s.level + 1)}</b></p>
      <div class="offers"></div>
      <button class="btn btn-primary next">Next level ▶</button>
    `;
    const offers = box.querySelector('.offers') as HTMLElement;
    const render = () => {
      offers.innerHTML = '';
      s.shop.forEach((offer, i) => {
        const info = OFFER_INFO[offer.id];
        const el = document.createElement('button');
        el.className = 'offer' + (offer.sold ? ' sold' : '');
        el.disabled = offer.sold || s.money < offer.price;
        el.innerHTML = `<span class="offer-icon">${ICONS[offer.id]}</span><span class="offer-name">${info.name}</span><span class="offer-desc">${info.desc}</span><span class="offer-price">${offer.sold ? 'Bought' : '$' + offer.price}</span>`;
        el.addEventListener('click', () => {
          const before = s.money;
          this.applyNow(('buy' + i) as InputAction);
          if (s.money !== before) {
            (box.querySelector('.shop-money b') as HTMLElement).textContent = `$${s.money}`;
            render();
          }
        });
        offers.appendChild(el);
      });
    };
    render();
    box.querySelector('.next')!.addEventListener('click', () => {
      o.classList.remove('open');
      o.innerHTML = '';
      this.applyNow('next');
    });
    o.appendChild(box);
  }

  /** Apply an input immediately (shop has no timer, so no need to wait for a tick). */
  private applyNow(a: InputAction): void {
    this.inputs.push({ t: this.state.tick, a });
    step(this.state, [a]);
  }

  private finish(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.renderer.draw(this.state);
    const s = this.state;
    this.cb.onEnd({ seed: this.seed, score: s.money, won: s.phase === 'won', level: s.level, inputs: this.inputs });
  }
}

function LEVEL_GOAL(level: number): number {
  return level > MAX_LEVELS ? 0 : LEVEL_GOALS[level - 1];
}

const ICONS: Record<string, string> = {
  dynamite: '🧨',
  strength: '🥤',
  rockbook: '📘',
  polish: '✨',
};
