import { PALETTE, wrapText, drawButton, hit, font, paperPath } from '../core/ui.js';
import { StreamText, Tween, easeOutExpo, REDUCED } from '../core/motion.js';
import { syllabifyText } from '../core/syllables.js';
import { readable } from '../core/text.js';

/**
 * Вступление главы: несколько страниц подряд, лист за листом.
 *
 * Страницы описаны в JSON главы (поле `intro`), в коде их нет. Типы:
 *   text  - абзац истории, слова проявляются каскадом (порт `.t-stream`);
 *   cast  - знакомство с героями: карточка на каждого, спрайт из атласа;
 *   learn - познавательная страница: цифры со словами и раскладка клавиш;
 *   scene - шаг кат-сцены: крупный герой слева объясняет одно действие.
 *
 * Игроку 6+ читать долго и трудно, поэтому:
 *   - «Пропустить» всегда на виду и уводит сразу в игру;
 *   - «По слогам» разбивает весь текст, как в букваре: «чис-ло-град»;
 *   - первый клик показывает страницу целиком, второй листает дальше.
 */

const ITEM_GAP = 0.16;    // задержка между появлением карточек, с
const ITEM_FADE = 0.42;   // длительность появления одной карточки, с
const SCENE_REF_H = 640;  // рост самого высокого кадра `_big` - общая мерка кат-сцены

export class StoryScene {
  constructor(game) {
    this.game = game;
    this.pages = [];
    this.page = 0;
    this.pageT = 0;
    this.stream = new StreamText('');
    this.btnW = new Tween(300);
    this.buttons = [];
    this.hover = -1;
  }

  async enter(data) {
    this.chapterId = data.chapter || 'chapter_01';
    this.pages = [{ type: 'text', text: '' }];
    this.page = 0;
    this.pageT = 0;
    this.buttons = [];
    this.hover = -1;
    const chapter = await this.game.api.content(this.chapterId);
    this.game.chapter = chapter;
    // главы без `intro` продолжают работать: их `story` - это те же текстовые страницы
    this.pages = chapter.intro?.length
      ? chapter.intro
      : (chapter.story || []).map((text) => ({ type: 'text', text }));
    this.open(0);
  }

  get current() { return this.pages[this.page] ?? { type: 'text', text: '' }; }
  get isLast() { return this.page >= this.pages.length - 1; }

  /** Текст с учётом режима чтения по слогам. */
  tr(s) { return readable(s, this.game.settings); }

  open(i) {
    this.page = i;
    this.pageT = 0;
    if (this.streamed) this.stream.reset(this.tr(this.current.text));
  }

  /** У страницы текст проявляется потоком слов? */
  get streamed() {
    const t = this.current.type;
    return t === 'text' || t === 'scene';
  }

  /** Номер шага кат-сцены и сколько их всего - подпись «Шаг 2 из 5». */
  sceneStep() {
    const scenes = this.pages.filter((p) => p.type === 'scene');
    return { n: scenes.indexOf(this.current) + 1, of: scenes.length };
  }

  /** Сколько элементов появляется на странице каскадом. */
  get itemCount() {
    const p = this.current;
    if (p.type === 'cast') return p.cast?.length ?? 0;
    if (p.type === 'learn') return (p.digits?.length ?? 0) + (p.keys?.length ?? 0);
    return 0;
  }

  get revealed() {
    if (this.streamed) return this.stream.done;
    return this.pageT >= this.itemCount * ITEM_GAP + ITEM_FADE;
  }

  revealAll() {
    if (this.streamed) this.stream.finish();
    else this.pageT = this.itemCount * ITEM_GAP + ITEM_FADE;
  }

  /** Прогресс появления i-го элемента: 0 - ещё нет, 1 - на месте. */
  appear(i) {
    if (REDUCED) return 1;
    const t = this.pageT - i * ITEM_GAP;
    return t <= 0 ? 0 : Math.min(1, easeOutExpo(t / ITEM_FADE));
  }

  next() {
    if (!this.revealed) { this.revealAll(); return; }
    if (!this.isLast) this.open(this.page + 1);
    else this.game.scenes.go('game', { chapter: this.chapterId });
  }

  /** Переключение слогов не должно сбрасывать уже показанный текст. */
  toggleSyllables() {
    this.game.settings.toggleSyllables();
    if (this.streamed) {
      const t = this.stream.t;
      this.stream.reset(this.tr(this.current.text));
      this.stream.t = t;
    }
  }

  update(dt) {
    const { viewW, viewH } = this.game.viewport;
    const { input, settings } = this.game;

    this.pageT += dt;
    if (this.streamed) this.stream.update(dt);

    const label = this.revealed && this.isLast ? 'Начать' : 'Дальше';
    this.btnW.set(label === 'Начать' ? 340 : 280);
    const w = this.btnW.update(dt);

    this.buttons = [
      { id: 'next', label, x: viewW / 2 - w / 2, y: viewH - 170, w, h: 84, color: PALETTE.green },
      {
        id: 'syllables', label: settings.syllables ? 'По сло-гам: да' : 'По слогам: нет',
        x: 40, y: 34, w: 320, h: 72, color: settings.syllables ? PALETTE.yellow : PALETTE.paper,
      },
      { id: 'skip', label: 'Пропустить', x: viewW - 300, y: 34, w: 260, h: 72, color: PALETTE.paper },
    ];

    this.hover = this.buttons.findIndex((b) => hit(b, input.pointer));
    this.game.canvas.classList.toggle('pointer', this.hover >= 0);

    if (input.pointer.clicked) {
      // клик мимо кнопок - это тоже «дальше»: попасть по кнопке ребёнку сложнее
      const id = this.hover >= 0 ? this.buttons[this.hover].id : 'next';
      if (id === 'skip') this.game.scenes.go('game', { chapter: this.chapterId });
      else if (id === 'syllables') this.toggleSyllables();
      else this.next();
      return;
    }
    if (input.justPressed('Space', 'Enter')) this.next();
    if (input.justPressed('Escape')) this.game.scenes.go('menu');
  }

  // ---------- отрисовка ----------

  render() {
    const { viewport } = this.game;
    const ctx = viewport.ctx;
    viewport.applyUI();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.viewW, viewport.viewH);

    const page = this.current;
    if (page.type === 'cast') this.renderCast(ctx, page);
    else if (page.type === 'learn') this.renderLearn(ctx, page);
    else if (page.type === 'scene') this.renderScene(ctx, page);
    else this.renderText(ctx, page);

    this.renderDots(ctx);
    this.buttons.forEach((b, i) => drawButton(ctx, b, { hover: i === this.hover, seed: 41 + i * 6 }));
  }

  renderText(ctx, page) {
    const { viewport } = this.game;
    const maxW = Math.min(1180, viewport.viewW * 0.78);
    const lineH = 86;

    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    // крупно и жирно: читателю 6+ так заметно легче
    ctx.font = font(60, 700);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // высота блока считается по всему абзацу, поэтому текст не «прыгает»
    // по мере появления слов
    const lines = wrapText(ctx, this.tr(page.text), maxW).length || 1;
    const startY = viewport.viewH / 2 - (lines * lineH) / 2;
    this.stream.draw(ctx, (viewport.viewW - maxW) / 2, startY, maxW, lineH);
    ctx.restore();
  }

  // ---------- кат-сцена: шаг обучения ----------

  /**
   * Шаг кат-сцены: слева крупный герой, справа - что делать.
   *
   * Кадры берутся из набора `_big` - героев, нарезанных из исходного листа
   * в большом разрешении. Мелкий кадр атласа при таком размере мылит.
   */
  renderScene(ctx, page) {
    const { viewport, atlas } = this.game;
    const { viewW, viewH } = viewport;

    const step = this.sceneStep();
    const frame = atlas.has(page.frame) ? page.frame : 'petka_big';
    const f = atlas.frame(frame);

    // герой: занимает левую треть, приезжает снизу.
    // Масштаб общий для всех кадров (SCENE_REF_H - рост самого высокого),
    // иначе кот растянулся бы до размеров Петьки и пропорции поехали бы
    const boxW = Math.min(660, viewW * 0.38);
    const boxH = viewH * 0.72;
    const scale = Math.min(boxW / f.w, boxH / SCENE_REF_H);
    const rise = (1 - Math.min(1, this.pageT / 0.5)) * 40;
    const baseY = viewH * 0.82 + rise;
    const cx = viewW * 0.27;

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = PALETTE.ink;
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 12, f.w * scale * 0.42, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // герой дышит: страница без движения выглядит мёртвой
    const k = Math.sin(this.game.time * 1.5);
    atlas.draw(ctx, frame, cx, baseY, {
      scaleY: scale * (1 + k * 0.018),
      scaleX: scale * (1 - k * 0.01),
      flipX: !!page.flip,
    });

    // справа: шаг, имя, действие
    const tx = viewW * 0.5;
    const tw = Math.min(820, viewW * 0.44);
    let ty = viewH * 0.3;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    if (step.of > 1) {
      ctx.fillStyle = '#a08160';
      ctx.font = font(28, 700);
      ctx.fillText(this.tr(`Шаг ${step.n} из ${step.of}`), tx, ty);
      ty += 52;
    }
    if (page.name) {
      ctx.fillStyle = '#7c9a5c';
      ctx.font = font(34, 800);
      ctx.fillText(this.tr(page.name), tx, ty);
      ty += 58;
    }

    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(50, 700);
    const lineH = 74;
    this.stream.draw(ctx, tx, ty + 10, tw, lineH);
    ty += 10 + wrapText(ctx, this.tr(page.text ?? ''), tw).length * lineH;
    ctx.restore();

    if (page.keys?.length) this.drawKeys(ctx, page.keys, ty + 24, 0, tx);
  }

  // ---------- знакомство с героями ----------

  renderCast(ctx, page) {
    const { viewport } = this.game;
    const cast = page.cast || [];
    this.drawTitle(ctx, page.title || 'Кто есть кто', 148);

    const n = Math.max(1, cast.length);
    const gap = 22;
    const maxW = Math.min(1580, viewport.viewW * 0.94);
    const cw = Math.min(292, (maxW - gap * (n - 1)) / n);
    // высота с запасом: на узком экране карточки уже, и описание переносится
    // на большее число строк
    const ch = 620;
    let x = (viewport.viewW - (cw * n + gap * (n - 1))) / 2;

    cast.forEach((c, i) => {
      const a = this.appear(i);
      if (a > 0) this.drawCastCard(ctx, c, x, 186 + (1 - a) * 26, cw, ch, a, i);
      x += cw + gap;
    });
  }

  drawCastCard(ctx, c, x, y, w, h, alpha, seed) {
    const { atlas } = this.game;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = PALETTE.shadow;
    paperPath(ctx, x + 5, y + 8, w, h, 22, 71 + seed * 5, 3);
    ctx.fill();
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, x, y, w, h, 22, 51 + seed * 7, 3);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();

    // спрайт вписывается в верхнюю часть карточки целиком: у героев очень
    // разные пропорции, поэтому масштаб считается по размеру кадра
    const f = atlas.frame(c.frame);
    const boxW = w - 44, boxH = 244;
    const baseY = y + 28 + boxH;
    atlas.draw(ctx, c.frame, x + w / 2, baseY, { scale: Math.min(boxW / f.w, boxH / f.h) });

    ctx.beginPath();
    ctx.moveTo(x + 28, baseY + 12);
    ctx.lineTo(x + w - 28, baseY + 12);
    ctx.lineWidth = 3; ctx.strokeStyle = '#e3d1ae'; ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let ty = baseY + 66;
    ctx.fillStyle = PALETTE.ink;
    fitText(ctx, c.name, x + w / 2, ty, w - 28, 30, 800);

    // имя всегда дублируется слогами: имена читать труднее всего
    ty += 34;
    ctx.fillStyle = '#a08160';
    fitText(ctx, syllabifyText(c.name), x + w / 2, ty, w - 28, 22, 600);

    if (c.role) {
      ty += 36;
      ctx.fillStyle = '#7c9a5c';
      fitText(ctx, this.tr(c.role), x + w / 2, ty, w - 28, 24, 700);
    }

    ty += 42;
    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(22, 400);
    wrapText(ctx, this.tr(c.text || ''), w - 44).forEach((line) => {
      ctx.fillText(line, x + w / 2, ty);
      ty += 30;
    });

    ctx.restore();
  }

  // ---------- познавательные страницы ----------

  renderLearn(ctx, page) {
    const { viewport } = this.game;
    const cx = viewport.viewW / 2;
    this.drawTitle(ctx, page.title || '', 148);

    let y = 236;
    if (page.text) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.ink;
      ctx.font = font(60, 700);
      wrapText(ctx, this.tr(page.text), Math.min(1100, viewport.viewW * 0.8)).forEach((line) => {
        ctx.fillText(line, cx, y);
        y += 84;
      });
      ctx.restore();
      y += 26;
    }

    if (page.digits?.length) y = this.drawDigits(ctx, page.digits, y);
    if (page.keys?.length) y = this.drawKeys(ctx, page.keys, y, page.digits?.length ?? 0);

    if (page.note) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8a6b53';
      ctx.font = font(28, 600);
      wrapText(ctx, this.tr(page.note), Math.min(1000, viewport.viewW * 0.76))
        .forEach((line, i) => ctx.fillText(line, cx, y + 26 + i * 38));
      ctx.restore();
    }
  }

  /** Ряд цифр из атласа: карточка, крупная цифра и слово под ней. */
  drawDigits(ctx, digits, y) {
    const { viewport, atlas } = this.game;
    const cellW = 150, cellH = 190, gap = 22;
    let x = (viewport.viewW - (digits.length * cellW + (digits.length - 1) * gap)) / 2;

    digits.forEach((d, i) => {
      const a = this.appear(i);
      if (a > 0) {
        const dy = (1 - a) * 18;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fffaf0';
        paperPath(ctx, x, y - dy, cellW, cellH, 18, 81 + i * 6, 3);
        ctx.fill();
        ctx.lineWidth = 3.5; ctx.strokeStyle = PALETTE.ink; ctx.stroke();

        const f = atlas.frame(d.frame);
        atlas.draw(ctx, d.frame, x + cellW / 2, y + cellH - 26 - dy, {
          scale: Math.min((cellW - 54) / f.w, (cellH - 52) / f.h),
        });

        if (d.label) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = PALETTE.ink;
          ctx.font = font(26, 700);
          ctx.fillText(this.tr(d.label), x + cellW / 2, y + cellH + 44 - dy);
        }
        ctx.restore();
      }
      x += cellW + gap;
    });

    return y + cellH + 96;
  }

  /** Раскладка управления: клавиша слева, что она делает - справа. */
  drawKeys(ctx, keys, y, offset, left = null) {
    const { viewport } = this.game;
    const capW = 230, capH = 74, textGap = 30, rowH = 94;
    const x = left ?? (viewport.viewW - (capW + textGap + 430)) / 2;

    keys.forEach((k, i) => {
      const a = this.appear(offset + i);
      if (a <= 0) return;
      const ry = y + i * rowH + (1 - a) * 18;

      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = PALETTE.paperDark;
      paperPath(ctx, x, ry, capW, capH, 16, 91 + i * 5, 2.5);
      ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = PALETTE.ink; ctx.stroke();

      ctx.fillStyle = PALETTE.ink;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      fitText(ctx, this.tr(k.cap), x + capW / 2, ry + capH / 2 + 2, capW - 24, 28, 800);
      ctx.textAlign = 'left';
      ctx.font = font(30, 600);
      ctx.fillText(this.tr(k.text), x + capW + textGap, ry + capH / 2 + 2);
      ctx.restore();
    });

    return y + keys.length * rowH;
  }

  // ---------- общее ----------

  drawTitle(ctx, text, y) {
    const { viewport } = this.game;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PALETTE.ink;
    fitText(ctx, this.tr(text), viewport.viewW / 2, y, viewport.viewW * 0.8, 56, 800);
    ctx.restore();
  }

  /** Точки-страницы: видно, сколько ещё осталось до игры. */
  renderDots(ctx) {
    const { viewport } = this.game;
    const n = this.pages.length;
    const dot = 12, gap = 20;
    let x = (viewport.viewW - (n * dot + (n - 1) * gap)) / 2;

    ctx.save();
    ctx.fillStyle = '#d9c8ab';
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = i === this.page ? 1 : 0.4;
      ctx.beginPath();
      ctx.arc(x + dot / 2, viewport.viewH - 232, dot / 2, 0, Math.PI * 2);
      ctx.fill();
      x += dot + gap;
    }
    ctx.restore();
  }
}

/** Надпись, которая ужимается по кеглю, пока не влезет в заданную ширину. */
function fitText(ctx, text, x, y, maxW, size, weight) {
  let fs = size;
  ctx.font = font(fs, weight);
  while (ctx.measureText(text).width > maxW && fs > 14) {
    fs -= 1;
    ctx.font = font(fs, weight);
  }
  ctx.fillText(text, x, y);
}
