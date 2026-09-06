/**
 * palette.js - панель кадров атласа.
 *
 * Кадр перетаскивается прямо на вид сбоку: где отпустил, там и появился
 * объект. Тип нового объекта выбирается переключателем сверху (по умолчанию
 * декорация), для декорации тут же задаётся план глубины.
 */
import { el, clear, thumb } from './dom.js';
import { KINDS } from './store.js';

const DECOR = /^(bench|pots|crate|sign|lamp|house_|tree_|fence_|bush_|stones|stone_|ground_strip|props_|card_|town_clock)/;
const HERO = /^(petka|cat|owl|baker|klyaksa)/;

function category(name) {
  if (/_big$/.test(name)) return 'big';
  if (/^digit_/.test(name)) return 'digit';
  if (DECOR.test(name)) return 'decor';
  if (HERO.test(name)) return 'hero';
  return 'other';
}

const TABS = [
  ['all', 'все'], ['decor', 'декор'], ['digit', 'цифры'], ['hero', 'герои'], ['big', 'крупные'],
];

export class Palette {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.tab = 'all';
    this.query = '';
    this.build();
  }

  build() {
    const app = this.app;
    clear(this.root);

    const kinds = el('div', { class: 'seg' },
      ['prop', 'pickup', 'gate', 'npc', 'enemy'].map((k) => el('button', {
        class: `seg-btn${app.newKind === k ? ' on' : ''}`,
        type: 'button',
        title: `Новый объект: ${KINDS[k].label}`,
        text: KINDS[k].short,
        onclick: () => { app.newKind = k; this.build(); },
      })));

    const par = el('select', {
      class: 'inp',
      onchange: (e) => { app.newParallax = Number(e.target.value); },
    }, [0.5, 0.75, 1].map((v) => el('option', { value: v, selected: app.newParallax === v },
      v === 0.5 ? '0.5 - дальний' : v === 0.75 ? '0.75 - средний' : '1 - игровой')));

    const search = el('input', {
      class: 'inp', type: 'search', placeholder: 'поиск кадра...', value: this.query,
      oninput: (e) => { this.query = e.target.value.trim().toLowerCase(); this.fill(); },
    });

    const tabs = el('div', { class: 'chips' }, TABS.map(([id, label]) => el('button', {
      class: `chip${this.tab === id ? ' on' : ''}`, type: 'button', text: label,
      onclick: () => { this.tab = id; this.build(); },
    })));

    this.grid = el('div', { class: 'frames' });

    this.root.append(
      el('div', { class: 'panel-head' }, 'Палитра кадров'),
      el('div', { class: 'panel-body pal-top' },
        el('div', { class: 'hint', text: 'Тип нового объекта' }),
        kinds,
        app.newKind === 'prop' ? par : null,
        search,
        tabs),
      this.grid,
      el('div', { class: 'pal-foot' },
        el('button', {
          class: 'btn wide', type: 'button', text: 'Добавить в центр экрана',
          onclick: () => app.addSelectedFrame(),
        }),
        el('div', { class: 'hint', text: 'или перетащи кадр на вид сбоку' })),
    );
    this.fill();
  }

  fill() {
    const app = this.app;
    clear(this.grid);
    const names = Object.keys(app.atlas.frames)
      .filter((n) => (this.tab === 'all' || category(n) === this.tab))
      .filter((n) => !this.query || n.includes(this.query))
      .sort();
    if (!names.length) {
      this.grid.append(el('div', { class: 'hint pad', text: 'Ничего не найдено' }));
      return;
    }
    for (const name of names) {
      const cell = el('button', {
        class: `frame${app.newFrame === name ? ' on' : ''}`,
        type: 'button', draggable: 'true', title: name,
        onclick: () => { app.newFrame = name; this.fill(); },
        ondblclick: () => { app.newFrame = name; app.addSelectedFrame(); },
        ondragstart: (e) => {
          app.newFrame = name;
          e.dataTransfer.setData('text/frame', name);
          e.dataTransfer.setData('text/plain', name);
          e.dataTransfer.effectAllowed = 'copy';
        },
      }, thumb(app.atlas, name, 52), el('span', { class: 'frame-name', text: name }));
      this.grid.append(cell);
    }
  }
}
