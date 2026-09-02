import { PALETTE, drawButton, hit, paperPath, font, wrapText, ghostFrame } from '../core/ui.js';
import { Dialogue } from '../core/Dialogue.js';
import { Placement } from '../core/Placement.js';
import { Finale } from '../core/Finale.js';
import { TaskWindow } from '../core/TaskWindow.js';
import { Editor } from '../core/Editor.js';
import { shimmerText } from '../core/motion.js';
import { readable } from '../core/text.js';

const GRAVITY = 2600;
const JUMP_V = 1080;   // прыжок повыше: через ящик и Кляксу надо перелетать

/**
 * Скорость подобрана под рисунок ходьбы, а не наоборот.
 *
 * В кадре-контакте стопы разведены на 51 px экрана - это длина шага. Полный
 * цикл из шести кадров - два шага, 102 px пути. При 320 px/с цикл занимает
 * 0,32 с (≈19 кадров/с, 6 шагов в секунду): быстрый, но живой шаг. При старых
 * 400 px/с ноги пришлось бы крутить на 23 кадрах/с - герой семенил.
 */
const SPEED = 320;
const WALK_CYCLE_PX = 102;      // путь за полный цикл ходьбы
const WALK_FRAMES = ['petka_walk0', 'petka_walk1', 'petka_walk2',
  'petka_walk3', 'petka_walk4', 'petka_walk5'];

/**
 * Фазы прыжка. При JUMP_V = 1080 и G = 2600 подъём длится 0,42 с, весь
 * прыжок - 0,83 с, высшая точка 224 px. Кадр выбирается не по таймеру, а по
 * вертикальной скорости: тогда фаза совпадает с тем, что видит игрок,
 * даже если герой оттолкнулся от Кляксы или спрыгнул с ящика.
 */
const JUMP_CROUCH_T = 0.06;     // короткая присядка на отрыве - «замах»
const JUMP_APEX_VY = 250;       // |vy| ниже этого - верхняя точка (0,19 с)
const LAND_TIME = 0.16;         // сколько держится поза приземления
const GROUND_OFFSET = 96;   // от низа экрана до линии пола
const MAX_HP = 3;
const HURT_TIME = 1.6;      // неуязвимость после касания Кляксы
const TALK_RANGE = 180;
const IDLE_FRONT_AFTER = 3;   // сек простоя до разворота к игроку
const NPC_ZOOM = 1.18;        // насколько камера наезжает у собеседника
const ZOOM_SPEED = 2.8;       // как быстро наезжает и отъезжает

/**
 * Игровая сцена.
 *
 * Слои по глубине: небо -> дальние декорации 0,5 -> средние 0,75 ->
 * игровой слой 1,0 -> передний план 1,2 (забор) -> интерфейс.
 * Чем ближе слой, тем быстрее он едет: это и даёт ощущение объёма.
 * Поверх работают две подсистемы: диалоги с НПС и встроенный редактор (F2).
 */
export class GameScene {
  constructor(game) {
    this.game = game;
    this.cameraX = 0;
    this.buttons = [];
    this.dialogue = new Dialogue(game);
    this.placement = new Placement(game);
    this.finale = new Finale(game);
    this.taskWindow = new TaskWindow(game);
    this.editor = new Editor(game);
  }

  async enter(data) {
    this.ready = false;
    const id = data.chapter || 'chapter_01';
    this.chapter = await this.game.api.content(id);
    this.game.chapter = this.chapter;
    this.game.scene = this;

    this.restart();
    this.ready = true;
  }

  restart() {
    const ch = this.chapter;
    this.player = {
      x: ch.playerStart ?? 260, y: 0, vx: 0, vy: 0,
      onGround: true, flip: false, scale: 0.63,
      hp: MAX_HP, hurt: 0,
      sx: 1, sy: 1, syv: 0,          // пружина для squash & stretch
    };
    this.state = 'hello';
    this.helloTimer = 1.2;
    this.walkDist = 0;      // пройденный путь: по нему крутится цикл ходьбы
    this.airT = 0;          // сколько уже в воздухе
    this.landT = 0;         // сколько ещё держать позу приземления
    this.idleTime = 0;
    this.cameraX = 0;
    this.camLook = 0;
    this.zoom = 1;
    this.collected = new Set();
    this.collectedOrder = [];        // порядок сбора нужен финалу: по нему считаем
    this.popup = null;
    this.finished = false;
    this.gameOver = false;
    this.showHint = 0;
    this.nearNpc = null;
    this.enemies = (ch.enemies || []).map((e) => ({ def: e, x: e.x, dir: 1, t: 0 }));
    // ворота: ящик стоит поперёк дороги, пока не решена его задача
    this.gates = (ch.gates || []).map((g) => ({ def: g, solved: false, slide: 0 }));
    this.nearGate = null;
    this.dialogue.close();
    // окно закрывается молча: после перезапуска главы цифра снова «не тронута»,
    // а не отложена до следующего подхода
    this.placement.onDone = null;
    this.placement.onClose = null;
    this.placement.close();
    this.finale.onClose = null;
    this.finale.close();
    this.taskWindow.onSolved = null;
    this.taskWindow.onClose = null;
    this.taskWindow.close();
    // цифры, чьё окно закрыли вручную: снова предложатся, когда герой отойдёт
    this.deferred = new Set();
    this.layoutUI();
  }

  /**
   * Лёгкая пружинка: персонаж чуть «дышит», а не стоит статуей.
   * Ширина гуляет в противофазе с высотой - объём сохраняется, как в
   * squash & stretch у Петьки. `seed` разводит героев по фазе, иначе весь
   * город дышал бы разом.
   */
  breath(seed, scale, amp = 0.022, speed = 1.6) {
    const t = this.game.time * speed + seed;
    const k = Math.sin(t);
    return { scaleY: scale * (1 + k * amp), scaleX: scale * (1 - k * amp * 0.55) };
  }

  /** Текст с учётом режима чтения по слогам (настройка из меню). */
  tr(s) { return readable(s, this.game.settings); }

  get groundY() { return this.game.viewport.viewH - GROUND_OFFSET; }
  get levelW() { return this.chapter.levelWidth ?? 4200; }

  // ---------- обновление ----------

  update(dt) {
    if (!this.ready) return;
    const { input } = this.game;

    // редактор перехватывает управление целиком
    if (this.editor.update(dt, this.chapter, this.groundY)) return;

    this.layoutUI();
    // пока открыто окно, кнопки «?» и «домой» не ловят клики: ребёнок тянет
    // цифру мышью и легко отпускает её над углом экрана
    if (!this.placement.active && !this.dialogue.active && !this.finale.active
        && !this.taskWindow.active) this.handleButtons();

    if (this.placement.active) { this.placement.update(dt); return; }
    if (this.taskWindow.active) { this.taskWindow.update(dt); return; }
    if (this.finale.active) { this.finale.update(dt); return; }
    if (this.dialogue.active) { this.dialogue.update(dt); return; }

    if (this.gameOver) {
      if (input.justPressed('Space', 'Enter') || input.pointer.clicked) this.restart();
      return;
    }
    if (input.justPressed('Escape')) { this.game.scenes.go('menu'); return; }
    if (this.showHint > 0) this.showHint -= dt;

    if (this.helloTimer > 0) {
      this.helloTimer -= dt;
      if (this.helloTimer <= 0) this.state = 'idle';
    }

    this.updatePlayer(dt);
    this.updateGates(dt);
    this.updateEnemies(dt);
    this.updateInteraction();
    this.updatePickups();
    this.updateCamera(dt);

    if (this.popup) { this.popup.t -= dt; if (this.popup.t <= 0) this.popup = null; }
    if (!this.finished && this.collected.size >= this.chapter.pickups.length) {
      this.finished = true;
      this.openFinale();
    }
  }

  updatePlayer(dt) {
    const { input } = this.game;
    const p = this.player;
    const locked = this.helloTimer > 0;

    const ax = locked ? 0 : input.axisX;
    p.vx = ax * SPEED;
    if (ax !== 0) p.flip = ax < 0;

    if (!locked && input.jump && p.onGround) {
      p.vy = -JUMP_V;
      p.onGround = false;
      p.syv = 3.2;                     // вытягивание на отрыве
    }

    p.vy += GRAVITY * dt;
    p.x = this.blockAtGates(p.x, Math.max(60, Math.min(this.levelW - 60, p.x + p.vx * dt)));
    p.y += p.vy * dt;

    if (p.y >= 0) {
      if (!p.onGround) {
        p.syv = -4.5;                  // приседание при приземлении
        this.landT = LAND_TIME;        // и поза «приземлился»
      }
      p.y = 0; p.vy = 0; p.onGround = true;
    }
    this.airT = p.onGround ? 0 : this.airT + dt;
    if (this.landT > 0 && p.onGround) this.landT -= dt;

    // цикл ходьбы крутится от пройденного пути - тогда ноги не скользят
    // ни при какой скорости
    if (p.onGround && ax !== 0) this.walkDist += Math.abs(p.vx) * dt;

    if (!locked) {
      if (!p.onGround) this.state = 'jump';
      else if (ax !== 0) this.state = 'walk';
      else this.state = this.idleTime >= IDLE_FRONT_AFTER ? 'idleFront' : 'idle';
    }

    // счётчик простоя: три секунды без движения - и герой смотрит вперёд
    const still = p.onGround && ax === 0 && !locked;
    this.idleTime = still ? this.idleTime + dt : 0;

    // пружина: sy стремится к 1, sx компенсирует «объём»
    const k = 46, damp = 9;
    p.syv += (1 - p.sy) * k * dt - p.syv * damp * dt;
    p.sy += p.syv * dt;
    p.sx = 1 + (1 - p.sy) * 0.55;
    if (this.state === 'walk') p.sy += Math.sin(this.game.time * 14) * 0.012;

    if (p.hurt > 0) p.hurt -= dt;
  }

  /**
   * Ящик перегораживает дорогу, пока задача не решена. Он выше прыжка -
   * обойти нельзя, только решить.
   */
  blockAtGates(fromX, toX) {
    for (const g of this.gates ?? []) {
      if (g.solved) continue;
      const wall = g.def.x - (g.def.width ?? 70);
      if (fromX <= wall && toX > wall) return wall;
    }
    return toX;
  }

  updateGates(dt) {
    const { input } = this.game;
    const p = this.player;
    this.nearGate = null;

    for (const g of this.gates ?? []) {
      if (g.solved) {
        if (g.slide < 1) g.slide = Math.min(1, g.slide + dt * 1.6);
        continue;
      }
      if (Math.abs(g.def.x - p.x) < 200) this.nearGate = g;
    }

    if (this.nearGate && input.interact) this.openGate(this.nearGate);
  }

  /** Задача у ворот собрана из цифр, которые уже надо было найти. */
  openGate(gate) {
    const need = (gate.def.needs ?? []).filter((id) => !this.collected.has(id));
    const win = this.taskWindow;
    win.onSolved = () => {
      gate.solved = true;
      this.game.api.saveProgress({
        chapter: this.chapter.id,
        collected: [...this.collected],
        hints_used: 0,
        seconds_played: Math.round(this.game.time),
      });
    };
    win.onClose = null;

    if (need.length) {
      const frames = need.map((id) => this.chapter.pickups.find((it) => it.id === id)?.frame).filter(Boolean);
      win.open({
        mode: 'need',
        need: frames,
        title: gate.def.needTitle ?? 'Сначала найди эти цифры',
        hint: gate.def.needHint ?? 'Без них задачу не решить',
      });
      return;
    }
    win.open({
      mode: 'task',
      task: gate.def.task,
      title: gate.def.title ?? 'Реши, и ящик уедет',
      hint: gate.def.hint ?? 'Выбери ответ: мышкой или клавишей 1, 2, 3',
    });
  }

  /** Какой кадр героя показывать сейчас. */
  playerFrame() {
    const p = this.player;
    if (!p.onGround) {
      if (this.airT < JUMP_CROUCH_T) return 'petka_jump_crouch';
      if (p.vy < -JUMP_APEX_VY) return 'petka_jump_up';
      if (p.vy <= JUMP_APEX_VY) return 'petka_jump_apex';
      return 'petka_jump_down';
    }
    if (this.landT > 0) return 'petka_jump_land';
    if (this.state === 'walk') {
      const step = WALK_CYCLE_PX / WALK_FRAMES.length;
      const i = Math.floor(this.walkDist / step) % WALK_FRAMES.length;
      return WALK_FRAMES[i];
    }
    if (this.state === 'idleFront' || this.state === 'hello') return 'petka_idle';
    return 'petka_stand';
  }

  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      const d = e.def;
      const dist = p.x - e.x;
      const chasing = Math.abs(dist) < (d.chaseRange ?? 500) && !this.finished;
      const speed = chasing ? (d.chaseSpeed ?? 220) : (d.speed ?? 140);

      if (chasing) {
        e.dir = Math.sign(dist) || 1;
      } else {
        if (e.x <= d.from) e.dir = 1;
        if (e.x >= d.to) e.dir = -1;
      }
      e.x += e.dir * speed * dt;
      e.x = Math.max(d.from - 220, Math.min(d.to + 220, e.x));
      e.t += dt;

      // столкновение: Клякса пачкает портфель, прыжком её можно перескочить
      if (p.hurt <= 0 && !this.finished && Math.abs(e.x - p.x) < 80 && p.y > -150) {
        p.hp -= 1;
        p.hurt = HURT_TIME;
        p.vy = -420;
        p.onGround = false;
        p.x += Math.sign(p.x - e.x || 1) * 90;
        p.syv = 2.5;
        if (p.hp <= 0) this.gameOver = true;
      }
    }
  }

  updateInteraction() {
    const { input } = this.game;
    const p = this.player;
    this.nearNpc = null;
    for (const n of this.chapter.npc) {
      if (!n.dialogue) continue;
      if (Math.abs(n.x - p.x) < TALK_RANGE) { this.nearNpc = n; break; }
    }
    if (this.nearNpc && input.interact) this.dialogue.open(this.nearNpc);
  }

  updatePickups() {
    const p = this.player;
    for (const it of this.chapter.pickups) {
      if (this.collected.has(it.id)) continue;
      const dist = Math.abs(it.x - p.x);
      if (dist >= 90 || p.y <= -260) {
        if (dist > 150) this.deferred.delete(it.id);   // отошёл - предложим снова
        continue;
      }
      if (this.deferred.has(it.id)) continue;
      this.openPlacement(it);
      return;
    }
  }

  /**
   * Цифра не попадает в портфель сама: сначала её надо узнать среди трёх
   * трафаретов. Задачка не случайная - у одной и той же цифры она всегда
   * одна и та же, поэтому ребёнок может пройти главу второй раз увереннее.
   */
  openPlacement(it) {
    const all = this.chapter.pickups;
    const others = all.filter((o) => o.frame !== it.frame);
    const i = all.indexOf(it);
    const frames = [it.frame];
    if (others.length) frames.push(others[i % others.length].frame);
    if (others.length > 1) frames.push(others[(i + 1) % others.length].frame);
    // верный трафарет не всегда первый: место зависит от номера цифры
    const shift = i % frames.length;
    const ordered = frames.slice(frames.length - shift).concat(frames.slice(0, frames.length - shift));

    this.placement.onDone = (item) => this.collect(item);
    this.placement.onClose = (solved) => {
      if (!solved) this.deferred.add(it.id);
    };
    this.placement.open(it, ordered);
  }

  collect(it) {
    this.collected.add(it.id);
    this.collectedOrder.push(it);
    this.popup = { frame: it.frame, t: 1.1 };
    this.player.syv = 2.0;
    this.game.api.saveProgress({
      chapter: this.chapter.id,
      collected: [...this.collected],
      hints_used: 0,
      seconds_played: Math.round(this.game.time),
    });
  }

  /** Финал главы: считаем собранное, складываем, и только потом - итог. */
  openFinale() {
    this.finale.onRestart = () => this.restart();
    this.finale.onMenu = () => this.game.scenes.go('menu');
    this.finale.onClose = null;
    this.finale.open(this.chapter, this.collectedOrder);
  }

  updateCamera(dt) {
    const { viewport } = this.game;
    const p = this.player;

    // рядом с собеседником камера наезжает: разговор - крупный план
    const wantZoom = this.nearNpc ? NPC_ZOOM : 1;
    this.zoom += (wantZoom - this.zoom) * Math.min(1, dt * ZOOM_SPEED);

    // лёгкое опережение по направлению взгляда - камера «дышит» за героем
    const want = p.flip ? -150 : 150;
    this.camLook += (want - this.camLook) * Math.min(1, dt * 2.2);
    const target = p.x + this.camLook - viewport.viewW * 0.45;
    this.cameraX += (target - this.cameraX) * Math.min(1, dt * 3.4);
    this.cameraX = Math.max(0, Math.min(Math.max(0, this.levelW - viewport.viewW), this.cameraX));
  }

  handleButtons() {
    const { input } = this.game;
    const over = this.buttons.findIndex((b) => hit(b, input.pointer));
    if (!this.dialogue.active) this.game.canvas.classList.toggle('pointer', over >= 0);
    if (input.pointer.clicked && over >= 0) {
      const id = this.buttons[over].id;
      if (id === 'menu') this.game.scenes.go('menu');
      if (id === 'hint') this.showHint = 5;
      if (id === 'again') this.restart();
    }
  }

  layoutUI() {
    const { viewW } = this.game.viewport;
    // подписи словами, а не значками: «?» и «домик» ребёнок 6+ не читает.
    // «Помощь» вместо «подсказки» - её и по слогам легко прочесть
    const items = [];
    if (this.finished) {
      // плашка «глава пройдена» закрывается совсем, поэтому пройти главу
      // заново предлагает кнопка в углу
      items.push({ id: 'again', label: this.tr('Заново'), w: 200, color: PALETTE.green });
    }
    items.push({ id: 'hint', label: this.tr('Помощь'), w: 210, color: PALETTE.yellow });
    items.push({ id: 'menu', label: this.tr('Домой'), w: 180, color: PALETTE.paper });

    const gap = 16;
    let x = viewW - 40 - items.reduce((a, b) => a + b.w, 0) - gap * (items.length - 1);
    this.buttons = items.map((b) => {
      const btn = { ...b, x, y: 28, h: 76 };
      x += b.w + gap;
      return btn;
    });
  }

  // ---------- отрисовка ----------

  render() {
    if (!this.ready) return;
    const { viewport, atlas, assets } = this.game;
    const ctx = viewport.ctx;
    const { viewW, viewH } = viewport;
    const gy = this.groundY;

    viewport.applyUI();
    ctx.fillStyle = '#eaf3fa';
    ctx.fillRect(0, 0, viewW, viewH);
    this.drawFar(ctx, assets.farBg, viewW, viewH);

    const z = this.editor.enabled ? 1 : this.zoom;   // в редакторе всегда 1:1
    const fy = gy;

    for (const o of this.chapter.props.filter((o) => (o.parallax ?? 1) !== 1)) {
      viewport.applyWorld(this.cameraX, o.parallax ?? 1, z, viewW / 2, fy);
      atlas.draw(ctx, o.frame, o.x, gy + (o.yOffset ?? 0), { scale: o.scale ?? 1, flipX: !!o.flip });
    }

    viewport.applyWorld(this.cameraX, 1, z, viewW / 2, fy);
    this.drawGround(ctx, gy);
    for (const o of this.chapter.props.filter((o) => (o.parallax ?? 1) === 1)) {
      atlas.draw(ctx, o.frame, o.x, gy + (o.yOffset ?? 0), { scale: o.scale ?? 1, flipX: !!o.flip });
    }
    for (const n of this.chapter.npc) {
      atlas.draw(ctx, n.frame, n.x, gy + (n.yOffset ?? 0), {
        ...this.breath(n.x * 0.01, n.scale ?? 1),
        flipX: !!n.flip,
      });
    }
    this.drawGates(ctx, gy);
    this.drawEnemies(ctx, gy);
    this.drawPickups(ctx, gy);
    this.drawPlayer(ctx, gy);
    this.drawForeground(ctx, gy, z, fy);
    if (!this.editor.enabled && !this.dialogue.active && !this.taskWindow.active) {
      viewport.applyWorld(this.cameraX, 1, z, viewW / 2, fy);
      if (this.nearNpc) this.drawTalkPrompt(ctx, gy);
      else if (this.nearGate) this.drawGatePrompt(ctx, gy);
    }

    viewport.applyUI();
    this.drawHUD(ctx, viewW, viewH);
    this.dialogue.render();
    this.placement.render();
    this.taskWindow.render();
    this.finale.render();
    this.editor.render(this.chapter, gy);
  }

  drawPlayer(ctx, gy) {
    const { atlas } = this.game;
    const p = this.player;
    if (p.hurt > 0 && Math.floor(p.hurt * 12) % 2 === 0) return;   // мигание
    const f = atlas.frame(this.playerFrame());
    const w = f.w * p.scale * p.sx;
    const h = f.h * p.scale * p.sy;
    // кадр «лицом к игроку» не зеркалим: он симметричен по смыслу
    const facing = this.state === 'idleFront' && p.onGround ? false : p.flip;
    ctx.save();
    ctx.translate(p.x, gy + p.y);
    if (facing) ctx.scale(-1, 1);
    ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, -w / 2, -h, w, h);
    ctx.restore();
  }

  drawGates(ctx, gy) {
    const { atlas } = this.game;
    for (const g of this.gates ?? []) {
      const d = g.def;
      if (!atlas.has(d.frame)) continue;
      // решённый ящик отъезжает в сторону и тает
      const k = g.slide;
      const dx = k * 190;
      const alpha = 1 - k;
      if (alpha <= 0.02) continue;
      atlas.draw(ctx, d.frame, d.x + dx, gy + (d.yOffset ?? 0) + k * 20, {
        ...this.breath(d.x * 0.01, d.scale ?? 1, 0.012),
        alpha,
        flipX: !!d.flip,
      });
    }
  }

  /** Подсказка над ящиком: «Пробел - решить». */
  drawGatePrompt(ctx, gy) {
    const g = this.nearGate;
    const d = g.def;
    const f = this.game.atlas.frame(d.frame);
    const top = gy + (d.yOffset ?? 0) - f.h * (d.scale ?? 1) - 26;

    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.font = font(24, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const label = this.tr('Пробел - решить');
    const w = Math.max(200, Math.ceil(ctx.measureText(label).width) + 48);
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, d.x - w / 2, top - 56, w, 58, 14, 15, 2.5);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(label, d.x, top - 18);
    ctx.restore();
  }

  drawEnemies(ctx, gy) {
    const { atlas } = this.game;
    for (const e of this.enemies) {
      const frame = (Math.floor(e.t * 4) % 2 === 0 && e.def.frameMove) ? e.def.frameMove : e.def.frame;
      const bob = Math.sin(e.t * 6) * 6;
      // Клякса кисельная, поэтому пружинит заметнее прочих
      atlas.draw(ctx, frame, e.x, gy + bob, {
        ...this.breath(e.x * 0.02, e.def.scale ?? 1, 0.05, 3.4),
        flipX: e.dir < 0,
      });
    }
  }

  drawPickups(ctx, gy) {
    const { atlas } = this.game;
    const t = this.game.time;
    for (const it of this.chapter.pickups) {
      if (this.collected.has(it.id)) continue;
      const bob = Math.sin(t * 2.4 + it.x * 0.01) * 12;
      atlas.draw(ctx, it.frame, it.x, gy + (it.yOffset ?? -150) + bob, { scale: it.scale ?? 0.5 });
    }
  }

  drawTalkPrompt(ctx, gy) {
    const n = this.nearNpc;
    const f = this.game.atlas.frame(n.frame);
    const top = gy + (n.yOffset ?? 0) - f.h * (n.scale ?? 1) - 30;

    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.font = font(24, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // ширина пузыря считается по самой надписи: по слогам она длиннее
    // («E - по-го-во-рить»), и в постоянные 230 px текст не влезал
    const label = this.tr('Пробел - поговорить');
    const w = Math.max(200, Math.ceil(ctx.measureText(label).width) + 48);
    const h = 58;

    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, n.x - w / 2, top - h + 2, w, h, 14, 13, 2.5);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(label, n.x, top - 18);
    ctx.restore();
  }

  drawFar(ctx, img, w, h) {
    // Дальний план не тайлится: изображение берётся с запасом по ширине
    // и двигается внутри запаса пропорционально положению камеры.
    const s = Math.max(w / img.width, h / img.height) * 1.18;
    const dw = img.width * s;
    const dh = img.height * s;
    const slack = dw - w;
    const k = Math.max(0, Math.min(1, this.cameraX / Math.max(1, this.levelW - this.game.viewport.viewW)));
    ctx.drawImage(img, -slack * k, h - dh, dw, dh);
  }

  /**
   * Передний план: забор вдоль всего экрана, за которым идёт герой.
   *
   * Слой не привязан к координатам мира - он бесконечно тайлится по экрану
   * со своим коэффициентом параллакса (больше единицы), поэтому едет быстрее
   * игрового слоя. Ряд кладётся с нахлёстом, чтобы стык не читался.
   */
  drawForeground(ctx, gy, zoom = 1, focusY = null) {
    const { viewport, atlas } = this.game;
    for (const layer of this.chapter.foreground ?? []) {
      if (!atlas.has(layer.frame)) continue;
      const f = atlas.frame(layer.frame);
      const scale = layer.scale ?? 1;
      const parallax = layer.parallax ?? 1.2;
      const w = f.w * scale;
      // нахлёст задаётся в пикселях кадра: столько, чтобы шаг между штакетинами
      // на стыке был такой же, как внутри кадра - иначе стык видно
      const step = Math.max(8, (f.w - (layer.overlap ?? 0)) * scale);
      const y = gy + (layer.yOffset ?? 0);

      // ряд кладётся в мировых координатах, поэтому наезд камеры достаётся
      // переднему плану сам собой - и он растёт сильнее остальных слоёв
      viewport.applyWorld(this.cameraX, parallax, zoom, viewport.viewW / 2, focusY ?? gy);
      const shift = this.cameraX * parallax;
      const from = Math.floor(shift / step) - 2;
      const to = from + Math.ceil(viewport.viewW / step) + 4;
      for (let i = from; i <= to; i++) {
        atlas.draw(ctx, layer.frame, i * step + w / 2, y, { scale });
      }
    }
  }

  drawGround(ctx, gy) {
    const { atlas } = this.game;
    const f = atlas.frame('ground_strip');
    const scale = 1.15;
    const w = f.w * scale;
    const step = w - 10;
    const y = gy + f.h * scale * 0.55;
    const from = Math.floor((this.cameraX - w) / step);
    const to = Math.ceil((this.cameraX + this.game.viewport.viewW + w) / step);
    for (let i = from; i <= to; i++) {
      atlas.draw(ctx, 'ground_strip', i * step + w / 2, y, { scale, flipX: (i & 1) === 1 });
    }
  }

  // ---------- интерфейс ----------

  drawHUD(ctx, viewW, viewH) {
    const { atlas } = this.game;
    const total = this.chapter.pickups.length;

    // счётчика «0 / 5» и сердечек нет: сколько собрано, видно по полоске
    // цифр внизу, а лишние значки только отвлекают
    this.buttons.forEach((b, i) => drawButton(ctx, b, { hover: hit(b, this.game.input.pointer), seed: 61 + i * 3 }));
    this.drawNumberStrip(ctx, viewW, viewH, total);

    if (this.showHint > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.showHint);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = font(26, 400);

      // сначала разбиваем текст, потом уже режем лист нужной высоты
      const w = Math.min(1000, viewW * 0.74);
      const lines = wrapText(ctx, this.tr(this.chapter.hint), w - 80);
      const h = 56 + lines.length * 34;

      ctx.fillStyle = '#fffaf0';
      paperPath(ctx, (viewW - w) / 2, 130, w, h, 20, 77, 3);
      ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
      ctx.fillStyle = PALETTE.ink;
      lines.forEach((l, i) => ctx.fillText(l, viewW / 2, 174 + i * 34));
      ctx.restore();
    }

    if (this.popup) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.popup.t * 2);
      atlas.draw(ctx, this.popup.frame, viewW / 2, viewH / 2, { scale: 0.8, anchorY: 0.5 });
      ctx.restore();
    }

    if (this.gameOver) {
      this.drawCard(ctx, viewW, viewH, 'Ой, Клякса тебя запачкала',
        'Ничего страшного. Отряхнёмся и начнём главу заново - пробел или клик.');
    }
  }

  drawNumberStrip(ctx, viewW, viewH, total) {
    const { atlas } = this.game;
    const cellW = 124, cellH = 124, gap = 18;
    const totalW = total * cellW + (total - 1) * gap;
    let x = (viewW - totalW) / 2;
    const y = viewH - cellH - 18;

    for (let i = 0; i < total; i++) {
      const it = this.chapter.pickups[i];
      const got = this.collected.has(it.id);

      ctx.save();
      ctx.globalAlpha = got ? 1 : 0.9;
      ctx.fillStyle = PALETTE.shadow;
      paperPath(ctx, x + 3, y + 6, cellW, cellH, 18, 130 + i * 7, 2.5);
      ctx.fill();
      ctx.fillStyle = got ? '#ffe9ae' : '#fffaf0';
      paperPath(ctx, x, y, cellW, cellH, 18, 100 + i * 9, 2.5);
      ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
      ctx.restore();

      const f = atlas.frame(it.frame);
      const scale = Math.min((cellW - 40) / f.w, (cellH - 34) / f.h);
      const cx = x + cellW / 2;
      const cy = y + cellH / 2;
      if (got) {
        atlas.draw(ctx, it.frame, cx, cy, { scale, anchorY: 0.5 });
      } else {
        const g = ghostFrame(atlas, it.frame, 'rgba(243,236,216,.74)');
        ctx.drawImage(g, cx - (f.w * scale) / 2, cy - (f.h * scale) / 2, f.w * scale, f.h * scale);
      }
      x += cellW + gap;
    }
  }

  drawCard(ctx, viewW, viewH, title, body) {
    title = this.tr(title);
    body = this.tr(body);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    const w = Math.min(1000, viewW * 0.76);
    ctx.font = font(26, 400);
    const lines = wrapText(ctx, body, w - 100);
    const h = 150 + lines.length * 38;          // заголовок, отступы и строки текста
    const y = viewH / 2 - h / 2;

    ctx.globalAlpha = 0.93;
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, (viewW - w) / 2, y, w, h, 24, 55, 4);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.ink;

    // заголовок ужимается, если по слогам он не влезает в лист
    let fs = 38;
    ctx.font = font(fs, 700);
    while (ctx.measureText(title).width > w - 80 && fs > 20) {
      fs -= 2;
      ctx.font = font(fs, 700);
    }
    shimmerText(ctx, title, viewW / 2, y + 84, {
      base: PALETTE.ink, highlight: '#ffe9ae', size: fs, time: this.game.time,
    });

    ctx.font = font(26, 400);
    lines.forEach((l, i) => ctx.fillText(l, viewW / 2, y + 140 + i * 38));
    ctx.restore();
  }
}
