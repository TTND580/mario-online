// 地图工坊编辑器：整图铺满屏幕，手指点画
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

export class Editor {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.cols = EDIT_COLS;
    this.rows = EDIT_ROWS;
    this.tool = '#';
    this.grid = this.blank();
    this.painting = false;
    this.lastCell = null;
    this.dpr = 1;
    this.cellSize = 20;
    this.offsetX = 0;
    this.offsetY = 0;
    this._bindEvents();
    this.resize();
  }

  blank() {
    const g = [];
    for (let r = 0; r < this.rows; r++) g.push(new Array(this.cols).fill('.'));
    // 预置一条地面 + 出生点 + 终点，保证一进来就能发布
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
    this.resize();
    this.draw();
  }

  clear() {
    this.grid = this.blank();
    this.draw();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);

    // 留出底部工具栏空间
    const toolbar = document.getElementById('editToolbar');
    const tbH = toolbar ? toolbar.offsetHeight : 130;
    const usableH = ch - tbH - 8;
    const usableW = cw - 12;

    const cell = Math.min(usableW / this.cols, usableH / this.rows);
    this.cellSize = Math.max(4, cell);
    this.offsetX = (cw - this.cellSize * this.cols) / 2;
    this.offsetY = Math.max(4, (usableH - this.cellSize * this.rows) / 2) + 4;
    this.draw();
  }

  _cellFromEvent(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const c = Math.floor((px - this.offsetX) / this.cellSize);
    const r = Math.floor((py - this.offsetY) / this.cellSize);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;
    return { c, r };
  }

  _paintAt(cell) {
    if (!cell) return;
    const { c, r } = cell;
    if (this.tool === 'S') {
      // 出生点唯一
      for (let rr = 0; rr < this.rows; rr++)
        for (let cc = 0; cc < this.cols; cc++)
          if (this.grid[rr][cc] === 'S') this.grid[rr][cc] = '.';
    }
    if (this.tool === 'G') {
      for (let rr = 0; rr < this.rows; rr++)
        for (let cc = 0; cc < this.cols; cc++)
          if (this.grid[rr][cc] === 'G') this.grid[rr][cc] = '.';
    }
    this.grid[r][c] = this.tool;
    this.draw();
  }

  _bindEvents() {
    const start = (ev) => {
      ev.preventDefault();
      this.painting = true;
      this.lastCell = null;
      const cell = this._cellFromEvent(ev);
      this._paintAt(cell);
      this.lastCell = cell;
    };
    const move = (ev) => {
      if (!this.painting) return;
      ev.preventDefault();
      const cell = this._cellFromEvent(ev);
      if (!cell) return;
      if (this.lastCell && this.lastCell.c === cell.c && this.lastCell.r === cell.r) return;
      this._paintAt(cell);
      this.lastCell = cell;
    };
    const end = () => {
      this.painting = false;
      this.lastCell = null;
    };

    this.canvas.addEventListener('pointerdown', start);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('pointerleave', end);
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const cs = this.cellSize;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 背景
    ctx.fillStyle = '#0d1220';
    ctx.fillRect(this.offsetX, this.offsetY, cs * this.cols, cs * this.rows);

    // 网格线
    if (cs >= 9) {
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.lineWidth = 1;
      for (let c = 0; c <= this.cols; c++) {
        const x = this.offsetX + c * cs;
        ctx.beginPath();
        ctx.moveTo(x, this.offsetY);
        ctx.lineTo(x, this.offsetY + cs * this.rows);
        ctx.stroke();
      }
      for (let r = 0; r <= this.rows; r++) {
        const y = this.offsetY + r * cs;
        ctx.beginPath();
        ctx.moveTo(this.offsetX, y);
        ctx.lineTo(this.offsetX + cs * this.cols, y);
        ctx.stroke();
      }
    }

    // 方块
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        if (ch === '.') continue;
        const x = this.offsetX + c * cs;
        const y = this.offsetY + r * cs;
        this._drawCell(ctx, ch, x, y, cs);
      }
    }

    // 外框
    ctx.strokeStyle = 'rgba(120,160,255,.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(this.offsetX, this.offsetY, cs * this.cols, cs * this.rows);
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
