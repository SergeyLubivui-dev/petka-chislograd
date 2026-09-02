import { PALETTE, paperPath, wrapText, drawButton, hit, font } from './ui.js';
import { shimmerText } from './motion.js';
import { readable } from './text.js';
import { drawSum } from './taskArt.js';

/**
 * Финал главы: сначала считаем собранное, потом складываем, и только
 * потом - «глава пройдена».
 *
 * Раньше в конце просто висела несъёмная плашка. Теперь это окно с шагами:
 *
 *   count -> цифры зажигаются по одной, под каждой встаёт её номер:
 *            ребёнок видит, что «собрал» - это «посчитал»;
 *   task  -> сложение из собранных цифр: 1 + 2 = ?, три ответа;
 *   done  -> итог главы и кнопки: «Играть снова», «В меню», «Закрыть».
 *
 * Закрыть можно на любом шаге - тогда плашка исчезает совсем, а вернуться
 * к началу главы можно кнопкой «Заново» в углу экрана.
 *
 * Задания лежат в JSON главы (поле `finale`), в коде их нет.
 */

const LIGHT_STEP = 0.55;    // пауза между зажиганием цифр при счёте, с

export class Finale {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.step = 'count';
    this.task = 0;
    this.t = 0;
    this.wrong = 0;
    this.wrongOption = -1;
    this.buttons = [];
    this.hover = -1;
    this.onRestart = null;
    this.onMenu = null;
    this.onClose = null;
  }

  /**
   * @param {object} chapter глава
   * @param {object[]} collected собранные предметы по порядку
   */
  open(chapter, collected) {
    this.chapter = chapter;
    this.data = chapter.finale ?? {};
    this.collected = collected;
    this.tasks = this.data.tasks ?? [];
    this.active = true;
    this.step = 'count';
    this.task = 0;
    this.t = 0;
    this.wrong = 0;
    this.wrongOption = -1;
    this.hover = -1;
    this.layout();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.onClose?.();
  }

  tr(s) { return readable(s, this.game.settings); }

  /** Сколько цифр уже зажглось на шаге счёта. */
  get lit() {
    return Math.min(this.collected.length, Math.floor(this.t / LIGHT_STEP));
  }

  get counted() { return this.lit >= this.collected.length; }

  /** Кадр для числа: берём у собранной цифры, чтобы задачка была «своей». */
  frameFor(value) {
    const it = this.chapter.pickups.find((p) => p.value === value);
    return it?.frame ?? null;
  }

  // ---------- раскладка ----------

  layout() {
    const { viewW, viewH } = this.game.viewport;
    const w = Math.min(1180, viewW * 0.86);
    const h = Math.min(780, viewH * 0.9);
    const x = (viewW - w) / 2;
    const y = (viewH - h) / 2;
    this.panel = { x, y, w, h };

    this.buttons = [];
    const row = y + h - 118;

    if (this.step === 'count') {
      this.buttons.push({
        id: 'next', label: this.counted ? 'Дальше' : 'Считаем...',
        x: x + (w - 320) / 2, y: row, w: 320, h: 84,
        color: this.counted ? PALETTE.green : PALETTE.paperDark,
      });
    } else if (this.step === 'task') {
      const t = this.tasks[this.task];
      const opts = t?.options ?? [];
      const ow = Math.min(240, (w - 200 - 26 * (opts.length - 1)) / Math.max(1, opts.length));
      let ox = x + (w - (ow * opts.length + 26 * (opts.length - 1))) / 2;
      opts.forEach((o, i) => {
        this.buttons.push({ id: `opt:${i}`, label: String(o), x: ox, y: row - 30, w: ow, h: 96, color: PALETTE.yellow });
        ox += ow + 26;
      });
    } else {
      const labels = [
        { id: 'again', label: 'Играть снова', color: PALETTE.green },
        { id: 'menu', label: 'В меню', color: PALETTE.paper },
        { id: 'close', label: 'Закрыть', color: PALETTE.paper },
      ];
      const bw = Math.min(320, (w - 160 - 24 * (labels.length - 1)) / labels.length);
      let bx = x + (w - (bw * labels.length + 24 * (labels.length - 1))) / 2;
      labels.forEach((b) => {
        this.buttons.push({ ...b, x: bx, y: row, w: bw, h: 84 });
        bx += bw + 24;
      });
    }
  }

  // ---------- ввод ----------

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    if (this.wrong > 0) this.wrong -= dt;
    this.layout();

    const { input } = this.game;
    this.hover = this.buttons.findIndex((b) => hit(b, input.pointer));
    this.game.canvas.classList.toggle('pointer', this.hover >= 0);

    if (input.pointer.clicked && this.hover >= 0) {
      this.choose(this.buttons[this.hover].id);
      return;
    }
    if (this.step === 'task') {
      for (let i = 0; i < 3; i++) {
        if (input.justPressed(`Digit${i + 1}`, `Numpad${i + 1}`)) this.choose(`opt:${i}`);
      }
    } else if (input.justPressed('Space', 'Enter')) {
      if (this.step === 'count') this.choose('next');
    }
    if (input.justPressed('Escape')) this.close();
  }

  choose(id) {
    if (id === 'next') {
      if (!this.counted) { this.t = this.collected.length * LIGHT_STEP; return; }   // досчитать сразу
      this.step = this.tasks.length ? 'task' : 'done';
      this.task = 0;
      this.t = 0;
      return;
    }
    if (id === 'again') { this.active = false; this.onRestart?.(); return; }
    if (id === 'menu') { this.active = false; this.onMenu?.(); return; }
    if (id === 'close') { this.close(); return; }

    if (id.startsWith('opt:')) {
      const i = Number(id.split(':')[1]);
      const t = this.tasks[this.task];
      if (!t) return;
      if (i === t.answer) {
        this.wrong = 0;
        this.wrongOption = -1;
        if (this.task < this.tasks.length - 1) { this.task += 1; this.t = 0; }
        else { this.step = 'done'; this.t = 0; }
      } else {
        this.wrong = 0.6;
        this.wrongOption = i;
      }
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
    paperPath(ctx, x + 6, y + 10, w, h, 26, 43, 4);
    ctx.fill();
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, x, y, w, h, 26, 37, 4);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.restore();

    if (this.step === 'count') this.renderCount(ctx);
    else if (this.step === 'task') this.renderTask(ctx);
    else this.renderDone(ctx);

    this.buttons.forEach((b, i) => {
      const shaking = this.wrong > 0 && b.id === `opt:${this.wrongOption}`;
      const dx = shaking ? Math.sin(this.wrong * 60) * 8 : 0;
      drawButton(ctx, { ...b, x: b.x + dx }, { hover: i === this.hover, seed: 71 + i * 5 });
    });
  }

  title(ctx, text, y) {
    const { x, w } = this.panel;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PALETTE.ink;
    let fs = 48;
    ctx.font = font(fs, 800);
    while (ctx.measureText(text).width > w - 90 && fs > 22) {
      fs -= 2;
      ctx.font = font(fs, 800);
    }
    ctx.fillText(text, x + w / 2, y);
    ctx.restore();
  }

  line(ctx, text, y, size = 30, color = '#8a6b53') {
    const { x, w } = this.panel;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.font = font(size, 600);
    const lines = wrapText(ctx, text, w - 140);
    lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + i * (size + 10)));
    ctx.restore();
    return y + lines.length * (size + 10);
  }

  /** Шаг «посчитаем»: цифры зажигаются по одной, под каждой встаёт её номер. */
  renderCount(ctx) {
    const { atlas } = this.game;
    const { x, y, w } = this.panel;
    this.title(ctx, this.tr(this.data.count || 'Посчитаем, что собрал'), y + 92);

    const n = Math.max(1, this.collected.length);
    const cell = Math.min(170, (w - 160) / n);
    const gap = Math.min(26, cell * 0.16);
    let cx = x + (w - (cell * n + gap * (n - 1))) / 2 + cell / 2;
    const cy = y + 330;

    this.collected.forEach((it, i) => {
      const on = i < this.lit;
      const f = atlas.frame(it.frame);
      const scale = Math.min(cell / f.w, 170 / f.h) * (on ? 1 : 0.86);
      ctx.save();
      ctx.globalAlpha = on ? 1 : 0.28;
      atlas.draw(ctx, it.frame, cx, cy, { scale, anchorY: 0.5 });
      ctx.restore();

      if (on) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = PALETTE.ink;
        ctx.font = font(34, 800);
        ctx.fillText(String(i + 1), cx, cy + 130);
        ctx.restore();
      }
      cx += cell + gap;
    });

    if (this.counted) {
      this.line(ctx, this.tr(`Всего цифр: ${this.collected.length}`), y + 520, 36, PALETTE.ink);
    }
  }

  /** Шаг «сложим»: слагаемые - те самые цифры, что собрал игрок. */
  renderTask(ctx) {
    const { atlas } = this.game;
    const { x, y, w } = this.panel;
    const t = this.tasks[this.task];
    if (!t) return;

    this.title(ctx, this.tr(this.data.title || 'Сложи цифры'), y + 92);
    this.line(ctx, this.tr(`Задача ${this.task + 1} из ${this.tasks.length}`), y + 148, 26);

    // пример рисуется общим кодом - он же во вкладке «Задачи» и у ящиков,
    // поэтому знак минуса не потеряется
    drawSum(ctx, atlas, t, x + w / 2, y + 330, 140);

    const hint = this.wrong > 0
      ? (this.data.wrong || 'Посчитай ещё раз.')
      : (this.data.hint || 'Нажми на верный ответ. Или клавишу 1, 2, 3.');
    this.line(ctx, this.tr(hint), y + 470, 28, this.wrong > 0 ? PALETTE.red : '#8a6b53');
  }

  renderDone(ctx) {
    const { x, y, w } = this.panel;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(54, 800);
    shimmerText(ctx, this.tr(this.data.done || 'Глава пройдена!'), x + w / 2, y + 150, {
      base: PALETTE.ink, highlight: '#ffe9ae', size: 54, time: this.game.time,
    });
    ctx.restore();

    this.line(ctx, this.tr(this.chapter.outro || ''), y + 250, 32, PALETTE.ink);
    this.line(ctx, this.tr(this.data.after || 'Можно пройти главу ещё раз.'), y + 430, 28);
  }
}
