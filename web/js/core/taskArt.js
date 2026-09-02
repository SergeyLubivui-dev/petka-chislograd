import { PALETTE, font } from './ui.js';

/**
 * taskArt.js - как рисуется сама задача.
 *
 * Одни и те же примеры показываются в трёх местах: в окне у препятствия,
 * во вкладке «Задачи» и в финале главы. Чтобы «2 + 3 = ?» везде выглядело
 * одинаково, рисование живёт здесь, а сцены только выбирают место и размер.
 *
 * Виды задач (различаются по полям, а не по типу в JSON):
 *   { a, b, op }        - пример: слагаемые цифрами из атласа;
 *   { count, frame }    - ряд одинаковых предметов, их надо пересчитать;
 *   { missing }         - слово с пропущенной буквой: «С_ВА».
 */

/** Пример «a + b = ?» цифрами из атласа. Возвращает занятую ширину. */
export function drawSum(ctx, atlas, task, cx, cy, digitH = 150) {
  const frameFor = (v) => (atlas.has(`digit_${v}`) ? `digit_${v}` : null);
  const parts = [
    { digit: task.a }, { sign: task.op || '+' }, { digit: task.b }, { sign: '=' }, { sign: '?' },
  ];
  const signSize = Math.round(digitH * 0.5);

  ctx.save();
  ctx.font = font(signSize, 800);
  const widths = parts.map((p) => {
    if (p.sign) return ctx.measureText(p.sign).width + digitH * 0.2;
    const fr = frameFor(p.digit);
    if (!fr) return digitH * 0.66;
    const f = atlas.frame(fr);
    return f.w * (digitH / f.h) + digitH * 0.16;
  });
  const total = widths.reduce((a, b) => a + b, 0);
  let x = cx - total / 2;

  parts.forEach((p, i) => {
    if (p.sign) {
      ctx.fillStyle = PALETTE.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = font(signSize, 800);
      ctx.fillText(p.sign, x + widths[i] / 2, cy);
    } else {
      const fr = frameFor(p.digit);
      if (fr) {
        const f = atlas.frame(fr);
        atlas.draw(ctx, fr, x + widths[i] / 2, cy, { scale: digitH / f.h, anchorY: 0.5 });
      } else {
        ctx.fillStyle = PALETTE.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = font(digitH * 0.8, 800);
        ctx.fillText(String(p.digit), x + widths[i] / 2, cy);
      }
    }
    x += widths[i];
  });
  ctx.restore();
  return total;
}

/**
 * Ряд одинаковых предметов - их надо пересчитать.
 * Чем меньше предметов, тем они крупнее: считать должно быть легко.
 */
export function drawCount(ctx, atlas, task, cx, baseY, maxW, maxH = 250, time = 0) {
  const f = atlas.frame(task.frame);
  const n = Math.max(1, task.count);
  const cell = Math.min(maxH, maxW / n);
  const scale = Math.min((cell - 30) / f.w, maxH / f.h);
  let x = cx - (cell * n) / 2 + cell / 2;

  for (let i = 0; i < n; i++) {
    const k = Math.sin(time * 1.8 + i);          // предметы чуть дышат
    atlas.draw(ctx, task.frame, x, baseY, {
      scaleX: scale * (1 - k * 0.012),
      scaleY: scale * (1 + k * 0.02),
    });
    x += cell;
  }
}

/**
 * Слово с пропущенной буквой: «С_ВА». Пропуск рисуется чертой, а не
 * подчёркиванием в тексте, - так виднее, куда вставлять букву.
 */
export function drawMissingWord(ctx, word, cx, cy, maxW, size = 120) {
  const letters = String(word).split('');
  let fs = size;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = () => {
    ctx.font = font(fs, 800);
    return letters.reduce((sum, ch) => sum + ctx.measureText(ch === '_' ? 'О' : ch).width + fs * 0.12, 0);
  };
  while (width() > maxW && fs > 32) fs -= 4;

  const total = width();
  let x = cx - total / 2;
  letters.forEach((ch) => {
    const w = ctx.measureText(ch === '_' ? 'О' : ch).width + fs * 0.12;
    if (ch === '_') {
      ctx.strokeStyle = PALETTE.red;
      ctx.lineWidth = Math.max(4, fs * 0.06);
      ctx.beginPath();
      ctx.moveTo(x + fs * 0.1, cy + fs * 0.42);
      ctx.lineTo(x + w - fs * 0.1, cy + fs * 0.42);
      ctx.stroke();
    } else {
      ctx.fillStyle = PALETTE.ink;
      ctx.fillText(ch, x + w / 2, cy);
    }
    x += w;
  });
  ctx.restore();
}

/** Верный ответ задачи в виде строки - по нему сверяются варианты. */
export function rightAnswer(task) {
  if (task.count !== undefined) return String(task.count);
  if (task.a !== undefined) return String(task.op === '-' ? task.a - task.b : task.a + task.b);
  return null;
}
