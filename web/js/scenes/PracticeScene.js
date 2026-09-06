import { PALETTE, paperPath, drawButton, hit, font, wrapText, drawCoinBadge, drawCoin, drawStar, playClick } from '../core/ui.js';
import { shimmerText } from '../core/motion.js';
import { readable } from '../core/text.js';
import { drawSum, drawCount, drawMissingWord } from '../core/taskArt.js';

/**
 * «Задачи» - тренировка на закрепление, отдельно от главы.
 *
 * Две вкладки:
 *   Чтение - прочитать слово и выбрать картинку (или наоборот);
 *   Счёт   - посчитать предметы, сложить или вычесть.
 *
 * Круг идёт на время: наверху полоска обратного отсчёта. Круг кончается,
 * когда решены все задачи или вышло время. Итог - сколько решено, за сколько
 * и сколько ошибок; лучший результат по каждой вкладке помнится в браузере.
 *
 * Задачи целиком лежат в `server/content/practice.json`, в коде их нет.
 */

const WRONG_TIME = 0.5;     // сколько дрожит неверный ответ
const GOOD_TIME = 0.45;     // сколько держится зелёная отметка

export class PracticeScene {
  constructor(game) {
    this.game = game;
    this.data = null;
    this.tab = 0;
    this.buttons = [];
    this.hover = -1;
    this.state = 'play';       // play | done
    this.round = 0;
  }

  async enter() {
    this.game.audio.play('practice');
    this.data = await this.game.api.content('practice');
    this.tab = 0;
    this.round = 0;
    this.coinBump = 0;
    this.start(0);
  }

  get labels() { return this.data?.labels ?? {}; }
  get sheet() { return this.data?.tabs?.[this.tab] ?? { tasks: [] }; }
  get task() { return this.sheet.tasks[this.order[this.index]] ?? null; }

  tr(s) { return readable(s, this.game.settings); }

  /** Новый круг: задачи перемешиваются, чтобы вторая попытка не была той же. */
  start(tab) {
    this.tab = tab;
    this.round += 1;
    this.state = 'play';
    this.index = 0;
    this.solved = 0;
    this.mistakes = 0;
    this.wrong = 0;
    this.wrongOption = -1;
    this.good = 0;
    this.left = this.sheet.seconds ?? 120;
    this.spent = 0;
    this.order = shuffle(this.sheet.tasks.length, this.round * 7919 + tab * 131);
    this.hover = -1;
  }

  /**
   * Круг окончен: монеты за каждую решённую задачу и премия за полный круг.
   * Лучший результат по вкладке хранит общий прогресс (`Progress`), а не
   * отдельный ключ: так «знания» видны и на экране выбора глав.
   */
  finish(timeout) {
    this.state = 'done';
    this.timeout = !!timeout;
    const { progress, audio } = this.game;
    const prev = progress.bestFor(this.sheet.id);
    const now = { solved: this.solved, seconds: Math.round(this.spent), mistakes: this.mistakes };
    this.record = isBetter(now, prev);
    this.earned = progress.practiceRound(this.sheet.id, now, this.sheet.tasks.length);
    this.best = progress.bestFor(this.sheet.id);
    this.coinBump = 1;
    if (this.earned) audio.coin();
    if (this.solved >= this.sheet.tasks.length) audio.fanfare();
  }

  // ---------- ввод ----------

  update(dt) {
    if (!this.data) return;
    const { input } = this.game;

    if (this.state === 'play') {
      this.spent += dt;
      this.left -= dt;
      if (this.wrong > 0) this.wrong -= dt;
      if (this.good > 0) {
        this.good -= dt;
        if (this.good <= 0) this.next();
      }
      if (this.left <= 0) { this.left = 0; this.finish(true); }
    }

    if (this.coinBump > 0) this.coinBump = Math.max(0, this.coinBump - dt * 1.4);
    this.layout();
    this.hover = this.buttons.findIndex((b) => hit(b, input.pointer));
    this.game.canvas.classList.toggle('pointer', this.hover >= 0);

    if (input.pointer.clicked && this.hover >= 0) {
      playClick();
      this.choose(this.buttons[this.hover].id);
      return;
    }
    if (this.state === 'play' && this.good <= 0) {
      for (let i = 0; i < 3; i++) {
        if (input.justPressed(`Digit${i + 1}`, `Numpad${i + 1}`)) this.choose(`opt:${i}`);
      }
    }
    if (input.back) this.game.scenes.go('menu');
  }

  choose(id) {
    if (id === 'home') { this.game.scenes.go('menu'); return; }
    if (id === 'again') { this.start(this.tab); return; }
    if (id.startsWith('tab:')) { this.start(Number(id.split(':')[1])); return; }
    if (!id.startsWith('opt:') || this.state !== 'play' || this.good > 0) return;

    const i = Number(id.split(':')[1]);
    if (i === this.task?.answer) {
      this.solved += 1;
      this.good = GOOD_TIME;
      this.wrong = 0;
      this.wrongOption = -1;
      this.game.audio.correct();
    } else {
      this.mistakes += 1;
      this.wrong = WRONG_TIME;
      this.wrongOption = i;
      this.game.audio.wrong();
    }
  }

  next() {
    if (this.index >= this.sheet.tasks.length - 1) { this.finish(false); return; }
    this.index += 1;
    this.wrong = 0;
    this.wrongOption = -1;
  }

  // ---------- раскладка ----------

  layout() {
    const { viewW, viewH } = this.game.viewport;
    this.buttons = [];

    // вкладки слева, «домой» справа
    const tabs = this.data.tabs ?? [];
    const { inset } = this.game.viewport;
    const th = this.game.viewport.atLeastPx(78, 48);
    let x = 40 + inset.left;
    tabs.forEach((t, i) => {
      this.buttons.push({
        id: `tab:${i}`, label: this.tr(t.title), x, y: 30 + inset.top, w: 260, h: th,
        color: i === this.tab ? PALETTE.yellow : PALETTE.paper,
      });
      x += 276;
    });
    this.buttons.push({
      id: 'home', label: this.tr(this.labels.home || 'Домой'),
      x: viewW - 220 - inset.right, y: 30 + inset.top, w: 180, h: th, color: PALETTE.paper,
    });

    this.bar = { x: 40 + inset.left, y: 132 + inset.top, w: viewW - 80 - inset.left - inset.right, h: 26 };

    if (this.state === 'done') {
      const bw = 300;
      const total = bw * 2 + 24;
      let bx = (viewW - total) / 2;
      [['again', this.labels.again || 'Ещё раз', PALETTE.green],
        ['home', this.labels.home || 'Домой', PALETTE.paper]].forEach(([id, label, color]) => {
        this.buttons.push({ id, label: this.tr(label), x: bx, y: viewH - 150 - inset.bottom, w: bw, h: 88, color });
        bx += bw + 24;
      });
      return;
    }

    const task = this.task;
    if (!task) return;
    const opts = task.options ?? [];
    const pictures = opts.every((o) => this.game.atlas.has(o));

    // на низком экране (телефон) варианты ниже, чтобы задача над ними влезла
    const ow = pictures ? Math.min(330, (viewW - 200) / opts.length) : Math.min(300, (viewW - 200) / opts.length);
    const oh = pictures ? Math.min(300, viewH * 0.3) : Math.min(130, viewH * 0.13);
    const gap = 30;
    let ox = (viewW - (ow * opts.length + gap * (opts.length - 1))) / 2;
    const oy = viewH - oh - Math.min(150, viewH * 0.1) - inset.bottom;
    opts.forEach((o, i) => {
      this.buttons.push({
        id: `opt:${i}`, label: pictures ? '' : this.tr(o), frame: pictures ? o : null,
        x: ox, y: oy, w: ow, h: oh, color: pictures ? PALETTE.paper : PALETTE.yellow, index: i,
      });
      ox += ow + gap;
    });
  }

  // ---------- отрисовка ----------

  render() {
    const { viewport } = this.game;
    const ctx = viewport.ctx;
    const { viewW, viewH } = viewport;
    viewport.applyUI();

    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, viewW, viewH);
    if (!this.data) return;
    if (!this.buttons.length) this.layout();

    if (this.state === 'done') this.renderResult(ctx);
    else this.renderTask(ctx);

    this.drawTimer(ctx);
    // кошелёк - между вкладками и «Домой»
    const homeBtn = this.buttons.find((b) => b.id === 'home');
    if (homeBtn) {
      drawCoinBadge(ctx, homeBtn.x - 24, homeBtn.y + (homeBtn.h - 64) / 2, this.game.progress.coins, {
        h: 64, seed: 9, bump: this.coinBump, time: this.game.time, align: 'right',
      });
    }

    this.buttons.forEach((b, i) => {
      const shaking = this.wrong > 0 && b.id === `opt:${this.wrongOption}`;
      const right = this.good > 0 && b.id === `opt:${this.task?.answer}`;
      const dx = shaking ? Math.sin(this.wrong * 60) * 9 : 0;
      const color = right ? PALETTE.green : (shaking ? PALETTE.red : b.color);
      drawButton(ctx, { ...b, x: b.x + dx, color }, { hover: i === this.hover, seed: 81 + i * 4 });
      if (b.frame) this.drawOptionPicture(ctx, { ...b, x: b.x + dx });
    });
  }

  /** Полоска обратного отсчёта: видно, сколько времени осталось. */
  drawTimer(ctx) {
    const { x, y, w, h } = this.bar;
    const total = this.sheet.seconds ?? 120;
    const k = Math.max(0, Math.min(1, this.left / total));

    ctx.save();
    ctx.fillStyle = '#f0e0bd';
    paperPath(ctx, x, y, w, h, 12, 51, 1.5);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    if (k > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y - 4, w * k, h + 8);
      ctx.clip();
      ctx.fillStyle = k > 0.25 ? PALETTE.green : PALETTE.red;
      paperPath(ctx, x, y, w, h, 12, 51, 1.5);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(26, 700);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${this.tr(this.labels.left || 'Осталось')}: ${clock(this.left)}`, x, y + h + 34);

    if (this.state === 'play') {
      ctx.textAlign = 'right';
      const n = this.sheet.tasks.length;
      ctx.fillText(
        `${this.tr(this.labels.task || 'Задача')} ${this.index + 1} ${this.tr(this.labels.of || 'из')} ${n}`,
        x + w, y + h + 34,
      );
    }
    ctx.restore();
  }

  renderTask(ctx) {
    const task = this.task;
    if (!task) return;
    const { viewW, viewH } = this.game.viewport;
    const cx = viewW / 2;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#8a6b53';
    ctx.font = font(28, 600);
    const hint = this.wrong > 0 ? (this.labels.wrong || 'Не то. Попробуй ещё') : (this.sheet.hint || '');
    if (this.wrong > 0) ctx.fillStyle = PALETTE.red;
    if (this.good > 0) { ctx.fillStyle = '#5f8c3f'; }
    ctx.fillText(this.tr(this.good > 0 ? (this.labels.correct || 'Верно!') : hint), cx, 236);
    ctx.restore();

    // область задачи - между подсказкой (y≈236) и вариантами ответа
    const top = 250;
    const bottom = (this.buttons.find((b) => b.id === 'opt:0')?.y ?? viewH - 300) - 20;
    const mid = (top + bottom) / 2;
    const room = Math.max(120, bottom - top);
    if (task.missing !== undefined) {
      // картинка сверху, под ней слово с пропуском: букву надо вставить
      if (task.frame) this.drawBigPicture(ctx, task.frame, top + room * 0.32, room * 0.5);
      drawMissingWord(ctx, task.missing, viewW / 2, top + room * 0.82, viewW * 0.7, Math.min(110, room * 0.28));
    } else if (task.word !== undefined) this.drawWord(ctx, task.word, mid);
    else if (task.count !== undefined) {
      drawCount(ctx, this.game.atlas, task, viewW / 2, mid + room * 0.1, viewW * 0.8, Math.min(250, room * 0.7), this.game.time);
    } else if (task.a !== undefined) drawSum(ctx, this.game.atlas, task, viewW / 2, mid, Math.min(150, room * 0.5));
    else if (task.frame) this.drawBigPicture(ctx, task.frame, mid, Math.min(300, room * 0.8));
  }

  /** Слово крупно - его и надо прочитать. */
  drawWord(ctx, word, cy = 420) {
    const { viewW, viewH } = this.game.viewport;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ink;
    let fs = Math.min(130, viewH * 0.14);
    ctx.font = font(fs, 800);
    const text = this.tr(word);
    while (ctx.measureText(text).width > viewW * 0.8 && fs > 40) {
      fs -= 4;
      ctx.font = font(fs, 800);
    }
    ctx.fillText(text, viewW / 2, cy);
    ctx.restore();
  }

  drawBigPicture(ctx, frame, cy = 420, maxH = 300) {
    const { atlas, viewport } = this.game;
    const f = atlas.frame(frame);
    const scale = Math.min((viewport.viewW * 0.34) / f.w, maxH / f.h);
    atlas.draw(ctx, frame, viewport.viewW / 2, cy, { scale, anchorY: 0.5 });
  }

  /** Картинка внутри кнопки-ответа. */
  drawOptionPicture(ctx, b) {
    const { atlas } = this.game;
    const f = atlas.frame(b.frame);
    const scale = Math.min((b.w - 60) / f.w, (b.h - 60) / f.h);
    atlas.draw(ctx, b.frame, b.x + b.w / 2, b.y + b.h / 2, { scale, anchorY: 0.5 });
    ctx.save();
    ctx.fillStyle = '#a08160';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(24, 700);
    ctx.fillText(String(b.index + 1), b.x + b.w / 2, b.y + b.h - 16);
    ctx.restore();
  }

  renderResult(ctx) {
    const { viewW, viewH } = this.game.viewport;
    const w = Math.min(1000, viewW * 0.8);
    const x = (viewW - w) / 2;
    const y = 200;
    const h = Math.min(500, viewH - 200 - 170);

    ctx.save();
    ctx.fillStyle = PALETTE.shadow;
    paperPath(ctx, x + 6, y + 10, w, h, 26, 61, 4);
    ctx.fill();
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, x, y, w, h, 26, 57, 4);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(52, 800);
    const title = this.timeout ? (this.labels.timeout || 'Время вышло') : (this.labels.done || 'Готово!');
    shimmerText(ctx, this.tr(title), x + w / 2, y + 96, {
      base: PALETTE.ink, highlight: '#ffe9ae', size: 52, time: this.game.time,
    });

    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(38, 700);
    const total = this.sheet.tasks.length;
    ctx.fillText(
      `${this.tr(this.labels.result || 'Решено')}: ${this.solved} ${this.tr(this.labels.of || 'из')} ${total}`,
      x + w / 2, y + 176,
    );
    ctx.font = font(30, 600);
    ctx.fillStyle = '#8a6b53';
    ctx.fillText(`${this.tr(this.labels.mistakes || 'Ошибок')}: ${this.mistakes}   ·   ${this.tr('Время')}: ${clock(this.spent)}`, x + w / 2, y + 226);

    // награда: монетки за круг и звёзды «знаний» по вкладке
    const earned = this.earned ?? 0;
    ctx.font = font(34, 800);
    ctx.fillStyle = PALETTE.ink;
    const label = `+${earned}`;
    const lw = ctx.measureText(label).width + 56;
    drawCoin(ctx, x + w / 2 - lw / 2 + 20, y + 280, 22, { spin: this.coinBump > 0 ? this.game.time * 8 : 0 });
    ctx.textAlign = 'left';
    ctx.fillText(label, x + w / 2 - lw / 2 + 56, y + 280 + 12);
    ctx.textAlign = 'center';
    const stars = this.game.progress.stars(this.sheet.id, total);
    for (let i = 0; i < 3; i++) drawStar(ctx, x + w / 2 - 48 + i * 48, y + 344, 20, i < stars);
    ctx.font = font(22, 600);
    ctx.fillStyle = '#8a6b53';
    ctx.fillText(this.tr(stars >= 3 ? 'Все задачи решены!' : 'Реши все задачи в круге - получишь три звезды'), x + w / 2, y + 392);

    if (this.best) {
      ctx.font = font(26, 600);
      ctx.fillStyle = this.record ? '#5f8c3f' : '#a08160';
      const best = `${this.tr(this.labels.best || 'Лучший раз')}: ${this.best.solved} ${this.tr(this.labels.of || 'из')} ${total}, ${clock(this.best.seconds)}`;
      wrapText(ctx, best, w - 120).forEach((line, i) => ctx.fillText(line, x + w / 2, y + 440 + i * 34));
    }
    ctx.restore();
    void viewH;
  }
}

// ---------- мелочи ----------

/** Порядок задач на круг: перемешиваем детерминированно от номера круга. */
function shuffle(n, seed) {
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Лучше - это больше решено, а при равенстве быстрее. */
function isBetter(now, best) {
  if (!best) return true;
  if (now.solved !== best.solved) return now.solved > best.solved;
  return now.seconds < best.seconds;
}
