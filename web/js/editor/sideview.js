/**
 * sideview.js - вид сбоку: уровень ровно так, как его видит игрок.
 *
 * Порядок отрисовки и все формулы повторяют GameScene.render():
 * небо -> дальний фон -> декорации не игрового слоя -> земля -> декорации
 * игрового слоя -> НПС -> ящики -> враги -> цифры -> передний план.
 *
 * Экранная позиция объекта слоя p:  px = (x - cam * p) * zoom
 * Обратно (как в core/Editor.js): x = px / zoom + cam * p - поэтому
 * перетаскивание дальней декорации так же точно, как ближней.
 */
import { GROUND_Y, DESIGN_H, KINDS, renderOrder, bounds, effParallax, defScale, defYOffset } from './store.js';

const SKY = '#eaf3fa';
const FONT = (px, w = 400) => `${w} ${px}px Comfortaa, system-ui, sans-serif`;

export class SideView {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.cam = 0;
    this.zoom = 0.4;
    this.panY = 0;
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.hover = null;
    this.drag = null;
    this.fitted = false;
    this.bind();
  }

  get store() { return this.app.store; }
  get atlas() { return this.app.atlas; }

  // ---------- геометрия ----------

  /** Ширина видимой части мира в виртуальных единицах. */
  get viewW() { return this.w / this.zoom; }

  toPx(x, p = 1) { return (x - this.cam * p) * this.zoom; }
  toWorld(px, p = 1) { return px / this.zoom + this.cam * p; }
  toPxY(y) { return (y - this.panY) * this.zoom; }
  toUiY(py) { return py / this.zoom + this.panY; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(80, this.canvas.clientWidth);
    const h = Math.max(60, this.canvas.clientHeight);
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.imageSmoothingQuality = 'high';
    if (!this.fitted && this.store.chapter) this.fit();
  }

  /** Показать всю высоту сцены: линия пола внизу, небо сверху. */
  fit() {
    this.zoom = Math.max(0.08, this.h / (DESIGN_H + 40));
    this.panY = -20;
    this.fitted = true;
  }

  setCam(v) {
    const max = Math.max(200, this.store.levelWidth - this.viewW * 0.5);
    this.cam = Math.max(-200, Math.min(max, v));
  }

  // ---------- ввод ----------

  bind() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', () => { this.drag = null; });
    c.addEventListener('pointerleave', () => { this.hover = null; this.app.draw(); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    c.addEventListener('drop', (e) => this.onDrop(e));
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onWheel(e) {
    e.preventDefault();
    if (e.shiftKey) {                       // Shift - прокрутка вдоль улицы
      this.setCam(this.cam + e.deltaY / this.zoom * 0.6);
      this.app.syncScroll();
      this.app.draw();
      return;
    }
    const p = this.local(e);
    const wx = this.toWorld(p.x);
    const wy = this.toUiY(p.y);
    const k = Math.exp(-e.deltaY * 0.0016);
    this.zoom = Math.max(0.06, Math.min(3, this.zoom * k));
    this.cam = wx - p.x / this.zoom;        // точка под курсором остаётся на месте
    this.panY = wy - p.y / this.zoom;
    this.setCam(this.cam);
    this.app.syncScroll();
    this.app.draw();
  }

  pick(px, py) {
    const ch = this.store.chapter;
    if (!ch) return null;
    const list = renderOrder(ch);
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.kind === 'fg') continue;       // передний план тайлится по всему экрану
      const b = bounds(this.atlas, it.kind, it.obj);
      if (!b) continue;
      const p = effParallax(it.kind, it.obj);
      const x = this.toWorld(px, p);
      const y = this.toUiY(py);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return it;
    }
    return null;
  }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    const panMode = e.button === 1 || e.button === 2 || this.app.space;
    if (panMode) {
      this.drag = { mode: 'pan', px: p.x, py: p.y, cam: this.cam, panY: this.panY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const it = this.pick(p.x, p.y);
    if (!it) {
      this.drag = { mode: 'pan', px: p.x, py: p.y, cam: this.cam, panY: this.panY, maybeClear: true };
      return;
    }
    this.store.select(it);
    const par = effParallax(it.kind, it.obj);
    this.drag = {
      mode: 'move', it, par, moved: false,
      dx: this.toWorld(p.x, par) - (it.obj.x ?? 0),
      dy: this.toUiY(p.y) - (GROUND_Y + defYOffset(it.kind, it.obj)),
    };
    this.canvas.style.cursor = 'grabbing';
  }

  onMove(e) {
    const p = this.local(e);
    const d = this.drag;
    if (!d) {
      const it = this.pick(p.x, p.y);
      const changed = (it?.obj ?? null) !== (this.hover?.obj ?? null);
      this.hover = it;
      this.canvas.style.cursor = it ? 'grab' : 'default';
      if (changed) this.app.draw();
      this.app.showCursor(this.toWorld(p.x), this.toUiY(p.y));
      return;
    }
    if (d.mode === 'pan') {
      if (d.maybeClear && Math.hypot(p.x - d.px, p.y - d.py) < 4) return;
      d.maybeClear = false;
      this.hover = null;          // сцена уехала - подсветка под курсором устарела
      this.setCam(d.cam - (p.x - d.px) / this.zoom);
      this.panY = d.panY - (p.y - d.py) / this.zoom;
      this.canvas.style.cursor = 'grabbing';
      this.app.syncScroll();
      this.app.draw();
      return;
    }
    if (!d.moved) { this.store.begin('drag-side'); d.moved = true; }
    const o = d.it.obj;
    o.x = this.app.snapValue(this.toWorld(p.x, d.par) - d.dx);
    const y = Math.round(this.toUiY(p.y) - d.dy - GROUND_Y);
    o.yOffset = this.app.snapValue(y);
    this.store.commit();
  }

  onUp(e) {
    const d = this.drag;
    this.drag = null;
    this.canvas.style.cursor = 'default';
    if (!d) return;
    if (d.mode === 'pan' && d.maybeClear) this.store.select(null);
    if (d.mode === 'move' && d.moved) this.store.seal();
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  }

  onDrop(e) {
    e.preventDefault();
    const frame = e.dataTransfer.getData('text/frame');
    if (!frame) return;
    const p = this.local(e);
    const kind = this.app.newKind;
    const par = kind === 'prop' ? this.app.newParallax : 1;
    this.app.createObject(kind, frame, this.toWorld(p.x, par), this.toUiY(p.y) - GROUND_Y, par);
  }

  // ---------- отрисовка ----------

  layer(p) {
    const z = this.zoom * this.dpr;
    this.ctx.setTransform(z, 0, 0, z, -this.cam * p * z, -this.panY * z);
  }

  screen() { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

  render() {
    const { ctx } = this;
    const ch = this.store.chapter;
    this.screen();
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!ch) return;

    this.drawFar();
    const atlas = this.atlas;
    const props = ch.props || [];

    for (const o of props) {
      if ((o.parallax ?? 1) === 1) continue;
      this.layer(o.parallax ?? 1);
      this.sprite(o, 'prop');
    }
    this.layer(1);
    this.drawGround();
    for (const o of props) {
      if ((o.parallax ?? 1) !== 1) continue;
      this.sprite(o, 'prop');
    }
    for (const n of ch.npc || []) this.sprite(n, 'npc');
    for (const g of ch.gates || []) this.sprite(g, 'gate');
    for (const e of ch.enemies || []) this.sprite(e, 'enemy');
    for (const it of ch.pickups || []) this.sprite(it, 'pickup');
    this.drawPlayerStart();
    this.drawForeground();

    this.drawGuides();
    this.drawOverlays();
  }

  sprite(o, kind) {
    if (!o.frame || !this.atlas.has(o.frame)) { this.missing(o, kind); return; }
    const y = GROUND_Y + defYOffset(kind, o);
    this.atlas.draw(this.ctx, o.frame, o.x ?? 0, y, {
      scale: defScale(kind, o), flipX: !!o.flip,
      alpha: kind === 'fg' ? 1 : 1,
    });
  }

  /** Кадра нет в атласе - рисуем красный вопрос, чтобы объект не потерялся. */
  missing(o, kind) {
    const ctx = this.ctx;
    const y = GROUND_Y + defYOffset(kind, o);
    ctx.save();
    ctx.strokeStyle = '#d64545';
    ctx.lineWidth = 3 / this.zoom;
    ctx.setLineDash([10 / this.zoom, 6 / this.zoom]);
    ctx.strokeRect((o.x ?? 0) - 40, y - 80, 80, 80);
    ctx.restore();
  }

  drawFar() {
    const img = this.app.farBg;
    if (!img) return;
    const vw = this.viewW;
    const vh = DESIGN_H;
    const s = Math.max(vw / img.width, vh / img.height) * 1.18;
    const dw = img.width * s;
    const dh = img.height * s;
    const slack = dw - vw;
    const k = Math.max(0, Math.min(1, this.cam / Math.max(1, this.store.levelWidth - vw)));
    this.layer(0);   // дальний фон в игре привязан к экрану, а не к миру
    this.ctx.drawImage(img, -slack * k, vh - dh, dw, dh);
  }

  drawGround() {
    const atlas = this.atlas;
    if (!atlas.has('ground_strip')) return;
    const f = atlas.frame('ground_strip');
    const scale = 1.15;
    const w = f.w * scale;
    const step = w - 10;
    const y = GROUND_Y + f.h * scale * 0.55;
    const from = Math.floor((this.cam - w) / step);
    const to = Math.min(from + 400, Math.ceil((this.cam + this.viewW + w) / step));
    for (let i = from; i <= to; i++) {
      atlas.draw(this.ctx, 'ground_strip', i * step + w / 2, y, { scale, flipX: (i & 1) === 1 });
    }
  }

  drawForeground() {
    const atlas = this.atlas;
    for (const layer of this.store.chapter.foreground || []) {
      if (!layer.frame || !atlas.has(layer.frame)) continue;
      const f = atlas.frame(layer.frame);
      const scale = layer.scale ?? 1;
      const par = layer.parallax ?? 1.2;
      const w = f.w * scale;
      const step = Math.max(8, (f.w - (layer.overlap ?? 0)) * scale);
      const y = GROUND_Y + (layer.yOffset ?? 0);
      this.layer(par);
      const shift = this.cam * par;
      const from = Math.floor(shift / step) - 2;
      const to = Math.min(from + 300, from + Math.ceil(this.viewW / step) + 6);
      for (let i = from; i <= to; i++) atlas.draw(this.ctx, layer.frame, i * step + w / 2, y, { scale });
    }
  }

  /** Полупрозрачный Петька на точке старта - чтобы видеть, откуда пойдёт игрок. */
  drawPlayerStart() {
    const atlas = this.atlas;
    const x = this.store.chapter.playerStart ?? 260;
    this.layer(1);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.45;
    if (atlas.has('petka_stand')) atlas.draw(ctx, 'petka_stand', x, GROUND_Y, { scale: 0.63 });
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(140,191,106,.9)';
    ctx.lineWidth = 2 / this.zoom;
    ctx.setLineDash([8 / this.zoom, 6 / this.zoom]);
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y - 340);
    ctx.lineTo(x, GROUND_Y + 20);
    ctx.stroke();
    ctx.restore();
  }

  /** Сетка, линия пола, границы уровня. */
  drawGuides() {
    const ctx = this.ctx;
    const lw = this.store.levelWidth;
    this.layer(1);
    const left = this.cam;
    const right = this.cam + this.viewW;
    const top = this.panY;
    const bottom = this.panY + this.h / this.zoom;

    if (this.app.grid && this.zoom > 0.12) {
      const step = this.zoom > 0.55 ? 100 : 500;
      ctx.save();
      ctx.strokeStyle = 'rgba(90,63,46,.14)';
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      for (let x = Math.floor(left / step) * step; x < right; x += step) {
        ctx.moveTo(x, top); ctx.lineTo(x, bottom);
      }
      ctx.stroke();
      ctx.restore();
    }

    // линия пола
    ctx.save();
    ctx.strokeStyle = 'rgba(214,69,69,.55)';
    ctx.lineWidth = 2 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(left, GROUND_Y); ctx.lineTo(right, GROUND_Y);
    ctx.stroke();
    ctx.restore();

    // за границами уровня и за кадром экрана - затемнение
    this.screen();
    ctx.save();
    ctx.fillStyle = 'rgba(47,33,25,.42)';
    const x0 = this.toPx(0);
    const x1 = this.toPx(lw);
    const y0 = this.toPxY(0);
    const y1 = this.toPxY(DESIGN_H);
    if (y0 > 0) ctx.fillRect(0, 0, this.w, y0);
    if (y1 < this.h) ctx.fillRect(0, y1, this.w, this.h - y1);
    if (x0 > 0) ctx.fillRect(0, 0, x0, this.h);
    if (x1 < this.w) ctx.fillRect(x1, 0, this.w - x1, this.h);
    ctx.strokeStyle = '#d97b62';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, this.h);
    ctx.moveTo(x1 - 0.5, 0); ctx.lineTo(x1 - 0.5, this.h);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,63,46,.4)';
    ctx.beginPath();
    ctx.moveTo(0, y0 + 0.5); ctx.lineTo(this.w, y0 + 0.5);
    ctx.moveTo(0, y1 - 0.5); ctx.lineTo(this.w, y1 - 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Рамки объектов, участки патруля, стенка ящика, подписи. */
  drawOverlays() {
    const ch = this.store.chapter;
    const ctx = this.ctx;
    const sel = this.store.sel;
    const selObj = this.store.obj();

    // участок патруля врага - полоса у пола
    this.screen();
    for (const e of ch.enemies || []) {
      const on = selObj === e;
      const y = this.toPxY(GROUND_Y);
      const a = this.toPx(e.from ?? 0);
      const b = this.toPx(e.to ?? 0);
      ctx.save();
      ctx.globalAlpha = on ? 0.9 : 0.4;
      ctx.fillStyle = KINDS.enemy.color;
      ctx.fillRect(a, y + 6, Math.max(2, b - a), 7);
      ctx.fillRect(a - 1, y - 4, 3, 22);
      ctx.fillRect(b - 2, y - 4, 3, 22);
      if (on) {
        const r = e.chaseRange ?? 500;
        ctx.globalAlpha = 0.22;
        ctx.fillRect(this.toPx((e.from ?? 0) - r), y + 16, (b - a) + r * 2 * this.zoom, 5);
      }
      ctx.restore();
    }

    // стенка ящика: до неё герой доходит и упирается
    for (const g of ch.gates || []) {
      const x = this.toPx((g.x ?? 0) - (g.width ?? 70));
      ctx.save();
      ctx.strokeStyle = 'rgba(217,123,98,.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, this.toPxY(GROUND_Y - 420));
      ctx.lineTo(x, this.toPxY(GROUND_Y + 10));
      ctx.stroke();
      ctx.restore();
    }

    const outline = (it, color, dash, width) => {
      const b = bounds(this.atlas, it.kind, it.obj);
      if (!b) return;
      const p = effParallax(it.kind, it.obj);
      const x = this.toPx(b.x, p);
      const y = this.toPxY(b.y);
      const w = b.w * this.zoom;
      const h = b.h * this.zoom;
      ctx.save();
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      ctx.restore();
      return { x, y, w, h };
    };

    this.screen();
    if (this.hover && this.hover.obj !== selObj) outline(this.hover, 'rgba(242,193,78,.95)', [6, 4], 2);

    if (sel && selObj) {
      const r = outline({ kind: sel.kind, obj: selObj }, '#d64545', [], 2.5);
      if (r) {
        // ручки по углам - видно, что объект выбран
        ctx.save();
        ctx.fillStyle = '#d64545';
        for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
          ctx.fillRect(hx - 3, hy - 3, 6, 6);
        }
        ctx.font = FONT(12, 700);
        ctx.fillStyle = '#4a3427';
        const label = `${KINDS[sel.kind].short}: ${selObj.id ?? selObj.frame}`;
        const tw = ctx.measureText(label).width;
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = '#fdf3df';
        ctx.fillRect(r.x - 1, r.y - 19, tw + 12, 17);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#4a3427';
        ctx.fillText(label, r.x + 5, r.y - 6);
        ctx.restore();
      }
    }
  }
}
