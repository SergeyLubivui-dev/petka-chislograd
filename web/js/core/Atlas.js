/**
 * Atlas - кадры из одного изображения-атласа.
 *
 * Помимо обычной отрисовки поддерживает зеркальное отражение (flipX):
 * все персонажи нарисованы смотрящими вправо, движение влево получается
 * инверсией по горизонтали, а не отдельным набором кадров.
 */
export class Atlas {
  constructor(image, data) {
    this.image = image;
    this.frames = data.frames;
  }

  has(name) { return Object.prototype.hasOwnProperty.call(this.frames, name); }

  frame(name) {
    const f = this.frames[name];
    if (!f) throw new Error(`Кадр "${name}" не найден в атласе`);
    return f;
  }

  /**
   * Рисует кадр.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} name имя кадра
   * @param {number} x позиция якоря по горизонтали
   * @param {number} y позиция якоря по вертикали
   * @param {object} o { scale, scaleX, scaleY, flipX, anchorX, anchorY, alpha }
   *        anchorX/anchorY: 0..1, по умолчанию нижний центр (0.5, 1).
   *        scaleX/scaleY задают масштаб по осям отдельно - так делается
   *        пружинка (squash & stretch), когда персонаж «дышит».
   */
  draw(ctx, name, x, y, o = {}) {
    const f = this.frame(name);
    const scale = o.scale ?? 1;
    const ax = o.anchorX ?? 0.5;
    const ay = o.anchorY ?? 1;
    const w = f.w * (o.scaleX ?? scale);
    const h = f.h * (o.scaleY ?? scale);
    const alpha = o.alpha ?? 1;

    ctx.save();
    if (alpha !== 1) ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    if (o.flipX) ctx.scale(-1, 1);
    ctx.drawImage(this.image, f.x, f.y, f.w, f.h, -w * ax, -h * ay, w, h);
    ctx.restore();
  }

  /** Ширина и высота кадра с учётом масштаба - нужны для попаданий и раскладки. */
  size(name, scale = 1) {
    const f = this.frame(name);
    return { w: f.w * scale, h: f.h * scale };
  }
}

/**
 * Animation - покадровая анимация по списку имён кадров.
 * Кадры берутся из атласа, порядок и скорость задаются здесь,
 * поэтому цикл ходьбы можно менять без переэкспорта графики.
 */
export class Animation {
  constructor(frames, fps = 10, loop = true) {
    this.frames = frames;
    this.fps = fps;
    this.loop = loop;
    this.t = 0;
    this.index = 0;
    this.finished = false;
  }

  reset() { this.t = 0; this.index = 0; this.finished = false; }

  update(dt) {
    if (this.finished) return;
    this.t += dt;
    const step = 1 / this.fps;
    while (this.t >= step) {
      this.t -= step;
      this.index += 1;
      if (this.index >= this.frames.length) {
        if (this.loop) this.index = 0;
        else { this.index = this.frames.length - 1; this.finished = true; }
      }
    }
  }

  get current() { return this.frames[this.index]; }
}
