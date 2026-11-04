// 地图工坊编辑器：支持缩放、拖动、单指绘制 / 双指平移缩放
import { TILE } from './game.js';

export const PALETTE = [
  { ch: '.', name: '橡皮', icon: '⌫', color: '#2a3446' },
  { ch: '#', name: '地面', icon: '▦', color: '#3d4a6b' },
  { ch: 'M', name: '金属', icon: '▩', color: '#5b6478' },
  { ch: '~', name: '冰面', icon: '❄', color: '#7cc8f0' },
  { ch: '=', name: '弹簧', icon: '⇧', color: '#5ce08a' },
  { ch: '^', name: '尖刺', icon: '▲', color: '#c9d2ee' },
  { ch: 'o', name: '金币', icon: '●', color: '#ffd23f' },
  { ch: '*', name: '星星', icon: '★', color: '#ffe14d' },
  { ch: 'S', name: '出生点', icon: '⚑', color: '#4f8cff' },
  { ch: 'G', name: '终点', icon: '⚐', color: '#22d3a6' },
];

export const EDIT_COLS = 64;
export const EDIT_ROWS = 20;

const MIN_CELL = 9;
const MAX_CELL = 72;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Editor {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;

    this.cols = EDIT_COLS;
    this.rows = EDIT_ROWS;
    this.tool = '#';
    this.mode = 'paint'; // paint | pan
    this.grid = this.blank();

    this.cell = 26;       // 每格像素（CSS px）
    this.viewX = 0;       // 视口左上角在世界坐标中的位置
    this.viewY = 0;
    this.userZoom = false;
    this.dpr = 1;
    this._usableH = 400;

    this.pointers = new Map();
    this.gesture = null;
    this.painting = false;
    this.lastPaint = null;
    this.ignoreUntilRelease = false;

    this._bindEvents();
    this.resize();
  }

  get viewW() {
    return this.canvas.clientWidth || window.innerWidth;
  }
  get viewH() {
    return this._usableH;
  }

  blank() {
    const g = [];
    for (let r = 0; r < this.rows; r++) g.push(new Array(this.cols).fill('.'));
    for (let c = 0; c < this.cols; c++) {
      g[this.rows - 2][c] = '#';
      g[this.rows - 1][c] = '#';
    }
    g[this.rows - 3][2] = 'S';
    g[this.rows - 3][this.cols - 3] = 'G';
    for (let c = 8; c < this.cols - 8; c += 6) g[this.rows - 5][c] = 'o';
    g[this.rows - 6][18] = '#';
    g[this.rows - 6][19] = '#';
    g[this.rows - 8][30] = '^';
    return g;
  }

  toGridStrings() {
    return this.grid.map((row) => row.join(''));
  }

  loadGrid(strings) {
    this.rows = strings.length;
    this.cols = strings[0].length;
    this.grid = strings.map((row) => row.split(''));
    this.userZoom = false;
    this.resize();
  }

  clear() {
    this.grid = this.blank();
    this.draw();
  }

  setMode(mode) {
    this.mode = mode === 'pan' ? 'pan' : 'paint';
    return this.mode;
  }

  /* ---------------- 视图 ---------------- */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);

    const toolbar = document.getElementById('editToolbar');
    const tbH = toolbar ? toolbar.offsetHeight : 150;
    this._usableH = Math.max(120, ch - tbH - 6);

    if (!this.userZoom) {
      // 默认让整张图的高度刚好铺满可视区，横向可拖动查看
      this.cell = clamp(this._usableH / this.rows, MIN_CELL, 44);
      this.viewX = 0;
      this.viewY = 0;
    }
    this.clampView();
    this.draw();
  }

  clampView() {
    const contentW = this.cols * this.cell;
    const contentH = this.rows * this.cell;
    if (contentW <= this.viewW) this.viewX = (this.viewW - contentW) / 2;
    else this.viewX = clamp(this.viewX, 0, contentW - this.viewW);
    if (contentH <= this.viewH) this.viewY = (this.viewH - contentH) / 2;
    else this.viewY = clamp(this.viewY, 0, contentH - this.viewH);
  }

  zoomBy(factor) {
    const cx = this.viewW / 2;
    const cy = this.viewH / 2;
    const wx = (cx + this.viewX) / this.cell;
    const wy = (cy + this.viewY) / this.cell;
    this.cell = clamp(this.cell * factor, MIN_CELL, MAX_CELL);
    this.viewX = wx * this.cell - cx;
    this.viewY = wy * this.cell - cy;
    this.userZoom = true;
    this.clampView();
    this.draw();
  }

  /* ---------------- 指针事件 ---------------- */
  _bindEvents() {
    const c = this.canvas;
    c.style.touchAction = 'none';

    c.addEventListener('pointerdown', (e) => {
      if (c.setPointerCapture) {
        try { c.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size >= 2) {
        this.painting = false;
        this.lastPaint = null;
        this.gesture = this._makePinch();
        return;
      }

      if (this.ignoreUntilRelease) return;

      if (this.mode === 'pan') {
        this.gesture = { type: 'pan', lastX: e.clientX, lastY: e.clientY };
      } else {
        this.painting = true;
        this._paintAtScreen(e.clientX, e.clientY);
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size >= 2 && this.gesture && this.gesture.type === 'pinch') {
        this._updatePinch();
        return;
      }

      if (this.gesture && this.gesture.type === 'pan') {
        const dx = e.clientX - this.gesture.lastX;
        const dy = e.clientY - this.gesture.lastY;
        this.gesture.lastX = e.clientX;
        this.gesture.lastY = e.clientY;
        this.viewX -= dx;
        this.viewY -= dy;
        this.clampView();
        this.draw();
        return;
      }

      if (this.painting) this._paintAtScreen(e.clientX, e.clientY);
    });

    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) {
        if (this.gesture && this.gesture.type === 'pinch') {
          // 双指手势结束后，剩下的手指不要继续画
          this.ignoreUntilRelease = this.pointers.size > 0;
        }
        this.gesture = null;
      }
      if (this.pointers.size === 0) {
        this.painting = false;
        this.lastPaint = null;
        this.ignoreUntilRelease = false;
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', (e) => {
      if (this.pointers.has(e.pointerId)) up(e);
    });
  }

  _makePinch() {
    const pts = [...this.pointers.values()];
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    return {
      type: 'pinch',
      midX,
      midY,
      dist,
      cell0: this.cell,
      viewX0: this.viewX,
      viewY0: this.viewY,
      // 记录手势开始时，双指中点对应的世界坐标（单位：格）
      worldX: (midX + this.viewX) / this.cell,
      worldY: (midY + this.viewY) / this.cell,
    };
  }

  _updatePinch() {
    const g = this.gesture;
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;

    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;

    this.cell = clamp(g.cell0 * (dist / g.dist), MIN_CELL, MAX_CELL);
    this.viewX = g.worldX * this.cell - midX;
    this.viewY = g.worldY * this.cell - midY;
    this.userZoom = true;
    this.clampView();
    this.draw();
  }

  /* ---------------- 绘制格子 ---------------- */
  _paintAtScreen(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    const wx = px - rect.left + this.viewX;
    const wy = py - rect.top + this.viewY;
    const c = Math.floor(wx / this.cell);
    const r = Math.floor(wy / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    if (this.lastPaint && this.lastPaint.c === c && this.lastPaint.r === r) return;
    this.lastPaint = { c, r };
    this._setCell(c, r, this.tool);
    this.draw();
  }

  _setCell(c, r, ch) {
    if (ch === 'S' || ch === 'G') {
      for (let rr = 0; rr < this.rows; rr++) {
        for (let cc = 0; cc < this.cols; cc++) {
          if (this.grid[rr][cc] === ch) this.grid[rr][cc] = '.';
        }
      }
    }
    this.grid[r][c] = ch;
  }

  /* ---------------- 渲染 ---------------- */
  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const cell = this.cell;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(-this.viewX, -this.viewY);

    // 画布底色
    ctx.fillStyle = '#0d1220';
    ctx.fillRect(0, 0, this.cols * cell, this.rows * cell);

    const c0 = Math.max(0, Math.floor(this.viewX / cell));
    const c1 = Math.min(this.cols - 1, Math.ceil((this.viewX + this.viewW) / cell));
    const r0 = Math.max(0, Math.floor(this.viewY / cell));
    const r1 = Math.min(this.rows - 1, Math.ceil((this.viewY + this.viewH) / cell));

    // 网格线
    if (cell >= 8) {
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      ctx.lineWidth = 1;
      for (let c = c0; c <= c1 + 1; c++) {
        const x = c * cell;
        ctx.beginPath();
        ctx.moveTo(x, r0 * cell);
        ctx.lineTo(x, (r1 + 1) * cell);
        ctx.stroke();
      }
      for (let r = r0; r <= r1 + 1; r++) {
        const y = r * cell;
        ctx.beginPath();
        ctx.moveTo(c0 * cell, y);
        ctx.lineTo((c1 + 1) * cell, y);
        ctx.stroke();
      }
    }

    // 方块
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = this.grid[r][c];
        if (ch === '.') continue;
        this._drawCell(ctx, ch, c * cell, r * cell, cell);
      }
    }

    // 外框
    ctx.strokeStyle = 'rgba(120,160,255,.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, this.cols * cell, this.rows * cell);

    ctx.restore();
  }

  _drawCell(ctx, ch, x, y, cs) {
    const pad = cs > 10 ? 1 : 0;
    const s = cs - pad * 2;
    switch (ch) {
      case '#':
        ctx.fillStyle = '#3d4a6b';
        ctx.fillRect(x + pad, y + pad, s, s);
        ctx.fillStyle = '#7d94c9';
        ctx.fillRect(x + pad, y + pad, s, Math.max(1, s * 0.2));
        break;
      case 'M':
        ctx.fillStyle = '#5b6478';
        ctx.fillRect(x + pad, y + pad, s, s);
        ctx.fillStyle = '#a8b2c8';
        ctx.fillRect(x + pad, y + pad, s, Math.max(1, s * 0.2));
        break;
      case '~':
        ctx.fillStyle = '#7cc8f0';
        ctx.fillRect(x + pad, y + pad, s, s);
        ctx.fillStyle = '#d6f4ff';
        ctx.fillRect(x + pad, y + pad, s, Math.max(1, s * 0.25));
        break;
      case '=':
        ctx.fillStyle = '#2f9d5c';
        ctx.fillRect(x + pad, y + pad + s * 0.45, s, s * 0.55);
        ctx.fillStyle = '#5ce08a';
        ctx.fillRect(x + pad, y + pad + s * 0.15, s, s * 0.35);
        break;
      case '^':
        ctx.fillStyle = '#c9d2ee';
        ctx.beginPath();
        ctx.moveTo(x + cs / 2, y + pad + 1);
        ctx.lineTo(x + cs - pad, y + cs - pad);
        ctx.lineTo(x + pad, y + cs - pad);
        ctx.closePath();
        ctx.fill();
        break;
      case 'o':
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(x + cs / 2, y + cs / 2, Math.max(1.5, s * 0.28), 0, Math.PI * 2);
        ctx.fill();
        break;
      case '*':
        ctx.fillStyle = '#ffe14d';
        ctx.beginPath();
        ctx.arc(x + cs / 2, y + cs / 2, Math.max(2, s * 0.34), 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'S':
        ctx.fillStyle = 'rgba(79,140,255,.3)';
        ctx.fillRect(x + pad, y + pad, s, s);
        ctx.fillStyle = '#4f8cff';
        ctx.fillRect(x + cs / 2 - 1, y + pad + 2, 2, s - 3);
        ctx.beginPath();
        ctx.moveTo(x + cs / 2 + 1, y + pad + 2);
        ctx.lineTo(x + cs - pad - 1, y + pad + s * 0.3);
        ctx.lineTo(x + cs / 2 + 1, y + pad + s * 0.55);
        ctx.closePath();
        ctx.fill();
        break;
      case 'G':
        ctx.fillStyle = 'rgba(34,211,166,.3)';
        ctx.fillRect(x + pad, y + pad, s, s);
        ctx.fillStyle = '#22d3a6';
        ctx.fillRect(x + cs / 2 - 1, y + pad + 2, 2, s - 3);
        ctx.beginPath();
        ctx.moveTo(x + cs / 2 + 1, y + pad + 2);
        ctx.lineTo(x + cs - pad - 1, y + pad + s * 0.3);
        ctx.lineTo(x + cs / 2 + 1, y + pad + s * 0.55);
        ctx.closePath();
        ctx.fill();
        break;
    }
  }
}
