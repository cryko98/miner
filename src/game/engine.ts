// Pure, deterministic Gold Miner simulation.
//
// Rules for keeping this replayable on the server:
//  - fixed timestep (TICK_RATE ticks per second), no wall-clock time
//  - all randomness comes from the seeded Rng
//  - the only external influence is the ordered list of Inputs
//  - no rendering, no DOM, no floating-point-order dependent reductions
//    beyond simple arithmetic (which is IEEE-754 deterministic across JS engines)

import { Rng } from './rng';

export const TICK_RATE = 60;
export const WORLD_W = 800;
export const WORLD_H = 600;
export const PIVOT_X = 400;
export const PIVOT_Y = 88;
export const LEVEL_SECONDS = 60;
export const MAX_LEVELS = 5;
export const LEVEL_GOALS = [650, 1500, 2600, 4000, 5800];

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
  gone: boolean;
}

export interface ShopOffer {
  id: 'dynamite' | 'strength' | 'rockbook' | 'polish';
  price: number;
  sold: boolean;
}

export type InputAction = 'fire' | 'dynamite' | 'buy0' | 'buy1' | 'buy2' | 'next';

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

export interface Event {
  t: number;
  kind: 'collect' | 'dynamite' | 'levelup' | 'gameover' | 'win' | 'buy' | 'bag';
  value?: number;
}

export interface State {
  seed: number;
  tick: number;
  level: number; // 1-based
  levelTick: number;
  money: number;
  goal: number;
  items: Item[];
  hook: Hook;
  inv: { dynamite: number; strength: boolean; rockbook: boolean; polish: boolean };
  shop: ShopOffer[];
  phase: 'play' | 'shop' | 'over' | 'won';
  events: Event[];
}

export const OFFER_INFO: Record<ShopOffer['id'], { name: string; desc: string }> = {
  dynamite: { name: 'Dynamite', desc: 'Blow up a heavy rock while reeling it in. Press D.' },
  strength: { name: 'Strength Drink', desc: 'Reel in everything 2x faster this level.' },
  rockbook: { name: 'Rock Collector', desc: 'Rocks are worth 3x this level.' },
  polish: { name: 'Gold Polish', desc: 'Gold is worth 20% more this level.' },
};

function makeRng(seed: number, salt: number): Rng {
  return new Rng((seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0);
}

export function generateLevel(seed: number, level: number): Item[] {
  const rng = makeRng(seed, level * 7919);
  const items: Item[] = [];
  const goal = LEVEL_GOALS[level - 1];
  let goldTotal = 0;
  let id = 0;

  const place = (kind: ItemKind, r: number, value: number, weight: number): boolean => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = rng.range(40 + r, WORLD_W - 40 - r);
      const y = rng.range(170 + r, WORLD_H - 20 - r);
      let ok = true;
      for (const it of items) {
        const dx = it.x - x;
        const dy = it.y - y;
        if (dx * dx + dy * dy < (it.r + r + 14) * (it.r + r + 14)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        items.push({ id: id++, kind, x, y, r, value, weight, gone: false });
        return true;
      }
    }
    return false;
  };

  // Guarantee enough gold on the map to beat the goal with room to spare.
  const target = goal * 1.7;
  const bigCount = 1 + Math.min(level, 3);
  for (let i = 0; i < bigCount; i++) if (place('gold', 34, 250 + level * 30, 4)) goldTotal += 250 + level * 30;
  while (goldTotal < target) {
    const k = rng.next();
    if (k < 0.5) {
      if (place('gold', 11, 50, 1)) goldTotal += 50;
    } else if (k < 0.85) {
      if (place('gold', 19, 100, 2)) goldTotal += 100;
    } else {
      if (place('diamond', 9, 600, 1)) goldTotal += 600;
    }
    if (items.length > 40) break;
  }

  const rocks = 3 + rng.int(0, 2) + Math.floor(level / 2);
  for (let i = 0; i < rocks; i++) {
    if (rng.next() < 0.5) place('rock', 15, 11, 2.2);
    else place('rock', 27, 20, 3.6);
  }
  const bags = rng.int(1, 2);
  for (let i = 0; i < bags; i++) place('bag', 14, 0, 1.5);

  return items;
}

function generateShop(seed: number, level: number): ShopOffer[] {
  const rng = makeRng(seed, level * 104729 + 13);
  const pool: ShopOffer['id'][] = ['dynamite', 'strength', 'rockbook', 'polish'];
  const offers: ShopOffer[] = [];
  const count = 3;
  for (let i = 0; i < count; i++) {
    const idx = rng.int(0, pool.length - 1);
    const id = pool.splice(idx, 1)[0];
    const base = { dynamite: 200, strength: 300, rockbook: 250, polish: 400 }[id];
    const price = Math.round((base * rng.range(0.6, 1.3) * (1 + level * 0.25)) / 10) * 10;
    offers.push({ id, price, sold: false });
  }
  return offers;
}

export function createState(seed: number): State {
  return {
    seed,
    tick: 0,
    level: 1,
    levelTick: 0,
    money: 0,
    goal: LEVEL_GOALS[0],
    items: generateLevel(seed, 1),
    hook: { angle: 0, dir: 1, len: 0, phase: 'swing', grabbed: -1 },
    inv: { dynamite: 0, strength: false, rockbook: false, polish: false },
    shop: [],
    phase: 'play',
    events: [],
  };
}

export function hookTip(h: Hook): { x: number; y: number } {
  return { x: PIVOT_X + Math.sin(h.angle) * h.len, y: PIVOT_Y + Math.cos(h.angle) * h.len };
}

export function timeLeft(s: State): number {
  return Math.max(0, LEVEL_SECONDS - Math.floor(s.levelTick / TICK_RATE));
}

function itemValue(s: State, it: Item, rng: Rng): number {
  if (it.kind === 'bag') {
    const roll = rng.next();
    if (roll < 0.5) return rng.int(5, 30) * 10;
    if (roll < 0.8) return rng.int(30, 60) * 10;
    return rng.int(60, 100) * 10;
  }
  if (it.kind === 'rock' && s.inv.rockbook) return it.value * 3;
  if (it.kind === 'gold' && s.inv.polish) return Math.round(it.value * 1.2);
  return it.value;
}

function endLevel(s: State): void {
  if (s.money < s.goal) {
    s.phase = 'over';
    s.events.push({ t: s.tick, kind: 'gameover', value: s.money });
    return;
  }
  if (s.level >= MAX_LEVELS) {
    s.phase = 'won';
    s.events.push({ t: s.tick, kind: 'win', value: s.money });
    return;
  }
  s.phase = 'shop';
  s.shop = generateShop(s.seed, s.level);
  s.events.push({ t: s.tick, kind: 'levelup', value: s.level });
}

function startNextLevel(s: State): void {
  s.level += 1;
  s.levelTick = 0;
  s.goal = LEVEL_GOALS[s.level - 1];
  s.items = generateLevel(s.seed, s.level);
  s.hook = { angle: 0, dir: 1, len: 0, phase: 'swing', grabbed: -1 };
  // One-level consumables reset; dynamite carries over.
  s.inv.strength = false;
  s.inv.rockbook = false;
  s.inv.polish = false;
  s.phase = 'play';
}

function applyInput(s: State, a: InputAction): void {
  if (s.phase === 'play') {
    if (a === 'fire' && s.hook.phase === 'swing') {
      s.hook.phase = 'out';
    } else if (a === 'dynamite' && s.hook.phase === 'in' && s.hook.grabbed >= 0 && s.inv.dynamite > 0) {
      const it = s.items.find((i) => i.id === s.hook.grabbed);
      if (it) it.gone = true;
      s.hook.grabbed = -1;
      s.inv.dynamite -= 1;
      s.events.push({ t: s.tick, kind: 'dynamite' });
    }
  } else if (s.phase === 'shop') {
    if (a === 'next') {
      startNextLevel(s);
      return;
    }
    const idx = a === 'buy0' ? 0 : a === 'buy1' ? 1 : a === 'buy2' ? 2 : -1;
    if (idx < 0) return;
    const offer = s.shop[idx];
    if (!offer || offer.sold || s.money < offer.price) return;
    if (offer.id === 'dynamite') s.inv.dynamite += 1;
    else s.inv[offer.id] = true;
    offer.sold = true;
    s.money -= offer.price;
    s.events.push({ t: s.tick, kind: 'buy', value: offer.price });
  }
}

/** Advance the simulation by exactly one tick, applying the inputs scheduled for this tick first. */
export function step(s: State, inputs: InputAction[]): void {
  for (const a of inputs) applyInput(s, a);
  s.tick += 1;
  if (s.phase !== 'play') return;

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
    // Catch check
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
    if (h.grabbed >= 0) {
      const it = s.items.find((i) => i.id === h.grabbed);
      if (it) weight = it.weight;
      if (s.inv.strength) weight = Math.max(1, weight / 2);
    }
    h.len -= (RETRACT_SPEED / weight) * dt;
    if (h.grabbed >= 0) {
      const it = s.items.find((i) => i.id === h.grabbed);
      if (it) {
        const tip = hookTip(h);
        it.x = tip.x;
        it.y = tip.y;
      }
    }
    if (h.len <= 0) {
      h.len = 0;
      h.phase = 'swing';
      if (h.grabbed >= 0) {
        const it = s.items.find((i) => i.id === h.grabbed);
        if (it) {
          it.gone = true;
          const rng = makeRng(s.seed, s.tick);
          const v = itemValue(s, it, rng);
          s.money += v;
          s.events.push({ t: s.tick, kind: it.kind === 'bag' ? 'bag' : 'collect', value: v });
        }
        h.grabbed = -1;
      }
    }
  }

  s.levelTick += 1;
  const allGone = s.items.every((i) => i.gone);
  if (s.levelTick >= LEVEL_SECONDS * TICK_RATE || (allGone && h.phase === 'swing')) {
    endLevel(s);
  }
}

/**
 * Replay a full run from seed + inputs. This is what the server runs to
 * verify a submitted score: the client's own score is never trusted.
 */
export function simulate(seed: number, inputs: Input[], maxTicks = LEVEL_SECONDS * TICK_RATE * MAX_LEVELS + 10_000): State {
  const s = createState(seed);
  const sorted = [...inputs].sort((a, b) => a.t - b.t);
  let i = 0;
  let idleTicks = 0;
  while (s.phase === 'play' || s.phase === 'shop') {
    const now: InputAction[] = [];
    while (i < sorted.length && sorted[i].t <= s.tick) {
      now.push(sorted[i].a);
      i++;
    }
    if (s.phase === 'shop') {
      // The shop has no timer; stop if the replay never leaves it.
      if (now.length === 0) {
        idleTicks++;
        if (idleTicks > TICK_RATE * 120) break;
      } else idleTicks = 0;
    }
    step(s, now);
    if (s.tick > maxTicks) break;
  }
  return s;
}
