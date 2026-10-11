// Storage layer. Production uses Upstash Redis (Vercel Marketplace); when the
// env vars are missing (local dev) an in-memory store with the same shape is
// used so the whole flow can be exercised without any external service.

import { Redis } from '@upstash/redis';

export interface Store {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  /** Set only if the key does not exist. Returns true if it was set. */
  setNx(key: string, value: unknown, ttlSec?: number): Promise<boolean>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSec?: number): Promise<number>;
  /** Add member to sorted set, keeping the greater score if it already exists. */
  zaddMax(key: string, score: number, member: string, ttlSec?: number): Promise<void>;
  zscore(key: string, member: string): Promise<number | null>;
  /** Top N members, highest score first. */
  ztop(key: string, n: number): Promise<{ member: string; score: number }[]>;
  zcard(key: string): Promise<number>;
  lpush(key: string, value: unknown, keep: number): Promise<void>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
}

class RedisStore implements Store {
  constructor(private r: Redis) {}
  async get<T>(key: string): Promise<T | null> {
    return (await this.r.get<T>(key)) ?? null;
  }
  async set(key: string, value: unknown, ttlSec?: number): Promise<void> {
    if (ttlSec) await this.r.set(key, value, { ex: ttlSec });
    else await this.r.set(key, value);
  }
  async setNx(key: string, value: unknown, ttlSec?: number): Promise<boolean> {
    const res = ttlSec ? await this.r.set(key, value, { nx: true, ex: ttlSec }) : await this.r.set(key, value, { nx: true });
    return res === 'OK';
  }
  async del(key: string): Promise<void> {
    await this.r.del(key);
  }
  async incr(key: string, ttlSec?: number): Promise<number> {
    const n = await this.r.incr(key);
    if (n === 1 && ttlSec) await this.r.expire(key, ttlSec);
    return n;
  }
  async zaddMax(key: string, score: number, member: string, ttlSec?: number): Promise<void> {
    await this.r.zadd(key, { gt: true }, { score, member });
    if (ttlSec) await this.r.expire(key, ttlSec);
  }
  async zscore(key: string, member: string): Promise<number | null> {
    return await this.r.zscore(key, member);
  }
  async ztop(key: string, n: number): Promise<{ member: string; score: number }[]> {
    const raw = await this.r.zrange<(string | number)[]>(key, 0, n - 1, { rev: true, withScores: true });
    const out: { member: string; score: number }[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) out.push({ member: String(raw[i]), score: Number(raw[i + 1]) });
    return out;
  }
  async zcard(key: string): Promise<number> {
    return await this.r.zcard(key);
  }
  async lpush(key: string, value: unknown, keep: number): Promise<void> {
    await this.r.lpush(key, value);
    await this.r.ltrim(key, 0, keep - 1);
  }
  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    return await this.r.lrange<T>(key, start, stop);
  }
}

class MemoryStore implements Store {
  private kv = new Map<string, { v: unknown; exp: number }>();
  private z = new Map<string, Map<string, number>>();
  private lists = new Map<string, unknown[]>();

  private live(key: string): { v: unknown; exp: number } | undefined {
    const e = this.kv.get(key);
    if (e && e.exp && e.exp < Date.now()) {
      this.kv.delete(key);
      return undefined;
    }
    return e;
  }
  async get<T>(key: string): Promise<T | null> {
    return (this.live(key)?.v as T) ?? null;
  }
  async set(key: string, value: unknown, ttlSec?: number): Promise<void> {
    this.kv.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
  }
  async setNx(key: string, value: unknown, ttlSec?: number): Promise<boolean> {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSec);
    return true;
  }
  async del(key: string): Promise<void> {
    this.kv.delete(key);
  }
  async incr(key: string, ttlSec?: number): Promise<number> {
    const n = Number(this.live(key)?.v ?? 0) + 1;
    if (n === 1) await this.set(key, n, ttlSec);
    else this.kv.get(key)!.v = n;
    return n;
  }
  async zaddMax(key: string, score: number, member: string): Promise<void> {
    let m = this.z.get(key);
    if (!m) this.z.set(key, (m = new Map()));
    const prev = m.get(member);
    if (prev === undefined || score > prev) m.set(member, score);
  }
  async zscore(key: string, member: string): Promise<number | null> {
    return this.z.get(key)?.get(member) ?? null;
  }
  async ztop(key: string, n: number): Promise<{ member: string; score: number }[]> {
    const m = this.z.get(key);
    if (!m) return [];
    return [...m.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => b.score - a.score || a.member.localeCompare(b.member))
      .slice(0, n);
  }
  async zcard(key: string): Promise<number> {
    return this.z.get(key)?.size ?? 0;
  }
  async lpush(key: string, value: unknown, keep: number): Promise<void> {
    const l = this.lists.get(key) ?? [];
    l.unshift(value);
    this.lists.set(key, l.slice(0, keep));
  }
  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    return ((this.lists.get(key) ?? []) as T[]).slice(start, stop + 1);
  }
}

let store: Store | undefined;
let memoryWarned = false;

export function getStore(): Store {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    store = new RedisStore(new Redis({ url, token }));
  } else {
    if (process.env.VERCEL_ENV === 'production') {
      throw new Error('Redis is not configured (UPSTASH_REDIS_REST_URL / TOKEN missing)');
    }
    if (!memoryWarned) {
      console.warn('[store] No Redis configured — using in-memory store (dev only)');
      memoryWarned = true;
    }
    store = new MemoryStore();
  }
  return store;
}

export function isPersistent(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
}
