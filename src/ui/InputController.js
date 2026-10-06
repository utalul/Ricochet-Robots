/**
 * InputController
 * 統一處理鍵盤、滑鼠/觸控（點擊、滑動手勢）與畫面按鈕，轉換成語意化的回呼。
 * 支援 1~5 號鍵選取機器人（包含 5 號白色／銀色機器人）。
 */

const KEY_TO_DIRECTION = Object.freeze({
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
});

const KEY_TO_ROBOT = Object.freeze({
  1: 'red',
  2: 'blue',
  3: 'yellow',
  4: 'green',
  5: 'silver',
});

const SWIPE_THRESHOLD_PX = 24;

export class InputController {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.boardElement   棋盤容器（點擊/滑動）
   * @param {HTMLElement} [opts.controlsRoot] 含 data-action / data-dir / data-select 按鈕的容器
   * @param {(clientX:number, clientY:number) => ({x:number,y:number}|null)} opts.cellFromClient
   * @param {() => Record<string,{x,y}>} opts.getRobots
   * @param {() => string|null} opts.getSelected
   * @param {object} opts.handlers { select, move, undo, reset, next, newGame, confirm, cancel }
   */
  constructor({
    boardElement,
    controlsRoot = document,
    cellFromClient,
    getRobots,
    getSelected,
    handlers,
  }) {
    this.board = boardElement;
    this.controlsRoot = controlsRoot;
    this.cellFromClient = cellFromClient;
    this.getRobots = getRobots;
    this.getSelected = getSelected;
    this.h = handlers;
    this._pointer = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = () => {
      this._pointer = null;
    };
    this._onClick = this._onClick.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    this.board.addEventListener('pointerdown', this._onPointerDown);
    this.board.addEventListener('pointerup', this._onPointerUp);
    this.board.addEventListener('pointercancel', this._onPointerCancel);
    this.controlsRoot.addEventListener('click', this._onClick);
    return this;
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    this.board.removeEventListener('pointerdown', this._onPointerDown);
    this.board.removeEventListener('pointerup', this._onPointerUp);
    this.board.removeEventListener('pointercancel', this._onPointerCancel);
    this.controlsRoot.removeEventListener('click', this._onClick);
  }

  _call(name, ...args) {
    const fn = this.h?.[name];
    if (typeof fn === 'function') fn(...args);
  }

  // ---------- 鍵盤 ----------
  _onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (KEY_TO_DIRECTION[key]) {
      e.preventDefault();
      if (!e.repeat) this._call('move', KEY_TO_DIRECTION[key]);
      return;
    }
    if (KEY_TO_ROBOT[key]) {
      e.preventDefault();
      this._call('select', KEY_TO_ROBOT[key]);
      return;
    }
    switch (key) {
      case 'z':
        e.preventDefault();
        this._call('undo');
        break;
      case 'r':
        e.preventDefault();
        this._call('reset');
        break;
      case 'n':
        e.preventDefault();
        this._call('next');
        break;
      case 'm':
        e.preventDefault();
        this._call('newGame');
        break;
      case 'Enter':
        this._call('confirm', e);
        break;
      case 'Escape':
        this._call('cancel', e);
        break;
      default:
        break;
    }
  }

  // ---------- 棋盤點擊 / 滑動 ----------
  _onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    this._pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  _onPointerUp(e) {
    const start = this._pointer;
    this._pointer = null;
    if (!start || start.id !== e.pointerId) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    if (Math.hypot(dx, dy) >= SWIPE_THRESHOLD_PX) {
      const startCell = this.cellFromClient(start.x, start.y);
      const robotOnStart = startCell && this._robotAt(startCell);
      if (robotOnStart) this._call('select', robotOnStart);
      const dir =
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? 'right'
            : 'left'
          : dy > 0
          ? 'down'
          : 'up';
      this._call('move', dir);
      return;
    }

    const cell = this.cellFromClient(e.clientX, e.clientY);
    if (!cell) return;
    const robot = this._robotAt(cell);
    if (robot) {
      this._call('select', robot);
      return;
    }
    const selected = this.getSelected();
    const pos = selected && this.getRobots()[selected];
    if (!pos) return;
    if (cell.x === pos.x && cell.y !== pos.y)
      this._call('move', cell.y < pos.y ? 'up' : 'down');
    else if (cell.y === pos.y && cell.x !== pos.x)
      this._call('move', cell.x < pos.x ? 'left' : 'right');
  }

  _robotAt(cell) {
    const robots = this.getRobots() ?? {};
    for (const [color, p] of Object.entries(robots)) {
      if (p.x === cell.x && p.y === cell.y) return color;
    }
    return null;
  }

  // ---------- 畫面按鈕 ----------
  _onClick(e) {
    const btn = e.target.closest?.('[data-action],[data-dir],[data-select]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.dir) this._call('move', btn.dataset.dir);
    else if (btn.dataset.select) this._call('select', btn.dataset.select);
    else if (btn.dataset.action) this._call(btn.dataset.action);
  }
}
