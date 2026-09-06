/**
 * inspector.js - панель свойств выделенного объекта.
 *
 * Панель собирается заново при смене выделения, а на обычных правках только
 * обновляет значения полей (`refresh`), иначе поле теряло бы фокус на каждом
 * нажатии клавиши. Любая правка сразу видна на обеих проекциях.
 */
import { el, clear, row, thumb } from './dom.js';
import { KINDS, listOf, defScale, defYOffset, effParallax } from './store.js';

const LEVELS = [['low', 'по слогам'], ['mid', 'немного умею'], ['high', 'хорошо читаю']];

let optGroup = 0;   // счётчик групп радиокнопок: у каждой задачи своя

export class Inspector {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.watchers = [];
  }

  get store() { return this.app.store; }
  get atlas() { return this.app.atlas; }

  // ---------- инфраструктура ----------

  edit(tag, fn) {
    this.store.begin(`${this.prefix}${tag}`);
    fn();
    this.store.commit();
  }

  /** Поле следит за значением: правка мышью на канвасе тут же видна в панели. */
  watch(node, fn) {
    this.watchers.push(() => { if (document.activeElement !== node) fn(); });
  }

  refresh() { for (const w of this.watchers) w(); }

  build() {
    const sel = this.store.sel;
    const obj = this.store.obj();
    // прокрутка сохраняется, пока правим тот же объект: перестройка панели
    // не должна уносить взгляд, а вот у нового объекта смотрим с начала
    const key = sel ? `${sel.kind}.${sel.index}` : 'chapter';
    const top = key === this._key ? this.root.scrollTop : 0;
    this._key = key;
    clear(this.root);
    this.watchers = [];
    this.prefix = sel ? `${sel.kind}.${sel.index}.` : 'chapter.';
    if (!this.store.chapter) {
      this.root.append(el('div', { class: 'panel-head', text: 'Свойства' }),
        el('div', { class: 'hint pad', text: 'Выбери главу сверху' }));
      return;
    }
    if (!sel || !obj) this.buildChapter();
    else this.buildObject(sel, obj);
    this.root.scrollTop = top;
  }

  // ---------- элементарные поля ----------

  num(label, obj, key, o = {}) {
    const def = o.def ?? 0;
    const inp = el('input', { class: 'inp num', type: 'number', step: o.step ?? 1 });
    if (o.min != null) inp.min = o.min;
    if (o.max != null) inp.max = o.max;
    inp.value = obj[key] ?? def;
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      if (inp.value === '' || Number.isNaN(v)) return;
      this.edit(key, () => { obj[key] = o.int ? Math.round(v) : Number(v.toFixed(3)); });
    });
    inp.addEventListener('blur', () => this.store.seal());
    this.watch(inp, () => { inp.value = obj[key] ?? def; });
    return row(label, inp);
  }

  str(label, obj, key, o = {}) {
    const inp = el('input', { class: 'inp', type: 'text', placeholder: o.placeholder ?? '' });
    inp.value = obj[key] ?? '';
    inp.addEventListener('input', () => this.edit(key, () => { obj[key] = inp.value; }));
    inp.addEventListener('blur', () => this.store.seal());
    this.watch(inp, () => { inp.value = obj[key] ?? ''; });
    return row(label, inp);
  }

  check(label, obj, key) {
    const inp = el('input', { type: 'checkbox' });
    inp.checked = !!obj[key];
    inp.addEventListener('change', () => {
      this.store.begin('');
      obj[key] = inp.checked;
      this.store.commit();
    });
    this.watch(inp, () => { inp.checked = !!obj[key]; });
    return el('label', { class: 'row chk' }, inp, el('span', { text: label }));
  }

  /** Ползунок и поле рядом: масштаб удобнее и тянуть, и вписывать точно. */
  scale(obj, kind) {
    const def = defScale(kind, obj);
    const rng = el('input', { class: 'rng', type: 'range', min: '0.05', max: '3', step: '0.01' });
    const inp = el('input', { class: 'inp num', type: 'number', min: '0.05', step: '0.01' });
    rng.value = def;
    inp.value = def;
    const set = (v) => this.edit('scale', () => { obj.scale = Number(Number(v).toFixed(3)); });
    rng.addEventListener('input', () => { inp.value = rng.value; set(rng.value); });
    inp.addEventListener('input', () => { if (inp.value !== '') { rng.value = inp.value; set(inp.value); } });
    inp.addEventListener('blur', () => this.store.seal());
    this.watch(rng, () => { rng.value = defScale(kind, obj); });
    this.watch(inp, () => { inp.value = defScale(kind, obj); });
    return row('масштаб', rng, inp);
  }

  /** Текст главы: одна строка или развилка low / mid / high. */
  text(label, obj, key, o = {}) {
    const val = obj[key];
    const fork = val && typeof val === 'object';
    const head = el('div', { class: 'text-head' },
      el('span', { class: 'row-label', text: label }),
      el('label', { class: 'chk small' },
        el('input', {
          type: 'checkbox', checked: fork,
          onchange: (e) => {
            this.store.begin('');
            if (e.target.checked) {
              const s = typeof val === 'string' ? val : '';
              obj[key] = { low: s, mid: s, high: s };
            } else {
              obj[key] = fork ? (val.mid ?? val.low ?? val.high ?? '') : (val ?? '');
            }
            this.store.commit();
            this.build();
          },
        }), el('span', { text: 'развилка' })));

    const area = (get, set, ph) => {
      const ta = el('textarea', { class: 'inp area', rows: o.rows ?? 2, placeholder: ph ?? '' });
      ta.value = get() ?? '';
      ta.addEventListener('input', () => this.edit(`${key}${ph ?? ''}`, () => set(ta.value)));
      ta.addEventListener('blur', () => this.store.seal());
      this.watch(ta, () => { ta.value = get() ?? ''; });
      return ta;
    };

    if (!fork) {
      return el('div', { class: 'field' }, head, area(() => obj[key], (v) => { obj[key] = v; }));
    }
    return el('div', { class: 'field' }, head, LEVELS.map(([k, title]) => el('div', { class: 'sub' },
      el('span', { class: 'sub-label', text: title }),
      area(() => obj[key][k], (v) => { obj[key][k] = v; }, k))));
  }

  /** Кадр атласа: кнопка с миниатюрой, по клику - список с поиском. */
  frame(label, obj, key) {
    const btn = el('button', { class: 'framebtn', type: 'button' });
    const paint = () => {
      clear(btn);
      const name = obj[key];
      btn.append(thumb(this.atlas, name, 38),
        el('span', { class: name && this.atlas.has(name) ? '' : 'bad', text: name || 'нет кадра' }));
    };
    paint();
    btn.addEventListener('click', () => openFramePicker(btn, this.atlas, obj[key], (name) => {
      this.store.begin('');
      obj[key] = name;
      this.store.commit();
      paint();
    }));
    this.watch(btn, paint);
    return row(label, btn);
  }

  // ---------- панели ----------

  buildChapter() {
    const ch = this.store.chapter;
    this.root.append(
      el('div', { class: 'panel-head', text: 'Глава' }),
      el('div', { class: 'panel-body' },
        this.str('название', ch, 'title'),
        this.str('жанр', ch, 'subtitle'),
        this.num('номер', ch, 'number', { int: true }),
        this.num('цена', ch, 'cost', { int: true }),
        this.frame('иконка', ch, 'icon'),
        this.num('длина уровня', ch, 'levelWidth', { int: true, step: 10 }),
        this.num('старт героя', ch, 'playerStart', { int: true, step: 10 }),
        this.text('подсказка', ch, 'hint'),
        this.text('финальный текст', ch, 'outro')),
      el('div', { class: 'panel-head', text: 'Объекты уровня' }),
      this.objectList(),
    );
  }

  objectList() {
    const ch = this.store.chapter;
    const box = el('div', { class: 'objlist' });
    for (const kind of ['prop', 'pickup', 'gate', 'npc', 'enemy', 'fg']) {
      const list = ch[KINDS[kind].list] || [];
      if (!list.length) continue;
      box.append(el('div', { class: 'objlist-head' },
        el('i', { class: 'dot', style: `background:${KINDS[kind].color}` }),
        `${KINDS[kind].label} - ${list.length}`));
      list.forEach((o, index) => box.append(el('button', {
        class: 'objrow', type: 'button',
        onclick: () => this.app.focusOn({ kind, index }),
      }, el('span', { class: 'objrow-name', text: o.id || o.frame || '?' }),
        el('span', { class: 'objrow-x', text: o.x != null ? `x ${Math.round(o.x)}` : 'слой' }))));
    }
    return box;
  }

  buildObject(sel, obj) {
    const { kind, index } = sel;
    const ch = this.store.chapter;
    const list = listOf(ch, kind);
    const K = KINDS[kind];

    const head = el('div', { class: 'panel-head sel' },
      el('i', { class: 'dot', style: `background:${K.color}` }),
      el('span', { text: `${K.label}` }),
      el('span', { class: 'grow' }),
      el('button', { class: 'mini', type: 'button', title: 'Копировать (Ctrl+D)', text: '⧉', onclick: () => this.app.duplicate() }),
      el('button', { class: 'mini danger', type: 'button', title: 'Удалить (Delete)', text: '✕', onclick: () => this.app.remove() }));

    // порядок считаем внутри плана: в игре соседями по перекрытию являются
    // только объекты того же параллакса
    const par = effParallax(kind, obj);
    const lane = list.filter((o) => effParallax(kind, o) === par);
    const order = el('div', { class: 'row' },
      el('span', { class: 'row-label', text: 'порядок в слое' }),
      el('span', { class: 'row-ctl order', title: `место в массиве ${KINDS[kind].list}: ${index}` },
        el('button', { class: 'mini', type: 'button', title: 'Назад, за соседей (PgDn)', text: '◀', onclick: () => this.app.reorder(-1) }),
        el('b', { text: `${lane.indexOf(obj) + 1} / ${lane.length}` }),
        el('button', { class: 'mini', type: 'button', title: 'Вперёд, поверх соседей (PgUp)', text: '▶', onclick: () => this.app.reorder(1) })));

    const body = el('div', { class: 'panel-body' });
    this.root.append(head, body);

    if (kind !== 'fg') body.append(this.str('id', obj, 'id'));
    if (kind === 'npc') body.append(this.str('имя', obj, 'name'));
    body.append(this.frame('кадр', obj, 'frame'));
    if (kind === 'enemy') body.append(this.frame('кадр движения', obj, 'frameMove'));
    if (kind !== 'fg') body.append(this.num('x', obj, 'x', { int: true }));
    body.append(this.num('yOffset', obj, 'yOffset', { int: true, def: defYOffset(kind, obj) }));
    body.append(this.scale(obj, kind));
    if (kind !== 'pickup' && kind !== 'fg') body.append(this.check('отразить (flip)', obj, 'flip'));

    // план глубины: у декораций и переднего плана он свой, остальные всегда на игровом
    if (kind === 'prop' || kind === 'fg') {
      const sel2 = el('select', { class: 'inp' });
      const vals = kind === 'fg' ? [1.1, 1.2, 1.4, 1.6] : [0.5, 0.75, 1];
      const cur = obj.parallax ?? (kind === 'fg' ? 1.2 : 1);
      for (const v of vals) sel2.append(el('option', { value: v, selected: v === cur }, String(v)));
      if (!vals.includes(cur)) sel2.append(el('option', { value: cur, selected: true }, String(cur)));
      sel2.addEventListener('change', () => {
        this.store.begin('');
        obj.parallax = Number(sel2.value);
        this.store.commit();
      });
      this.watch(sel2, () => { sel2.value = String(obj.parallax ?? (kind === 'fg' ? 1.2 : 1)); });
      body.append(row('план (parallax)', sel2));
    } else {
      body.append(row('план (parallax)', el('span', { class: 'ro', text: '1 - игровой слой' })));
    }
    if (kind === 'fg') body.append(this.num('нахлёст', obj, 'overlap', { int: true }));
    body.append(order);

    if (kind === 'pickup') body.append(this.num('значение цифры', obj, 'value', { int: true }));

    if (kind === 'gate') {
      body.append(this.num('ширина стенки', obj, 'width', { int: true, def: 70 }));
      body.append(el('div', { class: 'sect', text: 'Нужные цифры' }), this.needs(obj));
      body.append(this.str('заголовок задачи', obj, 'title'));
      body.append(this.str('подсказка', obj, 'hint'));
      body.append(el('div', { class: 'sect', text: 'Задача ящика' }), this.task(obj, 'task'));
    }

    if (kind === 'enemy') {
      body.append(this.num('патруль от', obj, 'from', { int: true, step: 10 }));
      body.append(this.num('патруль до', obj, 'to', { int: true, step: 10 }));
      body.append(this.num('скорость', obj, 'speed', { int: true, def: 140 }));
      body.append(this.num('скорость погони', obj, 'chaseSpeed', { int: true, def: 220 }));
      body.append(this.num('радиус погони', obj, 'chaseRange', { int: true, step: 10, def: 500 }));
    }

    if (kind === 'npc') body.append(this.dialogue(obj));
  }

  /** Галочки по цифрам главы: какие нужны, чтобы открыть ящик. */
  needs(gate) {
    const box = el('div', { class: 'needs' });
    const pickups = this.store.chapter.pickups || [];
    if (!pickups.length) return el('div', { class: 'hint pad', text: 'в главе нет цифр' });
    for (const it of pickups) {
      const on = (gate.needs || []).includes(it.id);
      box.append(el('label', { class: `need${on ? ' on' : ''}` },
        el('input', {
          type: 'checkbox', checked: on,
          onchange: (e) => {
            this.store.begin('');
            gate.needs = gate.needs || [];
            if (e.target.checked) { if (!gate.needs.includes(it.id)) gate.needs.push(it.id); } else {
              gate.needs = gate.needs.filter((n) => n !== it.id);
            }
            this.store.commit();
            this.build();
          },
        }),
        thumb(this.atlas, it.frame, 26),
        el('span', { text: it.id })));
    }
    return box;
  }

  /**
   * Редактор задачи: пример a+b, пересчёт предметов или слово с пропуском.
   * Ровно три вида, которые умеет рисовать core/taskArt.js.
   */
  task(owner, key) {
    const t = owner[key] || (owner[key] = { a: 1, b: 1, options: ['1', '2', '3'], answer: 1 });
    const kind = t.a != null ? 'sum' : t.count != null ? 'count' : 'missing';
    const box = el('div', { class: 'task' });

    const sel = el('select', { class: 'inp' },
      el('option', { value: 'sum', selected: kind === 'sum' }, 'пример a ± b'),
      el('option', { value: 'count', selected: kind === 'count' }, 'пересчёт предметов'),
      el('option', { value: 'missing', selected: kind === 'missing' }, 'слово с пропуском'));
    sel.addEventListener('change', () => {
      this.store.begin('');
      delete t.a; delete t.b; delete t.op; delete t.count; delete t.frame; delete t.missing;
      if (sel.value === 'sum') { t.a = 1; t.b = 2; t.op = '+'; } else if (sel.value === 'count') { t.count = 3; t.frame = 'crate'; } else t.missing = 'С_ВА';
      this.store.commit();
      this.build();
    });
    box.append(row('вид', sel));

    if (kind === 'sum') {
      const op = el('select', { class: 'inp' },
        el('option', { value: '+', selected: (t.op ?? '+') === '+' }, '+'),
        el('option', { value: '-', selected: t.op === '-' }, '−'));
      op.addEventListener('change', () => {
        this.store.begin('');
        t.op = op.value;
        this.store.commit();
      });
      box.append(this.num('a', t, 'a', { int: true }), row('знак', op), this.num('b', t, 'b', { int: true }));
    } else if (kind === 'count') {
      box.append(this.num('сколько', t, 'count', { int: true }), this.frame('предмет', t, 'frame'));
    } else {
      box.append(this.str('слово с «_»', t, 'missing'));
    }
    box.append(this.options(t));
    return box;
  }

  /** Варианты ответа: радиокнопка отмечает верный. */
  options(t) {
    t.options = t.options || [];
    const box = el('div', { class: 'opts' });
    const group = `answer-${++optGroup}`;   // у каждой задачи своя группа радиокнопок
    t.options.forEach((v, i) => {
      const radio = el('input', {
        type: 'radio', name: group, checked: t.answer === i,
        onchange: () => { this.store.begin(''); t.answer = i; this.store.commit(); },
      });
      const inp = el('input', { class: 'inp', type: 'text' });
      inp.value = v;
      inp.addEventListener('input', () => this.edit(`opt${i}`, () => { t.options[i] = inp.value; }));
      inp.addEventListener('blur', () => this.store.seal());
      this.watch(inp, () => { inp.value = t.options[i] ?? ''; });
      box.append(el('div', { class: `opt${t.answer === i ? ' on' : ''}` }, radio, inp,
        el('button', {
          class: 'mini', type: 'button', text: '✕', title: 'убрать вариант',
          onclick: () => {
            this.store.begin('');
            t.options.splice(i, 1);
            if (t.answer >= t.options.length) t.answer = Math.max(0, t.options.length - 1);
            this.store.commit();
            this.build();
          },
        })));
    });
    box.append(el('button', {
      class: 'btn small', type: 'button', text: '+ вариант',
      onclick: () => { this.store.begin(''); t.options.push(''); this.store.commit(); this.build(); },
    }));
    return el('div', { class: 'field' }, el('div', { class: 'row-label', text: 'варианты ответа' }), box);
  }

  /** Диалог НПС: приветствие, темы, задача внутри темы. */
  dialogue(npc) {
    const d = npc.dialogue || (npc.dialogue = { greeting: '', topics: [] });
    const box = el('div', {}, el('div', { class: 'sect', text: 'Диалог' }), this.text('приветствие', d, 'greeting'));
    d.topics = d.topics || [];
    d.topics.forEach((t, i) => {
      const card = el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('b', { text: `Тема ${i + 1}` }),
          el('span', { class: 'grow' }),
          el('button', {
            class: 'mini', type: 'button', text: '↑', title: 'выше',
            onclick: () => this.moveTopic(d, i, -1),
          }),
          el('button', {
            class: 'mini', type: 'button', text: '↓', title: 'ниже',
            onclick: () => this.moveTopic(d, i, 1),
          }),
          el('button', {
            class: 'mini danger', type: 'button', text: '✕', title: 'убрать тему',
            onclick: () => { this.store.begin(''); d.topics.splice(i, 1); this.store.commit(); this.build(); },
          })),
        this.text('название темы', t, 'title'),
        this.text('текст', t, 'text', { rows: 3 }),
        el('label', { class: 'chk small' },
          el('input', {
            type: 'checkbox', checked: !!t.puzzle,
            onchange: (e) => {
              this.store.begin('');
              if (e.target.checked) {
                t.puzzle = { question: '', options: ['1', '2', '3'], answer: 0, correct: '', wrong: '' };
              } else delete t.puzzle;
              this.store.commit();
              this.build();
            },
          }), el('span', { text: 'с задачей' })));
      if (t.puzzle) {
        card.append(this.text('вопрос', t.puzzle, 'question'),
          this.options(t.puzzle),
          this.text('если верно', t.puzzle, 'correct'),
          this.text('если ошибся', t.puzzle, 'wrong'));
      }
      box.append(card);
    });
    box.append(el('button', {
      class: 'btn wide', type: 'button', text: '+ тема',
      onclick: () => {
        this.store.begin('');
        d.topics.push({ title: 'Новая тема', text: '...' });
        this.store.commit();
        this.build();
      },
    }));
    return box;
  }

  moveTopic(d, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= d.topics.length) return;
    this.store.begin('');
    const [t] = d.topics.splice(i, 1);
    d.topics.splice(j, 0, t);
    this.store.commit();
    this.build();
  }
}

// ---------- выпадающий список кадров ----------

let picker = null;

export function openFramePicker(anchor, atlas, current, onPick) {
  closeFramePicker();
  const grid = el('div', { class: 'fp-grid' });
  const search = el('input', { class: 'inp', type: 'search', placeholder: 'поиск кадра...' });
  const fill = () => {
    clear(grid);
    const q = search.value.trim().toLowerCase();
    for (const name of Object.keys(atlas.frames).sort()) {
      if (q && !name.includes(q)) continue;
      grid.append(el('button', {
        class: `frame${name === current ? ' on' : ''}`, type: 'button', title: name,
        onclick: () => { onPick(name); closeFramePicker(); },
      }, thumb(atlas, name, 46), el('span', { class: 'frame-name', text: name })));
    }
  };
  search.addEventListener('input', fill);
  fill();

  picker = el('div', { class: 'fpick' }, search, grid);
  document.body.append(picker);
  const r = anchor.getBoundingClientRect();
  const w = picker.offsetWidth;
  picker.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  const below = window.innerHeight - r.bottom;
  if (below > 300) picker.style.top = `${r.bottom + 4}px`;
  else picker.style.bottom = `${window.innerHeight - r.top + 4}px`;
  search.focus();

  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
  }, 0);
}

function outside(e) { if (picker && !picker.contains(e.target)) closeFramePicker(); }
function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); closeFramePicker(); } }

export function closeFramePicker() {
  if (!picker) return;
  picker.remove();
  picker = null;
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', esc, true);
}
