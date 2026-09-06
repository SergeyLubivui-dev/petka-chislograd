/**
 * Puppet - перекладная (cut-out) марионетка из частей одного рисунка.
 *
 * Части нарезаны скриптом tools/rig/cut.py в один лист assets/rig/rig.png,
 * скелет описан в assets/rig/rig.json: у каждой части точка вращения
 * (pivot), родитель, порядок отрисовки (z) и положение в кадре-исходнике
 * в покое (world). Из положения покоя считается смещение до родителя, так
 * что при нулевых углах марионетка совпадает со старым кадром атласа
 * пиксель в пиксель.
 *
 * Анимация процедурная: аниматор персонажа выставляет частям целевые
 * углы/сдвиги, а `update` плавно тянет к ним текущие значения (пружина
 * первого порядка) - переходы между позами без рывков.
 *
 * Деформации, кроме поворотов:
 *  - bend: часть рисуется полосками вдоль оси, каждая полоска повёрнута на
 *    долю угла - сегмент изгибается по дуге (хвост кота, спина, крыло);
 *  - jelly: тело Кляксы рисуется горизонтальными полосками с волной по x;
 *  - squash & stretch всего тела через sx/sy в draw и масштаб частей.
 *
 * Координаты: все персонажи нарисованы вправо, влево - зеркалим (flip).
 * Углы - канвасные (положительный = по часовой). Для висящих вниз частей
 * (руки, ноги) аниматоры пользуются хелпером `fwd`: положительное значение
 * = «вперёд» по ходу персонажа.
 *
 * В draw ничего не создаётся: матрицы частей лежат в заранее выделенных
 * Float64Array, полоски рисуются через ctx.transform без save/restore.
 */
import { loadImage, loadJSON } from './Loader.js';

const DEG = Math.PI / 180;
const BEND_STRIPS = 7;
const JELLY_STRIPS = 26;

/** Загрузка листа и скелета (как в main.js: {data, images}). */
export async function loadRigs(base = 'assets/rig/') {
  const data = await loadJSON(`${base}rig.json`);
  const names = new Set([data.image ?? 'rig.png']);
  for (const rig of Object.values(data.rigs ?? {})) if (rig.image) names.add(rig.image);
  const images = {};
  await Promise.all([...names].map(async (n) => { images[n] = await loadImage(base + n); }));
  return { data, images };
}

/** Одна часть марионетки: картинка в листе + текущие и целевые параметры. */
class Part {
  constructor(def) {
    this.name = def.name;
    this.parentName = def.parent;
    this.parent = null;
    this.z = def.z;
    const [sx, sy, sw, sh] = def.rect;
    this.sx = sx; this.sy = sy; this.sw = sw; this.sh = sh;
    this.px = def.pivot[0]; this.py = def.pivot[1];
    this.wx = def.world[0]; this.wy = def.world[1];
    this.ox = 0; this.oy = 0;          // смещение пивота относительно родителя (покой)
    this.axis = def.axis ?? 'y';
    this.jelly = !!def.jelly;
    // текущие значения
    this.angle = 0; this.dx = 0; this.dy = 0; this.scaleX = 1; this.scaleY = 1; this.bend = 0;
    // целевые
    this.tAngle = 0; this.tDx = 0; this.tDy = 0; this.tScaleX = 1; this.tScaleY = 1; this.tBend = 0;
    this.rate = 12;
    // Предел угловой скорости, рад/с. Сглаживание само по себе от рывка не
    // спасает: если две позы расходятся на сто с лишним градусов, часть
    // пролетит их за пару кадров. Предел растягивает такой взмах на
    // осмысленное время, оставляя быстрым всё остальное.
    this.maxSpeed = Infinity;
    this.visible = true;
    this.alpha = 1;
    // волна для jelly-части
    this.waveAmp = 0; this.wavePhase = 0; this.waveFreq = 0.05; this.waveTilt = 0;
    this.m = new Float64Array(6);      // матрица в координатах кадра-исходника
  }

  /** Целевые значения; rate - скорость притяжения (1/с). */
  set(o, rate) {
    if (o.angle !== undefined) this.tAngle = o.angle;
    if (o.dx !== undefined) this.tDx = o.dx;
    if (o.dy !== undefined) this.tDy = o.dy;
    if (o.scaleX !== undefined) this.tScaleX = o.scaleX;
    if (o.scaleY !== undefined) this.tScaleY = o.scaleY;
    if (o.bend !== undefined) this.tBend = o.bend;
    if (rate !== undefined) this.rate = rate;
  }

  /** Мгновенно поставить в целевую позу (без переходов). */
  snap() {
    this.angle = this.tAngle; this.dx = this.tDx; this.dy = this.tDy;
    this.scaleX = this.tScaleX; this.scaleY = this.tScaleY; this.bend = this.tBend;
  }

  relax(dt) {
    // 1 - exp(-rate*dt): «половина пути за такое-то время» независимо от
    // шага. Прежнее min(1, dt*rate) при большом шаге доезжало ровно в цель
    // и делало движение ступенчатым, а при малом - вело себя иначе.
    const k = 1 - Math.exp(-this.rate * dt);
    let da = (this.tAngle - this.angle) * k;
    if (this.maxSpeed !== Infinity) {
      const lim = this.maxSpeed * dt;
      if (da > lim) da = lim; else if (da < -lim) da = -lim;
    }
    this.angle += da;
    this.dx += (this.tDx - this.dx) * k;
    this.dy += (this.tDy - this.dy) * k;
    this.scaleX += (this.tScaleX - this.scaleX) * k;
    this.scaleY += (this.tScaleY - this.scaleY) * k;
    this.bend += (this.tBend - this.bend) * k;
  }

  /** Смещение волны по x для строки картинки (jelly-часть). */
  waveX(row) {
    const k = Math.max(0, (this.sh - row) / this.sh);
    const w = Math.pow(k, 1.4);
    return (this.waveAmp * Math.sin(this.wavePhase + row * this.waveFreq) + this.waveTilt) * w;
  }
}

export class Puppet {
  /**
   * @param {object} rigData   содержимое rig.json (или один скелет из rigs)
   * @param {object|HTMLImageElement} images  {имя_файла: Image} или сам лист
   * @param {string} name      'petka' | 'cat' | 'owl' | 'baker' | 'klyaksa'
   * @param {object} opts      { atlas } - атлас для запасных кадров (idleFront)
   */
  constructor(rigData, images, name, opts = {}) {
    this.name = name;
    this.atlas = opts.atlas ?? null;
    this.ok = false;
    this.parts = [];
    this.byName = Object.create(null);
    this.height = 0;
    this.width = 0;
    this.unit = 1;
    this.ox = 0; this.oy = 0;
    this.time = 0;
    this.rate = 10;
    this.st = {};                       // память аниматора

    const rigs = rigData?.rigs ?? rigData;
    const rig = rigs?.[name];
    if (!rig || !rig.parts) {
      console.warn(`Puppet: скелет «${name}» не найден в rig.json`);
      return;
    }
    this.source = rig.source;
    this.height = rig.height;
    this.width = rig.width;
    this.unit = rig.unit ?? 1;
    this.ox = rig.origin[0]; this.oy = rig.origin[1];

    const imgName = rig.image ?? rigData.image ?? 'rig.png';
    let image = null;
    if (images && typeof images === 'object' && 'naturalWidth' in images) image = images;
    else if (images) image = images[imgName] ?? Object.values(images)[0];
    if (!image) {
      console.warn(`Puppet: картинка «${imgName}» для «${name}» не загружена`);
      return;
    }
    this.image = image;

    for (const def of rig.parts) {
      if (!def.rect || !def.pivot || !def.world) {
        console.warn(`Puppet: у части «${def.name}» (${name}) нет геометрии, пропускаем`);
        continue;
      }
      const p = new Part(def);
      this.parts.push(p);
      this.byName[p.name] = p;
    }
    this.parts.sort((a, b) => a.z - b.z);
    // порядок обхода: родители раньше детей
    const ordered = [];
    const seen = new Set();
    const visit = (p) => {
      if (seen.has(p)) return;
      if (p.parentName) {
        const par = this.byName[p.parentName];
        if (!par) console.warn(`Puppet: у части «${p.name}» (${name}) нет родителя «${p.parentName}»`);
        else { p.parent = par; visit(par); }
      }
      seen.add(p);
      ordered.push(p);
    };
    for (const p of this.parts) visit(p);
    this.order = ordered;
    for (const p of this.parts) {
      if (p.parent) { p.ox = p.wx - p.parent.wx; p.oy = p.wy - p.parent.wy; } else { p.ox = p.wx; p.oy = p.wy; }
    }
    this.anim = ANIMATORS[name] ?? animGeneric;
    this.ok = true;
    // веки закрыты только в момент моргания
    for (const p of this.parts) if (p.name.startsWith('lid')) { p.tScaleY = 0; p.scaleY = 0; p.visible = false; }
  }

  part(name) { return this.byName[name]; }

  /** Есть ли часть (аниматоры терпят отсутствие: просто пропускают). */
  set(name, o, rate) {
    const p = this.byName[name];
    if (p) p.set(o, rate ?? this.rate);
  }

  /** Поставить всех в целевую позу сразу (при появлении на сцене). */
  snap() { for (const p of this.parts) p.snap(); }

  /** Предел угловой скорости части, градусов в секунду. */
  limit(name, degPerSec) {
    const p = this.byName[name];
    if (p) p.maxSpeed = degPerSec * DEG;
  }

  /**
   * @param {number} dt
   * @param {object} input { state, vx, vy, onGround, walkDist, flip, time, hurt }
   *   Петька: state 'hello' | 'idle' | 'idleFront' | 'walk' | 'jump' | 'land'
   *   NPC:    state 'idle' | 'talk'; Клякса: vx задаёт наклон и волну
   */
  update(dt, input = {}) {
    if (!this.ok) return;
    this.time = input.time ?? (this.time + dt);
    this.anim(this, dt, input);
    for (const p of this.parts) p.relax(dt);
  }

  /**
   * Рисует марионетку. Якорь - нижний центр (стопы на линии пола y).
   * @param {object} o { scale, flip, sx, sy, alpha }
   */
  draw(ctx, x, y, o = {}) {
    const scale = o.scale ?? 1;
    const sx = o.sx ?? 1;
    const sy = o.sy ?? 1;
    const alpha = o.alpha ?? 1;
    // `face` - направление взгляда числом от -1 до 1. Промежуточные
    // значения = разворот: фигурка сужается и раскрывается обратно, как
    // лист бумаги в перекладной мультипликации. `flip` остаётся для тех,
    // кто разворачивается мгновенно (НПС стоят на месте).
    const faceRaw = o.face !== undefined ? o.face : (o.flip ? -1 : 1);
    // совсем в ноль не сжимаем: один кадр «нулевой ширины» читается как пропуск
    const face = faceRaw >= 0 ? Math.max(0.14, faceRaw) : Math.min(-0.14, faceRaw);
    if (!this.ok) { this.drawFallback(ctx, x, y, scale, sx, sy, alpha, face); return; }

    // вид анфас: отдельный кадр атласа, переход - перекрёстным затуханием
    const fa = this.st.fbAlpha ?? (this.st.fallbackFrame ? 1 : 0);
    const frame = this.st.fallbackFrame;
    const hasFrame = frame && this.atlas && this.atlas.has(frame);
    if (hasFrame && fa > 0.004) {
      this.atlas.draw(ctx, frame, x, y, {
        scaleX: scale * sx * Math.abs(face), scaleY: scale * sy,
        alpha: alpha * Math.min(1, fa), flipX: face < 0,
      });
      if (fa >= 0.996) return;
    }
    const bodyAlpha = hasFrame ? alpha * (1 - Math.min(1, fa)) : alpha;
    if (bodyAlpha <= 0.004) return;

    this.computeMatrices();
    ctx.save();
    if (bodyAlpha !== 1) ctx.globalAlpha *= bodyAlpha;
    ctx.translate(x, y);
    ctx.scale(scale * this.unit * sx * face, scale * this.unit * sy);
    ctx.translate(-this.ox, -this.oy);
    const img = this.image;
    for (const p of this.parts) {
      if (!p.visible || p.alpha <= 0) continue;
      const m = p.m;
      ctx.save();
      if (p.alpha !== 1) ctx.globalAlpha *= p.alpha;
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      if (p.jelly) this.drawJelly(ctx, img, p);
      else if (p.bend !== 0 && Math.abs(p.bend) > 0.002) this.drawBent(ctx, img, p);
      else ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, -p.px, -p.py, p.sw, p.sh);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Старый кадр атласа, если скелета нет. */
  drawFallback(ctx, x, y, scale, sx, sy, alpha, face) {
    if (this.atlas && this.source && this.atlas.has(this.source)) {
      this.atlas.draw(ctx, this.source, x, y, {
        scaleX: scale * sx * Math.abs(face), scaleY: scale * sy, alpha, flipX: face < 0,
      });
    }
  }

  computeMatrices() {
    for (const p of this.order) {
      const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
      const la = cos * p.scaleX, lb = sin * p.scaleX, lc = -sin * p.scaleY, ld = cos * p.scaleY;
      let tx = p.ox + p.dx, ty = p.oy + p.dy;
      const par = p.parent;
      if (par && par.jelly) tx += par.waveX(p.oy + par.py);   // деталь едет вместе с волной тела
      const m = p.m;
      if (!par) {
        m[0] = la; m[1] = lb; m[2] = lc; m[3] = ld; m[4] = tx; m[5] = ty;
      } else {
        const q = par.m;
        m[0] = q[0] * la + q[2] * lb;
        m[1] = q[1] * la + q[3] * lb;
        m[2] = q[0] * lc + q[2] * ld;
        m[3] = q[1] * lc + q[3] * ld;
        m[4] = q[0] * tx + q[2] * ty + q[4];
        m[5] = q[1] * tx + q[3] * ty + q[5];
      }
    }
  }

  /**
   * Изгиб по дуге: часть режется на полоски поперёк оси, каждая следующая
   * повёрнута на bend/N вокруг границы с предыдущей.
   */
  drawBent(ctx, img, p) {
    const n = BEND_STRIPS;
    const step = p.bend / n;
    const cos = Math.cos(step), sin = Math.sin(step);
    if (p.axis === 'y' || p.axis === 'y-') {
      const down = p.axis === 'y';
      const len = down ? p.sh - p.py : p.py;
      if (len < n) { ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, -p.px, -p.py, p.sw, p.sh); return; }
      // полоска захватывает лишние строки в сторону кончика: они прячутся под
      // следующей полоской, а на внешней стороне дуги закрывают клин-щель
      const over = Math.min(Math.floor(len / n), Math.ceil(Math.abs(sin) * p.sw * 0.6) + 2);
      // неподвижная половина по другую сторону пивота
      if (down) ctx.drawImage(img, p.sx, p.sy, p.sw, p.py + 1, -p.px, -p.py, p.sw, p.py + 1);
      else ctx.drawImage(img, p.sx, p.sy + p.py, p.sw, p.sh - p.py, -p.px, 0, p.sw, p.sh - p.py);
      let prev = p.py;
      for (let i = 1; i <= n; i++) {
        const b = down ? Math.round(p.py + len * i / n) : Math.round(p.py - len * i / n);
        let r0 = Math.min(prev, b), r1 = Math.max(prev, b);
        if (i < n) { if (down) r1 = Math.min(p.sh, r1 + over); else r0 = Math.max(0, r0 - over); }
        const h = r1 - r0;
        if (h > 0) ctx.drawImage(img, p.sx, p.sy + r0, p.sw, h, -p.px, r0 - p.py, p.sw, h);
        // повернуть систему координат вокруг границы полоски
        const cy = b - p.py;
        ctx.transform(cos, sin, -sin, cos, -(-sin * cy), cy - cos * cy);
        prev = b;
      }
    } else {
      const right = p.axis === 'x';
      const len = right ? p.sw - p.px : p.px;
      if (len < n) { ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, -p.px, -p.py, p.sw, p.sh); return; }
      const over = Math.min(Math.floor(len / n), Math.ceil(Math.abs(sin) * p.sh * 0.6) + 2);
      if (right) ctx.drawImage(img, p.sx, p.sy, p.px + 1, p.sh, -p.px, -p.py, p.px + 1, p.sh);
      else ctx.drawImage(img, p.sx + p.px, p.sy, p.sw - p.px, p.sh, 0, -p.py, p.sw - p.px, p.sh);
      let prev = p.px;
      for (let i = 1; i <= n; i++) {
        const b = right ? Math.round(p.px + len * i / n) : Math.round(p.px - len * i / n);
        let c0 = Math.min(prev, b), c1 = Math.max(prev, b);
        if (i < n) { if (right) c1 = Math.min(p.sw, c1 + over); else c0 = Math.max(0, c0 - over); }
        const w = c1 - c0;
        if (w > 0) ctx.drawImage(img, p.sx + c0, p.sy, w, p.sh, c0 - p.px, -p.py, w, p.sh);
        const cx = b - p.px;
        ctx.transform(cos, sin, -sin, cos, cx - cos * cx, -sin * cx);
        prev = b;
      }
    }
  }

  /** Желе: горизонтальные полоски со сдвигом по волне (низ стоит на месте). */
  drawJelly(ctx, img, p) {
    const n = JELLY_STRIPS;
    let prev = 0;
    for (let i = 1; i <= n; i++) {
      const r1 = Math.round(p.sh * i / n);
      const h = r1 - prev + (i < n ? 1 : 0);
      const off = p.waveX((prev + r1) / 2);
      ctx.drawImage(img, p.sx, p.sy + prev, p.sw, h, -p.px + off, prev - p.py, p.sw, h);
      prev = r1;
    }
  }
}

// ----------------------------------------------------------------------
// аниматоры
// ----------------------------------------------------------------------

/** «Вперёд» для висящей вниз части: положительное = кончик по ходу героя. */
const fwd = (deg) => -deg * DEG;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };

/** Общее моргание: st.blinkT - таймер, веко открывается/закрывается за 0.12 с. */
function blink(pp, dt, names, gap = [2.2, 5.5]) {
  const st = pp.st;
  if (st.blinkT === undefined) st.blinkT = 1 + Math.random() * 2;
  st.blinkT -= dt;
  let k = 0;
  if (st.blinkT <= 0) {
    st.blinkPhase = (st.blinkPhase ?? 0) + dt;
    const d = 0.26;
    const u = st.blinkPhase / d;
    k = u < 0.5 ? smooth(u * 2) : smooth((1 - u) * 2);
    if (st.blinkPhase >= d) { st.blinkPhase = 0; st.blinkT = gap[0] + Math.random() * (gap[1] - gap[0]); k = 0; }
  }
  for (const n of names) {
    const p = pp.byName[n];
    if (!p) continue;
    p.visible = k > 0.02;
    p.tScaleY = k; p.scaleY = k;   // веко идёт мгновенно, без пружины
  }
}

function animGeneric(pp, dt, input) {
  const t = pp.time;
  for (const p of pp.parts) if (!p.parent) p.set({ scaleY: 1 + 0.02 * Math.sin(t * 1.6), scaleX: 1 - 0.011 * Math.sin(t * 1.6) }, 20);
}

/* ---------------- Петька ---------------- */

/**
 * Контроллер анимации героя.
 *
 * Раньше поза считалась «одной веткой if» и подставлялась как цель для
 * общей пружины, а плавность перехода задавалась скоростью притяжения
 * (`rate`), которая менялась от 6 до 45 в зависимости от ветки. Из-за
 * этого на каждой смене состояния поза меняла и цель, и скорость: старт
 * ходьбы вбрасывал синусоиду в произвольной фазе на скорости 45, а
 * остановка тормозила её до 6 - отсюда рывки.
 *
 * Теперь работает смешивание поз (blend tree), как в обычных игровых
 * аниматорах:
 *
 *   1. каждое состояние (стойка, ходьба, замах, полёт, приземление,
 *      приветствие, «ой») - отдельная **поза**: набор из 12 чисел;
 *   2. у каждого состояния свой **вес** 0..1, который сам плавно едет к
 *      цели, причём вход и выход имеют разные скорости (в полёт - резко,
 *      из приседа - медленно, «оседая»);
 *   3. итоговая поза - взвешенная сумма; веса нормируются, поэтому в
 *      любой момент времени поза корректна, даже если сумма не единица;
 *   4. к частям итог применяется с одной и той же быстрой скоростью:
 *      за плавность отвечают веса, а не сглаживание частей.
 *
 * Побочные приятные следствия: при остановке амплитуда шага гаснет сама
 * (вес ходьбы падает), поэтому ноги сходятся, а не замирают враскоряку;
 * фазы полёта переливаются друг в друга непрерывно по вертикальной
 * скорости, а не переключаются по порогу.
 */

const WALK_CYCLE_PX = 102;      // как в GameScene: путь за полный цикл (два шага)
const LEG_THIGH = 70;           // длины сегментов ног в px частей
const LEG_SHIN = 45;
const TAU = Math.PI * 2;
const APPLY_RATE = 45;          // скорость, с которой части догоняют смешанную позу
const AIR_VY = 700;             // вертикальная скорость, на которой полёт «в полную силу»

// каналы позы
const CH = 12;
const C_THN = 0, C_SHN = 1, C_THF = 2, C_SHF = 3;
const C_UAN = 4, C_FAN = 5, C_UAF = 6, C_FAF = 7;
const C_LEAN = 8, C_HEAD = 9, C_BEND = 10, C_DY = 11;

/** Заполнить буфер позы. Углы конечностей - в градусах «вперёд». */
function pose(o, thN, shN, thF, shF, uaN, faN, uaF, faF, lean, head, bend, dy) {
  o[0] = thN; o[1] = shN; o[2] = thF; o[3] = shF;
  o[4] = uaN; o[5] = faN; o[6] = uaF; o[7] = faF;
  o[8] = lean; o[9] = head; o[10] = bend; o[11] = dy;
  return o;
}

/** Экспоненциальное приближение, не зависящее от шага времени. */
function approach(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

// Скорости появления и исчезновения каждой позы (1/с). Разные для входа и
// выхода: в воздух герой уходит резко, а присед после приземления
// «оседает» медленно - так движение читается как вес тела, а не как
// переключение картинки.
const BLEND_IN = { idle: 8, walk: 14, crouch: 26, air: 16, land: 20, hello: 9, hurt: 22 };
const BLEND_OUT = { idle: 10, walk: 11, crouch: 18, air: 15, land: 6.5, hello: 8, hurt: 9 };
const STATES = ['idle', 'walk', 'crouch', 'air', 'land', 'hello', 'hurt'];

function animPetka(pp, dt, input) {
  const st = pp.st;
  const t = pp.time;
  const state = input.state ?? 'idle';
  const onGround = input.onGround ?? true;
  const vy = input.vy ?? 0;

  if (!st.buf) {
    st.buf = new Float64Array(CH);      // аккумулятор итоговой позы
    st.tmp = new Float64Array(CH);      // поза одного состояния
    st.w = Object.create(null);
    for (const k of STATES) st.w[k] = 0;
    st.w.idle = 1;
    st.phase = 0;
    // сколько градусов в секунду позволено каждой части: взмах руки быстрее
    // шага, но и он не мгновенный
    for (const n of ['upperarm_near', 'upperarm_far']) pp.limit(n, 780);
    for (const n of ['forearm_near', 'forearm_far']) pp.limit(n, 900);
    for (const n of ['thigh_near', 'thigh_far', 'shin_near', 'shin_far']) pp.limit(n, 1000);
    pp.limit('torso', 420);
    pp.limit('head', 420);
  }

  // ---------- тайминги ----------
  if (st.wasOnGround === undefined) st.wasOnGround = onGround;
  if (!onGround) { st.airT = (st.airT ?? 0) + dt; st.landT = 0; }
  else {
    if (!st.wasOnGround) st.landT = 0.18;          // только что коснулись земли
    st.airT = 0;
    st.landT = Math.max(0, (st.landT ?? 0) - dt);
  }
  st.wasOnGround = onGround;

  // ---------- фаза шага ----------
  // Фаза считается от пройденного пути, поэтому ноги не скользят. Когда
  // герой встал, фаза доворачивается до ближайшей точки «ноги вместе»:
  // иначе поза замирала бы посреди шага и гасла в стойку боком.
  const speed = input.speed ?? Math.abs(input.vx ?? 0);
  const moving = state === 'walk' && onGround;
  if (moving) st.phase += (speed * dt / WALK_CYCLE_PX) * TAU;
  else {
    const nearest = Math.round(st.phase / Math.PI) * Math.PI;
    st.phase = approach(st.phase, nearest, 9, dt);
  }

  // ---------- какое состояние сейчас главное ----------
  let active;
  if ((input.hurt ?? 0) > 0) active = 'hurt';
  else if (!onGround) active = st.airT < 0.07 ? 'crouch' : 'air';
  else if (st.landT > 0) active = 'land';
  else if (state === 'walk') active = 'walk';
  else if (state === 'hello') active = 'hello';
  else active = 'idle';

  for (const k of STATES) {
    const target = k === active ? 1 : 0;
    const rate = target > st.w[k] ? BLEND_IN[k] : BLEND_OUT[k];
    st.w[k] = approach(st.w[k], target, rate, dt);
  }

  // ---------- смешиваем позы ----------
  const buf = st.buf;
  const tmp = st.tmp;
  buf.fill(0);
  let sum = 0;
  for (const k of STATES) {
    const w = st.w[k];
    if (w < 0.002) continue;
    posePetka(tmp, k, st, t, vy, dt);
    for (let i = 0; i < CH; i++) buf[i] += tmp[i] * w;
    sum += w;
  }
  if (sum > 1e-4) for (let i = 0; i < CH; i++) buf[i] /= sum;

  // ---------- вид анфас ----------
  // Отдельный рисунок из атласа: марионетка не умеет разворачиваться к
  // зрителю. Переход не срезом, а перекрёстным затуханием.
  st.fbTarget = state === 'idleFront' && onGround ? 1 : 0;
  st.fbAlpha = approach(st.fbAlpha ?? 0, st.fbTarget, st.fbTarget ? 6 : 9, dt);
  st.fallbackFrame = st.fbAlpha > 0.004 ? 'petka_idle' : null;

  // ---------- корпус садится на длину согнутых ног ----------
  const thN = buf[C_THN], shN = buf[C_SHN], thF = buf[C_THF], shF = buf[C_SHF];
  const footN = LEG_THIGH * Math.cos(thN * DEG) + LEG_SHIN * Math.cos((thN + shN) * DEG);
  const footF = LEG_THIGH * Math.cos(thF * DEG) + LEG_SHIN * Math.cos((thF + shF) * DEG);
  let dy = buf[C_DY];
  if (onGround) dy += 0.8 * ((LEG_THIGH + LEG_SHIN) - Math.max(footN, footF));

  // дыхание: в покое заметнее, на бегу почти не видно
  const calm = 1 - Math.min(1, st.w.walk + st.w.air + st.w.crouch);
  const breathe = Math.sin(t * 1.7) * calm;

  pp.set('torso', {
    angle: buf[C_LEAN] * DEG, dy, bend: buf[C_BEND],
    scaleY: 1 + 0.012 * breathe, scaleX: 1 - 0.006 * breathe,
  }, APPLY_RATE);
  pp.set('head', { angle: buf[C_HEAD] * DEG }, APPLY_RATE);
  pp.set('thigh_near', { angle: fwd(thN) }, APPLY_RATE);
  pp.set('shin_near', { angle: fwd(shN) }, APPLY_RATE);
  pp.set('thigh_far', { angle: fwd(thF) }, APPLY_RATE);
  pp.set('shin_far', { angle: fwd(shF) }, APPLY_RATE);
  pp.set('upperarm_near', { angle: fwd(buf[C_UAN]) }, APPLY_RATE);
  pp.set('forearm_near', { angle: fwd(buf[C_FAN]) }, APPLY_RATE);
  pp.set('upperarm_far', { angle: fwd(buf[C_UAF]) }, APPLY_RATE);
  pp.set('forearm_far', { angle: fwd(buf[C_FAF]) }, APPLY_RATE);

  // ---------- рюкзак: пружина с запаздыванием ----------
  const torso = pp.byName.torso;
  if (torso) {
    const bodyY = dy + vy * 0.003;
    if (st.bpPrev === undefined) { st.bpPrev = bodyY; st.bpY = 0; st.bpV = 0; }
    const vel = (bodyY - st.bpPrev) / Math.max(dt, 1e-3);
    st.bpPrev = bodyY;
    st.bpV += (-st.bpY * 150 - st.bpV * 11 - vel * 0.8) * dt;
    st.bpY += st.bpV * dt;
    st.bpY = Math.max(-9, Math.min(11, st.bpY));
    pp.set('backpack', { dy: st.bpY, angle: -st.bpY * 0.012 }, 60);
  }

  blink(pp, dt, ['lid']);
}

/** Поза одного состояния в буфер `o`. */
function posePetka(o, key, st, t, vy, dt) {
  switch (key) {
    case 'walk': return poseWalk(o, st.phase);
    case 'crouch':
      // замах на отрыве: подобрался, руки пошли назад
      return pose(o, 30, -55, 10, -30, -22, -8, -20, -8, 12, -4, -0.02, 10);
    case 'air': return poseAir(o, vy);
    case 'land': {
      // присед на приземлении: чем свежее касание, тем глубже
      const k = Math.min(1, (st.landT ?? 0) / 0.18);
      return pose(o, 30 * k, -54 * k, -4 * k, -32 * k,
        30 * k, 18 * k, 24 * k, 14 * k, 13 * k, 8 * k, 0.03 * k, 0);
    }
    case 'hello': {
      const w = Math.sin(t * 9);
      return pose(o, 0, 0, -3, 0, 92 + 4 * w, 62 + 22 * w, 4, 8, -2, -5 + 2 * w, 0, 0);
    }
    case 'hurt':
      return pose(o, 18, -10, -12, -8, 55, 30, 40, 25, -14, -10, -0.12, 0);
    default: return poseIdle(o, st, t, dt);
  }
}

/**
 * Ходьба. Фаза - от пройденного пути, поэтому ноги не скользят.
 * Руки отстают от ног на небольшой угол: так шаг выглядит живее, чем при
 * строгой противофазе.
 */
function poseWalk(o, ph) {
  const s = Math.sin(ph), c = Math.cos(ph);
  const sa = Math.sin(ph - 0.22);
  const A = 27;
  const thN = A * s;
  const thF = -A * s;
  // колено сгибается в фазе переноса (когда бедро идёт вперёд)
  const shN = -52 * Math.pow(Math.max(0, c), 1.3) - 6 * Math.max(0, -c) * Math.max(0, -s);
  const shF = -52 * Math.pow(Math.max(0, -c), 1.3) - 6 * Math.max(0, c) * Math.max(0, s);
  return pose(o,
    thN, shN, thF, shF,
    -32 * sa, 12 + 20 * (0.5 - 0.5 * sa),
    32 * sa, 12 + 20 * (0.5 + 0.5 * sa),
    4 + 1.5 * Math.sin(2 * ph),
    -2 + 2.2 * Math.sin(2 * ph - 0.9),
    0.03 + 0.02 * Math.sin(2 * ph),
    0);
}

/**
 * Полёт одной непрерывной формулой: `k` = +1 на взлёте, 0 в верхней точке,
 * -1 при падении. Раньше три позы переключались по порогу скорости, и на
 * границе поза прыгала на десятки градусов.
 */
function poseAir(o, vy) {
  const k = Math.max(-1, Math.min(1, -vy / AIR_VY));
  const up = Math.max(0, k);        // доля позы взлёта
  const down = Math.max(0, -k);     // доля позы падения
  const mid = 1 - up - down;        // верхняя точка
  const mix = (a, b, c) => a * up + b * mid + c * down;
  return pose(o,
    mix(45, 30, 28),                // бедро ближнее
    mix(-85, -60, -12),             // голень ближняя
    mix(5, -15, 8),                 // бедро дальнее
    mix(-60, -35, -22),             // голень дальняя
    // руки: на взлёте вверх, в верхней точке раскинуты, при падении уже
    // идут вперёд - к позе приземления, чтобы не пролетать её рывком
    mix(105, 80, 10),               // плечо ближнее
    mix(35, 40, 8),                 // предплечье ближнее
    mix(140, -30, -6),              // плечо дальнее
    mix(20, 18, 6),                 // предплечье дальнее
    mix(5, 2, -5),                  // наклон
    mix(-9, -5, 6),                 // голова
    mix(-0.08, 0, 0.06),            // изгиб корпуса
    0);
}

/**
 * Стойка: дыхание и редкие микродвижения - переступить или посмотреть в
 * сторону. Без них персонаж выглядит замершей картинкой.
 */
function poseIdle(o, st, t, dt) {
  const b = Math.sin(t * 1.7);
  let thN = 0, shN = 0, head = 1.4 * Math.sin(t * 1.7 + 0.8), lean = 0.6 * b;

  if (st.microT === undefined) st.microT = 3 + Math.random() * 3;
  st.microT -= dt;
  if (st.microT <= 0 && !st.micro) {
    st.micro = Math.random() < 0.5 ? 'step' : 'look';
    st.microLeft = st.micro === 'step' ? 0.7 : 1.1;
  }
  if (st.micro) {
    st.microLeft -= dt;
    const dur = st.micro === 'step' ? 0.7 : 1.1;
    const k = smooth(st.microLeft / 0.25) * smooth((dur - st.microLeft) / 0.25);
    if (st.micro === 'step') { thN = -7 * k; shN = 12 * k; lean += 1.5 * k; }
    else head += -6 * k;
    if (st.microLeft <= 0) { st.micro = null; st.microT = 4 + Math.random() * 4; }
  }

  return pose(o, thN, shN, 0, 0, 2 * b, 3 + 1.5 * b, 2 * b, 3 + 1.5 * b, lean, head, 0, 0);
}

/* ---------------- Кот Тишка ---------------- */

function animCat(pp, dt, input) {
  const st = pp.st;
  const t = pp.time;
  const talk = input.state === 'talk';
  const br = Math.sin(t * 1.4);
  pp.set('body', { scaleY: 1 + 0.02 * br, scaleX: 1 - 0.012 * br }, 20);

  // голова: медленное покачивание + иногда наклон набок
  if (st.tiltT === undefined) st.tiltT = 2 + Math.random() * 3;
  st.tiltT -= dt;
  if (st.tiltT <= 0 && !st.tilt) { st.tilt = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 4); st.tiltLeft = 1.4; }
  let head = 2 * Math.sin(t * 0.9);
  if (st.tilt) {
    st.tiltLeft -= dt;
    const k = smooth(Math.min(1, st.tiltLeft / 0.4)) * smooth(Math.min(1, (1.4 - st.tiltLeft) / 0.4));
    head += st.tilt * k;
    if (st.tiltLeft <= 0) { st.tilt = 0; st.tiltT = 3 + Math.random() * 4; }
  }
  if (talk) head += 3.5 * Math.sin(t * 7);
  pp.set('head', { angle: head * DEG, dy: talk ? 1.5 * Math.sin(t * 7) : 0 }, talk ? 18 : 6);

  // уши: редкое подёргивание
  if (st.earT === undefined) st.earT = 1 + Math.random() * 3;
  st.earT -= dt;
  if (st.earT <= 0) { st.earT = 2 + Math.random() * 4; st.earK = 0.25; st.earSide = Math.random() < 0.5 ? 'ear_l' : 'ear_r'; }
  if (st.earK > 0) {
    st.earK -= dt;
    const k = Math.sin(clamp01(st.earK / 0.25) * Math.PI);
    pp.set(st.earSide, { angle: (st.earSide === 'ear_l' ? -1 : 1) * 12 * DEG * k }, 40);
  }
  pp.set(st.earSide === 'ear_l' ? 'ear_r' : 'ear_l', { angle: 0 }, 12);

  // хвост: качается и изгибается
  const tw = talk ? 2.2 : 1;
  pp.set('tail', { angle: 2.5 * DEG * Math.sin(t * 1.1 * tw), bend: 0.3 * Math.sin(t * 1.5 * tw + 1) }, 30);

  blink(pp, dt, ['lid_l', 'lid_r']);
}

/* ---------------- Сова ---------------- */

function animOwl(pp, dt, input) {
  const st = pp.st;
  const t = pp.time;
  const talk = input.state === 'talk';
  const br = Math.sin(t * 1.2);
  pp.set('body', { scaleY: 1 + 0.016 * br, scaleX: 1 - 0.009 * br }, 20);
  let head = 2.5 * Math.sin(t * 0.8) + (talk ? 3 * Math.sin(t * 6.5) : 0);
  pp.set('head', { angle: head * DEG, dy: -1.5 * br + (talk ? 1.2 * Math.sin(t * 6.5) : 0) }, talk ? 16 : 6);

  // листает страницу: крыло приподнимается к книге и опускается
  if (st.pageT === undefined) st.pageT = 2 + Math.random() * 3;
  st.pageT -= dt;
  let wing = 0, book = 0, wingBend = 0;
  if (st.pageT <= 0 && !st.page) { st.page = 0.9; }
  if (st.page) {
    st.page -= dt;
    const k = Math.sin(clamp01(1 - st.page / 0.9) * Math.PI);
    wing = -9 * k; wingBend = -0.18 * k; book = -3 * k;
    if (st.page <= 0) { st.page = 0; st.pageT = talk ? 1.5 + Math.random() * 2 : 3 + Math.random() * 4; }
  }
  if (talk) { wing += 2 * Math.sin(t * 5); }
  pp.set('wing', { angle: wing * DEG, bend: wingBend + 0.04 * br }, 14);
  pp.set('book', { angle: (book + 1.2 * br) * DEG, dy: -1 * br }, 10);
  blink(pp, dt, ['lid_l', 'lid_r'], [2.5, 6]);
}

/* ---------------- Пекарь ---------------- */

function animBaker(pp, dt, input) {
  const t = pp.time;
  const talk = input.state === 'talk';
  const br = Math.sin(t * 1.3);
  pp.set('body', { scaleY: 1 + 0.018 * br, scaleX: 1 - 0.01 * br }, 20);
  const nod = talk ? 4 * Math.sin(t * 5.5) : 2 * Math.sin(t * 0.9);
  pp.set('head', { angle: nod * DEG, dy: talk ? 1.5 * Math.sin(t * 5.5 + 1) : 0 }, talk ? 16 : 6);
  pp.set('cap', { angle: -nod * 0.5 * DEG, dy: -0.8 * br }, 8);   // колпак отстаёт от кивка
  // жестикуляция ближней рукой
  const g = talk ? 1 : 0.35;
  pp.set('upperarm_near', { angle: (5 * Math.sin(t * 2.4)) * g * DEG }, 10);
  pp.set('forearm_near', { angle: (12 * Math.sin(t * 2.4 + 0.7) + 4) * g * DEG }, 12);
  pp.set('arm_far', { angle: 2 * br * DEG }, 8);
  blink(pp, dt, ['lid'], [2, 5]);
}

/* ---------------- Клякса ---------------- */

function animKlyaksa(pp, dt, input) {
  const st = pp.st;
  const t = pp.time;
  const vx = input.vx ?? 0;
  const moving = Math.min(1, Math.abs(vx) / 200);
  const body = pp.byName.body;
  // желейная волна: сильнее при движении; наклон корпуса по ходу
  const ph = t * (3.6 + 4 * moving);
  if (body) {
    body.waveAmp = 5 + 8 * moving;
    body.wavePhase = -ph;
    body.waveFreq = 0.022;
    const dir = input.flip ? -1 : 1;    // в draw зеркалим, поэтому наклон в локальных координатах
    body.waveTilt += ((-vx * 0.05 * dir) - body.waveTilt) * Math.min(1, dt * 6);
  }
  const sq = Math.sin(ph * 0.9);
  pp.set('body', { scaleY: 1 + (0.06 + 0.06 * moving) * sq, scaleX: 1 - (0.035 + 0.04 * moving) * sq }, 40);
  // капли-отростки колышутся с запаздыванием
  pp.set('drop_a', { angle: 7 * DEG * Math.sin(ph - 1.2), bend: 0.25 * Math.sin(ph - 1.8) }, 30);
  pp.set('drop_b', { angle: 6 * DEG * Math.sin(ph - 1.9), bend: 0.2 * Math.sin(ph - 2.4) }, 30);
  // глаз следит: за героем (lookX -1..1) или бегает сам
  let look = input.lookX ?? Math.sin(t * 0.7);
  if (st.lookT === undefined) st.lookT = 1;
  pp.set('pupil', { dx: 7 * look, dy: 3 * Math.sin(t * 1.3) }, 8);
  pp.set('eye', { dy: -2 * sq }, 30);
  blink(pp, dt, ['lid'], [1.5, 4]);
}

const ANIMATORS = { petka: animPetka, cat: animCat, owl: animOwl, baker: animBaker, klyaksa: animKlyaksa };
