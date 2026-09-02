import { PALETTE, drawButton, hit, font, wrapText } from '../core/ui.js';
import { syllabifyText } from '../core/syllables.js';

/**
 * Первый экран: «Как ты читаешь?».
 *
 * Дети приходят с очень разным чтением, и одна и та же фраза для одного
 * коротка, а другого пугает. Поэтому уровень спрашивается сразу, до всего
 * остального, и от него зависит длина текстов во вступлении, в диалогах и
 * в задачах (развилки `low / mid / high` прямо в JSON).
 *
 * Заодно выбор задаёт разумную начальную настройку слогов: тем, кто читает
 * по складам, они нужны, а уверенному читателю только мешают.
 *
 * Экран показывается один раз - выбор запоминается. Поменять можно из меню.
 */

const CARDS = [
  {
    level: 'low',
    title: 'По слогам',
    text: 'Читаю медленно, по складам',
    frame: 'cat_big',
    color: PALETTE.green,
    syllables: true,
  },
  {
    level: 'mid',
    title: 'Немного умею',
    text: 'Короткие слова читаю сам',
    frame: 'petka_big',
    color: PALETTE.yellow,
    syllables: true,
  },
  {
    level: 'high',
    title: 'Хорошо читаю',
    text: 'Читаю целыми словами',
    frame: 'owl_read_big',
    color: PALETTE.blue,
    syllables: false,
  },
];

export class ReaderScene {
  constructor(game) {
    this.game = game;
    this.buttons = [];
    this.hover = -1;
    this.t = 0;
  }

  enter(data = {}) {
    this.t = 0;
    this.hover = -1;
    this.back = data.back || 'menu';
    this.layout();
  }

  layout() {
    const { viewW, viewH } = this.game.viewport;
    const n = CARDS.length;
    const gap = 40;
    const w = Math.min(420, (viewW - 160 - gap * (n - 1)) / n);
    const h = Math.min(620, viewH * 0.58);
    let x = (viewW - (w * n + gap * (n - 1))) / 2;
    const y = viewH * 0.28;

    this.cards = CARDS.map((c) => {
      const card = { ...c, x, y, w, h };
      x += w + gap;
      return card;
    });
    this.buttons = this.cards.map((c, i) => ({
      id: `level:${i}`, label: '', x: c.x, y: c.y, w: c.w, h: c.h, color: c.color,
    }));
  }

  update(dt) {
    this.t += dt;
    this.layout();
    const { input, settings, scenes } = this.game;
    this.hover = this.buttons.findIndex((b) => hit(b, input.pointer));
    this.game.canvas.classList.toggle('pointer', this.hover >= 0);

    let choice = -1;
    if (input.pointer.clicked && this.hover >= 0) choice = this.hover;
    for (let i = 0; i < this.cards.length; i++) {
      if (input.justPressed(`Digit${i + 1}`, `Numpad${i + 1}`)) choice = i;
    }
    if (choice >= 0) {
      const card = this.cards[choice];
      settings.setLevel(card.level, card.syllables);
      scenes.go(this.back);
    }
  }

  render() {
    const { viewport, atlas } = this.game;
    const ctx = viewport.ctx;
    const { viewW, viewH } = viewport;
    viewport.applyUI();

    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(64, 800);
    ctx.fillText('Как ты чи-та-ешь?', viewW / 2, viewH * 0.16);
    ctx.font = font(30, 600);
    ctx.fillStyle = '#8a6b53';
    ctx.fillText('Вы-бе-ри кар-точ-ку. По-том мож-но по-ме-нять', viewW / 2, viewH * 0.16 + 54);
    ctx.restore();

    this.cards.forEach((c, i) => {
      const hovered = i === this.hover;
      drawButton(ctx, { ...this.buttons[i], label: '' }, { hover: hovered, seed: 21 + i * 6 });

      const lift = hovered ? 4 : 0;
      const f = atlas.frame(c.frame);
      const boxH = c.h * 0.44;
      const scale = Math.min((c.w - 90) / f.w, boxH / f.h);
      atlas.draw(ctx, c.frame, c.x + c.w / 2, c.y + 40 + boxH - lift, { scale });

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      let ty = c.y + c.h * 0.62 - lift;

      ctx.fillStyle = PALETTE.ink;
      ctx.font = font(38, 800);
      ctx.fillText(syllabifyText(c.title), c.x + c.w / 2, ty);

      ty += 52;
      ctx.font = font(24, 600);
      ctx.fillStyle = '#5a3f2e';
      wrapText(ctx, syllabifyText(c.text), c.w - 60).forEach((line) => {
        ctx.fillText(line, c.x + c.w / 2, ty);
        ty += 32;
      });

      // номер карточки - её можно выбрать клавишей
      ctx.fillStyle = '#a08160';
      ctx.font = font(26, 700);
      ctx.fillText(String(i + 1), c.x + c.w / 2, c.y + c.h - 26 - lift);
      ctx.restore();
    });
  }
}
