/**
 * topview.js - вид сверху: план уровня по глубине сцены.
 *
 * Горизонталь - та же координата X вдоль улицы, что и на виде сбоку
 * (прокрутка общая). Вертикаль - глубина: дальний план сверху, игровой
 * посередине, передний внизу. Полоса = коэффициент параллакса, поэтому
 * перетащить объект вниз или вверх - значит перенести его между планами.
 *
 * Внутри полосы объекты стоят в порядке массива `props` - это и есть
 * Z-порядок отрисовки в игре; он показан номером в значке и правится
 * кнопками «вперёд / назад».
 */
import { KINDS, effParallax, defScale } from './store.js';

const FONT = (px, w = 400) => `${w} ${px}px Comfortaa, system-ui, sans-serif`;
const ROW_H = 15;

export class TopView {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.hover = null;
    this.drag = null;
    this.bind();
  }

  get store() { return this.app.store; }
  get side() { return this.app.side; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = Math.max(80, this.canvas.clientWidth);
    this.h = Math.max(60, this.canvas.clientHeight);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
  }

  toPx(x) { return this.side.toPx(x, 1); }
  toWorld(px) { return this.side.toWorld(px, 1); }

  /** Полосы глубины: стандартные планы плюс всё, что реально есть в главе. */
  lanes() {
    const ch = this.store.chapter;
    const set = new Set([0.5, 0.75, 1]);
    for (const o of ch?.props || []) set.add(o.parallax ?? 1);
    for (const f of ch?.foreground || []) set.add(f.parallax ?? 1.2);
    const list = [...set].sort((a, b) => a - b);
    const top = 4;
    const h = Math.max(28, Math.min(56, (this.h - top - 4) / list.length));
    return list.map((p, i) => ({
      p, y: top + i * h, h,
      label: p < 1 ? (p <= 0.55 ? 'дальний' : 'средний') : p === 1 ? 'игровой' : 'передний',
    }));
  }

  laneAt(py) {
    const ls = this.lanes();
    for (const l of ls) if (py >= l.y && py < l.y + l.h) return l;
    return py < ls[0].y ? ls[0] : ls[ls.length - 1];
  }

  /** Все значки плана: полоса, ряд внутри полосы, экранный прямоугольник. */
  glyphs() {
    const ch = this.store.chapter;
    if (!ch) return [];
    const lanes = this.lanes();
    const byP = new Map(lanes.map((l) => [l.p, l]));
    const order = [];
    const add = (kind) => (ch[KINDS[kind].list] || []).forEach((obj, index) => order.push({ kind, index, obj }));
    add('prop'); add('npc'); add('gate'); add('enemy'); add('pickup'); add('fg');

    // сколько объектов в полосе - столько ступенек внутри неё
    const perLane = new Map();
    for (const it of order) {
      const p = effParallax(it.kind, it.obj);
      perLane.set(p, (perLane.get(p) || 0) + 1);
    }
    const seen = new Map();
    const out = [];
    for (const it of order) {
      const p = effParallax(it.kind, it.obj);
      const lane = byP.get(p) || lanes[lanes.length - 1];
      const n = perLane.get(p) || 1;
      const i = seen.get(p) || 0;
      seen.set(p, i + 1);
      const room = Math.max(0, lane.h - ROW_H - 8);
      const step = n > 1 ? Math.min(6, room / (n - 1)) : 0;
      const y = lane.y + 4 + i * step;

      let x0, w;
      if (it.kind === 'fg') { x0 = 0; w = this.w; } else {
        const f = this.app.atlas.has(it.obj.frame) ? this.app.atlas.frame(it.obj.frame) : { w: 80 };
        const ww = f.w * defScale(it.kind, it.obj) * this.side.zoom;
        w = Math.max(11, ww);
        x0 = this.toPx(it.obj.x ?? 0) - w / 2;
      }
      out.push({ ...it, lane, p, x: x0, y, w, h: ROW_H, ord: i });
    }
    return out;
  }

  // ---------- ввод ----------

  bind() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.side.setCam(this.side.cam + (e.shiftKey ? e.deltaY : e.deltaX || e.deltaY) / this.side.zoom * 0.6);
      this.app.syncScroll();
      this.app.draw();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => { this.hover = null; this.app.draw(); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  pick(px, py) {
    const gs = this.glyphs();
    for (let i = gs.length - 1; i >= 0; i--) {
      const g = gs[i];
      if (px >= g.x && px <= g.x + g.w && py >= g.y && py <= g.y + g.h) return g;
    }
    return null;
  }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    if (e.button === 1 || e.button === 2 || this.app.space) {
      this.drag = { mode: 'pan', px: p.x, cam: this.side.cam };
      return;
    }
    if (e.button !== 0) return;
    const g = this.pick(p.x, p.y);
    if (!g) { this.store.select(null); this.drag = { mode: 'pan', px: p.x, cam: this.side.cam }; return; }
    this.store.select(g);
    this.drag = {
      mode: 'move', it: g, moved: false,
      dx: this.toWorld(p.x) - (g.obj.x ?? 0),
      canLane: g.kind === 'prop',
    };
  }

  onMove(e) {
    const p = this.local(e);
    const d = this.drag;
    if (!d) {
      const g = this.pick(p.x, p.y);
      const changed = (g?.obj ?? null) !== (this.hover?.obj ?? null);
      this.hover = g;
      this.canvas.style.cursor = g ? (g.kind === 'prop' ? 'move' : 'ew-resize') : 'default';
      if (changed) this.app.draw();
      return;
    }
    if (d.mode === 'pan') {
      this.hover = null;
      this.side.setCam(d.cam - (p.x - d.px) / this.side.zoom);
      this.app.syncScroll();
      this.app.draw();
      return;
    }
    if (!d.moved) { this.store.begin('drag-top'); d.moved = true; }
    const o = d.it.obj;
    if (d.it.kind !== 'fg') o.x = this.app.snapValue(this.toWorld(p.x) - d.dx);
    if (d.canLane) {
      const lane = this.laneAt(p.y);
      if (lane && lane.p <= 1) o.parallax = lane.p;    // декорация живёт только за передним планом
    }
    this.store.commit();
  }

  onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (d?.mode === 'move' && d.moved) this.store.seal();
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  }

  // ---------- отрисовка ----------

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#efe3c9';
    ctx.fillRect(0, 0, this.w, this.h);
    const ch = this.store.chapter;
    if (!ch) return;

    const lanes = this.lanes();
    // полосы глубины
    lanes.forEach((l, i) => {
      ctx.fillStyle = i % 2 ? 'rgba(90,63,46,.07)' : 'rgba(255,255,255,.35)';
      ctx.fillRect(0, l.y, this.w, l.h - 1);
      ctx.strokeStyle = 'rgba(90,63,46,.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, l.y + l.h - 0.5); ctx.lineTo(this.w, l.y + l.h - 0.5);
      ctx.stroke();
    });

    // границы уровня и сетка - те же, что на виде сбоку
    const x0 = this.toPx(0);
    const x1 = this.toPx(this.store.levelWidth);
    ctx.save();
    ctx.fillStyle = 'rgba(47,33,25,.28)';
    if (x0 > 0) ctx.fillRect(0, 0, x0, this.h);
    if (x1 < this.w) ctx.fillRect(x1, 0, this.w - x1, this.h);
    ctx.restore();

    // участки патруля - на игровой полосе
    const play = lanes.find((l) => l.p === 1) || lanes[0];
    for (const e of ch.enemies || []) {
      const a = this.toPx(e.from ?? 0);
      const b = this.toPx(e.to ?? 0);
      ctx.save();
      ctx.globalAlpha = this.store.obj() === e ? 0.85 : 0.35;
      ctx.fillStyle = KINDS.enemy.color;
      ctx.fillRect(a, play.y + play.h - 6, Math.max(2, b - a), 3);
      ctx.restore();
    }

    const sel = this.store.obj();
    for (const g of this.glyphs()) {
      const k = KINDS[g.kind];
      const on = g.obj === sel;
      const hov = g.obj === this.hover?.obj;
      ctx.save();
      if (g.kind === 'fg') {
        ctx.globalAlpha = on ? 0.5 : 0.28;
        ctx.fillStyle = k.color;
        ctx.fillRect(0, g.y, this.w, g.h);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = k.color;
        ctx.globalAlpha = on ? 1 : hov ? 0.92 : 0.75;
        roundRect(ctx, g.x, g.y, g.w, g.h, 3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (on) {
        ctx.strokeStyle = '#d64545';
        ctx.lineWidth = 2;
        roundRect(ctx, g.x - 1, g.y - 1, g.w + 2, g.h + 2, 4);
        ctx.stroke();
      }
      // номер в слое - это и есть порядок отрисовки
      if (g.w > 20 && g.kind !== 'fg') {
        ctx.fillStyle = 'rgba(47,33,25,.8)';
        ctx.font = FONT(9, 700);
        ctx.textBaseline = 'middle';
        ctx.fillText(String(g.index), g.x + 4, g.y + g.h / 2 + 0.5);
      }
      if (g.kind === 'fg') {
        ctx.fillStyle = 'rgba(47,33,25,.75)';
        ctx.font = FONT(10, 700);
        ctx.textBaseline = 'middle';
        ctx.fillText(`передний план: ${g.obj.frame}`, 104, g.y + g.h / 2);
      }
      ctx.restore();
    }

    // подписи полос поверх всего, но полупрозрачные - X не сдвигается
    ctx.save();
    ctx.font = FONT(10, 700);
    ctx.textBaseline = 'top';
    for (const l of lanes) {
      const t = `${l.label} ${l.p}`;
      const w = ctx.measureText(t).width + 10;
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = '#fdf3df';
      roundRect(ctx, 3, l.y + 2, w, 13, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#7a5a44';
      ctx.fillText(t, 8, l.y + 4);
    }
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
