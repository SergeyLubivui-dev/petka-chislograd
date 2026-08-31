import { Animation } from '../core/Atlas.js';
import { PALETTE, drawButton, hit, paperPath, font, wrapText } from '../core/ui.js';
import { Dialogue } from '../core/Dialogue.js';
import { Editor } from '../core/Editor.js';
import { shimmerText } from '../core/motion.js';

const GRAVITY = 2600;
const SPEED = 400;
const JUMP_V = 950;
const GROUND_OFFSET = 96;   // от низа экрана до линии пола
const MAX_HP = 3;
const HURT_TIME = 1.6;      // неуязвимость после касания Кляксы
const TALK_RANGE = 180;
const IDLE_FRONT_AFTER = 3;   // сек простоя до разворота к игроку

/**
 * Игровая сцена.
 *
 * Слои: дальний фон 0,15 - декорации 0,5 - игровой слой 1,0 - интерфейс.
 * Поверх работают две подсистемы: диалоги с НПС и встроенный редактор (F2).
 */
export class GameScene {
  constructor(game) {
    this.game = game;
    this.cameraX = 0;
    this.buttons = [];
    this.dialogue = new Dialogue(game);
    this.editor = new Editor(game);
  }

  async enter(data) {
    this.ready = false;
    const id = data.chapter || 'chapter_01';
    this.chapter = await this.game.api.content(id);
    this.game.chapter = this.chapter;
    this.game.scene = this;

    this.anim = {
      idle: new Animation(['petka_stand'], 1),
      // цикл ходьбы из четырёх кадров нового листа
      walk: new Animation(['petka_w1', 'petka_w2', 'petka_w3', 'petka_w4'], 10),
      jump: new Animation(['petka_w3'], 1),
      hello: new Animation(['petka_idle'], 1),
      // постояв без дела, Петька разворачивается к игроку
      idleFront: new Animation(['petka_idle'], 1),
    };
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
    this.idleTime = 0;
    this.cameraX = 0;
    this.camLook = 0;
    this.collected = new Set();
    this.popup = null;
    this.finished = false;
    this.gameOver = false;
    this.showHint = 0;
    this.nearNpc = null;
    this.enemies = (ch.enemies || []).map((e) => ({ def: e, x: e.x, dir: 1, t: 0 }));
    this.dialogue.close();
    this.layoutUI();
  }

  get groundY() { return this.game.viewport.viewH - GROUND_OFFSET; }
  get levelW() { return this.chapter.levelWidth ?? 4200; }

  // ---------- обновление ----------

  update(dt) {
    if (!this.ready) return;
    const { input } = this.game;

    // редактор перехватывает управление целиком
    if (this.editor.update(dt, this.chapter, this.groundY)) return;

    this.layoutUI();
    this.handleButtons();

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
    this.updateEnemies(dt);
    this.updateInteraction();
    this.updatePickups();
    this.updateCamera(dt);

    if (this.popup) { this.popup.t -= dt; if (this.popup.t <= 0) this.popup = null; }
    if (!this.finished && this.collected.size >= this.chapter.pickups.length) this.finished = true;
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
    p.x = Math.max(60, Math.min(this.levelW - 60, p.x + p.vx * dt));
    p.y += p.vy * dt;

    if (p.y >= 0) {
      if (!p.onGround) p.syv = -4.5;   // приседание при приземлении
      p.y = 0; p.vy = 0; p.onGround = true;
    }

    if (!locked) {
      if (!p.onGround) this.state = 'jump';
      else if (ax !== 0) this.state = 'walk';
      else this.state = this.idleTime >= IDLE_FRONT_AFTER ? 'idleFront' : 'idle';
    }

    // счётчик простоя: три секунды без движения - и герой смотрит вперёд
    const still = p.onGround && ax === 0 && !locked;
    this.idleTime = still ? this.idleTime + dt : 0;

    this.anim[this.state].update(dt);

    // пружина: sy стремится к 1, sx компенсирует «объём»
    const k = 46, damp = 9;
    p.syv += (1 - p.sy) * k * dt - p.syv * damp * dt;
    p.sy += p.syv * dt;
    p.sx = 1 + (1 - p.sy) * 0.55;
    if (this.state === 'walk') p.sy += Math.sin(this.game.time * 14) * 0.012;

    if (p.hurt > 0) p.hurt -= dt;
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
    if (this.nearNpc && input.justPressed('KeyE', 'Enter')) this.dialogue.open(this.nearNpc);
  }

  updatePickups() {
    const p = this.player;
    for (const it of this.chapter.pickups) {
      if (this.collected.has(it.id)) continue;
      if (Math.abs(it.x - p.x) < 90 && p.y > -260) {
        this.collected.add(it.id);
        this.popup = { frame: it.frame, t: 1.1 };
        p.syv = 2.0;
        this.game.api.saveProgress({
          chapter: this.chapter.id,
          collected: [...this.collected],
          hints_used: 0,
          seconds_played: Math.round(this.game.time),
        });
      }
    }
  }

  updateCamera(dt) {
    const { viewport } = this.game;
    const p = this.player;
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
    }
  }

  layoutUI() {
    const { viewW } = this.game.viewport;
    this.buttons = [
      { id: 'hint', label: '?', x: viewW - 210, y: 28, w: 76, h: 76, color: PALETTE.yellow },
      { id: 'menu', label: '⌂', x: viewW - 116, y: 28, w: 76, h: 76, color: PALETTE.paper },
    ];
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

    for (const o of this.chapter.props.filter((o) => (o.parallax ?? 1) !== 1)) {
      viewport.applyWorld(this.cameraX, o.parallax ?? 1);
      atlas.draw(ctx, o.frame, o.x, gy + (o.yOffset ?? 0), { scale: o.scale ?? 1, flipX: !!o.flip });
    }

    viewport.applyWorld(this.cameraX, 1);
    this.drawGround(ctx, gy);
    for (const o of this.chapter.props.filter((o) => (o.parallax ?? 1) === 1)) {
      atlas.draw(ctx, o.frame, o.x, gy + (o.yOffset ?? 0), { scale: o.scale ?? 1, flipX: !!o.flip });
    }
    for (const n of this.chapter.npc) {
      atlas.draw(ctx, n.frame, n.x, gy + (n.yOffset ?? 0), { scale: n.scale ?? 1, flipX: !!n.flip });
    }
    this.drawEnemies(ctx, gy);
    this.drawPickups(ctx, gy);
    this.drawPlayer(ctx, gy);
    if (this.nearNpc && !this.dialogue.active && !this.editor.enabled) this.drawTalkPrompt(ctx, gy);

    viewport.applyUI();
    this.drawHUD(ctx, viewW, viewH);
    this.dialogue.render();
    this.editor.render(this.chapter, gy);
  }

  drawPlayer(ctx, gy) {
    const { atlas } = this.game;
    const p = this.player;
    if (p.hurt > 0 && Math.floor(p.hurt * 12) % 2 === 0) return;   // мигание
    const f = atlas.frame(this.anim[this.state].current);
    const w = f.w * p.scale * p.sx;
    const h = f.h * p.scale * p.sy;
    // кадр «лицом к игроку» не зеркалим: он симметричен по смыслу
    const facing = this.state === 'idleFront' ? false : p.flip;
    ctx.save();
    ctx.translate(p.x, gy + p.y);
    if (facing) ctx.scale(-1, 1);
    ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, -w / 2, -h, w, h);
    ctx.restore();
  }

  drawEnemies(ctx, gy) {
    const { atlas } = this.game;
    for (const e of this.enemies) {
      const frame = (Math.floor(e.t * 4) % 2 === 0 && e.def.frameMove) ? e.def.frameMove : e.def.frame;
      const bob = Math.sin(e.t * 6) * 6;
      atlas.draw(ctx, frame, e.x, gy + bob, { scale: e.def.scale ?? 1, flipX: e.dir < 0 });
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
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, n.x - 115, top - 56, 230, 58, 14, 13, 2.5);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(24, 700);
    ctx.textAlign = 'center';
    ctx.fillText('E - поговорить', n.x, top - 18);
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

    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#fffaf0';
    paperPath(ctx, 24, 24, 250, 84, 18, 3, 3);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.restore();
    atlas.draw(ctx, 'card_blank', 78, 96, { scale: 0.42 });
    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = font(40);
    ctx.textBaseline = 'middle';
    ctx.fillText(`${this.collected.size} / ${total}`, 132, 68);
    ctx.restore();

    this.drawHearts(ctx, 30, 122);
    this.buttons.forEach((b, i) => drawButton(ctx, b, { hover: hit(b, this.game.input.pointer), seed: 61 + i * 3 }));
    this.drawNumberStrip(ctx, viewW, viewH, total);

    if (this.showHint > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.showHint);
      ctx.fillStyle = '#fffaf0';
      const w = Math.min(1000, viewW * 0.74);
      paperPath(ctx, (viewW - w) / 2, 130, w, 118, 20, 77, 3);
      ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
      ctx.fillStyle = PALETTE.ink;
      ctx.font = font(26, 400);
      ctx.textAlign = 'center';
      wrapText(ctx, this.chapter.hint, w - 80).forEach((l, i) => ctx.fillText(l, viewW / 2, 180 + i * 34));
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
    } else if (this.finished) {
      this.drawCard(ctx, viewW, viewH, 'Глава пройдена!', this.chapter.outro);
    }
  }

  drawHearts(ctx, x, y) {
    for (let i = 0; i < MAX_HP; i++) {
      const full = i < this.player.hp;
      ctx.save();
      ctx.translate(x + 26 + i * 58, y + 26);
      ctx.scale(1.6, 1.6);
      ctx.beginPath();
      ctx.moveTo(0, 7);
      ctx.bezierCurveTo(-13, -6, -8, -17, 0, -10);
      ctx.bezierCurveTo(8, -17, 13, -6, 0, 7);
      ctx.closePath();
      ctx.fillStyle = full ? '#d97b62' : 'rgba(255,250,240,.6)';
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawNumberStrip(ctx, viewW, viewH, total) {
    const { atlas } = this.game;
    const cellW = 84, cellH = 84, gap = 14;
    const totalW = total * cellW + (total - 1) * gap;
    let x = (viewW - totalW) / 2;
    const y = viewH - cellH - 16;
    for (let i = 0; i < total; i++) {
      const it = this.chapter.pickups[i];
      const got = this.collected.has(it.id);
      ctx.save();
      ctx.globalAlpha = got ? 1 : 0.82;
      ctx.fillStyle = got ? '#ffe9ae' : '#fffaf0';
      paperPath(ctx, x, y, cellW, cellH, 16, 100 + i * 9, 2.5);
      ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
      ctx.restore();
      if (got) atlas.draw(ctx, it.frame, x + cellW / 2, y + cellH - 8, { scale: 0.135 });
      x += cellW + gap;
    }
  }

  drawCard(ctx, viewW, viewH, title, body) {
    ctx.save();
    ctx.globalAlpha = 0.93;
    ctx.fillStyle = '#fffaf0';
    const w = Math.min(1000, viewW * 0.76);
    paperPath(ctx, (viewW - w) / 2, viewH / 2 - 150, w, 250, 24, 55, 4);
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'center';
    ctx.font = font(38);
    shimmerText(ctx, title, viewW / 2, viewH / 2 - 70, {
      base: PALETTE.ink, highlight: '#ffe9ae', size: 38, time: this.game.time,
    });
    ctx.font = font(26, 400);
    wrapText(ctx, body, w - 100).forEach((l, i) => ctx.fillText(l, viewW / 2, viewH / 2 - 16 + i * 38));
    ctx.restore();
  }
}
