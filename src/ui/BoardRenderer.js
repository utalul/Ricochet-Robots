/**
 * BoardRenderer
 * 以 SVG 繪製 16×16 棋盤：格線、牆壁、中央卡榫、目標符號、機器人與滑動動畫。
 * 只負責「畫」，不持有遊戲規則狀態。
 */
import { COLOR_HEX } from '../core/constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const ROBOT_HEX = Object.freeze({
  red: '#e53935',
  blue: '#1e88e5',
  yellow: '#fbc02d',
  green: '#43a047',
});
const ROBOT_STROKE = Object.freeze({
  red: '#8e1c1a',
  blue: '#0d4f8b',
  yellow: '#8a6500',
  green: '#1f5e22',
});
const ROBOT_KEY = Object.freeze({ red: '1', blue: '2', yellow: '3', green: '4' });

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

function targetHex(color) {
  return ROBOT_HEX[color] ?? COLOR_HEX[color] ?? '#7b1fa2';
}

/**
 * 建立目標符號（以 (0,0) 為中心、半徑 r）。
 * star 星星 / moon 月亮 / planet 行星 / gear 齒輪 / vortex 漩渦
 */
export function createShape(shape, color, r) {
  const g = el('g', { class: `shape shape-${shape}` });
  const fill = targetHex(color);
  const stroke = 'rgba(0,0,0,.35)';

  switch (shape) {
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push(`${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`);
      }
      el('polygon', { points: pts.join(' '), fill, stroke, 'stroke-width': r * 0.08, 'stroke-linejoin': 'round' }, g);
      break;
    }
    case 'moon': {
      const a = 0.4 * r;
      const b = Math.sqrt(1 - 0.16) * r;
      const rr = b * 1.15;
      const d = `M ${a} ${-b} A ${r} ${r} 0 1 0 ${a} ${b} A ${rr} ${rr} 0 0 1 ${a} ${-b} Z`;
      el('path', { d, fill, stroke, 'stroke-width': r * 0.08 }, g);
      break;
    }
    case 'planet': {
      el('circle', { r: r * 0.58, fill, stroke, 'stroke-width': r * 0.08 }, g);
      el('ellipse', {
        rx: r * 0.98, ry: r * 0.3, fill: 'none', stroke: fill, 'stroke-width': r * 0.16,
        transform: 'rotate(-22)', opacity: 0.9,
      }, g);
      break;
    }
    case 'gear': {
      const teeth = 8;
      const pts = [];
      for (let i = 0; i < teeth * 4; i++) {
        const a = (i * Math.PI * 2) / (teeth * 4);
        const rad = i % 4 < 2 ? r : r * 0.74;
        pts.push(`${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`);
      }
      el('polygon', { points: pts.join(' '), fill, stroke, 'stroke-width': r * 0.06, 'stroke-linejoin': 'round' }, g);
      el('circle', { r: r * 0.28, fill: '#fffaf0', stroke, 'stroke-width': r * 0.06 }, g);
      break;
    }
    case 'vortex':
    default: {
      const colors = [ROBOT_HEX.red, ROBOT_HEX.blue, ROBOT_HEX.green, ROBOT_HEX.yellow];
      colors.forEach((c, i) => {
        const a0 = (i * Math.PI) / 2;
        const a1 = a0 + Math.PI / 2;
        const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
        const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
        const xm = Math.cos(a0 + Math.PI / 4) * r * 0.35, ym = Math.sin(a0 + Math.PI / 4) * r * 0.35;
        el('path', { d: `M 0 0 Q ${xm} ${ym} ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`, fill: c }, g);
      });
      el('circle', { r: r * 0.22, fill: '#fffaf0' }, g);
      g.classList.add('vortex-spin');
      break;
    }
  }
  return g;
}

/** 建立獨立的目標小圖示 <svg>（HUD 使用） */
export function createTargetIcon(target, size = 36) {
  const svg = el('svg', { viewBox: '-20 -20 40 40', width: size, height: size, class: 'target-icon', 'aria-hidden': 'true' });
  svg.appendChild(createShape(target.shape, target.color, 17));
  return svg;
}

export class BoardRenderer {
  /**
   * @param {HTMLElement} container
   * @param {{cellSize?: number}} [options]
   */
  constructor(container, { cellSize = 40 } = {}) {
    this.container = container;
    this.cell = cellSize;
    this.grid = null;
    this.size = 0;
    this.robotEls = {};
    this.positions = {};

    this.svg = el('svg', { class: 'board-svg', role: 'img', 'aria-label': 'Ricochet Robots board' });
    this.layers = {};
    for (const name of ['bg', 'gridlines', 'targets', 'trails', 'walls', 'hub', 'robots']) {
      this.layers[name] = el('g', { class: `layer-${name}` }, this.svg);
    }
    container.innerHTML = '';
    container.appendChild(this.svg);
  }

  /** 格中心座標 */
  center(x, y) {
    return { cx: (x + 0.5) * this.cell, cy: (y + 0.5) * this.cell };
  }

  /** 由螢幕座標換算為格座標（支援 CSS 縮放） */
  cellFromClient(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !this.size) return null;
    const x = Math.floor(((clientX - rect.left) / rect.width) * this.size);
    const y = Math.floor(((clientY - rect.top) / rect.height) * this.size);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    return { x, y };
  }

  /** 繪製靜態棋盤（格線、牆、卡榫、目標） */
  setBoard(grid) {
    this.grid = grid;
    this.size = grid.length;
    const C = this.cell;
    const W = this.size * C;
    this.svg.setAttribute('viewBox', `-4 -4 ${W + 8} ${W + 8}`);
    Object.values(this.layers).forEach((l) => l.replaceChildren());
    this.robotEls = {};
    this.positions = {};
    this.targetEls = [];

    const { bg, gridlines, targets, walls, hub } = this.layers;

    // 背景與棋盤格
    el('rect', { x: 0, y: 0, width: W, height: W, class: 'board-bg' }, bg);
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if ((x + y) % 2 === 0) el('rect', { x: x * C, y: y * C, width: C, height: C, class: 'cell-alt' }, bg);
      }
    }

    // 格線
    for (let i = 1; i < this.size; i++) {
      el('line', { x1: i * C, y1: 0, x2: i * C, y2: W, class: 'gridline' }, gridlines);
      el('line', { x1: 0, y1: i * C, x2: W, y2: i * C, class: 'gridline' }, gridlines);
    }

    // 目標
    for (const row of grid) {
      for (const cell of row) {
        if (!cell.target) continue;
        const { cx, cy } = this.center(cell.x, cell.y);
        const g = el('g', { class: 'target', transform: `translate(${cx} ${cy})`, 'data-x': cell.x, 'data-y': cell.y }, targets);
        el('rect', {
          x: -C / 2 + 1.5, y: -C / 2 + 1.5, width: C - 3, height: C - 3, rx: 4,
          class: 'target-bg', fill: targetHex(cell.target.color),
        }, g);
        g.appendChild(createShape(cell.target.shape, cell.target.color, C * 0.32));
        this.targetEls.push({ el: g, x: cell.x, y: cell.y });
      }
    }

    // 牆壁：每格畫 top / left，最後一欄補 right、最後一列補 bottom（牆面已雙向一致）
    const segs = [];
    for (const row of grid) {
      for (const c of row) {
        const x0 = c.x * C, y0 = c.y * C, x1 = x0 + C, y1 = y0 + C;
        if (c.top) segs.push(`M${x0} ${y0}H${x1}`);
        if (c.left) segs.push(`M${x0} ${y0}V${y1}`);
        if (c.right && c.x === this.size - 1) segs.push(`M${x1} ${y0}V${y1}`);
        if (c.bottom && c.y === this.size - 1) segs.push(`M${x0} ${y1}H${x1}`);
      }
    }
    el('path', { d: segs.join(''), class: 'walls' }, walls);

    // 中央卡榫
    const hubCells = grid.flat().filter((c) => c.blocked);
    if (hubCells.length) {
      const minX = Math.min(...hubCells.map((c) => c.x));
      const minY = Math.min(...hubCells.map((c) => c.y));
      const maxX = Math.max(...hubCells.map((c) => c.x));
      const maxY = Math.max(...hubCells.map((c) => c.y));
      el('rect', {
        x: minX * C, y: minY * C, width: (maxX - minX + 1) * C, height: (maxY - minY + 1) * C,
        class: 'hub', rx: 3,
      }, hub);
      this.hubCenter = { cx: ((minX + maxX + 1) / 2) * C, cy: ((minY + maxY + 1) / 2) * C };
      this.hubIcon = el('g', { class: 'hub-icon', transform: `translate(${this.hubCenter.cx} ${this.hubCenter.cy})` }, hub);
    }
  }

  /** 標示本回合目標（其他目標淡化，中央卡榫顯示目標圖示） */
  setTarget(target) {
    for (const t of this.targetEls ?? []) {
      const active = target && t.x === target.x && t.y === target.y;
      t.el.classList.toggle('active', !!active);
      t.el.classList.toggle('dim', !active);
    }
    if (this.hubIcon) {
      this.hubIcon.replaceChildren();
      if (target) this.hubIcon.appendChild(createShape(target.shape, target.color, this.cell * 0.7));
    }
  }

  _ensureRobot(color) {
    if (this.robotEls[color]) return this.robotEls[color];
    const C = this.cell;
    const g = el('g', { class: 'robot', 'data-color': color }, this.layers.robots);
    el('circle', { r: C * 0.46, class: 'robot-ring', stroke: ROBOT_HEX[color] }, g);
    el('circle', { r: C * 0.36, class: 'robot-body', fill: ROBOT_HEX[color], stroke: ROBOT_STROKE[color] }, g);
    el('circle', { r: C * 0.12, cx: -C * 0.11, cy: -C * 0.12, class: 'robot-shine' }, g);
    const label = el('text', { class: 'robot-label', 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 1 }, g);
    label.textContent = ROBOT_KEY[color] ?? '';
    this.robotEls[color] = g;
    return g;
  }

  _place(g, x, y, durationMs) {
    const { cx, cy } = this.center(x, y);
    if (durationMs <= 0) {
      g.style.transition = 'none';
      g.style.transform = `translate(${cx}px, ${cy}px)`;
      void g.getBoundingClientRect(); // 強制 reflow，讓下一次 transition 生效
      g.style.transition = '';
    } else {
      g.style.transitionDuration = `${durationMs}ms`;
      g.style.transform = `translate(${cx}px, ${cy}px)`;
    }
  }

  /** 依距離計算動畫時間 */
  static durationFor(distance) {
    return distance > 0 ? Math.min(90 + distance * 38, 520) : 0;
  }

  /**
   * 更新機器人位置與選取狀態。
   * @param {Record<string,{x,y}>} robots
   * @param {string|null} selected
   * @param {{animate?: boolean}} [opts]
   * @returns {number} 最長動畫時間 (ms)
   */
  renderRobots(robots, selected, { animate = true } = {}) {
    let maxDur = 0;
    for (const [color, pos] of Object.entries(robots)) {
      const g = this._ensureRobot(color);
      const prev = this.positions[color];
      const dist = prev ? Math.abs(prev.x - pos.x) + Math.abs(prev.y - pos.y) : 0;
      const dur = animate && prev ? BoardRenderer.durationFor(dist) : 0;
      if (!prev || dist > 0) this._place(g, pos.x, pos.y, dur);
      maxDur = Math.max(maxDur, dur);
      this.positions[color] = { x: pos.x, y: pos.y };
      g.classList.toggle('selected', color === selected);
    }
    // 選中者置頂
    if (selected && this.robotEls[selected]) this.layers.robots.appendChild(this.robotEls[selected]);
    return maxDur;
  }

  /** 繪製滑動軌跡（淡出後自動移除） */
  drawTrail(color, path) {
    if (!path || path.length < 2) return;
    const a = this.center(path[0].x, path[0].y);
    const b = this.center(path[path.length - 1].x, path[path.length - 1].y);
    const line = el('line', {
      x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy, class: 'trail', stroke: ROBOT_HEX[color] ?? '#000',
      'stroke-width': this.cell * 0.28,
    }, this.layers.trails);
    setTimeout(() => line.remove(), 900);
  }

  /** 無法移動時的「撞牆」抖動回饋 */
  bump(color, direction) {
    const g = this.robotEls[color];
    const pos = this.positions[color];
    if (!g || !pos || typeof g.animate !== 'function') return;
    const { cx, cy } = this.center(pos.x, pos.y);
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction] ?? [0, 0];
    const k = this.cell * 0.12;
    const base = `translate(${cx}px, ${cy}px)`;
    const push = `translate(${cx + d[0] * k}px, ${cy + d[1] * k}px)`;
    g.animate([{ transform: base }, { transform: push }, { transform: base }], { duration: 160, easing: 'ease-out' });
  }

  /** 達陣慶祝效果 */
  celebrate(x, y) {
    const { cx, cy } = this.center(x, y);
    const ring = el('circle', { cx, cy, r: this.cell * 0.4, class: 'celebrate-ring' }, this.layers.trails);
    setTimeout(() => ring.remove(), 1200);
  }
}
