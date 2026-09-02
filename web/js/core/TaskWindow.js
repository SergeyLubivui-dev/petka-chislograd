import { PALETTE, paperPath, drawButton, hit, font, wrapText, ghostFrame } from './ui.js';
import { readable } from './text.js';
import { drawSum, drawCount, drawMissingWord } from './taskArt.js';

/**
 * Окно задачи у препятствия.
 *
 * На уровне стоят ящики, которые не обойти и не перепрыгнуть. Чтобы сдвинуть
 * ящик, надо решить задачу - и задача собрана из тех самых цифр, которые
 * ребёнок только что нашёл. Поэтому у препятствия два состояния:
 *
 *   need - нужные цифры ещё не собраны: показываем, каких не хватает;
 *   task - всё собрано: показываем пример и три ответа.
 *
 * Задачи бывают трёх видов (см. `taskArt.js`): пример, пересчёт предметов
 * и слово с пропущенной буквой.
 */

const WRONG_TIME = 0.55;
const DONE_TIME = 1.1;

export class TaskWindow {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.mode = 'task';
    this.state = 'ask';
    this.t = 0;
    this.wrong = 0;
    this.wrongOption = -1;
    this.buttons = [];
    this.hover = -1;
    this.onSolved = null;
    this.onClose = null;
  }

  /**
   * @param {object} o { mode, task, need, title, hint }
   *        need - список кадров цифр, которых не хватает
   */
  open(o) {
    this.active = true;
    this.mode = o.mode ?? 'task';
    this.task = o.task ?? null;
    this.need = o.need ?? [];
    this.title = o.title ?? '';
    this.hint = o.hint ?? '';
    this.state = 'ask';
    this.t = 0;
    this.wrong = 0;
    this.wrongOption = -1;
    this.hover = -1;
    this.layout();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.onClose?.(this.state === 'ok');
  }

  tr(s) { return readable(s, this.game.settings); }

  layout() {
    const { viewW, viewH } = this.game.viewport;
    const w = Math.min(1120, viewW * 0.84);
    const h = Math.min(660, viewH * 0.8);
    const x = (viewW - w) / 2;
    const y = (viewH - h) / 2;
    this.panel = { x, y, w, h };
    this.buttons = [];

    if (this.mode === 'need') {
      this.buttons.push({
        id: 'close', label: this.tr('Понятно'),
        x: x + (w - 320) / 2, y: y + h - 120, w: 320, h: 84, color: PALETTE.green,
      });
      return;
    }

    const opts = this.task?.options ?? [];
    const ow = Math.min(240, (w - 160 - 26 * (opts.length - 1)) / Math.max(1, opts.length));
    let ox = x + (w - (ow * opts.length + 26 * (opts.length - 1))) / 2;
    opts.forEach((o, i) => {
      this.buttons.push({
        id: `opt:${i}`, label: this.tr(o), x: ox, y: y + h - 150, w: ow, h: 104, color: PALETTE.yellow,
      });
      ox += ow + 26;
    });
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    if (this.wrong > 0) this.wrong -= dt;
    this.layout();

    const { input } = this.game;
    if (this.state === 'ok') {
      if (this.t >= DONE_TIME) this.close();
      return;
    }

    this.hover = this.buttons.findIndex((b) => hit(b, input.pointer));
    this.game.canvas.classList.toggle('pointer', this.hover >= 0);

    if (input.pointer.clicked && this.hover >= 0) { this.choose(this.buttons[this.hover].id); return; }
    if (this.mode === 'task') {
      for (let i = 0; i < 3; i++) {
        if (input.justPressed(`Digit${i + 1}`, `Numpad${i + 1}`)) this.choose(`opt:${i}`);
      }
    } else if (input.interact) {
      this.close();
      return;
    }
    if (input.justPressed('Escape')) this.close();
  }

  choose(id) {
    if (id === 'close') { this.close(); return; }
    if (!id.startsWith('opt:') || this.state === 'ok') return;
    const i = Number(id.split(':')[1]);
    if (i === this.task.answer) {
      this.state = 'ok';
      this.t = 0;
      this.onSolved?.();
    } else {
      this.wrong = WRONG_TIME;
      this.wrongOption = i;
    }
  }

  // ---------- отрисовка ----------

  render() {
    if (!this.active) return;
    if (!this.panel) this.layout();
    const { viewport, atlas } = this.game;
    const ctx = viewport.ctx;
    viewport.applyUI();

    ctx.save();
    ctx.fillStyle = 'rgba(60,42,30,.34)';
    ctx.fillRect(0, 0, viewport.viewW, viewport.viewH);
    ctx.restore();

    const { x, y, w, h } = this.panel;
    ctx.save();
    ctx.fillStyle = PALETTE.shadow;
    paperPath(ctx, x + 6, y + 10, w, h, 26, 47, 4);
    ctx.fill();
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, x, y, w, h, 26, 41, 4);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.restore();

    // заголовок
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PALETTE.ink;
    let fs = 46;
    const title = this.tr(this.state === 'ok' ? 'Ящик поехал!' : this.title);
    ctx.font = font(fs, 800);
    while (ctx.measureText(title).width > w - 90 && fs > 22) {
      fs -= 2;
      ctx.font = font(fs, 800);
    }
    ctx.fillText(title, x + w / 2, y + 88);
    ctx.restore();

    if (this.mode === 'need') this.renderNeed(ctx);
    else this.renderTask(ctx);

    // подпись внизу
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(26, 600);
    ctx.fillStyle = this.wrong > 0 ? PALETTE.red : '#8a6b53';
    const hint = this.wrong > 0 ? 'Не то. Посчитай ещё раз' : this.hint;
    if (this.state !== 'ok') {
      wrapText(ctx, this.tr(hint), w - 140).forEach((line, i) => {
        ctx.fillText(line, x + w / 2, y + h - 176 + i * 32);
      });
    }
    ctx.restore();

    if (this.state !== 'ok' || this.mode === 'need') {
      this.buttons.forEach((b, i) => {
        const shaking = this.wrong > 0 && b.id === `opt:${this.wrongOption}`;
        const dx = shaking ? Math.sin(this.wrong * 60) * 9 : 0;
        drawButton(ctx, { ...b, x: b.x + dx, color: shaking ? PALETTE.red : b.color },
          { hover: i === this.hover, seed: 91 + i * 4 });
      });
    }
    void atlas;
  }

  /** Каких цифр не хватает - показываем трафаретами, как в полоске внизу. */
  renderNeed(ctx) {
    const { atlas } = this.game;
    const { x, y, w } = this.panel;
    const n = Math.max(1, this.need.length);
    const cell = 150;
    let cx = x + w / 2 - (cell * n) / 2 + cell / 2;

    this.need.forEach((frame) => {
      const f = atlas.frame(frame);
      const scale = Math.min(110 / f.w, 150 / f.h);
      const g = ghostFrame(atlas, frame, 'rgba(243,236,216,.6)');
      ctx.drawImage(g, cx - (f.w * scale) / 2, y + 210, f.w * scale, f.h * scale);
      cx += cell;
    });
  }

  renderTask(ctx) {
    const { atlas } = this.game;
    const { x, y, w } = this.panel;
    const cx = x + w / 2;
    const task = this.task;
    if (!task) return;

    if (task.missing) drawMissingWord(ctx, task.missing, cx, y + 300, w - 200, 120);
    else if (task.count !== undefined) drawCount(ctx, atlas, task, cx, y + 360, w - 200, 190, this.game.time);
    else drawSum(ctx, atlas, task, cx, y + 300, 150);
  }
}
