import { PALETTE, wrapText, drawButton, hit, font } from '../core/ui.js';
import { StreamText, Tween } from '../core/motion.js';

/**
 * Сцена истории: белый лист, текст проявляется по словам.
 *
 * Появление сделано как канвас-порт эффекта `.t-stream` из Transitions.dev:
 * каждое слово въезжает через прозрачность и лёгкий расфокус, слова
 * запускаются каскадом. Кнопка «Дальше» подъезжает по ширине под свою
 * подпись - это порт `.t-resize`.
 *
 * Клик или пробел: первый раз - показать абзац целиком, второй - следующий.
 */
export class StoryScene {
  constructor(game) {
    this.game = game;
    this.lines = [];
    this.page = 0;
    this.stream = new StreamText('');
    this.btnW = new Tween(300);
    this.btn = null;
  }

  async enter(data) {
    this.chapterId = data.chapter || 'chapter_01';
    this.page = 0;
    this.lines = [''];
    this.btn = null;
    this.stream = new StreamText('');
    const chapter = await this.game.api.content(this.chapterId);
    this.game.chapter = chapter;
    this.lines = chapter.story || [];
    this.stream.reset(this.lines[0] ?? '');
  }

  get fullText() { return this.lines[this.page] ?? ''; }

  next() {
    if (!this.stream.done) { this.stream.finish(); return; }
    if (this.page < this.lines.length - 1) {
      this.page += 1;
      this.stream.reset(this.fullText);
    } else {
      this.game.scenes.go('game', { chapter: this.chapterId });
    }
  }

  update(dt) {
    const { viewW, viewH } = this.game.viewport;
    const last = this.page === this.lines.length - 1;
    const label = this.stream.done && last ? 'Начать' : 'Дальше';

    this.stream.update(dt);
    this.btnW.set(label === 'Начать' ? 340 : 280);
    const w = this.btnW.update(dt);

    this.btn = { id: 'next', label, x: viewW / 2 - w / 2, y: viewH - 170, w, h: 84, color: PALETTE.green };

    const { input } = this.game;
    this.game.canvas.classList.toggle('pointer', hit(this.btn, input.pointer));
    if (input.justPressed('Space', 'Enter') || input.pointer.clicked) this.next();
    if (input.justPressed('Escape')) this.game.scenes.go('menu');
  }

  render() {
    const { viewport } = this.game;
    const ctx = viewport.ctx;
    viewport.applyUI();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.viewW, viewport.viewH);

    const maxW = Math.min(1180, viewport.viewW * 0.78);
    const lineH = 62;

    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(42, 400);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // высота блока считается по всему абзацу, поэтому текст не «прыгает»
    // по мере появления слов
    const lines = wrapText(ctx, this.fullText, maxW).length || 1;
    const startY = viewport.viewH / 2 - (lines * lineH) / 2;
    this.stream.draw(ctx, (viewport.viewW - maxW) / 2, startY, maxW, lineH);
    ctx.restore();

    // индикатор абзацев
    ctx.save();
    ctx.fillStyle = '#d9c8ab';
    const n = this.lines.length;
    const dot = 12, gap = 20;
    let dx = (viewport.viewW - (n * dot + (n - 1) * gap)) / 2;
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = i === this.page ? 1 : 0.4;
      ctx.beginPath();
      ctx.arc(dx + dot / 2, viewport.viewH - 232, dot / 2, 0, Math.PI * 2);
      ctx.fill();
      dx += dot + gap;
    }
    ctx.restore();

    if (this.btn) drawButton(ctx, this.btn, { hover: hit(this.btn, this.game.input.pointer), seed: 41 });
  }
}
