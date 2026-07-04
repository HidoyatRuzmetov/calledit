/** In-memory twin of the redis subset — for tests and the integration sim. */
import type { Store, ZMemberLike, ZRangeOptionsLike } from './store';

type Z = Map<string, number>;

export class MemoryStore implements Store {
  strings = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  zsets = new Map<string, Z>();
  /** When set, throws after this many write operations (crash simulation). */
  failAfterWrites: number | null = null;
  private writes = 0;

  private write(): void {
    this.writes += 1;
    if (this.failAfterWrites !== null && this.writes > this.failAfterWrites) {
      throw new Error('simulated crash');
    }
  }

  async get(key: string): Promise<string | undefined> {
    return this.strings.get(key);
  }
  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; xx?: boolean; expiration?: Date }
  ): Promise<string> {
    this.write();
    if (options?.nx && this.strings.has(key)) return '';
    if (options?.xx && !this.strings.has(key)) return '';
    this.strings.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]): Promise<void> {
    this.write();
    for (const k of keys) {
      this.strings.delete(k);
      this.hashes.delete(k);
      this.zsets.delete(k);
    }
  }
  async incrBy(key: string, value: number): Promise<number> {
    this.write();
    const next = parseInt(this.strings.get(key) ?? '0', 10) + value;
    this.strings.set(key, String(next));
    return next;
  }

  private hash(key: string): Map<string, string> {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    return h;
  }
  async hGet(key: string, field: string): Promise<string | undefined> {
    return this.hashes.get(key)?.get(field);
  }
  async hSet(
    key: string,
    fieldValues: Record<string, string>
  ): Promise<number> {
    this.write();
    const h = this.hash(key);
    let added = 0;
    for (const [f, v] of Object.entries(fieldValues)) {
      if (!h.has(f)) added++;
      h.set(f, v);
    }
    return added;
  }
  async hSetNX(key: string, field: string, value: string): Promise<number> {
    this.write();
    const h = this.hash(key);
    if (h.has(field)) return 0;
    h.set(field, value);
    return 1;
  }
  async hGetAll(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
  async hIncrBy(key: string, field: string, value: number): Promise<number> {
    this.write();
    const h = this.hash(key);
    const next = parseInt(h.get(field) ?? '0', 10) + value;
    h.set(field, String(next));
    return next;
  }
  async hLen(key: string): Promise<number> {
    return this.hashes.get(key)?.size ?? 0;
  }
  async hDel(key: string, fields: string[]): Promise<number> {
    this.write();
    const h = this.hash(key);
    let n = 0;
    for (const f of fields) if (h.delete(f)) n++;
    return n;
  }

  private zset(key: string): Z {
    let z = this.zsets.get(key);
    if (!z) {
      z = new Map();
      this.zsets.set(key, z);
    }
    return z;
  }
  async zAdd(key: string, ...members: ZMemberLike[]): Promise<number> {
    this.write();
    const z = this.zset(key);
    let added = 0;
    for (const m of members) {
      if (!z.has(m.member)) added++;
      z.set(m.member, m.score);
    }
    return added;
  }
  async zCard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }
  async zScore(key: string, member: string): Promise<number | undefined> {
    return this.zsets.get(key)?.get(member);
  }
  private sorted(key: string): { member: string; score: number }[] {
    return [...(this.zsets.get(key) ?? new Map<string, number>()).entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));
  }
  async zRank(key: string, member: string): Promise<number | undefined> {
    const idx = this.sorted(key).findIndex((r) => r.member === member);
    return idx === -1 ? undefined : idx;
  }
  async zRem(key: string, members: string[]): Promise<number> {
    this.write();
    const z = this.zset(key);
    let n = 0;
    for (const m of members) if (z.delete(m)) n++;
    return n;
  }
  async zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: ZRangeOptionsLike
  ): Promise<{ member: string; score: number }[]> {
    let rows = this.sorted(key);
    if (options?.reverse) rows = rows.reverse();
    const s = Number(start);
    const e = Number(stop);
    const from = s < 0 ? Math.max(0, rows.length + s) : s;
    const to = e < 0 ? rows.length + e : Math.min(e, rows.length - 1);
    return rows.slice(from, to + 1);
  }
}
