import { PALETTE, paperPath, font } from './ui.js';

/**
 * Встроенный редактор сцены (режим отладки).
 *
 * F2         - включить / выключить
 * ЛКМ + drag - двигать объект
 * стрелки    - сдвиг на 1 (Shift - на 10)
 * [ / ]      - уменьшить / увеличить масштаб объекта
 * F          - отразить объект по горизонтали
 * G          - показать сетку и линию пола
 * Ctrl+S     - сохранить главу на диск (POST /api/content/{id})
 * Esc        - снять выделение
 *
 * Редактор правит тот же объект главы, который отдаёт сервер, поэтому
 * сохранённый JSON сразу подхватывается игрой при перезапуске.
 */
export class Editor {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.selected = null;
    this.dragging = null;
    this.grid = true;
    this.status = '';
    this.statusT = 0;
  }

  /** Плоский список редактируемых объектов главы. */
  items(chapter) {
    const out = [];
    const add = (arr, kind) => (arr || []).forEach((o) => out.push({ obj: o, kind }));
    add(chapter.props, 'prop');
    add(chapter.pickups, 'pickup');
    add(chapter.npc, 'npc');
    add(chapter.enemies, 'enemy');
    return out;
  }

  bounds(o, gy) {
    const { atlas } = this.game;
    const s = o.scale ?? 1;
    const f = atlas.frame(o.frame);
    const w = f.w * s;
    const h = f.h * s;
    return { x: o.x - w / 2, y: gy + (o.yOffset ?? 0) - h, w, h };
  }

  /** Экранные координаты указателя -> координаты слоя с учётом параллакса. */
  toLayer(p, parallax) {
    return { x: p.x + this.game.scene.cameraX * (parallax ?? 1), y: p.y };
  }

  update(dt, chapter, gy) {
    const { input } = this.game;

    if (input.justPressed('F2')) {
      this.enabled = !this.enabled;
      this.selected = null;
      this.flash(this.enabled ? 'Редактор включён (F2 - выйти)' : 'Редактор выключен');
    }
    if (this.statusT > 0) this.statusT -= dt;
    if (!this.enabled) return false;

    if (input.justPressed('KeyG')) this.grid = !this.grid;
    if (input.justPressed('Escape')) { this.selected = null; this.dragging = null; }
    if (input.down('ControlLeft', 'ControlRight') && input.justPressed('KeyS')) this.save(chapter);

    const list = this.items(chapter);
    const p = input.pointer;

    // выбор и перетаскивание
    let hovered = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      const lp = this.toLayer(p, it.obj.parallax);
      const b = this.bounds(it.obj, gy);
      if (lp.x >= b.x && lp.x <= b.x + b.w && lp.y >= b.y && lp.y <= b.y + b.h) { hovered = it; break; }
    }
    this.hovered = hovered;
    this.game.canvas.classList.toggle('grab', !!hovered && !this.dragging);
    this.game.canvas.classList.toggle('grabbing', !!this.dragging);

    if (p.down && !this.dragging && hovered) {
      const lp = this.toLayer(p, hovered.obj.parallax);
      this.selected = hovered;
      this.dragging = { it: hovered, dx: lp.x - hovered.obj.x, dy: lp.y - (gy + (hovered.obj.yOffset ?? 0)) };
    }
    if (!p.down) this.dragging = null;

    if (this.dragging) {
      const it = this.dragging.it;
      const lp = this.toLayer(p, it.obj.parallax);
      it.obj.x = Math.round(lp.x - this.dragging.dx);
      it.obj.yOffset = Math.round(lp.y - this.dragging.dy - gy);
    }

    // клавиатурная правка выбранного объекта
    const o = this.selected?.obj;
    if (o) {
      const step = input.down('ShiftLeft', 'ShiftRight') ? 10 : 1;
      if (input.justPressed('ArrowLeft')) o.x -= step;
      if (input.justPressed('ArrowRight')) o.x += step;
      if (input.justPressed('ArrowUp')) o.yOffset = (o.yOffset ?? 0) - step;
      if (input.justPressed('ArrowDown')) o.yOffset = (o.yOffset ?? 0) + step;
      if (input.justPressed('BracketLeft')) o.scale = Math.max(0.05, Number(((o.scale ?? 1) - 0.02).toFixed(3)));
      if (input.justPressed('BracketRight')) o.scale = Number(((o.scale ?? 1) + 0.02).toFixed(3));
      if (input.justPressed('KeyF')) o.flip = !o.flip;
    }

    // камера в редакторе двигается вручную
    if (input.down('KeyA')) this.game.scene.cameraX -= 900 * dt;
    if (input.down('KeyD')) this.game.scene.cameraX += 900 * dt;

    return true;   // игровой ввод в этом кадре перехвачен редактором
  }

  flash(text) { this.status = text; this.statusT = 2.5; }

  async save(chapter) {
    try {
      const r = await fetch(`/api/content/${chapter.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chapter, null, 2),
      });
      this.flash(r.ok ? 'Сохранено в chapter JSON' : `Ошибка сохранения: ${r.status}`);
    } catch (e) {
      this.flash(`Ошибка сохранения: ${e.message}`);
    }
  }

  render(chapter, gy) {
    const { viewport } = this.game;
    const ctx = viewport.ctx;

    if (this.statusT > 0 && !this.enabled) { this.renderStatus(ctx); return; }
    if (!this.enabled) return;

    // сетка и линия пола
    if (this.grid) {
      viewport.applyWorld(this.game.scene.cameraX, 1);
      ctx.save();
      ctx.strokeStyle = 'rgba(90,63,46,.18)';
      ctx.lineWidth = 1;
      const from = Math.floor((this.game.scene.cameraX - 200) / 100) * 100;
      const to = this.game.scene.cameraX + viewport.viewW + 200;
      for (let x = from; x < to; x += 100) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, viewport.viewH); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(200,60,60,.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(from, gy); ctx.lineTo(to, gy); ctx.stroke();
      ctx.restore();
    }

    // рамки объектов
    for (const it of this.items(chapter)) {
      viewport.applyWorld(this.game.scene.cameraX, it.obj.parallax ?? 1);
      const b = this.bounds(it.obj, gy);
      const isSel = this.selected?.obj === it.obj;
      const isHov = this.hovered?.obj === it.obj;
      ctx.save();
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.setLineDash(isSel ? [] : [8, 6]);
      ctx.strokeStyle = isSel ? '#d64545' : (isHov ? '#e08a3c' : 'rgba(90,63,46,.45)');
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      ctx.fillStyle = isSel ? '#d64545' : 'rgba(90,63,46,.6)';
      ctx.font = font(18, 700);
      ctx.textAlign = 'left';
      ctx.fillText(`${it.kind}:${it.obj.id ?? it.obj.frame}`, b.x, b.y - 8);
      ctx.restore();
    }

    // панель редактора
    viewport.applyUI();
    const o = this.selected?.obj;
    const lines = [
      'РЕДАКТОР  F2 - выход',
      'мышь - двигать · стрелки - на 1 (Shift - 10)',
      '[ ] - масштаб · F - отразить · G - сетка',
      'A / D - камера · Ctrl+S - сохранить',
      o ? `${this.selected.kind}: ${o.id ?? o.frame}` : 'объект не выбран',
      o ? `x ${Math.round(o.x)}   y ${Math.round(o.yOffset ?? 0)}   scale ${(o.scale ?? 1).toFixed(2)}${o.flip ? '   flip' : ''}` : '',
    ].filter(Boolean);

    const pw = 560;
    const ph = 40 + lines.length * 30;
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, 24, viewport.viewH - ph - 24, pw, ph, 16, 5, 2.5);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'left';
    lines.forEach((l, i) => {
      ctx.font = font(i === 0 ? 22 : 19, i === 0 ? 700 : 400);
      ctx.fillText(l, 48, viewport.viewH - ph - 24 + 34 + i * 30);
    });
    ctx.restore();

    this.renderStatus(ctx);
  }

  renderStatus(ctx) {
    if (this.statusT <= 0) return;
    const { viewport } = this.game;
    viewport.applyUI();
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.statusT);
    ctx.fillStyle = '#fffaf0';
    const w = 520;
    paperPath(ctx, (viewport.viewW - w) / 2, 26, w, 62, 14, 9, 2.5);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(24, 700);
    ctx.textAlign = 'center';
    ctx.fillText(this.status, viewport.viewW / 2, 66);
    ctx.restore();
  }
}
