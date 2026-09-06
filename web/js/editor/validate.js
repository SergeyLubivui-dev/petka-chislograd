/**
 * validate.js - те же проверки, что и `tools/check_chapter.py`.
 *
 * Редактор не даёт сохранить главу, которую скрипт проверки забракует:
 * ошибки блокируют сохранение, замечания (warn) только показываются.
 * Порядок и формулировки повторяют питоновский скрипт, чтобы не расходились.
 */

const LEVELS = ['low', 'mid', 'high'];

const textOk = (v) => {
  if (typeof v === 'string') return !!v.trim();
  if (v && typeof v === 'object') return LEVELS.some((k) => typeof v[k] === 'string' && v[k].trim());
  return false;
};

const rightAnswer = (task) => {
  if (task.count != null) return String(task.count);
  if (task.a != null && task.b != null) {
    return String(task.op === '-' ? task.a - task.b : task.a + task.b);
  }
  return null;
};

export function validate(ch, atlas, name = ch?.id) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const frame = (f, where) => {
    if (typeof f !== 'string' || !atlas.has(f)) err(`${where}: кадра «${f}» нет в атласе`);
  };

  if (!ch) return { errors: ['глава не загружена'], warnings };

  const task = (t, where, values = null) => {
    const opts = t?.options;
    if (!Array.isArray(opts) || !opts.length) { err(`${where}: нет options`); return; }
    const ans = t.answer;
    if (!Number.isInteger(ans) || ans < 0 || ans >= opts.length) {
      err(`${where}: answer=${ans} вне диапазона options (0..${opts.length - 1})`);
      return;
    }
    const kind = t.a != null ? 'sum' : t.count != null ? 'count' : t.missing != null ? 'missing' : null;
    if (!kind) { err(`${where}: задача без a/b, count или missing`); return; }
    if (kind === 'count') frame(t.frame, `${where}.frame`);
    if (kind === 'missing' && !String(t.missing).includes('_')) {
      err(`${where}: в слове «${t.missing}» нет пропуска «_»`);
    }
    const expected = rightAnswer(t);
    if (expected != null && String(opts[ans]) !== expected) {
      err(`${where}: верный вариант «${opts[ans]}», а по условию должно быть «${expected}»`);
    }
    if (kind === 'sum' && values) {
      for (const key of ['a', 'b']) {
        if (!values.has(t[key])) {
          err(`${where}: ${key}=${t[key]} нет среди pickups.value ${[...values].sort((x, y) => x - y).join(', ')}`);
        }
      }
    }
    if (kind === 'sum' && t.op === '-' && t.a < t.b) err(`${where}: ${t.a} - ${t.b} меньше нуля`);
  };

  for (const key of ['number', 'title', 'subtitle', 'summary', 'icon', 'cost', 'skills', 'rewards']) {
    if (!(key in ch)) err(`нет мета-поля «${key}»`);
  }
  if ('summary' in ch && !textOk(ch.summary)) err('summary пустой');
  if ('icon' in ch) frame(ch.icon, 'icon');
  if (ch.rewards) {
    for (const key of ['pickup', 'gate', 'finale']) {
      if (!Number.isInteger(ch.rewards[key])) err(`rewards.${key} должен быть целым числом`);
    }
  }
  if (name && ch.id !== name) err(`id «${ch.id}» не совпадает с именем файла «${name}»`);

  const width = ch.levelWidth ?? 0;
  if ((width < 6000 || width > 7200) && name !== 'chapter_01') warn(`levelWidth=${width} вне 6000..7200`);
  if (!textOk(ch.hint)) err('hint пустой');
  if (!textOk(ch.outro)) err('outro пустой');

  (ch.intro || []).forEach((page, i) => {
    const where = `intro[${i}]`;
    const t = page.type;
    if ((t === 'text' || t === 'scene') && !textOk(page.text)) err(`${where}: пустой text`);
    if (t === 'scene') frame(page.frame, `${where}.frame`);
    if (t === 'cast') {
      (page.cast || []).forEach((c, j) => {
        frame(c.frame, `${where}.cast[${j}]`);
        if (!c.name) err(`${where}.cast[${j}]: нет name`);
      });
    }
    if (t === 'learn') (page.digits || []).forEach((d, j) => frame(d.frame, `${where}.digits[${j}]`));
    if (!['text', 'cast', 'learn', 'scene'].includes(t)) err(`${where}: неизвестный тип «${t}»`);
  });

  for (const p of ch.props || []) {
    frame(p.frame, `props.${p.id}`);
    if ((p.parallax ?? 1) === 1 && !(p.x >= -50 && p.x <= width + 50)) {
      warn(`props.${p.id}: x=${p.x} за краем уровня`);
    }
  }
  (ch.foreground || []).forEach((f, i) => frame(f.frame, `foreground[${i}]`));

  const pickups = ch.pickups || [];
  const ids = new Map();
  const values = new Set();
  let lastX = -1;
  for (const it of pickups) {
    const where = `pickups.${it.id}`;
    frame(it.frame, where);
    if (ids.has(it.id)) err(`${where}: id повторяется`);
    ids.set(it.id, it);
    if (!Number.isInteger(it.value)) err(`${where}: value не число`);
    else values.add(it.value);
    const x = it.x ?? -1;
    if (!(x >= 60 && x <= width - 60)) err(`${where}: x=${x} вне уровня`);
    if (x <= lastX) warn(`${where}: x=${x} не возрастает`);
    lastX = x;
    if (it.yOffset !== -150 || it.scale !== 0.5) warn(`${where}: ожидались yOffset=-150, scale=0.5`);
  }
  if (pickups.length < 5 || pickups.length > 8) warn(`пикапов ${pickups.length}, ожидалось 5..8`);

  const gates = ch.gates || [];
  for (const g of gates) {
    const where = `gates.${g.id}`;
    frame(g.frame, where);
    const gx = g.x ?? -1;
    if (!(gx >= 0 && gx <= width)) err(`${where}: x=${gx} вне уровня`);
    for (const need of g.needs || []) {
      if (!ids.has(need)) err(`${where}: needs ссылается на несуществующий пикап «${need}»`);
      else if (ids.get(need).x >= gx) {
        err(`${where}: пикап «${need}» (x=${ids.get(need).x}) стоит не левее ящика (x=${gx})`);
      }
    }
    for (const it of pickups) {
      if (Math.abs(it.x - gx) < 120) err(`${where}: пикап «${it.id}» ближе 120 к ящику`);
    }
    if (!g.task) err(`${where}: нет task`);
    else task(g.task, `${where}.task`);
  }
  if (gates.length < 3 || gates.length > 4) warn(`ящиков ${gates.length}, ожидалось 3..4`);
  if (pickups.length && gates.length
      && Math.max(...pickups.map((it) => it.x)) < Math.max(...gates.map((g) => g.x))) {
    warn('последний ящик стоит правее последнего пикапа: до него не дойти до финала');
  }

  const npcs = ch.npc || [];
  for (const n of npcs) {
    const where = `npc.${n.id}`;
    frame(n.frame, where);
    if (!(n.x >= 0 && n.x <= width)) err(`${where}: x вне уровня`);
    const d = n.dialogue;
    if (!d) { err(`${where}: нет dialogue`); continue; }
    if (!textOk(d.greeting)) err(`${where}: пустой greeting`);
    const topics = d.topics || [];
    if (topics.length < 2 || topics.length > 4) warn(`${where}: тем ${topics.length}, ожидалось 2..4`);
    topics.forEach((t, j) => {
      const tw = `${where}.topics[${j}]`;
      if (!textOk(t.title) || !textOk(t.text)) err(`${tw}: нет title или text`);
      const pz = t.puzzle;
      if (!pz) return;
      if (!textOk(pz.question)) err(`${tw}.puzzle: нет question`);
      const opts = pz.options || [];
      if (!Number.isInteger(pz.answer) || pz.answer < 0 || pz.answer >= opts.length) {
        err(`${tw}.puzzle: answer=${pz.answer} вне options`);
      }
      for (const key of ['correct', 'wrong']) {
        if (!textOk(pz[key])) err(`${tw}.puzzle: нет ${key}`);
      }
    });
  }
  if (npcs.length < 2 || npcs.length > 3) warn(`НПС ${npcs.length}, ожидалось 2..3`);

  const enemies = ch.enemies || [];
  for (const e of enemies) {
    const where = `enemies.${e.id}`;
    frame(e.frame, where);
    if (e.frameMove) frame(e.frameMove, `${where}.frameMove`);
    const lo = e.from ?? 0;
    const hi = e.to ?? 0;
    if (!(lo >= 0 && lo < hi && hi <= width)) err(`${where}: участок ${lo}..${hi} вне уровня`);
    if (!(e.x >= lo && e.x <= hi)) warn(`${where}: стартовый x=${e.x} вне участка ${lo}..${hi}`);
    const reach = [lo - 220, hi + 220];
    for (const g of gates) {
      if (g.x >= lo && g.x <= hi) err(`${where}: участок ${lo}..${hi} пересекает ящик ${g.id} x=${g.x}`);
      else if (g.x >= reach[0] && g.x <= reach[1]) {
        warn(`${where}: при погоне (+220) Клякса достаёт до ящика ${g.id} x=${g.x}`);
      }
    }
    for (const n of npcs) {
      if (n.x >= lo && n.x <= hi) err(`${where}: участок ${lo}..${hi} пересекает НПС ${n.id} x=${n.x}`);
      else if (n.x >= reach[0] && n.x <= reach[1]) {
        warn(`${where}: при погоне (+220) Клякса достаёт до НПС ${n.id} x=${n.x}`);
      }
    }
  }
  if (enemies.length < 1 || enemies.length > 2) warn(`врагов ${enemies.length}, ожидалось 1..2`);

  const fin = ch.finale;
  if (!fin) err('нет finale');
  else {
    for (const key of ['count', 'title', 'hint', 'wrong', 'done', 'after']) {
      if (!textOk(fin[key])) err(`finale.${key} пустой`);
    }
    const tasks = fin.tasks || [];
    if (tasks.length < 3 || tasks.length > 4) warn(`finale.tasks: ${tasks.length} задач, ожидалось 3..4`);
    tasks.forEach((t, i) => {
      if (t.a == null) { err(`finale.tasks[${i}]: финал умеет только примеры a/b`); return; }
      task(t, `finale.tasks[${i}]`, values);
    });
  }

  return { errors, warnings };
}
