/**
 * store.js - состояние редактора: загруженная глава, выделение, история.
 *
 * Правится тот же объект, который отдаёт сервер: «Сохранить» посылает его
 * целиком обратно в POST /api/content/{id}. Поэтому здесь нет никакой своей
 * модели данных - только удобные обёртки над JSON главы.
 */

export const DESIGN_H = 1080;          // виртуальная высота сцены (Viewport.DESIGN_H)
export const GROUND_OFFSET = 150;      // GameScene: от низа экрана до линии пола
export const GROUND_Y = DESIGN_H - GROUND_OFFSET;   // 930

/** Пять видов объектов главы + отдельный слой переднего плана. */
export const KINDS = {
  prop: { list: 'props', label: 'Декорация', short: 'дек', color: '#8cbf6a' },
  pickup: { list: 'pickups', label: 'Цифра', short: 'цифра', color: '#f2c14e' },
  gate: { list: 'gates', label: 'Ящик', short: 'ящик', color: '#d97b62' },
  npc: { list: 'npc', label: 'НПС', short: 'НПС', color: '#7fb6d9' },
  enemy: { list: 'enemies', label: 'Враг', short: 'враг', color: '#b47ad0' },
  fg: { list: 'foreground', label: 'Передний план', short: 'перед', color: '#54a89c' },
};

export const clone = (o) => (typeof structuredClone === 'function'
  ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export const listOf = (ch, kind) => (ch[KINDS[kind].list] ||= []);

/**
 * Коэффициент параллакса, с которым объект реально рисуется в игре.
 * Цифры, ящики, НПС и враги GameScene рисует внутри слоя 1 независимо
 * от того, что записано в JSON, - редактор обязан это повторять.
 */
export function effParallax(kind, obj) {
  if (kind === 'prop') return obj.parallax ?? 1;
  if (kind === 'fg') return obj.parallax ?? 1.2;
  return 1;
}

/** Значения по умолчанию, как их читает GameScene. */
export function defScale(kind, obj) {
  if (obj.scale != null) return obj.scale;
  return kind === 'pickup' ? 0.5 : 1;
}

export function defYOffset(kind, obj) {
  if (obj.yOffset != null) return obj.yOffset;
  return kind === 'pickup' ? -150 : 0;
}

/** Прямоугольник объекта в координатах его слоя (как в Editor.bounds). */
export function bounds(atlas, kind, obj) {
  if (!obj.frame || !atlas.has(obj.frame)) return null;
  const f = atlas.frame(obj.frame);
  const s = defScale(kind, obj);
  const w = f.w * s;
  const h = f.h * s;
  const base = GROUND_Y + defYOffset(kind, obj);
  return { x: (obj.x ?? 0) - w / 2, y: base - h, w, h };
}

/**
 * Плоский список объектов в порядке отрисовки GameScene.render():
 * дальние декорации -> земля -> декорации игрового слоя -> НПС -> ящики ->
 * враги -> цифры -> передний план. Кто позже, тот сверху.
 */
export function renderOrder(ch) {
  const out = [];
  const add = (kind, filter) => (ch[KINDS[kind].list] || []).forEach((obj, index) => {
    if (!filter || filter(obj)) out.push({ kind, index, obj });
  });
  add('prop', (o) => (o.parallax ?? 1) !== 1);
  add('prop', (o) => (o.parallax ?? 1) === 1);
  add('npc');
  add('gate');
  add('enemy');
  add('pickup');
  add('fg');
  return out;
}

const HISTORY = 60;   // шагов отмены

export class Store {
  constructor() {
    this.id = null;
    this.chapter = null;
    this.meta = [];          // список глав из /api/chapters
    this.dirty = false;
    this.sel = null;         // { kind, index }
    this.past = [];
    this.future = [];
    this._tag = '';
    this._t = 0;
    this._subs = new Set();
  }

  on(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }

  /** @param {string} what 'chapter' | 'change' | 'select' | 'status' */
  emit(what) { for (const fn of this._subs) fn(what, this); }

  setChapter(id, data) {
    this.id = id;
    this.chapter = data;
    this.dirty = false;
    this.sel = null;
    this.past.length = 0;
    this.future.length = 0;
    this.emit('chapter');
  }

  /**
   * Снимок перед правкой. `tag` склеивает подряд идущие мелкие правки одного
   * поля в один шаг истории: набор текста не должен съедать 60 отмен.
   */
  begin(tag = '') {
    const now = performance.now();
    if (tag && tag === this._tag && now - this._t < 800) { this._t = now; return; }
    this._tag = tag;
    this._t = now;
    this.past.push(clone(this.chapter));
    if (this.past.length > HISTORY) this.past.shift();
    this.future.length = 0;
  }

  /** Правка закончена: перерисовать всё и пометить главу изменённой. */
  commit() {
    this.dirty = true;
    this.emit('change');
  }

  /** Разорвать склейку: следующая правка точно попадёт в отдельный шаг. */
  seal() { this._tag = ''; }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }

  undo() {
    if (!this.past.length) return false;
    this.future.push(clone(this.chapter));
    this.chapter = this.past.pop();
    this.dirty = true;
    this.seal();
    this.clampSelection();
    this.emit('change');
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(clone(this.chapter));
    this.chapter = this.future.pop();
    this.dirty = true;
    this.seal();
    this.clampSelection();
    this.emit('change');
    return true;
  }

  /** После отмены объекта могло не стать - снимаем выделение. */
  clampSelection() {
    if (!this.sel) return;
    if (!this.obj(this.sel)) this.sel = null;
  }

  obj(sel = this.sel) {
    if (!sel || !this.chapter) return null;
    return (this.chapter[KINDS[sel.kind].list] || [])[sel.index] || null;
  }

  select(sel) {
    const same = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.index === b.index);
    if (same(sel, this.sel)) return;
    this.sel = sel ? { kind: sel.kind, index: sel.index } : null;
    this.seal();
    this.emit('select');
  }

  count() {
    const ch = this.chapter;
    if (!ch) return 0;
    return Object.values(KINDS).reduce((n, k) => n + (ch[k.list]?.length || 0), 0);
  }

  get levelWidth() { return this.chapter?.levelWidth ?? 4200; }
}
