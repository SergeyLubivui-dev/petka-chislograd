import { PALETTE, paperPath, drawButton, hit, font, wrapText, drawCoinBadge, drawCoin, drawLock, drawStar, playClick } from '../core/ui.js';
import { shimmerText, easeOutExpo, REDUCED } from '../core/motion.js';
import { readable } from '../core/text.js';
import { syllabifyText } from '../core/syllables.js';

/**
 * Выбор главы.
 *
 * Карточка на каждую главу: номер, крупный герой, название, жанр (рассказ,
 * сказка, история с выбором), чему учит и что уже сделано. Первая глава
 * открыта всегда; следующие открываются за монетки, которые ребёнок получает
 * за цифры, ящики и задания. Так награда за старание - это новая история.
 *
 * Состояния карточки:
 *   locked    - замок и цена; нажатие при нехватке монет объясняет, где взять;
 *   fresh     - «Играть»: со вступления;
 *   started   - «Продолжить»: в игру, с сохранёнными цифрами и ящиками;
 *   done      - галочка и «Ещё раз».
 *
 * Список глав приходит с сервера (`/api/chapters`): новая глава - это новый
 * JSON, кода не требуется.
 */

const ITEM_GAP = 0.1;
const ITEM_FADE = 0.4;

export class ChapterScene {
  constructor(game) {
    this.game = game;
    this.cards = [];
    this.buttons = [];
    this.hover = -1;
    this.t = 0;
    this.shake = 0;
    this.shakeId = null;
    this.note = null;       // подсказка «не хватает монет»
    this.bump = 0;
  }

  async enter() {
    this.t = 0;
    this.hover = -1;
    this.note = null;
    this.shake = 0;
    this.game.audio.play('chapters');
    this.chapters = this.game.chapters ?? [];
    this.layout();
    // список мог пополниться новой главой, пока игра открыта
    const fresh = await this.game.api.chapters();
    if (fresh?.length) { this.game.chapters = fresh; this.chapters = fresh; this.layout(); }
  }

  tr(s) { return readable(s, this.game.settings); }

  state(ch) {
    const { progress } = this.game;
    if (!progress.isUnlocked(ch.id)) return 'locked';
    if (progress.started(ch.id)) return 'started';
    if (progress.chapter(ch.id).completed) return 'done';
    return 'fresh';
  }

  layout() {
    const { viewport, progress } = this.game;
    const { viewW, viewH, inset } = viewport;
    const n = Math.max(1, this.chapters.length);
    const top = 150;
    const bottom = viewH - 40 - inset.bottom;
    const gap = 26;
    const margin = 50 + inset.left;
    const avail = viewW - margin * 2;
    // на широком экране все главы в ряд, на узком - два ряда
    let cols = n;
    let cw = (avail - gap * (cols - 1)) / cols;
    if (cw < 300 && n > 2) { cols = Math.ceil(n / 2); cw = (avail - gap * (cols - 1)) / cols; }
    cw = Math.min(400, cw);
    const rows = Math.ceil(n / cols);
    const chAvail = (bottom - top - gap * (rows - 1)) / rows;
    const ch = Math.min(rows > 1 ? 380 : 640, chAvail);
    const x0 = (viewW - (cw * cols + gap * (cols - 1))) / 2;
    const y0 = top + ((bottom - top) - (ch * rows + gap * (rows - 1))) / 2;

    this.cards = this.chapters.map((c, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const st = this.state(c);
      return { def: c, state: st, x: x0 + col * (cw + gap), y: y0 + row * (ch + gap), w: cw, h: ch, i, compact: rows > 1 };
    });

    this.buttons = this.cards.map((c) => {
      const st = c.state;
      const label = st === 'locked' ? '' : st === 'started' ? 'Продолжить' : st === 'done' ? 'Ещё раз' : 'Играть';
      const bh = viewport.atLeastPx(76, 48);
      return {
        id: `open:${c.i}`, label: this.tr(label), cost: st === 'locked' ? (c.def.cost ?? 0) : 0,
        x: c.x + 24, y: c.y + c.h - bh - 22, w: c.w - 48, h: bh,
        color: st === 'locked' ? PALETTE.paperDark : st === 'started' ? PALETTE.yellow : PALETTE.green,
      };
    });
    const hh = viewport.atLeastPx(72, 46);
    this.buttons.push({ id: 'home', label: this.tr('Домой'), x: 40 + inset.left, y: 34, w: 180 * (hh / 72), h: hh, color: PALETTE.paper });
    if (this.note) {
      this.buttons.push({ id: 'practice', label: this.tr('Задания'), x: this.note.x + this.note.w - 240, y: this.note.y + this.note.h - 78, w: 200, h: 62, color: PALETTE.blue });
      this.buttons.push({ id: 'note-close', label: this.tr('Понятно'), x: this.note.x + 40, y: this.note.y + this.note.h - 78, w: 200, h: 62, color: PALETTE.paper });
    }
    void progress;
  }

  appear(i) {
    if (REDUCED) return 1;
    const t = this.t - i * ITEM_GAP;
    return t <= 0 ? 0 : Math.min(1, easeOutExpo(t / ITEM_FADE));
  }

  update(dt) {
    this.t += dt;
    if (this.shake > 0) this.shake -= dt;
    if (this.bump > 0) this.bump = Math.max(0, this.bump - dt * 2);
    this.layout();
    const { input, scenes } = this.game;

    this.hover = this.buttons.findIndex((b) => hit(b, input.pointer));
    // карточка целиком - тоже кнопка: попасть по ней ребёнку проще
    if (this.hover < 0 && !this.note) {
      const ci = this.cards.findIndex((c) => hit(c, input.pointer));
      if (ci >= 0) this.hover = this.buttons.findIndex((b) => b.id === `open:${ci}`);
    }
    this.game.canvas.classList.toggle('pointer', this.hover >= 0);

    if (input.pointer.clicked && this.hover >= 0) {
      playClick();
      this.choose(this.buttons[this.hover].id);
      return;
    }
    if (input.back) {
      if (this.note) this.note = null; else scenes.go('menu');
    }
    for (let i = 0; i < this.cards.length && i < 9; i++) {
      if (input.justPressed(`Digit${i + 1}`, `Numpad${i + 1}`)) this.choose(`open:${i}`);
    }
  }

  choose(id) {
    const { scenes, progress, audio } = this.game;
    if (id === 'home') { scenes.go('menu'); return; }
    if (id === 'practice') { scenes.go('practice'); return; }
    if (id === 'note-close') { this.note = null; return; }
    if (!id.startsWith('open:')) return;
    if (this.note) { this.note = null; return; }

    const card = this.cards[Number(id.split(':')[1])];
    if (!card) return;
    const ch = card.def;

    if (card.state === 'locked') {
      const cost = ch.cost ?? 0;
      if (progress.unlock(ch.id, cost)) {
        audio.unlock_();
        this.bump = 1;
        this.layout();
        return;
      }
      audio.wrong();
      this.shake = 0.5;
      this.shakeId = ch.id;
      const need = cost - progress.coins;
      this.note = { text: `Не хватает ${need} ${coinsWord(need)}. Монетки дают за цифры, ящики и за круги в «Заданиях».` };
      return;
    }

    progress.data.lastChapter = ch.id;
    if (card.state === 'started') scenes.go('game', { chapter: ch.id, resume: true });
    else scenes.go('story', { chapter: ch.id });
  }

  // ---------- отрисовка ----------

  render() {
    const { viewport, progress, input } = this.game;
    const ctx = viewport.ctx;
    const { viewW, viewH, inset } = viewport;
    if (!this.cards.length) this.layout();
    viewport.applyUI();

    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, viewW, viewH);
    this.drawBackdrop(ctx, viewW, viewH);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    shimmerText(ctx, this.tr('Главы'), viewW / 2, 96, {
      base: PALETTE.ink, highlight: '#ffe9ae', size: 62, time: this.game.time,
    });
    ctx.restore();

    this.cards.forEach((c, i) => {
      const a = this.appear(i);
      if (a > 0) this.drawCard(ctx, c, a);
    });

    this.buttons.forEach((b, i) => {
      if (b.id.startsWith('open:')) {
        const c = this.cards[Number(b.id.split(':')[1])];
        if (this.appear(c.i) <= 0.05) return;
        if (c.state === 'locked') { this.drawCostButton(ctx, b, c, i === this.hover); return; }
      }
      if (this.note && !['practice', 'note-close'].includes(b.id) && b.id !== 'home') return;
      drawButton(ctx, b, { hover: i === this.hover, seed: 121 + i * 5 });
    });

    drawCoinBadge(ctx, viewW - 40 - inset.right, 34, progress.coins, {
      h: viewport.atLeastPx(72, 46), seed: 9, bump: this.bump, time: this.game.time, align: 'right',
    });

    if (this.note) this.drawNote(ctx);
    void input;
  }

  /** Лёгкие «облачка» бумаги на фоне, чтобы экран не был пустым белым листом. */
  drawBackdrop(ctx, w, h) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#f6ecd6';
    for (let i = 0; i < 6; i++) {
      const x = (i * 0.37 + 0.05) * w + Math.sin(this.game.time * 0.2 + i) * 20;
      const y = (i % 2 ? 0.2 : 0.75) * h + Math.cos(this.game.time * 0.15 + i * 2) * 12;
      ctx.beginPath();
      ctx.ellipse(x, y, 260, 90, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawCard(ctx, c, alpha) {
    const { atlas, progress } = this.game;
    const ch = c.def;
    const locked = c.state === 'locked';
    const shaking = this.shake > 0 && this.shakeId === ch.id;
    const dx = shaking ? Math.sin(this.shake * 50) * 8 : 0;
    const hovered = this.hover >= 0 && this.buttons[this.hover]?.id === `open:${c.i}`;
    const lift = hovered ? 6 : 0;
    const y = c.y + (1 - alpha) * 24 - lift;
    const x = c.x + dx;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = PALETTE.shadow;
    paperPath(ctx, x + 6, y + 10, c.w, c.h, 26, 141 + c.i * 7, 3.5);
    ctx.fill();
    ctx.fillStyle = locked ? '#f4ecda' : '#fffaf0';
    paperPath(ctx, x, y, c.w, c.h, 26, 131 + c.i * 9, 3.5);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();

    // номер главы - ярлычок в углу
    const tagW = 150, tagH = 46;
    ctx.fillStyle = locked ? PALETTE.paperDark : PALETTE.yellow;
    paperPath(ctx, x + 18, y - 14, tagW, tagH, 14, 151 + c.i, 2);
    ctx.fill();
    ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(24, 800);
    ctx.fillText(this.tr(`Глава ${ch.number ?? c.i + 1}`), x + 18 + tagW / 2, y - 14 + tagH / 2 + 1);

    // герой главы
    const boxH = c.compact ? c.h * 0.32 : c.h * 0.36;
    const iconFrame = atlas.has(ch.icon) ? ch.icon : 'petka_big';
    const f = atlas.frame(iconFrame);
    const s = Math.min((c.w - 80) / f.w, boxH / f.h);
    const baseY = y + 44 + boxH;
    ctx.save();
    if (locked) ctx.globalAlpha *= 0.45;
    const k = Math.sin(this.game.time * 1.4 + c.i);
    atlas.draw(ctx, iconFrame, x + c.w / 2, baseY, { scaleY: s * (1 + k * 0.015), scaleX: s * (1 - k * 0.008) });
    ctx.restore();
    if (locked) drawLock(ctx, x + c.w / 2, baseY - boxH * 0.45, Math.min(110, boxH * 0.6));

    let ty = baseY + 44;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PALETTE.ink;
    fitText(ctx, this.tr(ch.title ?? ''), x + c.w / 2, ty, c.w - 40, c.compact ? 26 : 32, 800);

    if (ch.subtitle) {
      ty += c.compact ? 28 : 34;
      ctx.fillStyle = '#7c9a5c';
      fitText(ctx, this.tr(ch.subtitle), x + c.w / 2, ty, c.w - 40, c.compact ? 20 : 24, 700);
    }

    // прогресс: что сделано в главе
    const bh = this.buttons[c.i]?.h ?? 76;
    const py = y + c.h - bh - 22 - 40;

    // описание - сколько строк влезает между жанром и полоской прогресса
    if (!c.compact && ch.summary) {
      ty += 36;
      const maxLines = Math.floor((py - 40 - ty) / 28);
      if (maxLines > 0) {
        ctx.fillStyle = PALETTE.ink;
        ctx.font = font(21, 400);
        const lines = wrapText(ctx, this.tr(ch.summary), c.w - 56).slice(0, Math.min(4, maxLines));
        lines.forEach((l) => { ctx.fillText(l, x + c.w / 2, ty); ty += 28; });
      }
    }
    this.drawProgress(ctx, c, x, py, progress);
    ctx.restore();
  }

  /** Полоска с собранными цифрами; у пройденной главы - звёздочки. */
  drawProgress(ctx, c, x, y, progress) {
    const ch = c.def;
    const st = progress.chapter(ch.id);
    const total = ch.pickups ?? 0;
    const cx = x + c.w / 2;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (c.state === 'locked') {
      ctx.fillStyle = '#a08160';
      ctx.font = font(22, 600);
      ctx.fillText(this.tr('Закрыто'), cx, y);
    } else if (c.state === 'done') {
      const n = Math.min(3, st.completed);
      for (let i = 0; i < 3; i++) drawStar(ctx, cx - 44 + i * 44, y, 17, i < n);
    } else {
      const got = st.collected?.length ?? 0;
      const bw = c.w - 80, bhh = 18;
      const bx = x + 40;
      ctx.fillStyle = '#f0e0bd';
      paperPath(ctx, bx, y - bhh / 2, bw, bhh, 9, 161 + c.i, 1.2);
      ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
      if (total && got) {
        ctx.save();
        ctx.beginPath(); ctx.rect(bx, y - bhh, bw * Math.min(1, got / total), bhh * 2); ctx.clip();
        ctx.fillStyle = PALETTE.green;
        paperPath(ctx, bx, y - bhh / 2, bw, bhh, 9, 161 + c.i, 1.2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#8a6b53';
      ctx.font = font(20, 600);
      ctx.fillText(this.tr(got ? `Цифр: ${got} из ${total}` : `Цифр найти: ${total}`), cx, y - 26);
    }
    ctx.restore();
  }

  /** Кнопка закрытой главы: «Открыть за N» с монеткой. */
  drawCostButton(ctx, b, c, hovered) {
    const { progress } = this.game;
    const enough = progress.coins >= (c.def.cost ?? 0);
    drawButton(ctx, { ...b, label: '', color: enough ? PALETTE.yellow : PALETTE.paperDark }, { hover: hovered, seed: 171 + c.i * 3 });
    const lift = hovered ? 4 : 0;
    const cy = b.y + b.h / 2 - lift + 2;
    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const text = this.tr('Открыть за');
    const num = String(c.def.cost ?? 0);
    // кегль подбирается так, чтобы надпись с монеткой влезла в кнопку
    let fs = Math.round(b.h * 0.38);
    let r, numW, total;
    for (;;) {
      r = fs * 0.62;
      ctx.font = font(fs, 800);
      numW = ctx.measureText(num).width;
      ctx.font = font(fs, 700);
      total = ctx.measureText(text).width + 14 + r * 2 + 10 + numW;
      if (total <= b.w - 24 || fs <= 12) break;
      fs -= 1;
    }
    let tx = b.x + (b.w - total) / 2;
    ctx.fillText(text, tx, cy);
    tx += ctx.measureText(text).width + 14 + r;
    drawCoin(ctx, tx, cy, r);
    tx += r + 10;
    ctx.font = font(fs, 800);
    ctx.fillText(num, tx, cy);
    ctx.restore();
  }

  drawNote(ctx) {
    const { viewport } = this.game;
    const { viewW, viewH } = viewport;
    const w = Math.min(820, viewW * 0.7);
    ctx.save();
    ctx.font = font(28, 600);
    const lines = wrapText(ctx, this.tr(this.note.text), w - 100);
    const h = 120 + lines.length * 38 + 80;
    const x = (viewW - w) / 2, y = (viewH - h) / 2;
    this.note.x = x; this.note.y = y; this.note.w = w; this.note.h = h;

    ctx.fillStyle = 'rgba(60,42,30,.3)';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = PALETTE.shadow;
    paperPath(ctx, x + 6, y + 10, w, h, 26, 181, 4);
    ctx.fill();
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, x, y, w, h, 26, 177, 4);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(40, 800);
    ctx.fillText(this.tr('Пока закрыто'), x + w / 2, y + 66);
    ctx.font = font(28, 600);
    ctx.fillStyle = '#5a3f2e';
    lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + 122 + i * 38));
    ctx.restore();

    // кнопки подсказки рисуются поверх подложки
    this.buttons.forEach((b, i) => {
      if (b.id === 'practice' || b.id === 'note-close') drawButton(ctx, b, { hover: i === this.hover, seed: 191 + i });
    });
  }
}

function fitText(ctx, text, x, y, maxW, size, weight) {
  let fs = size;
  ctx.font = font(fs, weight);
  while (ctx.measureText(text).width > maxW && fs > 14) {
    fs -= 1;
    ctx.font = font(fs, weight);
  }
  ctx.fillText(text, x, y);
}

/** «Не хватает одной монетки / пяти монеток» - родительный падеж. */
function coinsWord(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (b === 1 && a !== 11) return 'монетки';
  return 'монеток';
}

void syllabifyText;
