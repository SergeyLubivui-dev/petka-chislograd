import { PALETTE, paperPath, wrapText, drawButton, hit, font } from './ui.js';
import { Tween } from './motion.js';

/**
 * Диалоговая система с выбором темы и головоломками.
 *
 * Состояния:
 *   topics -> список тем собеседника
 *   text   -> ответ на выбранную тему
 *   puzzle -> вопрос с тремя вариантами ответа
 *   result -> реакция на ответ (правильно / попробуй ещё)
 *
 * Тексты и задачи целиком лежат в JSON главы, в коде их нет.
 */
export class Dialogue {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.npc = null;
    this.mode = 'topics';
    this.topic = null;
    this.buttons = [];
    this.solved = new Set();
    this.hT = new Tween(0);   // высота панели тянется, а не прыгает
    this._first = true;
  }

  open(npc) {
    this.active = true;
    this.npc = npc;
    this.mode = 'topics';
    this.topic = null;
    this.result = null;
    this._first = true;
    this.layout();
  }

  close() {
    this.active = false;
    this.npc = null;
  }

  /** Раскладка кнопок: пересчитывается каждый кадр, поэтому не зависит от формата экрана. */
  layout() {
    const { viewW, viewH } = this.game.viewport;
    const w = Math.min(1180, viewW * 0.82);
    const bw = w - 120;
    const bh = 74;
    const gap = 14;
    const HEAD = 168;            // портрет, имя и реплика собеседника
    const n = this.npc.dialogue.topics.length;

    let h;
    if (this.mode === 'topics') h = HEAD + n * (bh + gap) + 104;
    else if (this.mode === 'puzzle') h = HEAD + 190 + 96;
    else if (this.mode === 'result') h = HEAD + 130;
    else h = HEAD + 150;
    h = Math.min(h, viewH - 120);

    // порт .t-resize: высота карточки доезжает до новой за 300 мс
    if (this._first) { this.hT.from = this.hT.to = this.hT.value = h; this._first = false; }
    else this.hT.set(h);
    h = this.hT.value;

    const x = (viewW - w) / 2;
    const y = viewH - h - 40;
    this.panel = { x, y, w, h };
    this.buttons = [];

    if (this.mode === 'topics') {
      let by = y + HEAD;
      this.npc.dialogue.topics.forEach((t, i) => {
        const done = this.solved.has(`${this.npc.id}:${i}`);
        this.buttons.push({
          id: `topic:${i}`, label: `${i + 1}. ${t.title}${done ? '   готово' : ''}`,
          x: x + 60, y: by, w: bw, h: bh, color: done ? PALETTE.paperDark : PALETTE.paper,
        });
        by += bh + gap;
      });
      this.buttons.push({ id: 'close', label: 'Закрыть', x: x + w - 260, y: y + h - 84, w: 200, h: 64, color: PALETTE.green });
    } else if (this.mode === 'text') {
      this.buttons.push({ id: 'back', label: 'Назад', x: x + 60, y: y + h - 84, w: 200, h: 64, color: PALETTE.paper });
      this.buttons.push({ id: 'close', label: 'Закрыть', x: x + w - 260, y: y + h - 84, w: 200, h: 64, color: PALETTE.green });
    } else if (this.mode === 'puzzle') {
      const opts = this.topic.puzzle.options;
      const ow = Math.min(240, (bw - gap * (opts.length - 1)) / opts.length);
      let ox = x + (w - (ow * opts.length + gap * (opts.length - 1))) / 2;
      opts.forEach((o, i) => {
        this.buttons.push({ id: `opt:${i}`, label: o, x: ox, y: y + HEAD + 10, w: ow, h: 96, color: PALETTE.yellow });
        ox += ow + gap;
      });
      this.buttons.push({ id: 'back', label: 'Назад', x: x + 60, y: y + h - 76, w: 180, h: 58, color: PALETTE.paper });
    } else if (this.mode === 'result') {
      this.buttons.push({
        id: this.result.ok ? 'back' : 'retry',
        label: this.result.ok ? 'Хорошо' : 'Попробовать ещё',
        x: x + (w - 340) / 2, y: y + h - 92, w: 340, h: 72,
        color: this.result.ok ? PALETTE.green : PALETTE.yellow,
      });
    }
  }

  choose(id) {
    if (id === 'close') { this.close(); return; }
    if (id === 'back') { this.mode = 'topics'; this.topic = null; this.result = null; return; }
    if (id === 'retry') { this.mode = 'puzzle'; this.result = null; return; }

    if (id.startsWith('topic:')) {
      const i = Number(id.split(':')[1]);
      this.topicIndex = i;
      this.topic = this.npc.dialogue.topics[i];
      this.mode = 'text';
      return;
    }
    if (id.startsWith('opt:')) {
      const i = Number(id.split(':')[1]);
      const pz = this.topic.puzzle;
      const ok = i === pz.answer;
      this.result = { ok, text: ok ? pz.correct : pz.wrong };
      if (ok) this.solved.add(`${this.npc.id}:${this.topicIndex}`);
      this.mode = 'result';
    }
  }

  update(dt = 1 / 60) {
    if (!this.active) return;
    this.hT.update(dt);
    this.layout();
    const { input } = this.game;
    const p = input.pointer;
    this.hover = this.buttons.findIndex((b) => hit(b, p));
    this.game.canvas.classList.toggle('pointer', this.hover >= 0);

    if (p.clicked && this.hover >= 0) this.choose(this.buttons[this.hover].id);

    // быстрый выбор цифрами 1..3
    for (let i = 0; i < 3; i++) {
      if (input.justPressed(`Digit${i + 1}`, `Numpad${i + 1}`)) {
        const b = this.buttons.find((x) => x.id === `topic:${i}` || x.id === `opt:${i}`);
        if (b) this.choose(b.id);
      }
    }
    if (input.justPressed('Escape')) {
      if (this.mode === 'topics') this.close(); else this.choose('back');
    }
    // переход от текста темы к её задаче
    if (this.mode === 'text' && this.topic?.puzzle && input.justPressed('Space', 'Enter')) {
      this.mode = 'puzzle';
    }
  }

  render() {
    if (!this.active) return;
    if (!this.panel) this.layout();
    const { viewport, atlas } = this.game;
    const ctx = viewport.ctx;
    viewport.applyUI();

    ctx.save();
    ctx.fillStyle = 'rgba(60,42,30,.28)';
    ctx.fillRect(0, 0, viewport.viewW, viewport.viewH);
    ctx.restore();

    const { x, y, w, h } = this.panel;
    ctx.save();
    ctx.fillStyle = PALETTE.shadow;
    paperPath(ctx, x + 6, y + 10, w, h, 26, 21, 4);
    ctx.fill();
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, x, y, w, h, 26, 17, 4);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.restore();

    // портрет собеседника
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + 92, y + 92, 62, 0, Math.PI * 2);
    ctx.fillStyle = '#f5e7c9'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.clip();
    atlas.draw(ctx, this.npc.frame, x + 92, y + 150, { scale: 0.62 });
    ctx.restore();

    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'left';
    ctx.font = font(34);
    ctx.fillText(this.npc.name, x + 176, y + 72);

    ctx.font = font(26, 400);
    const maxW = w - 236;
    let body = '';
    if (this.mode === 'topics') body = this.npc.dialogue.greeting;
    else if (this.mode === 'text') body = this.topic.text + (this.topic.puzzle ? '\n(пробел - к задаче)' : '');
    else if (this.mode === 'puzzle') body = this.topic.puzzle.question;
    else if (this.mode === 'result') body = this.result.text;

    let ly = y + 112;
    for (const para of body.split('\n')) {
      for (const line of wrapText(ctx, para, maxW)) {
        ctx.fillText(line, x + 176, ly);
        ly += 36;
      }
    }
    ctx.restore();

    this.buttons.forEach((b, i) => {
      const isTopic = b.id.startsWith('topic:');
      drawButton(ctx, isTopic ? { ...b, label: '' } : b, { hover: i === this.hover, seed: 31 + i * 4 });
      if (isTopic) {
        ctx.save();
        ctx.fillStyle = PALETTE.ink;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = font(28, 700);
        ctx.fillText(b.label, b.x + 28, b.y + b.h / 2 + (i === this.hover ? -2 : 2));
        ctx.restore();
      }
    });
  }
}
