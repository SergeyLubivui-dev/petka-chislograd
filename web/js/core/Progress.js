/**
 * Progress - прогресс игрока: главы, монетки, задания.
 *
 * Одна структура на всю игру:
 *
 *   {
 *     version: 2,
 *     coins: 135,                          // сколько монет в кошельке сейчас
 *     earned: 200,                         // сколько заработано за всё время
 *     unlocked: ['chapter_01', 'chapter_02'],
 *     lastChapter: 'chapter_01',
 *     chapters: {
 *       chapter_01: { collected: ['d1', 'd2'], gates: ['gate1'], puzzles: ['cat:2'],
 *                     completed: 2, bestSeconds: 310, x: 1560 }
 *     },
 *     practice: { rounds: 3, solved: 41, best: { reading: {...}, count: {...} } }
 *   }
 *
 * Хранится в двух местах: в браузере (localStorage - мгновенно) и на сервере
 * (SQLite рядом с exe - переживает чистку браузера). Читаем сначала локально,
 * потом подтягиваем серверное и берём то, где заработано больше. Все записи
 * идут в оба места; ошибка сети гасится - игра продолжается офлайн.
 *
 * Монеты - единственная валюта. Их дают за цифры, ящики, задачи собеседников,
 * финал главы и за круги в «Заданиях». Тратятся только на открытие глав.
 */

const KEY = 'petka.progress';
export const FIRST_CHAPTER = 'chapter_01';

export const DEFAULT_REWARDS = { pickup: 5, gate: 10, puzzle: 5, finale: 40 };
export const PRACTICE_REWARDS = { task: 2, round: 10 };

export class Progress {
  constructor(api) {
    this.api = api;
    this.data = this.fresh();
    this.listeners = new Set();
    this.load();
  }

  fresh() {
    return {
      version: 2, coins: 0, earned: 0,
      unlocked: [FIRST_CHAPTER], lastChapter: FIRST_CHAPTER,
      chapters: {}, practice: { rounds: 0, solved: 0, best: {} },
    };
  }

  // ---------------------------------------------------------------- хранение

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = this.migrate(JSON.parse(raw));
    } catch { /* приватный режим или битые данные */ }
  }

  /** Подтянуть прогресс с сервера. Вызывается один раз при старте. */
  async sync() {
    const remote = await this.api.progress();
    if (!remote || typeof remote !== 'object') return;
    const r = this.migrate(remote);
    // кто больше заработал, у того и правда: локальная копия могла остаться
    // от другой игры на том же компьютере
    if ((r.earned ?? 0) > (this.data.earned ?? 0)) {
      this.data = r;
      this.writeLocal();
      this.emit();
    } else if ((this.data.earned ?? 0) > (r.earned ?? 0)) {
      this.api.saveProgress(this.data);
    }
  }

  /** Старый формат (одна глава, список собранного) превращается в новый. */
  migrate(d) {
    if (!d || typeof d !== 'object') return this.fresh();
    if (d.version === 2) {
      const f = this.fresh();
      return { ...f, ...d, chapters: d.chapters ?? {}, practice: { ...f.practice, ...(d.practice ?? {}) },
        unlocked: Array.isArray(d.unlocked) && d.unlocked.length ? d.unlocked : [FIRST_CHAPTER] };
    }
    const f = this.fresh();
    if (Array.isArray(d.collected) && d.collected.length) {
      f.chapters[d.chapter || FIRST_CHAPTER] = { collected: d.collected, gates: [], puzzles: [], completed: 0 };
    }
    return f;
  }

  save() {
    this.writeLocal();
    this.api.saveProgress(this.data);
    this.emit();
  }

  writeLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* приватный режим */ }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this.data); }

  // ---------------------------------------------------------------- монеты

  get coins() { return this.data.coins; }

  /** Начислить монеты. Возвращает, сколько добавили (для всплывающей подписи). */
  earn(n, reason = '') {
    n = Math.max(0, Math.round(n));
    if (!n) return 0;
    this.data.coins += n;
    this.data.earned += n;
    this.lastReason = reason;
    this.save();
    return n;
  }

  spend(n) {
    if (this.data.coins < n) return false;
    this.data.coins -= n;
    this.save();
    return true;
  }

  // ---------------------------------------------------------------- главы

  chapter(id) {
    const ch = this.data.chapters[id];
    if (ch) return ch;
    return (this.data.chapters[id] = { collected: [], gates: [], puzzles: [], completed: 0 });
  }

  isUnlocked(id) { return this.data.unlocked.includes(id); }

  /** Открыть главу за монеты. `cost` берётся из JSON главы. */
  unlock(id, cost = 0) {
    if (this.isUnlocked(id)) return true;
    if (!this.spend(cost)) return false;
    this.data.unlocked.push(id);
    this.save();
    return true;
  }

  /** Есть ли что продолжать: глава начата, но не пройдена. */
  started(id) {
    const ch = this.data.chapters[id];
    return !!ch && (ch.collected.length > 0 || ch.gates.length > 0) && !ch.completed;
  }

  markCollected(id, itemId) {
    const ch = this.chapter(id);
    if (!ch.collected.includes(itemId)) ch.collected.push(itemId);
    this.data.lastChapter = id;
    this.save();
  }

  markGate(id, gateId, x) {
    const ch = this.chapter(id);
    if (!ch.gates.includes(gateId)) ch.gates.push(gateId);
    if (x !== undefined) ch.x = x;
    this.data.lastChapter = id;
    this.save();
  }

  /** Задача собеседника решена впервые? Тогда за неё дают монеты. */
  markPuzzle(id, key) {
    const ch = this.chapter(id);
    if (ch.puzzles.includes(key)) return false;
    ch.puzzles.push(key);
    this.save();
    return true;
  }

  /** Глава пройдена: считаем разы и лучшее время; прогресс внутри главы сбрасываем. */
  complete(id, seconds) {
    const ch = this.chapter(id);
    ch.completed = (ch.completed ?? 0) + 1;
    if (!ch.bestSeconds || seconds < ch.bestSeconds) ch.bestSeconds = seconds;
    ch.collected = [];
    ch.gates = [];
    delete ch.x;
    this.data.lastChapter = id;
    this.save();
  }

  /** Начать главу с чистого листа (кнопка «Заново»). */
  reset(id) {
    const ch = this.chapter(id);
    ch.collected = [];
    ch.gates = [];
    delete ch.x;
    this.save();
  }

  // ---------------------------------------------------------------- задания

  /** Итог круга в «Заданиях»: монеты за решённое и премия за полный круг. */
  practiceRound(sheetId, result, total) {
    const p = this.data.practice;
    p.rounds += 1;
    p.solved += result.solved;
    const prev = p.best[sheetId];
    if (!prev || isBetter(result, prev)) p.best[sheetId] = { ...result };
    const coins = result.solved * PRACTICE_REWARDS.task + (result.solved >= total ? PRACTICE_REWARDS.round : 0);
    this.earn(coins, 'practice');
    return coins;
  }

  bestFor(sheetId) { return this.data.practice.best[sheetId] ?? null; }

  /** Уровень «знаний» по вкладке: 0-3 звезды от доли решённого в лучшем круге. */
  stars(sheetId, total) {
    const b = this.bestFor(sheetId);
    if (!b || !total) return 0;
    const k = b.solved / total;
    return k >= 1 ? 3 : k >= 0.66 ? 2 : k >= 0.33 ? 1 : 0;
  }
}

/** Лучше - больше решено; при равенстве - быстрее. */
export function isBetter(a, b) {
  if (!b) return true;
  if (a.solved !== b.solved) return a.solved > b.solved;
  return a.seconds < b.seconds;
}
