import { drawButton, hit, drawCover, PALETTE, paperPath, drawCoinBadge, playClick, font } from '../core/ui.js';
import { shimmerText } from '../core/motion.js';
import { readable } from '../core/text.js';

/**
 * Главное меню: фон-иллюстрация на весь экран, кнопки управления по центру.
 * Кнопки живут в виртуальных координатах и пересчитываются при каждом кадре,
 * поэтому меню одинаково собирается и на 16:9, и на 21:9, и на планшете.
 *
 * «Играть» ведёт на выбор главы, «Продолжить» - сразу в начатую главу.
 * Внизу - настройки: слоги, уровень чтения, музыка, звуки, полный экран.
 * На планшете кнопки «Выход» нет: закрыть вкладку браузер игре не даст.
 */
export class MenuScene {
  constructor(game) {
    this.game = game;
    this.buttons = [];
    this.tools = [];
    this.hover = -1;
    this.toolHover = -1;
  }

  enter() {
    this.hover = -1;
    this.toolHover = -1;
    this.game.audio.play('menu');
    this.layout();
  }

  tr(s) { return readable(s, this.game.settings); }

  /** Есть ли что продолжать: последняя глава начата и не пройдена. */
  get resumable() {
    const { progress } = this.game;
    return progress.started(progress.data.lastChapter);
  }

  layout() {
    const { viewport, progress, audio, input } = this.game;
    const { viewW, viewH, inset, compact } = viewport;
    const w = Math.min(430, viewW * 0.30);
    const h = viewport.atLeastPx(compact ? 84 : 96, 52);
    const gap = compact ? 18 : 26;
    const touch = input.touch || viewport.coarse;
    const items = [
      { id: 'play', label: 'Играть', color: PALETTE.green },
      { id: 'continue', label: 'Продолжить', color: this.resumable ? PALETTE.yellow : PALETTE.paperDark },
      { id: 'practice', label: 'Задания', color: PALETTE.blue },
    ];
    if (!touch) items.push({ id: 'exit', label: 'Выход', color: PALETTE.paper });
    const totalH = items.length * h + (items.length - 1) * gap;
    const x = (viewW - w) / 2;
    let y = viewH * 0.53 - totalH / 2;
    this.buttons = items.map((it) => {
      const b = { ...it, label: this.tr(it.label), x, y, w, h };
      y += h + gap;
      return b;
    });
    this.titleY = this.buttons[0].y - 132;
    this.panelW = Math.min(viewW * 0.62, 880);

    // настройки внизу: слоги, уровень чтения, музыка, звуки, полный экран
    const { syllables, level } = this.game.settings;
    const levelName = { low: 'по слогам', mid: 'немного', high: 'хорошо' }[level] ?? 'не выбрано';
    const th = viewport.atLeastPx(72, 44);
    const defs = [
      { id: 'syllables', label: syllables ? 'По сло-гам: да' : 'По слогам: нет', w: 270, color: syllables ? PALETTE.yellow : PALETTE.paper },
      { id: 'reader', label: `Читаю: ${levelName}`, w: 300, color: PALETTE.blue },
      { id: 'music', label: audio.music ? 'Музыка: да' : 'Музыка: нет', w: 210, color: audio.music ? PALETTE.yellow : PALETTE.paper },
      { id: 'sfx', label: audio.sfx ? 'Звуки: да' : 'Звуки: нет', w: 200, color: audio.sfx ? PALETTE.yellow : PALETTE.paper },
    ];
    if (viewport.canFullscreen && touch) {
      defs.push({ id: 'fullscreen', label: viewport.isFullscreen ? 'Окно' : 'На весь экран', w: 250, color: PALETTE.paper });
    }
    const tgap = 12;
    const avail = viewW - 80 - inset.left - inset.right;
    // кнопки выросли под палец - растут и в ширину, иначе подпись не влезет
    const grow = th / 72;
    for (const d of defs) d.w *= grow;
    const total = defs.reduce((a, d) => a + d.w, 0) + tgap * (defs.length - 1);
    const k = total > avail ? avail / total : 1;
    let tx = 40 + inset.left;
    this.tools = defs.map((d) => {
      const b = { ...d, x: tx, y: viewH - th - 36 - inset.bottom, w: d.w * k, h: th };
      tx += d.w * k + tgap;
      return b;
    });
    void progress;
  }

  update() {
    this.layout();
    const { input, scenes, viewport, audio, progress } = this.game;
    const p = input.pointer;
    this.hover = this.buttons.findIndex((b) => hit(b, p));
    this.toolHover = this.tools.findIndex((b) => hit(b, p));
    this.game.canvas.classList.toggle('pointer', this.hover >= 0 || this.toolHover >= 0);

    if (input.pointer.clicked && this.toolHover >= 0) {
      const id = this.tools[this.toolHover].id;
      if (id !== 'sfx') playClick();
      if (id === 'syllables') this.game.settings.toggleSyllables();
      if (id === 'reader') scenes.go('reader');
      if (id === 'music') audio.toggleMusic();
      if (id === 'sfx') audio.toggleSfx();
      if (id === 'fullscreen') viewport.toggleFullscreen();
      return;
    }
    if (input.pointer.clicked && this.hover >= 0) {
      playClick();
      this.choose(this.buttons[this.hover].id);
      return;
    }
    if (input.justPressed('Enter')) this.choose('play');
    void progress;
  }

  choose(id) {
    const { scenes, progress } = this.game;
    if (id === 'play') scenes.go('chapters');
    if (id === 'continue') {
      if (this.resumable) scenes.go('game', { chapter: progress.data.lastChapter, resume: true });
      else scenes.go('chapters');
    }
    if (id === 'practice') scenes.go('practice');
    if (id === 'exit') window.close();
  }

  render() {
    const { viewport, assets, progress } = this.game;
    const ctx = viewport.ctx;
    if (!this.buttons.length) this.layout();
    viewport.applyUI();

    drawCover(ctx, assets.menuBg, viewport.viewW, viewport.viewH);

    // мягкая подложка под кнопками, чтобы текст читался на любой иллюстрации
    const bn = this.buttons[this.buttons.length - 1];
    const padY = 52;
    const panelW = this.panelW;
    const panelX = (viewport.viewW - panelW) / 2;
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, panelX, this.titleY - padY, panelW,
      (bn.y + bn.h) - this.titleY + padY * 2, 26, 99, 4);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ink;
    let fs = 74;
    ctx.font = `800 ${fs}px "Comfortaa", "Segoe UI", system-ui, sans-serif`;
    while (ctx.measureText('Петька и Числоград').width > this.panelW - 90 && fs > 34) {
      fs -= 2;
      ctx.font = `800 ${fs}px "Comfortaa", "Segoe UI", system-ui, sans-serif`;
    }
    shimmerText(ctx, 'Петька и Числоград', viewport.viewW / 2, this.titleY + 42, {
      base: PALETTE.ink, highlight: '#fff3c4', size: fs, time: this.game.time,
    });
    ctx.font = `600 26px "Comfortaa", "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = '#8a6b53';
    ctx.fillText('обучающая адвенчура 6+', viewport.viewW / 2, this.titleY + 84);
    ctx.restore();

    this.buttons.forEach((b, i) => drawButton(ctx, b, { hover: i === this.hover, seed: 11 + i * 5 }));
    this.tools.forEach((b, i) => drawButton(ctx, b, { hover: i === this.toolHover, seed: 91 + i * 5 }));

    drawCoinBadge(ctx, viewport.viewW - 40 - viewport.inset.right, 34, progress.coins, {
      h: viewport.atLeastPx(72, 46), seed: 9, align: 'right',
    });

    ctx.save();
    ctx.fillStyle = 'rgba(90,63,46,.75)';
    ctx.font = font(20, 500);
    ctx.textAlign = 'right';
    ctx.fillText('прототип · порт 6244', viewport.viewW - 28 - viewport.inset.right, viewport.viewH - 14 - viewport.inset.bottom);
    ctx.restore();
  }
}
