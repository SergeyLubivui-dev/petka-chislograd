import { PALETTE, paperPath, font } from './ui.js';

/**
 * TouchControls - экранные кнопки для планшета и телефона.
 *
 * Слева - «влево» и «вправо», справа - «прыжок» и «действие». Кнопки
 * появляются только после первого касания экрана (`input.touch`), поэтому на
 * компьютере с мышью их нет. Размер считается так, чтобы на любом экране
 * кнопка была не меньше 64 CSS-пикселей - под детский палец.
 *
 * Зоны отдаются в `Input.setZones()`: он сам следит, какой палец что держит,
 * и переводит это в `axisX`, `jump`, `interact`. Здесь - только раскладка и
 * отрисовка. Кнопка действия подписывается словом по ситуации:
 * «Говорить», «Решить», «Взять» - ребёнок 6+ значок «E» не прочтёт.
 */
export class TouchControls {
  constructor(game) {
    this.game = game;
    this.zones = [];
    this.actLabel = '';
    this.visible = false;
  }

  /**
   * @param {object} o { act: подпись кнопки действия или null, если действие невозможно }
   */
  layout(o = {}) {
    const { viewport, input } = this.game;
    this.visible = input.touch || (viewport.coarse && !input.keys.size);
    this.zones = [];
    if (!this.visible) { input.setZones([]); return; }

    const { viewW, viewH, inset } = viewport;
    const size = viewport.atLeastPx(150, 74);
    const gap = viewport.atLeastPx(18, 10);
    const bottom = viewH - viewport.atLeastPx(150, 18) - inset.bottom;   // над числовой линейкой
    const left = viewport.atLeastPx(36, 14) + inset.left;
    const right = viewW - viewport.atLeastPx(36, 14) - inset.right;

    this.zones.push({ id: 'left', x: left, y: bottom - size, w: size, h: size, icon: 'left' });
    this.zones.push({ id: 'right', x: left + size + gap, y: bottom - size, w: size, h: size, icon: 'right' });

    this.actLabel = o.act ?? '';
    const actW = size * 1.35;
    this.zones.push({ id: 'jump', x: right - size, y: bottom - size, w: size, h: size, icon: 'jump' });
    this.zones.push({
      id: 'act', x: right - size - gap - actW, y: bottom - size, w: actW, h: size,
      icon: 'act', label: this.actLabel, disabled: !this.actLabel,
    });
    input.setZones(this.zones);
  }

  render() {
    if (!this.visible) return;
    const { viewport, input } = this.game;
    const ctx = viewport.ctx;
    viewport.applyUI();

    this.zones.forEach((z, i) => {
      const held = input.zoneHeld(z.id);
      const alpha = z.disabled ? 0.35 : (held ? 0.98 : 0.8);
      const lift = held ? -3 : 0;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = PALETTE.shadow;
      paperPath(ctx, z.x + 4, z.y + 7 + lift, z.w, z.h, 26, 201 + i * 5, 3);
      ctx.fill();
      ctx.fillStyle = held ? PALETTE.yellow : '#fffaf0';
      paperPath(ctx, z.x, z.y + lift, z.w, z.h, 26, 191 + i * 7, 3);
      ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();

      const cx = z.x + z.w / 2, cy = z.y + z.h / 2 + lift;
      ctx.fillStyle = PALETTE.ink;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (z.icon === 'left' || z.icon === 'right') this.arrow(ctx, cx, cy, z.w * 0.24, z.icon === 'left' ? -1 : 1);
      else if (z.icon === 'jump') this.jumpIcon(ctx, cx, cy, z.w * 0.24);
      else if (z.icon === 'act') {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        let fs = z.h * 0.3;
        ctx.font = font(fs, 800);
        const label = z.label || '…';
        while (ctx.measureText(label).width > z.w - 28 && fs > 14) { fs -= 1; ctx.font = font(fs, 800); }
        ctx.fillText(label, cx, cy + 2);
      }
      ctx.restore();
    });
  }

  arrow(ctx, cx, cy, r, dir) {
    ctx.beginPath();
    ctx.moveTo(cx - r * dir, cy - r);
    ctx.lineTo(cx + r * dir, cy);
    ctx.lineTo(cx - r * dir, cy + r);
    ctx.closePath();
    ctx.fill();
  }

  /** Стрелка вверх с «подошвой» - прыжок. */
  jumpIcon(ctx, cx, cy, r) {
    ctx.lineWidth = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.9);
    ctx.lineTo(cx, cy - r * 0.7);
    ctx.moveTo(cx - r * 0.8, cy - r * 0.05);
    ctx.lineTo(cx, cy - r * 0.9);
    ctx.lineTo(cx + r * 0.8, cy - r * 0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.1, cy + r * 1.35);
    ctx.lineTo(cx + r * 1.1, cy + r * 1.35);
    ctx.stroke();
  }
}
