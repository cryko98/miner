// Browser-side game controller: runs the deterministic engine at a fixed
// tick rate, records every input with its tick (the replay that is sent to
// the server for verification), and drives the renderer.

import { State, Input, InputAction, createState, step, hookTip, TICK_RATE } from './engine';
import { Renderer } from './render';

export interface RunResult {
  seed: number;
  score: number;
  ticks: number;
  inputs: Input[];
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
  private onKey = (e: KeyboardEvent): void => {
    if (!this.running) return;
    if (e.code === 'Space' || e.code === 'ArrowDown') {
      e.preventDefault();
      this.queue('fire');
    } else if (e.code === 'KeyD') {
      this.queue('dynamite');
    }
  };
  private onPointer = (e: Event): void => {
    e.preventDefault();
    this.queue('fire');
  };

  constructor(
    private canvas: HTMLCanvasElement,
    private seed: number,
    private onEnd: (r: RunResult) => void,
  ) {
    this.state = createState(seed);
    this.renderer = new Renderer(canvas);
  }

  start(): void {
    this.running = true;
    this.canvas.addEventListener('pointerdown', this.onPointer);
    window.addEventListener('keydown', this.onKey);
    this.last = performance.now();
    this.loop(this.last);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointer);
    window.removeEventListener('keydown', this.onKey);
  }

  queue(a: InputAction): void {
    if (!this.running) return;
    // Basic client-side debounce; the server applies its own stricter checks.
    const now = performance.now();
    if (now - this.lastInputAt < 40) return;
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
      if (this.state.phase === 'over') {
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
      const tip = hookTip(s.hook);
      if (ev.kind === 'collect' || ev.kind === 'bag') {
        this.renderer.flash(tip.x - 20, Math.max(110, tip.y), `+${ev.value}`, ev.kind === 'bag' ? '#9ff3ff' : '#ffe34d');
      } else if (ev.kind === 'dynamite') {
        this.renderer.flash(tip.x - 20, tip.y, 'BOOM', '#ff5a3c');
      }
    }
  }

  private finish(): void {
    this.stop();
    this.renderer.draw(this.state);
    const s = this.state;
    this.onEnd({ seed: this.seed, score: s.money, ticks: s.tick, inputs: this.inputs });
  }
}
