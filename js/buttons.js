// Live button / D-pad panel. Shows every button the controller exposes, lit up
// on press. A licensed clone's button order isn't guaranteed, so we render both
// a Switch-labelled view (best-effort default order) AND a raw index grid, plus
// a live "last pressed" readout for identifying which physical button is which.

import { t } from './i18n.js';

const SWITCH_LABELS = {
  1: 'B', 2: 'A', 3: 'Y', 4: 'X',
  5: 'L', 6: 'R', 7: 'ZL', 8: 'ZR',
  9: '−', 10: '+', 11: 'L3', 12: 'R3',
  13: 'Home', 14: 'Capture',
};

export class ButtonsPanel {
  constructor(root) {
    this.root = root;
    this.cells = {};      // index -> raw grid element
    this.chips = {};      // index -> labelled chip element
    this.dpad = {};
    this._prevPressed = new Set();
  }

  build(info) {
    this.root.innerHTML = '';
    const n = info.buttonCount || 0;

    // Labelled Switch view
    const named = document.createElement('div');
    named.className = 'btn-named';
    for (let i = 1; i <= 14; i++) {
      if (!SWITCH_LABELS[i]) continue;
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = SWITCH_LABELS[i];
      chip.title = t('ident_btn', { i });
      this.chips[i] = chip;
      named.appendChild(chip);
    }

    // D-pad
    const dpad = document.createElement('div');
    dpad.className = 'dpad';
    for (const dir of ['up', 'left', 'right', 'down']) {
      const el = document.createElement('div');
      el.className = `dpad-${dir} dbtn`;
      el.textContent = { up: '▲', down: '▼', left: '◀', right: '▶' }[dir];
      this.dpad[dir] = el;
      dpad.appendChild(el);
    }

    // Raw grid of every exposed button
    const grid = document.createElement('div');
    grid.className = 'btn-grid';
    for (let i = 1; i <= n; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.innerHTML = `<b>${i}</b><span>${SWITCH_LABELS[i] || ''}</span>`;
      this.cells[i] = cell;
      grid.appendChild(cell);
    }

    const ident = document.createElement('div');
    ident.className = 'ident';
    ident.id = 'ident-line';
    ident.textContent = t('ident_hint');

    const sub = document.createElement('h3'); sub.className = 'subhead';
    sub.textContent = t('subhead', { n });
    this.root.append(named, dpad, ident, sub, grid);
  }

  update(state) {
    const pressed = new Set();
    for (const [idx, on] of Object.entries(state.buttons)) {
      const i = +idx;
      const el = this.cells[i];
      if (el) el.classList.toggle('on', !!on);
      const chip = this.chips[i];
      if (chip) chip.classList.toggle('on', !!on);
      if (on) pressed.add(i);
    }

    const h = state.hat || { x: 0, y: 0 };
    this.dpad.up?.classList.toggle('on', h.y < 0);    // decodeHat: up = y:-1 (screen coords)
    this.dpad.down?.classList.toggle('on', h.y > 0);
    this.dpad.left?.classList.toggle('on', h.x < 0);
    this.dpad.right?.classList.toggle('on', h.x > 0);

    // identify: report newly pressed indices
    const newly = [...pressed].filter((i) => !this._prevPressed.has(i));
    if (newly.length) {
      const line = document.getElementById('ident-line');
      if (line) line.textContent = newly
        .map((i) => t('ident_btn', { i }) + (SWITCH_LABELS[i] ? t('ident_default', { label: SWITCH_LABELS[i] }) : ''))
        .join('  ·  ');
    }
    this._prevPressed = pressed;
  }
}
