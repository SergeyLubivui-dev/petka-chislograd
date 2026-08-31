/**
 * motion.js - перенос эффектов Transitions.dev на Canvas.
 *
 * Интерфейс игры рисуется на канвасе, поэтому CSS-переходы к нему не
 * применяются. Здесь три эффекта воспроизведены вручную с теми же
 * параметрами, что и в `css/transitions.css`, чтобы DOM и канвас
 * выглядели и ощущались одинаково:
 *
 *   t-resize  -> Tween + EASE_OUT_EXPO (300 мс) - плавное изменение размера
 *                панели диалога;
 *   t-shimmer -> shimmerText() - бегущий блик по надписи;
 *   t-stream  -> StreamText - появление текста по словам с расфокусом.
 *
 * Настройка `prefers-reduced-motion: reduce` уважается так же, как в CSS:
 * анимации выключаются, конечное состояние показывается сразу.
 */

export const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** cubic-bezier(0.22, 1, 0.36, 1) - та же кривая, что и --resize-ease. */
export function easeOutExpo(t) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export const RESIZE_DUR = 0.3;   // --resize-dur: 300ms
export const STREAM_GAP = 0.06;  // --stream-gap: 60ms
export const STREAM_FADE = 0.35; // --stream-fade: 350ms
export const STREAM_BLUR = 1;    // --stream-blur: 1px
export const SHIMMER_DUR = 1.8;  // --shimmer-dur

/** Плавный переход числа к целевому значению - канвас-аналог `.t-resize`. */
export class Tween {
  constructor(value, dur = RESIZE_DUR) {
    this.from = value;
    this.to = value;
    this.value = value;
    this.dur = dur;
    this.t = dur;
  }

  set(target) {
    if (target === this.to) return;
    if (REDUCED) { this.from = this.to = this.value = target; this.t = this.dur; return; }
    this.from = this.value;
    this.to = target;
    this.t = 0;
  }

  update(dt) {
    if (this.t >= this.dur) { this.value = this.to; return this.value; }
    this.t = Math.min(this.dur, this.t + dt);
    this.value = this.from + (this.to - this.from) * easeOutExpo(this.t / this.dur);
    return this.value;
  }
}

// ---------------------------------------------------------------- shimmer

const shimmerCache = new Map();

function scratch(w, h) {
  const key = `${w}x${h}`;
  let c = shimmerCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    shimmerCache.set(key, c);
    if (shimmerCache.size > 12) shimmerCache.delete(shimmerCache.keys().next().value);
  }
  return c;
}

/**
 * Надпись с бегущим бликом - канвас-аналог `.t-shimmer`.
 * База рисуется обычным цветом, поверх накладывается полоса градиента,
 * обрезанная по глифам через композицию `source-in` (аналог background-clip: text).
 *
 * Шрифт, textAlign и textBaseline берутся из текущего состояния контекста.
 */
export function shimmerText(ctx, text, x, y, o = {}) {
  const base = o.base ?? '#8a6b53';
  const highlight = o.highlight ?? '#fffdf6';
  const size = o.size ?? 40;
  const time = o.time ?? 0;

  ctx.fillStyle = base;
  ctx.fillText(text, x, y);
  if (REDUCED) return;

  const w = Math.ceil(ctx.measureText(text).width) + 8;
  const h = Math.ceil(size * 1.8);
  if (w < 4 || h < 4) return;

  const baseline = h * 0.72;
  let left = x;
  if (ctx.textAlign === 'center') left = x - w / 2;
  else if (ctx.textAlign === 'right' || ctx.textAlign === 'end') left = x - w;

  const off = scratch(w, h);
  const o2 = off.getContext('2d');
  o2.clearRect(0, 0, w, h);
  o2.font = ctx.font;
  o2.textAlign = 'left';
  o2.textBaseline = 'alphabetic';
  o2.fillStyle = '#000';
  o2.fillText(text, 4, baseline);

  // полоса шириной 400 % от надписи, едет справа налево (как background-position)
  const band = w * 4;
  const phase = ((time % SHIMMER_DUR) / SHIMMER_DUR);
  const gx = w - phase * (band + w);
  const grad = o2.createLinearGradient(gx, 0, gx + band, 0);
  grad.addColorStop(0.00, 'rgba(255,255,255,0)');
  grad.addColorStop(0.40, 'rgba(255,255,255,0)');
  grad.addColorStop(0.50, highlight);
  grad.addColorStop(0.60, 'rgba(255,255,255,0)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');

  o2.globalCompositeOperation = 'source-in';
  o2.fillStyle = grad;
  o2.fillRect(0, 0, w, h);
  o2.globalCompositeOperation = 'source-over';

  let dy = y - baseline;
  if (ctx.textBaseline === 'middle') dy = y - baseline + size * 0.36;
  else if (ctx.textBaseline === 'top') dy = y;
  ctx.drawImage(off, left - 4, dy);
}

// ----------------------------------------------------------------- stream

/**
 * Появление текста по словам - канвас-аналог `.t-stream`.
 * Каждое слово въезжает через прозрачность и лёгкий расфокус; слова
 * запускаются каскадом с интервалом STREAM_GAP.
 */
export class StreamText {
  constructor(text = '') { this.reset(text); }

  reset(text) {
    this.words = String(text).split(/\s+/).filter(Boolean);
    this.t = 0;
  }

  update(dt) { this.t += dt; }

  /** Прогресс появления слова: 0 - ещё нет, 1 - полностью видно. */
  progress(i) {
    if (REDUCED) return 1;
    const start = i * STREAM_GAP;
    if (this.t <= start) return 0;
    return Math.min(1, easeOutExpo((this.t - start) / STREAM_FADE));
  }

  get done() { return REDUCED || this.t >= this.words.length * STREAM_GAP + STREAM_FADE; }
  finish() { this.t = this.words.length * STREAM_GAP + STREAM_FADE; }

  /**
   * Рисует абзац с переносом по ширине. Возвращает высоту блока.
   * Расфокус делается через ctx.filter, если браузер его поддерживает.
   */
  draw(ctx, x, y, maxWidth, lineH) {
    const spaceW = ctx.measureText(' ').width;
    const canBlur = typeof ctx.filter === 'string';
    let cx = x, cy = y, lines = 1;

    this.words.forEach((word, i) => {
      const ww = ctx.measureText(word).width;
      if (cx > x && cx + ww > x + maxWidth) { cx = x; cy += lineH; lines += 1; }

      const p = this.progress(i);
      if (p > 0) {
        ctx.save();
        ctx.globalAlpha *= p;
        if (canBlur && p < 1) ctx.filter = `blur(${(1 - p) * STREAM_BLUR}px)`;
        ctx.fillText(word, cx, cy);
        ctx.restore();
      }
      cx += ww + spaceW;
    });

    return lines * lineH;
  }
}
