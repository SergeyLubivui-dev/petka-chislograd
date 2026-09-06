/**
 * main.js - сборка редактора уровней.
 *
 * Страница /editor (алиас /редактор). Работает поверх тех же данных, что и
 * игра: GET /api/chapters, GET/POST /api/content/{id}. Ничего игрового в
 * коде редактора нет - он только правит JSON главы.
 */
import { loadImage, loadJSON } from '../core/Loader.js';
import { Atlas } from '../core/Atlas.js';
import { Store, KINDS, GROUND_Y, listOf, clone, effParallax, defYOffset } from './store.js';
import { SideView } from './sideview.js';
import { TopView } from './topview.js';
import { Palette } from './palette.js';
import { Inspector, closeFramePicker } from './inspector.js';
import { validate } from './validate.js';
import { el, clear } from './dom.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.store = new Store();
    this.grid = true;
    this.snap = true;
    this.space = false;
    this.newKind = 'prop';
    this.newParallax = 1;
    this.newFrame = 'bench';
    this.cursor = { x: 0, y: 0 };
    this._raf = 0;
  }

  async boot() {
    const [img, data, far] = await Promise.all([
      loadImage('assets/atlas/atlas.png'),
      loadJSON('assets/atlas/atlas.json'),
      loadImage('assets/bg/far.png').catch(() => null),
    ]);
    this.atlas = new Atlas(img, data);
    this.farBg = far;

    this.side = new SideView($('side'), this);
    this.top = new TopView($('top'), this);
    this.palette = new Palette($('palette'), this);
    this.inspector = new Inspector($('inspector'), this);
    this.ruler = $('ruler');
    this.rulerCtx = this.ruler.getContext('2d');

    this.store.on((what) => {
      if (what === 'chapter') {
        this.side.fitted = false;
        this.side.resize();
        this.side.setCam(0);
        this.inspector.build();
        this.palette.build();
      }
      if (what === 'select') this.inspector.build();
      if (what === 'change') this.inspector.refresh();
      this.draw();
      this.updateHead();
    });

    this.bindUI();
    this.bindKeys();
    window.addEventListener('resize', () => { this.layout(); });
    window.addEventListener('beforeunload', (e) => {
      if (!this.store.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    this.layout();
    await this.loadChapters();
    $('boot').remove();
  }

  // ---------- главы ----------

  async loadChapters() {
    const list = await loadJSON('/api/chapters');
    this.store.meta = list;
    const tabs = $('chapters');
    clear(tabs);
    for (const m of list) {
      tabs.append(el('button', {
        class: 'tab', type: 'button', 'data-id': m.id,
        onclick: () => this.openChapter(m.id),
      }, el('b', { text: String(m.number ?? '') }), el('span', { text: m.title || m.id }),
        el('i', { class: 'star' })));
    }
    if (list.length) await this.openChapter(list[0].id);
  }

  async openChapter(id) {
    if (this.store.dirty && id !== this.store.id) {
      if (!confirm('В открытой главе есть несохранённые правки. Открыть другую и потерять их?')) return;
    }
    const data = await loadJSON(`/api/content/${id}`);
    this.store.setChapter(id, data);
    this.status(`Открыта ${id}`);
  }

  async save() {
    const ch = this.store.chapter;
    if (!ch) return;
    const { errors, warnings } = validate(ch, this.atlas, this.store.id);
    if (errors.length) { this.report(errors, warnings, false); return; }
    try {
      const r = await fetch(`/api/content/${this.store.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ch),
      });
      if (!r.ok) throw new Error(`сервер ответил ${r.status}`);
      this.store.dirty = false;
      this.updateHead();
      this.status(`Сохранено: ${this.store.id}.json${warnings.length ? ` (замечаний: ${warnings.length})` : ''}`);
    } catch (e) {
      this.status(`Ошибка сохранения: ${e.message}`, true);
    }
  }

  check() {
    const { errors, warnings } = validate(this.store.chapter, this.atlas, this.store.id);
    this.report(errors, warnings, true);
  }

  report(errors, warnings, always) {
    if (!errors.length && !warnings.length && !always) return;
    const box = $('modal-body');
    clear(box);
    if (!errors.length) box.append(el('p', { class: 'ok', text: 'Ошибок нет - главу можно сохранять.' }));
    if (errors.length) {
      box.append(el('h3', { text: `Ошибки (${errors.length}) - сохранение остановлено` }));
      box.append(el('ul', { class: 'errs' }, errors.map((t) => el('li', { text: t }))));
    }
    if (warnings.length) {
      box.append(el('h3', { text: `Замечания (${warnings.length}) - сохранить можно` }));
      box.append(el('ul', { class: 'warns' }, warnings.map((t) => el('li', { text: t }))));
    }
    $('modal').hidden = false;
  }

  // ---------- объекты ----------

  uniqueId(base) {
    const ch = this.store.chapter;
    const used = new Set();
    for (const k of Object.values(KINDS)) for (const o of ch[k.list] || []) if (o.id) used.add(o.id);
    let i = 1;
    while (used.has(`${base}${i}`)) i++;
    return `${base}${i}`;
  }

  createObject(kind, frame, x, yOffset, parallax = 1) {
    const ch = this.store.chapter;
    if (!ch) return;
    const X = this.snapValue(x);
    const Y = this.snapValue(yOffset);
    let obj;
    if (kind === 'prop') obj = { id: this.uniqueId('prop'), frame, x: X, yOffset: Y, scale: 1, parallax };
    else if (kind === 'pickup') {
      const n = (ch.pickups?.length || 0) + 1;
      obj = { id: this.uniqueId('d'), frame, x: X, yOffset: -150, scale: 0.5, value: n };
    } else if (kind === 'gate') {
      obj = {
        id: this.uniqueId('gate'), x: X, frame, scale: 1.5, yOffset: Y, width: 80, needs: [],
        title: 'Реши, и ящик уедет', hint: 'Выбери ответ: мышкой или клавишей 1, 2, 3',
        task: { a: 1, b: 2, op: '+', options: ['2', '3', '4'], answer: 1 },
      };
    } else if (kind === 'npc') {
      obj = {
        id: this.uniqueId('npc'), name: 'Новый герой', frame, x: X, yOffset: Y, scale: 1, parallax: 1,
        dialogue: {
          greeting: 'Привет!',
          topics: [
            { title: 'Первая тема', text: 'Расскажи что-нибудь.' },
            { title: 'Вторая тема', text: 'И ещё немного.' },
          ],
        },
      };
    } else {
      obj = {
        id: this.uniqueId('enemy'), frame, frameMove: frame, x: X, yOffset: Y, scale: 1, parallax: 1,
        from: Math.max(0, X - 300), to: X + 300, speed: 150, chaseSpeed: 240, chaseRange: 520,
      };
    }
    this.store.begin('');
    const list = listOf(ch, kind);
    list.push(obj);
    this.store.commit();
    this.store.select({ kind, index: list.length - 1 });
    this.status(`Добавлен объект: ${KINDS[kind].label} «${obj.id}»`);
  }

  addSelectedFrame() {
    // середина экрана в координатах того слоя, куда кладём объект
    const par = this.newKind === 'prop' ? this.newParallax : 1;
    const x = this.side.cam * par + this.side.viewW / 2;
    this.createObject(this.newKind, this.newFrame, x, this.newKind === 'pickup' ? -150 : 0, par);
  }

  remove() {
    const sel = this.store.sel;
    if (!sel) return;
    const list = listOf(this.store.chapter, sel.kind);
    this.store.begin('');
    list.splice(sel.index, 1);
    this.store.select(null);
    this.store.commit();
    this.status('Объект удалён (Ctrl+Z - вернуть)');
  }

  duplicate() {
    const sel = this.store.sel;
    const obj = this.store.obj();
    if (!obj) return;
    const copy = clone(obj);
    if (copy.id) copy.id = this.uniqueId(String(copy.id).replace(/\d+$/, '') || 'obj');
    if (copy.x != null) copy.x = copy.x + 80;
    this.store.begin('');
    const list = listOf(this.store.chapter, sel.kind);
    list.splice(sel.index + 1, 0, copy);
    this.store.commit();
    this.store.select({ kind: sel.kind, index: sel.index + 1 });
    this.status('Копия создана');
  }

  /** Порядок в слое: меняемся местами с ближайшим соседом того же плана. */
  reorder(dir) {
    const sel = this.store.sel;
    const obj = this.store.obj();
    if (!obj) return;
    const list = listOf(this.store.chapter, sel.kind);
    const p = effParallax(sel.kind, obj);
    let j = sel.index + dir;
    while (j >= 0 && j < list.length && effParallax(sel.kind, list[j]) !== p) j += dir;
    if (j < 0 || j >= list.length) return;
    this.store.begin('');
    const [it] = list.splice(sel.index, 1);
    list.splice(j, 0, it);
    this.store.commit();
    this.store.select({ kind: sel.kind, index: j });
  }

  /** Выбрать объект и подвести к нему обе проекции. */
  focusOn(sel) {
    this.store.select(sel);
    const o = this.store.obj();
    if (o && o.x != null) {
      // объект слоя p стоит на экране в (x - cam*p): чтобы он оказался
      // посередине, камеру двигаем в (x - половина экрана) / p
      const par = effParallax(sel.kind, o) || 1;
      this.side.setCam((o.x - this.side.viewW / 2) / par);
      this.syncScroll();
    }
    this.draw();
  }

  snapValue(v) { return this.snap ? Math.round(v / 10) * 10 : Math.round(v); }

  // ---------- интерфейс ----------

  bindUI() {
    $('btn-save').onclick = () => this.save();
    $('btn-check').onclick = () => this.check();
    $('btn-undo').onclick = () => this.store.undo();
    $('btn-redo').onclick = () => this.store.redo();
    $('btn-fit').onclick = () => { this.side.fit(); this.draw(); };
    $('modal-close').onclick = () => { $('modal').hidden = true; };
    $('modal').onclick = (e) => { if (e.target.id === 'modal') $('modal').hidden = true; };
    $('opt-snap').onchange = (e) => { this.snap = e.target.checked; };
    $('opt-grid').onchange = (e) => { this.grid = e.target.checked; this.draw(); };
    const sc = $('scroll');
    sc.oninput = () => { this.side.setCam(Number(sc.value)); this.draw(); };
  }

  bindKeys() {
    const typing = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !typing(e)) { this.space = true; e.preventDefault(); }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === 'KeyS') { e.preventDefault(); this.save(); return; }
      if (ctrl && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) this.store.redo(); else this.store.undo();
        return;
      }
      if (ctrl && e.code === 'KeyY') { e.preventDefault(); this.store.redo(); return; }
      if (typing(e)) return;
      if (ctrl && e.code === 'KeyD') { e.preventDefault(); this.duplicate(); return; }
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.remove(); return; }
      if (e.code === 'Escape') { this.store.select(null); return; }
      if (e.code === 'KeyG') { this.grid = !this.grid; $('opt-grid').checked = this.grid; this.draw(); return; }
      if (e.code === 'PageUp') { e.preventDefault(); this.reorder(1); return; }
      if (e.code === 'PageDown') { e.preventDefault(); this.reorder(-1); return; }

      const o = this.store.obj();
      if (!o) return;
      if (e.code === 'KeyF') {
        this.store.begin('');
        o.flip = !o.flip;
        this.store.commit();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const move = (dx, dy) => {
        e.preventDefault();
        this.store.begin('nudge');
        if (dx && o.x != null) o.x = Math.round((o.x ?? 0) + dx);
        if (dy) o.yOffset = Math.round(defYOffset(this.store.sel.kind, o) + dy);
        this.store.commit();
      };
      if (e.code === 'ArrowLeft') move(-step, 0);
      if (e.code === 'ArrowRight') move(step, 0);
      if (e.code === 'ArrowUp') move(0, -step);
      if (e.code === 'ArrowDown') move(0, step);
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; });
    window.addEventListener('blur', () => { this.space = false; });
  }

  layout() {
    this.side.resize();
    this.top.resize();
    const r = this.ruler;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    r.width = Math.round(r.clientWidth * dpr);
    r.height = Math.round(r.clientHeight * dpr);
    this.rulerDpr = dpr;
    this.syncScroll();
    this.draw();
  }

  syncScroll() {
    const sc = $('scroll');
    sc.min = -200;
    sc.max = Math.max(200, this.store.levelWidth - this.side.viewW * 0.5);
    sc.value = this.side.cam;
  }

  showCursor(x, y) {
    this.cursor = { x, y };
    $('st-cursor').textContent = `x ${Math.round(x)}   y ${Math.round(y - GROUND_Y)}`;
  }

  status(text, bad = false) {
    const n = $('st-msg');
    n.textContent = text;
    n.classList.toggle('bad', bad);
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => { n.textContent = ''; n.classList.remove('bad'); }, 6000);
  }

  updateHead() {
    const s = this.store;
    for (const b of $('chapters').children) {
      const on = b.dataset.id === s.id;
      b.classList.toggle('on', on);
      b.classList.toggle('dirty', on && s.dirty);
    }
    $('btn-save').classList.toggle('accent', s.dirty);
    $('btn-undo').disabled = !s.canUndo();
    $('btn-redo').disabled = !s.canRedo();
    const ch = s.chapter;
    $('st-counts').textContent = ch
      ? `объектов ${s.count()}  ·  декораций ${ch.props?.length || 0}, цифр ${ch.pickups?.length || 0}, `
        + `ящиков ${ch.gates?.length || 0}, НПС ${ch.npc?.length || 0}, врагов ${ch.enemies?.length || 0}`
      : '';
    $('st-zoom').textContent = `${Math.round(this.side.zoom * 100)}%  ·  длина ${s.levelWidth}`;
  }

  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.side.render();
      this.top.render();
      this.drawRuler();
      $('st-zoom').textContent = `${Math.round(this.side.zoom * 100)}%  ·  длина ${this.store.levelWidth}`;
    });
  }

  /** Линейка мировых координат над видом сбоку. */
  drawRuler() {
    const ctx = this.rulerCtx;
    const w = this.ruler.clientWidth;
    const h = this.ruler.clientHeight;
    ctx.setTransform(this.rulerDpr, 0, 0, this.rulerDpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#efe3c9';
    ctx.fillRect(0, 0, w, h);
    const z = this.side.zoom;
    const step = [25, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => s * z >= 62) ?? 5000;
    const from = Math.floor(this.side.cam / step) * step;
    ctx.font = '600 10px Comfortaa, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = 'rgba(90,63,46,.45)';
    ctx.fillStyle = '#7a5a44';
    ctx.beginPath();
    for (let x = from; x < this.side.cam + this.side.viewW; x += step) {
      const px = Math.round(this.side.toPx(x)) + 0.5;
      ctx.moveTo(px, h - 7);
      ctx.lineTo(px, h);
      ctx.fillText(String(x), px + 3, h - 9);
      for (let i = 1; i < 5; i++) {
        const sp = Math.round(this.side.toPx(x + (step / 5) * i)) + 0.5;
        ctx.moveTo(sp, h - 4);
        ctx.lineTo(sp, h);
      }
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(90,63,46,.25)';
    ctx.fillRect(0, h - 1, w, 1);
  }
}

const app = new App();
window.editor = app;   // удобно смотреть состояние из консоли
app.boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.textContent = `Не удалось запустить редактор: ${e.message}`;
});
document.addEventListener('visibilitychange', closeFramePicker);
