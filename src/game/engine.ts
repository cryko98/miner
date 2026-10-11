// Pure, deterministic Gold Miner simulation.
//
// Rules for keeping this replayable on the server:
//  - fixed timestep (TICK_RATE ticks per second), no wall-clock time
//  - all randomness comes from the seeded Rng
//  - the only external influence is the ordered list of Inputs
//  - no rendering, no DOM
//
// A run: the player has SHOTS hook drops (and a time cap as a safety net).
// Gold and rocks keep spawning at random intervals so the map never runs
// dry but never gets crowded either. Score = money collected.

import { Rng } from './rng';

export const TICK_RATE = 60;
export const WORLD_W = 800;
export const WORLD_H = 600;
export const PIVOT_X = 400;
export const PIVOT_Y = 92;
export const SHOTS = 25;
export const START_DYNAMITE = 2;
export const TIME_CAP_SECONDS = 120;
export const MAX_TICKS = TIME_CAP_SECONDS * TICK_RATE;

const MIN_ITEMS = 9;
const MAX_ITEMS = 15;
const SPAWN_GAP_MIN = 40; // ticks
const SPAWN_GAP_MAX = 110;

const SWING_SPEED = 1.9; // rad/s
const SWING_LIMIT = (80 * Math.PI) / 180;
const EXTEND_SPEED = 420; // px/s
const RETRACT_SPEED = 420; // px/s, divided by weight

export type ItemKind = 'gold' | 'rock' | 'diamond' | 'bag';

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  r: number;
  value: number;
  weight: number;
  born: number; // tick it appeared (for the pop-in animation)
  gone: boolean;
}

export type InputAction = 'fire' | 'dynamite';

export interface Input {
  t: number; // absolute tick at which the input is applied
  a: InputAction;
}

export interface Hook {
  angle: number; // radians, 0 = straight down, positive = towards right
  dir: 1 | -1;
  len: number;
  phase: 'swing' | 'out' | 'in';
  grabbed: number; // item id or -1
}

export interface GameEvent {
  t: number;
  kind: 'collect' | 'bag' | 'dynamite' | 'end';
  value?: number;
}

export interface State {
  seed: number;
  tick: number;
  money: number;
  shots: number;
  dynamite: number;
  items: Item[];
  hook: Hook;
  nextId: number;
  nextSpawn: number;
  phase: 'play' | 'over';
  events: GameEvent[];
}

function makeRng(seed: number, salt: number): Rng {
  return new Rng((seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0);
}

interface Template {
  kind: ItemKind;
  r: number;
  value: number;
  weight: number;
  w: number; // spawn weight
}

const TEMPLATES: Template[] = [
  { kind: 'gold', r: 11, value: 50, weight: 1, w: 32 },
  { kind: 'gold', r: 19, value: 100, weight: 2, w: 24 },
  { kind: 'gold', r: 34, value: 300, weight: 4, w: 9 },
  { kind: 'rock', r: 15, value: 11, weight: 2.2, w: 15 },
  { kind: 'rock', r: 27, value: 20, weight: 3.6, w: 9 },
  { kind: 'diamond', r: 9, value: 500, weight: 1, w: 5 },
  { kind: 'bag', r: 14, value: 0, weight: 1.5, w: 6 },
];
const TEMPLATE_TOTAL = TEMPLATES.reduce((a, t) => a + t.w, 0);

function pickTemplate(rng: Rng): Template {
  let x = rng.next() * TEMPLATE_TOTAL;
  for (const t of TEMPLATES) {
    x -= t.w;
    if (x <= 0) return t;
  }
  return TEMPLATES[0];
}

/** Try to spawn one item at a free spot. Returns false if no room was found. */
function spawn(s: State, rng: Rng): boolean {
  const t = pickTemplate(rng);
  const r = t.r;
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = rng.range(40 + r, WORLD_W - 40 - r);
    const y = rng.range(175 + r, WORLD_H - 20 - r);
    let ok = true;
    for (const it of s.items) {
      if (it.gone) continue;
      const dx = it.x - x;
      const dy = it.y - y;
      const min = it.r + r + 16;
      if (dx * dx + dy * dy < min * min) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // Keep new items away from the hook's current line so they don't pop in on top of it.
    if (s.hook.phase !== 'swing') {
      const tip = hookTip(s.hook);
      const dx = tip.x - x;
      const dy = tip.y - y;
      if (dx * dx + dy * dy < (r + 60) * (r + 60)) continue;
    }
    s.items.push({ id: s.nextId++, kind: t.kind, x, y, r, value: t.value, weight: t.weight, born: s.tick, gone: false });
    return true;
  }
  return false;
}

export function createState(seed: number): State {
  const s: State = {
    seed,
    tick: 0,
    money: 0,
    shots: SHOTS,
    dynamite: START_DYNAMITE,
    items: [],
    hook: { angle: 0, dir: 1, len: 0, phase: 'swing', grabbed: -1 },
    nextId: 0,
    nextSpawn: 0,
    phase: 'play',
    events: [],
  };
  const rng = makeRng(seed, 0);
  for (let i = 0; i < 11; i++) spawn(s, rng);
  s.nextSpawn = rng.int(SPAWN_GAP_MIN, SPAWN_GAP_MAX);
  return s;
}

export function hookTip(h: Hook): { x: number; y: number } {
  return { x: PIVOT_X + Math.sin(h.angle) * h.len, y: PIVOT_Y + Math.cos(h.angle) * h.len };
}

export function timeLeft(s: State): number {
  return Math.max(0, TIME_CAP_SECONDS - Math.floor(s.tick / TICK_RATE));
}

function itemValue(it: Item, rng: Rng): number {
  if (it.kind !== 'bag') return it.value;
  const roll = rng.next();
  if (roll < 0.5) return rng.int(5, 30) * 10;
  if (roll < 0.8) return rng.int(30, 60) * 10;
  return rng.int(60, 100) * 10;
}

function applyInput(s: State, a: InputAction): void {
  if (a === 'fire' && s.hook.phase === 'swing' && s.shots > 0) {
    s.hook.phase = 'out';
    s.shots -= 1;
  } else if (a === 'dynamite' && s.hook.phase === 'in' && s.hook.grabbed >= 0 && s.dynamite > 0) {
    const it = s.items.find((i) => i.id === s.hook.grabbed);
    if (it) it.gone = true;
    s.hook.grabbed = -1;
    s.dynamite -= 1;
    s.events.push({ t: s.tick, kind: 'dynamite' });
  }
}

function endRun(s: State): void {
  s.phase = 'over';
  s.events.push({ t: s.tick, kind: 'end', value: s.money });
}

/** Advance the simulation by exactly one tick, applying the inputs scheduled for this tick first. */
export function step(s: State, inputs: InputAction[]): void {
  if (s.phase !== 'play') return;
  for (const a of inputs) applyInput(s, a);
  s.tick += 1;

  const dt = 1 / TICK_RATE;
  const h = s.hook;

  if (h.phase === 'swing') {
    h.angle += h.dir * SWING_SPEED * dt;
    if (h.angle > SWING_LIMIT) {
      h.angle = SWING_LIMIT;
      h.dir = -1;
    } else if (h.angle < -SWING_LIMIT) {
      h.angle = -SWING_LIMIT;
      h.dir = 1;
    }
  } else if (h.phase === 'out') {
    h.len += EXTEND_SPEED * dt;
    const tip = hookTip(h);
    for (const it of s.items) {
      if (it.gone) continue;
      const dx = it.x - tip.x;
      const dy = it.y - tip.y;
      if (dx * dx + dy * dy <= (it.r + 6) * (it.r + 6)) {
        h.grabbed = it.id;
        h.phase = 'in';
        break;
      }
    }
    if (h.phase === 'out' && (tip.x < 0 || tip.x > WORLD_W || tip.y > WORLD_H)) {
      h.phase = 'in';
    }
  } else {
    let weight = 1;
    const grabbed = h.grabbed >= 0 ? s.items.find((i) => i.id === h.grabbed) : undefined;
    if (grabbed) weight = grabbed.weight;
    h.len -= (RETRACT_SPEED / weight) * dt;
    if (grabbed) {
      const tip = hookTip(h);
      grabbed.x = tip.x;
      grabbed.y = tip.y;
    }
    if (h.len <= 0) {
      h.len = 0;
      h.phase = 'swing';
      if (grabbed) {
        grabbed.gone = true;
        const v = itemValue(grabbed, makeRng(s.seed, s.tick));
        s.money += v;
        s.events.push({ t: s.tick, kind: grabbed.kind === 'bag' ? 'bag' : 'collect', value: v });
      }
      h.grabbed = -1;
    }
  }

  // Drop collected items from the array so it never grows unbounded.
  if (s.tick % 300 === 0) s.items = s.items.filter((i) => !i.gone);

  // Continuous spawning: keep the field between MIN_ITEMS and MAX_ITEMS.
  const active = s.items.reduce((n, i) => (i.gone ? n : n + 1), 0);
  if (s.tick >= s.nextSpawn || active < MIN_ITEMS) {
    const rng = makeRng(s.seed, s.tick);
    if (active < MAX_ITEMS) spawn(s, rng);
    s.nextSpawn = s.tick + rng.int(SPAWN_GAP_MIN, SPAWN_GAP_MAX);
  }

  if ((s.shots === 0 && h.phase === 'swing') || s.tick >= MAX_TICKS) {
    endRun(s);
  }
}

/**
 * Replay a full run from seed + inputs. This is what the server runs to
 * verify a submitted score: the client's own score is never trusted.
 */
export function simulate(seed: number, inputs: Input[]): State {
  const s = createState(seed);
  const sorted = [...inputs].sort((a, b) => a.t - b.t);
  let i = 0;
  while (s.phase === 'play') {
    const now: InputAction[] = [];
    while (i < sorted.length && sorted[i].t <= s.tick) {
      now.push(sorted[i].a);
      i++;
    }
    step(s, now);
  }
  return s;
}
