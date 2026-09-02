import { drawButton, hit, drawCover, PALETTE, paperPath } from '../core/ui.js';
import { shimmerText } from '../core/motion.js';

/**
 * Главное меню: фон-иллюстрация на весь экран, кнопки управления по центру.
 * Кнопки живут в виртуальных координатах и пересчитываются при каждом кадре,
 * поэтому меню одинаково собирается и на 16:9, и на 21:9, и на 4:3.
 */
export class MenuScene {
  constructor(game) {
    this.game = game;
    this.buttons = [];
    this.tools = [];
    this.hover = -1;
    this.toolHover = -1;
  }

  enter() { this.hover = -1; this.toolHover = -1; this.layout(); }

  layout() {
    const { viewW, viewH } = this.game.viewport;
    const w = Math.min(430, viewW * 0.30);
    const h = 96;
    const gap = 26;
    const items = [
      { id: 'play', label: 'Играть', color: PALETTE.green },
      { id: 'continue', label: 'Продолжить', color: PALETTE.yellow },
      { id: 'practice', label: 'Задачи', color: PALETTE.blue },
      { id: 'exit', label: 'Выход', color: PALETTE.paper },
    ];
    const totalH = items.length * h + (items.length - 1) * gap;
    const x = (viewW - w) / 2;
    let y = viewH * 0.52 - totalH / 2;
    this.buttons = items.map((it) => {
      const b = { ...it, x, y, w, h };
      y += h + gap;
      return b;
    });
    this.titleY = this.buttons[0].y - 132;
    this.panelW = Math.min(viewW * 0.62, 880);

    // чтение по слогам переключается и здесь: вступление можно пропустить,
    // а настройка нужна на весь остальной текст игры
    const { syllables, level } = this.game.settings;
    const levelName = { low: 'по слогам', mid: 'немного', high: 'хорошо' }[level] ?? 'не выбрано';
    this.tools = [
      {
        id: 'syllables', label: syllables ? 'По сло-гам: да' : 'По слогам: нет',
        x: 40, y: viewH - 108, w: 320, h: 72, color: syllables ? PALETTE.yellow : PALETTE.paper,
      },
      {
        id: 'reader', label: `Читаю: ${levelName}`,
        x: 380, y: viewH - 108, w: 360, h: 72, color: PALETTE.blue,
      },
    ];
  }

  update() {
    this.layout();
    const { input, scenes } = this.game;
    const p = input.pointer;
    this.hover = this.buttons.findIndex((b) => hit(b, p));
    this.toolHover = this.tools.findIndex((b) => hit(b, p));
    this.game.canvas.classList.toggle('pointer', this.hover >= 0 || this.toolHover >= 0);

    if (input.pointer.clicked && this.toolHover >= 0) {
      const id = this.tools[this.toolHover].id;
      if (id === 'syllables') this.game.settings.toggleSyllables();
      if (id === 'reader') scenes.go('reader');
      return;
    }
    if (input.pointer.clicked && this.hover >= 0) {
      const id = this.buttons[this.hover].id;
      if (id === 'play') scenes.go('story', { chapter: 'chapter_01' });
      if (id === 'continue') scenes.go('game', { chapter: 'chapter_01' });
      if (id === 'practice') scenes.go('practice');
      if (id === 'exit') window.close();
    }
    if (input.justPressed('Enter')) scenes.go('story', { chapter: 'chapter_01' });
  }

  render() {
    const { viewport, assets } = this.game;
    const ctx = viewport.ctx;
    if (!this.buttons.length) this.layout();
    viewport.applyUI();

    drawCover(ctx, assets.menuBg, viewport.viewW, viewport.viewH);

    // мягкая подложка под кнопками, чтобы текст читался на любой иллюстрации
    const b0 = this.buttons[0];
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
    void b0;

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

    ctx.save();
    ctx.fillStyle = 'rgba(90,63,46,.75)';
    ctx.font = '500 22px "Comfortaa", "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('прототип · порт 6244', viewport.viewW - 28, viewport.viewH - 22);
    ctx.restore();
  }
}
