import { PALETTE, paperPath, hit, font, wrapText, ghostFrame } from './ui.js';
import { readable } from './text.js';

/**
 * Окно «поставь цифру в трафарет».
 *
 * Открывается, когда Петька подобрал цифру. На листе три трафарета - светлые
 * силуэты цифр, - и найденную цифру нужно положить в свой. Это задача на
 * узнавание формы: игроку 6+ читать трудно, а сопоставить контур легко.
 *
 * Управление намеренно тройное, чтобы не зависеть от навыка мыши:
 *   - перетащить цифру в трафарет;
 *   - просто щёлкнуть по нужному трафарету;
 *   - нажать 1, 2 или 3.
 *
 * Пока окно открыто, герой не двигается: GameScene отдаёт сюда весь ввод.
 */

const SLOT_RATIO = 1.28;    // трафарет чуть выше, чем шире
const WRONG_TIME = 0.55;    // сколько дрожит неверный трафарет
const DONE_TIME = 1.5;      // сколько любуемся результатом до закрытия
const DIGIT_GAP = 70;       // просвет между трафаретами и цифрой - там живёт стрелка

export class Placement {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.item = null;
    this.slots = [];
    this.correct = -1;
    this.state = 'ask';       // ask - ищем место, ok - цифра встала
    this.t = 0;
    this.wrong = 0;
    this.wrongSlot = -1;
    this.held = false;
    this.drag = null;
    this.hover = -1;
    this.onDone = null;
    this.onClose = null;
  }

  /** @param {object} item предмет главы  @param {string[]} frames три кадра, один из них - верный */
  open(item, frames) {
    this.active = true;
    this.item = item;
    this.slots = frames.map((frame) => ({ frame, filled: false }));
    this.correct = frames.indexOf(item.frame);
    this.state = 'ask';
    this.t = 0;
    this.wrong = 0;
    this.wrongSlot = -1;
    this.held = false;
    this.drag = null;
    this.hover = -1;
    this.layout();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    const solved = this.state === 'ok';
    this.item = null;
    this.onClose?.(solved);
  }

  tr(s) { return readable(s, this.game.settings); }

  layout() {
    const { viewW, viewH } = this.game.viewport;
    const w = Math.min(1120, viewW * 0.86);
    const h = Math.min(800, viewH * 0.92);
    const x = (viewW - w) / 2;
    const y = (viewH - h) / 2;
    this.panel = { x, y, w, h };

    const n = Math.max(1, this.slots.length);
    const gap = 34;
    const sw = Math.min(230, (w - 130 - gap * (n - 1)) / n);
    const sh = Math.min(sw * SLOT_RATIO, h - 340);
    const sy = y + 148;
    let sx = x + (w - (sw * n + gap * (n - 1))) / 2;
    this.slots.forEach((s) => {
      s.x = sx; s.y = sy; s.w = sw; s.h = sh;
      sx += sw + gap;
    });

    // «домик» найденной цифры: под трафаретами по центру листа. Цифра
    // крупная - её надо сравнивать с трафаретом, а не разглядывать.
    // Снизу оставлено место под подпись, сверху - под стрелку-подсказку.
    this.homeH = Math.max(90, Math.min(170, h - (sy - y) - sh - 180));
    this.home = { cx: x + w / 2, cy: sy + sh + DIGIT_GAP + this.homeH / 2 };
  }

  /** Прямоугольник найденной цифры - за него можно схватить. */
  digitBox() {
    const f = this.game.atlas.frame(this.item.frame);
    const scale = this.homeH / f.h;
    const w = f.w * scale, h = f.h * scale;
    const c = this.drag ?? { x: this.home.cx, y: this.home.cy };
    return { x: c.x - w / 2, y: c.y - h / 2, w, h, scale };
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    this.layout();

    const { input } = this.game;
    const p = input.pointer;

    if (this.state === 'ok') {
      if (this.t >= DONE_TIME || input.justPressed('Space', 'Enter') || p.clicked) this.close();
      return;
    }

    if (this.wrong > 0) this.wrong -= dt;

    const box = this.digitBox();
    if (p.down && !this.held && hit(box, p)) this.held = true;
    if (this.held) this.drag = { x: p.x, y: p.y };

    this.hover = this.slots.findIndex((s) => hit(s, p));
    this.game.canvas.classList.toggle('pointer', this.hover >= 0 || hit(box, p));

    if (p.clicked) {
      const target = this.hover;
      if (this.held) {
        this.held = false;
        this.drag = null;
      }
      // промах мимо трафаретов - просто вернуть цифру на место, без «неверно»
      if (target >= 0) this.drop(target);
    }

    for (let i = 0; i < this.slots.length; i++) {
      if (input.justPressed(`Digit${i + 1}`, `Numpad${i + 1}`)) this.drop(i);
    }
    if (input.justPressed('Escape')) this.close();
  }

  drop(i) {
    if (this.state === 'ok' || i < 0 || i >= this.slots.length) return;
    if (i === this.correct) {
      this.slots[i].filled = true;
      this.state = 'ok';
      this.t = 0;
      this.held = false;
      this.drag = null;
      this.onDone?.(this.item);
    } else {
      this.wrong = WRONG_TIME;
      this.wrongSlot = i;
    }
  }

  // ---------- отрисовка ----------

  render() {
    if (!this.active) return;
    if (!this.panel) this.layout();
    const { viewport } = this.game;
    const ctx = viewport.ctx;
    viewport.applyUI();

    ctx.save();
    ctx.fillStyle = 'rgba(60,42,30,.34)';
    ctx.fillRect(0, 0, viewport.viewW, viewport.viewH);
    ctx.restore();

    const { x, y, w, h } = this.panel;
    ctx.save();
    ctx.fillStyle = PALETTE.shadow;
    paperPath(ctx, x + 6, y + 10, w, h, 26, 23, 4);
    ctx.fill();
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, x, y, w, h, 26, 19, 4);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.restore();

    this.drawTitle(ctx);
    this.slots.forEach((s, i) => this.drawSlot(ctx, s, i));
    if (this.state !== 'ok') {
      if (!this.held) this.drawArrow(ctx);
      this.drawDigit(ctx);
    }
    this.drawFooter(ctx);
  }

  drawTitle(ctx) {
    const { x, y, w } = this.panel;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PALETTE.ink;
    const text = this.state === 'ok' ? 'Молодец!' : 'Найди такую же цифру';
    let fs = 48;
    ctx.font = font(fs, 800);
    while (ctx.measureText(this.tr(text)).width > w - 90 && fs > 22) {
      fs -= 2;
      ctx.font = font(fs, 800);
    }
    ctx.fillText(this.tr(text), x + w / 2, y + 92);
    ctx.restore();
  }

  drawSlot(ctx, s, i) {
    const { atlas } = this.game;
    const hovered = this.hover === i && this.state !== 'ok';
    const shaking = this.wrong > 0 && this.wrongSlot === i;
    const dx = shaking ? Math.sin(this.wrong * 60) * 10 : 0;
    const lift = hovered ? 6 : 0;

    ctx.save();
    ctx.translate(dx, -lift);

    ctx.fillStyle = PALETTE.shadow;
    paperPath(ctx, s.x + 4, s.y + 8, s.w, s.h, 20, 33 + i * 5, 3);
    ctx.fill();
    ctx.fillStyle = s.filled ? '#ffeec0' : '#f7edd8';
    paperPath(ctx, s.x, s.y, s.w, s.h, 20, 27 + i * 7, 3);
    ctx.fill();
    ctx.lineWidth = shaking ? 5 : 4;
    ctx.strokeStyle = shaking ? PALETTE.red : PALETTE.ink;
    ctx.stroke();

    const f = atlas.frame(s.frame);
    const scale = Math.min((s.w - 64) / f.w, (s.h - 78) / f.h);
    const cx = s.x + s.w / 2;
    const cy = s.y + (s.h - 26) / 2;
    if (s.filled) {
      atlas.draw(ctx, s.frame, cx, cy, { scale, anchorY: 0.5 });
    } else {
      // трафарет: та же цифра, но выцветшая. Под курсором проявляется сильнее
      const g = ghostFrame(atlas, s.frame, hovered ? 'rgba(240,231,208,.46)' : 'rgba(243,236,216,.7)');
      ctx.drawImage(g, cx - (f.w * scale) / 2, cy - (f.h * scale) / 2, f.w * scale, f.h * scale);
    }

    // номер трафарета - подсказка для клавиш 1, 2, 3
    ctx.fillStyle = '#a08160';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(26, 700);
    ctx.fillText(String(i + 1), cx, s.y + s.h - 18);

    ctx.restore();
  }

  drawDigit(ctx) {
    const { atlas } = this.game;
    const box = this.digitBox();
    const bob = this.held ? 0 : Math.sin(this.t * 3) * 6;
    const scale = box.scale * (this.held ? 1.1 : 1);

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = PALETTE.ink;
    ctx.beginPath();
    ctx.ellipse(box.x + box.w / 2, box.y + box.h + 16 + bob, box.w * 0.42, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    atlas.draw(ctx, this.item.frame, box.x + box.w / 2, box.y + box.h / 2 + bob, {
      scale, anchorY: 0.5,
    });
  }

  /** Пунктирная стрелка от цифры к трафаретам - «неси сюда». */
  drawArrow(ctx) {
    const box = this.digitBox();
    const slot = this.slots[0];
    const x = box.x + box.w / 2;
    const top = slot.y + slot.h + 14;
    const bottom = box.y - 14;
    if (bottom - top < 30) return;

    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(this.t * 3) * 0.2;
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, top + 14);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = PALETTE.ink;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x - 13, top + 20);
    ctx.lineTo(x + 13, top + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawFooter(ctx) {
    const { x, y, w, h } = this.panel;
    let text;
    if (this.state === 'ok') text = 'Цифра вернулась на место.';
    else if (this.wrong > 0) text = 'Не сюда. Смотри на форму.';
    else text = 'Перетащи цифру наверх. Или нажми 1, 2, 3.';

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = this.wrong > 0 ? PALETTE.red : '#8a6b53';
    ctx.font = font(28, 600);
    const lines = wrapText(ctx, this.tr(text), w - 120);
    lines.forEach((line, i) => ctx.fillText(line, x + w / 2, y + h - 40 + (i - lines.length + 1) * 36));
    ctx.restore();
  }
}
