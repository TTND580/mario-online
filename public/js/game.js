// 超级跳跃工坊 · 游戏引擎
// 物理参数取自「派对制造」：GRAV 1750 / RUN 265 / JUMPV -640
// 新增：二段跳、攀墙、反墙跳；固定 17ms 步进

export const TILE = 32;
export const FIXED_DT = 0.017; // 1 帧 = 17ms（约 58.8 fps）

const P = {
  GRAV: 1750,
  MAXFALL: 1050,
  RUN: 265,
  ACC: 2600,
  FRIC: 2400,
  JUMPV: -640,
  DOUBLE_JUMP_MUL: 0.92,
  MAX_JUMPS: 2,
  WALL_SLIDE: 150,   // 贴墙下滑速度上限
  WALL_CLIMB: -168,  // 攀墙上升速度
  CLIMB_STAMINA: 1.15, // 每次贴墙可攀爬秒数
  WALL_JUMP_X: 330,
  WALL_JUMP_Y: -565,
  SPRING: -1000,
  COYOTE: 0.09,      // 离开平台后仍可起跳的宽限
};

const SOLID_CH = { '#': 1, '=': 1, '~': 1, 'M': 1 };
const isSolidCh = (ch) => !!SOLID_CH[ch];

/* ================= 关卡 ================= */
export function parseLevel(data) {
  const grid = data.grid || [];
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  const coins = [];
  const stars = [];
  const spikes = [];
  const springs = [];
  let spawn = null;
  let goal = null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      const x = c * TILE;
      const y = r * TILE;
      if (ch === 'S') spawn = { x: x + (TILE - 24) / 2, y: y + TILE - 30 };
      else if (ch === 'o') coins.push({ x: x + TILE / 2, y: y + TILE / 2, taken: false, t: Math.random() * 6 });
      else if (ch === '*') stars.push({ x: x + TILE / 2, y: y + TILE / 2, taken: false, t: Math.random() * 6 });
      else if (ch === '^') spikes.push({ x: x + 3, y: y + 16, w: TILE - 6, h: TILE - 16 });
      else if (ch === '=') springs.push({ x, y, w: TILE, h: TILE, anim: 0 });
      else if (ch === 'G') goal = { x: x + 4, y: y - TILE, w: TILE - 8, h: TILE * 2 };
    }
  }

  return {
    name: data.name || '未命名',
    code: data.code || '',
    author: data.author || '',
    grid, rows, cols,
    spawn: spawn || { x: TILE, y: TILE * Math.max(1, rows - 2) },
    goal, coins, stars, spikes, springs,
    pxW: cols * TILE,
    pxH: rows * TILE,

    at(c, r) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return '.';
      return grid[r][c];
    },
    solidAt(c, r) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
      return isSolidCh(grid[r][c]);
    },
  };
}

/* ================= 输入 ================= */
export class Input {
  constructor() {
    this.left = false;
    this.right = false;
    this.jump = false;
    this.jumpQueued = false;
    this.jumpHeld = false;
  }
  get x() {
    return (this.right ? 1 : 0) - (this.left ? 1 : 0);
  }
  pressJump() {
    if (!this.jumpHeld) this.jumpQueued = true;
    this.jumpHeld = true;
  }
  releaseJump() {
    this.jumpHeld = false;
  }
  consumeJump() {
    const q = this.jumpQueued;
    this.jumpQueued = false;
    return q;
  }
  reset() {
    this.left = this.right = this.jump = this.jumpHeld = this.jumpQueued = false;
  }
}

/* ================= 角色 ================= */
export class Player {
  constructor(x, y) {
    this.w = 24;
    this.h = 30;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.onIce = false;
    this.onSpring = false;
    this.jumps = P.MAX_JUMPS;
    this.facing = 1;
    this.coyote = 0;
    this.climbStamina = P.CLIMB_STAMINA;
    this.wall = 0;        // -1 左墙 / 1 右墙 / 0 无
    this.wallSliding = false;
    this.climbing = false;
    this.squash = 1;
    this.anim = 0;
    this.dead = false;
    this.won = false;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  probeWalls(lv) {
    const eps = 2;
    const r0 = Math.floor((this.y + this.h * 0.25) / TILE);
    const r1 = Math.floor((this.y + this.h * 0.75) / TILE);
    const solidCol = (px) => {
      const c = Math.floor(px / TILE);
      for (let r = r0; r <= r1; r++) if (lv.solidAt(c, r)) return true;
      return false;
    };
    const leftHit = solidCol(this.x - eps);
    const rightHit = solidCol(this.x + this.w + eps);
    if (leftHit && !rightHit) return -1;
    if (rightHit && !leftHit) return 1;
    if (this.vx > 0 && rightHit) return 1;
    if (this.vx < 0 && leftHit) return -1;
    return 0;
  }

  step(dt, lv, input) {
    const wantJump = input.consumeJump();
    const ix = input.x;

    /* --- 水平加速 --- */
    if (ix !== 0) {
      const target = ix * P.RUN;
      const acc = (this.onGround ? P.ACC : P.ACC * 0.78) * dt;
      if (Math.abs(target - this.vx) <= acc) this.vx = target;
      else this.vx += Math.sign(target - this.vx) * acc;
      this.facing = ix > 0 ? 1 : -1;
    } else {
      const f = (this.onGround ? (this.onIce ? P.FRIC * 0.09 : P.FRIC) : P.FRIC * 0.3) * dt;
      if (Math.abs(this.vx) <= f) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * f;
    }

    /* --- 墙面 --- */
    this.wall = this.onGround ? 0 : this.probeWalls(lv);
    const pressingIntoWall = this.wall !== 0 && ix === this.wall;

    this.wallSliding = false;
    this.climbing = false;

    if (this.wall !== 0 && !this.onGround && pressingIntoWall) {
      if (this.climbStamina > 0 && this.vy > -200) {
        // 攀墙：贴住墙往上爬
        this.climbing = true;
        this.climbStamina -= dt;
        this.vy = P.WALL_CLIMB;
      } else {
        // 体力耗尽 → 下滑
        this.wallSliding = true;
        if (this.vy > P.WALL_SLIDE) this.vy = P.WALL_SLIDE;
      }
    }

    /* --- 跳跃 --- */
    if (this.onGround) {
      this.jumps = P.MAX_JUMPS;
      this.coyote = P.COYOTE;
      this.climbStamina = P.CLIMB_STAMINA;
    } else if (this.coyote > 0) {
      this.coyote -= dt;
    }

    if (wantJump) {
      if (this.wall !== 0 && !this.onGround) {
        // 反墙跳：朝反方向弹开，并刷新二段跳
        this.vx = -this.wall * P.WALL_JUMP_X;
        this.vy = P.WALL_JUMP_Y;
        this.jumps = P.MAX_JUMPS - 1;
        this.climbStamina = P.CLIMB_STAMINA;
        this.facing = -this.wall;
        this.squash = 1.3;
        this.wall = 0;
        // 必须清掉攀爬状态，否则下面的攀爬加速会把反墙跳的速度覆盖掉
        this.climbing = false;
        this.wallSliding = false;
      } else if (this.onGround || this.coyote > 0) {
        this.vy = P.JUMPV;
        this.onGround = false;
        this.coyote = 0;
        this.jumps = P.MAX_JUMPS - 1;
        this.squash = 1.25;
      } else if (this.jumps > 0) {
        // 二段跳
        this.jumps--;
        this.vy = P.JUMPV * P.DOUBLE_JUMP_MUL;
        this.squash = 1.25;
      }
    }

    // 松开跳跃键提前收力，实现长按跳更高
    if (!input.jumpHeld && this.vy < -180) this.vy = -180;
    if (input.jumpHeld && this.climbing) this.vy = P.WALL_CLIMB * 1.35;

    /* --- 重力 --- */
    this.vy += P.GRAV * dt * (this.onGround ? 1 : 1.12);
    if (this.vy > P.MAXFALL) this.vy = P.MAXFALL;

    /* --- 位移与碰撞 --- */
    this.moveAndCollide(lv, dt);

    if (this.onSpring) {
      this.vy = P.SPRING;
      this.onGround = false;
      this.squash = 1.4;
      this.jumps = P.MAX_JUMPS;
    }

    /* --- 动画 --- */
    this.squash += (1 - this.squash) * Math.min(1, dt * 12);
    if (this.onGround && Math.abs(this.vx) > 25) this.anim += dt * (4 + Math.abs(this.vx) / 55);
    else if (this.onGround) this.anim += dt * 1.6;
    else this.anim += dt * 2.2;
  }

  moveAndCollide(lv, dt) {
    /* X 轴 */
    this.x += this.vx * dt;
    let c0 = Math.floor(this.x / TILE);
    let c1 = Math.floor((this.x + this.w - 0.01) / TILE);
    let r0 = Math.floor(this.y / TILE);
    let r1 = Math.floor((this.y + this.h - 0.01) / TILE);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!lv.solidAt(c, r)) continue;
        if (this.vx > 0) this.x = c * TILE - this.w;
        else if (this.vx < 0) this.x = (c + 1) * TILE;
        this.vx = 0;
        c0 = Math.floor(this.x / TILE);
        c1 = Math.floor((this.x + this.w - 0.01) / TILE);
      }
    }

    /* Y 轴 */
    this.y += this.vy * dt;
    this.onGround = false;
    this.onIce = false;
    this.onSpring = false;
    r0 = Math.floor(this.y / TILE);
    r1 = Math.floor((this.y + this.h - 0.01) / TILE);
    c0 = Math.floor(this.x / TILE);
    c1 = Math.floor((this.x + this.w - 0.01) / TILE);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!lv.solidAt(c, r)) continue;
        const ch = lv.at(c, r);
        if (this.vy > 0) {
          this.y = r * TILE - this.h;
          this.vy = 0;
          this.onGround = true;
          if (ch === '~') this.onIce = true;
          if (ch === '=') this.onSpring = true;
        } else if (this.vy < 0) {
          this.y = (r + 1) * TILE;
          this.vy = 0;
        }
        r0 = Math.floor(this.y / TILE);
        r1 = Math.floor((this.y + this.h - 0.01) / TILE);
      }
    }
  }
}

/* ================= 游戏主类 ================= */
export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.input = new Input();
    this.level = null;
    this.player = null;
    this.particles = [];
    this.camera = { x: 0, y: 0 };
    this.running = false;
    this.paused = false;
    this.acc = 0;
    this.last = 0;
    this.time = 0;
    this.coins = 0;
    this.deaths = 0;
    this.heroImg = null;
    this.heroReady = false;
    this.viewW = 640;
    this.viewH = 360;
    this.scale = 1;
    this._loadHero();
    this._bindResize();
  }

  _loadHero() {
    const img = new Image();
    img.onload = () => { this.heroReady = true; };
    img.onerror = () => { this.heroReady = false; };
    img.src = '/assets/hero.png';
    this.heroImg = img;
  }

  _bindResize() {
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    window.addEventListener('orientationchange', () => setTimeout(this._resize, 120));
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);

    const aspect = cw / ch;
    let LW = 360 * aspect;
    let LH = 360;
    if (LW < 520) { LW = 520; LH = LW / aspect; }
    if (LW > 1150) { LW = 1150; LH = LW / aspect; }
    this.viewW = LW;
    this.viewH = LH;
    this.scale = (cw * dpr) / LW;
    this.dpr = dpr;
  }

  load(levelData) {
    this.level = parseLevel(levelData);
    this.player = new Player(this.level.spawn.x, this.level.spawn.y);
    this.particles = [];
    this.time = 0;
    this.coins = 0;
    this.deaths = 0;
    this.paused = false;
    this.camera.x = this.player.cx - this.viewW / 2;
    this.camera.y = this.player.cy - this.viewH / 2;
    this._clampCamera();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25;
      if (!this.paused) {
        this.acc += dt;
        let guard = 0;
        while (this.acc >= FIXED_DT && guard++ < 5) {
          this.update(FIXED_DT);
          this.acc -= FIXED_DT;
        }
      }
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    window.removeEventListener('resize', this._resize);
  }

  respawn() {
    const p = this.player;
    p.x = this.level.spawn.x;
    p.y = this.level.spawn.y;
    p.vx = p.vy = 0;
    p.jumps = P.MAX_JUMPS;
    p.climbStamina = P.CLIMB_STAMINA;
    p.dead = false;
    this.deaths++;
    this.camera.x = p.cx - this.viewW / 2;
    this.camera.y = p.cy - this.viewH / 2;
    this._clampCamera();
    this.hooks.onDeath?.(this.deaths);
  }

  burst(x, y, color, n = 10, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
        life: 0.45 + Math.random() * 0.35, max: 0.8, color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  update(dt) {
    const lv = this.level;
    const p = this.player;
    if (!lv || !p || p.won) return;

    this.time += dt;
    p.step(dt, lv, this.input);

    /* 掉出地图 */
    if (p.y > lv.pxH + 260 || p.x < -200 || p.x > lv.pxW + 200) {
      this.respawn();
      return;
    }

    /* 金币 / 星星 */
    for (const c of lv.coins) {
      if (c.taken) continue;
      c.t += dt;
      if (Math.abs(c.x - p.cx) < 16 + p.w / 2 && Math.abs(c.y - p.cy) < 16 + p.h / 2) {
        c.taken = true; this.coins++;
        this.burst(c.x, c.y, '#ffd23f', 8, 170);
        this.hooks.onCoin?.(this.coins);
      }
    }
    for (const s of lv.stars) {
      if (s.taken) continue;
      s.t += dt;
      if (Math.abs(s.x - p.cx) < 18 + p.w / 2 && Math.abs(s.y - p.cy) < 18 + p.h / 2) {
        s.taken = true; this.coins += 5;
        this.burst(s.x, s.y, '#ffe14d', 16, 240);
        this.hooks.onCoin?.(this.coins);
      }
    }

    /* 弹簧动画 */
    for (const sp of lv.springs) {
      if (sp.anim > 0) sp.anim -= dt * 4;
      if (p.onSpring && Math.abs(sp.y + sp.h - (p.y + p.h)) < 6 && Math.abs(sp.x + TILE / 2 - p.cx) < TILE) {
        sp.anim = 1;
      }
    }

    /* 尖刺 */
    for (const s of lv.spikes) {
      if (
        p.x < s.x + s.w && p.x + p.w > s.x &&
        p.y < s.y + s.h && p.y + p.h > s.y + 4
      ) {
        this.burst(p.cx, p.cy, '#ff5c6a', 20, 300);
        this.respawn();
        return;
      }
    }

    /* 终点 */
    if (lv.goal) {
      const g = lv.goal;
      if (p.x < g.x + g.w && p.x + p.w > g.x && p.y < g.y + g.h && p.y + p.h > g.y) {
        p.won = true;
        this.burst(g.x + g.w / 2, g.y + g.h / 2, '#22d3a6', 30, 320);
        this.hooks.onWin?.({ time: this.time, coins: this.coins, deaths: this.deaths });
      }
    }

    /* 粒子 */
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) { this.particles.splice(i, 1); continue; }
      q.vy += 900 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }

    /* 相机 */
    const tx = p.cx - this.viewW / 2 + p.facing * 40;
    const ty = p.cy - this.viewH * 0.55;
    this.camera.x += (tx - this.camera.x) * Math.min(1, dt * 7);
    this.camera.y += (ty - this.camera.y) * Math.min(1, dt * 7);
    this._clampCamera();
  }

  _clampCamera() {
    const lv = this.level;
    if (!lv) return;
    const maxX = Math.max(0, lv.pxW - this.viewW);
    const maxY = Math.max(0, lv.pxH - this.viewH);
    this.camera.x = Math.max(0, Math.min(maxX, this.camera.x));
    this.camera.y = Math.max(0, Math.min(maxY, this.camera.y));
  }

  /* ---------------- 渲染 ---------------- */
  render() {
    const ctx = this.ctx;
    const lv = this.level;
    if (!lv) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const camX = Math.round(this.camera.x);
    const camY = Math.round(this.camera.y);
    ctx.save();
    ctx.translate(-camX, -camY);

    this.drawBackground(ctx, camX, camY);
    this.drawTiles(ctx, lv, camX, camY);
    this.drawEntities(ctx, lv);
    this.drawPlayer(ctx);
    this.drawParticles(ctx);

    ctx.restore();
  }

  drawBackground(ctx, camX, camY) {
    const W = this.viewW;
    const H = this.viewH;
    const g = ctx.createLinearGradient(0, camY, 0, camY + H);
    g.addColorStop(0, '#1a2547');
    g.addColorStop(0.55, '#121a33');
    g.addColorStop(1, '#0a0e1a');
    ctx.fillStyle = g;
    ctx.fillRect(camX, camY, W, H);

    // 远景星点
    ctx.save();
    ctx.globalAlpha = 0.5;
    const starOff = (-camX * 0.15) % 280;
    for (let i = 0; i < 26; i++) {
      const sx = camX + ((i * 97 + starOff + 280) % (W + 60)) - 30;
      const sy = camY + ((i * 53) % Math.max(40, H * 0.6)) + 14;
      ctx.fillStyle = i % 3 === 0 ? '#9fd4ff' : '#5a6f9c';
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.restore();

    //  parallax 山形
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#1e2b52';
    const hillOff = (-camX * 0.35) % 420;
    const baseY = camY + H * 0.72;
    for (let k = -1; k < Math.ceil(W / 420) + 2; k++) {
      const bx = camX + k * 420 + hillOff;
      ctx.beginPath();
      ctx.moveTo(bx, baseY + 120);
      ctx.lineTo(bx + 130, baseY - 90);
      ctx.lineTo(bx + 250, baseY + 40);
      ctx.lineTo(bx + 360, baseY - 60);
      ctx.lineTo(bx + 470, baseY + 120);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawTiles(ctx, lv, camX, camY) {
    const c0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const c1 = Math.min(lv.cols - 1, Math.ceil((camX + this.viewW) / TILE) + 1);
    const r0 = Math.max(0, Math.floor(camY / TILE) - 1);
    const r1 = Math.min(lv.rows - 1, Math.ceil((camY + this.viewH) / TILE) + 1);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = lv.at(c, r);
        if (ch === '.' || ch === 'S' || ch === 'G' || ch === 'o' || ch === '*') continue;
        const x = c * TILE;
        const y = r * TILE;
        const above = lv.at(c, r - 1);
        const topOpen = !isSolidCh(above);

        if (ch === '#' || ch === 'M') {
          const metal = ch === 'M';
          ctx.fillStyle = metal ? '#5b6478' : '#3d4a6b';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = metal ? '#7d879c' : '#556890';
          ctx.fillRect(x, y, TILE, 3);
          if (topOpen) {
            ctx.fillStyle = metal ? '#a8b2c8' : '#7d94c9';
            ctx.fillRect(x, y, TILE, 6);
            ctx.fillStyle = metal ? '#c9d3e8' : '#a3bce8';
            ctx.fillRect(x, y, TILE, 2);
          }
          ctx.fillStyle = 'rgba(0,0,0,.18)';
          ctx.fillRect(x, y + TILE - 2, TILE, 2);
        } else if (ch === '~') {
          ctx.fillStyle = '#7cc8f0';
          ctx.fillRect(x, y, TILE, TILE);
          if (topOpen) {
            ctx.fillStyle = '#d6f4ff';
            ctx.fillRect(x, y, TILE, 6);
          }
          ctx.fillStyle = 'rgba(255,255,255,.25)';
          ctx.fillRect(x + 4, y + 10, 8, 3);
        } else if (ch === '^') {
          ctx.fillStyle = '#c9d2ee';
          for (let i = 0; i < 3; i++) {
            const sx = x + i * (TILE / 3);
            ctx.beginPath();
            ctx.moveTo(sx, y + TILE);
            ctx.lineTo(sx + TILE / 6, y + 16);
            ctx.lineTo(sx + TILE / 3, y + TILE);
            ctx.closePath();
            ctx.fill();
          }
          ctx.fillStyle = '#8d97b8';
          ctx.fillRect(x, y + TILE - 4, TILE, 4);
        } else if (ch === '=') {
          const sp = lv.springs.find((s) => s.x === x && s.y === y);
          const press = sp ? Math.max(0, sp.anim) : 0;
          const h = TILE * 0.45 * (1 - press * 0.5);
          ctx.fillStyle = '#2f9d5c';
          ctx.fillRect(x + 4, y + TILE - 6, TILE - 8, 6);
          ctx.fillStyle = '#5ce08a';
          ctx.fillRect(x + 4, y + TILE - 6 - h, TILE - 8, h);
          ctx.fillStyle = '#8ff5b0';
          ctx.fillRect(x + 4, y + TILE - 6 - h, TILE - 8, 3);
        }
      }
    }
  }

  drawEntities(ctx, lv) {
    const t = this.time;
    for (const c of lv.coins) {
      if (c.taken) continue;
      const bob = Math.sin(t * 3 + c.t) * 2.5;
      const squish = Math.abs(Math.cos(t * 2.4 + c.t));
      ctx.save();
      ctx.translate(c.x, c.y + bob);
      ctx.scale(0.35 + squish * 0.65, 1);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe98a';
      ctx.beginPath();
      ctx.arc(-2, -2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const s of lv.stars) {
      if (s.taken) continue;
      const bob = Math.sin(t * 2.6 + s.t) * 3;
      ctx.save();
      ctx.translate(s.x, s.y + bob);
      ctx.rotate(t * 1.4 + s.t);
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? 12 : 5;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (lv.goal) {
      const g = lv.goal;
      const px = g.x + g.w / 2;
      const base = g.y + g.h;
      ctx.fillStyle = '#c8ced9';
      ctx.fillRect(px - 2, g.y + 6, 4, g.h - 6);
      ctx.fillStyle = '#22d3a6';
      const wave = Math.sin(t * 4) * 3;
      ctx.beginPath();
      ctx.moveTo(px + 2, g.y + 8);
      ctx.lineTo(px + 30 + wave, g.y + 20);
      ctx.lineTo(px + 2, g.y + 32);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(34,211,166,.18)';
      ctx.beginPath();
      ctx.arc(px, base - 20, 30 + Math.sin(t * 3) * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPlayer(ctx) {
    const p = this.player;
    if (!p) return;
    const sq = p.squash;
    const w = p.w * (2 - sq);
    const h = p.h * sq;
    const cx = p.cx;
    const bottom = p.y + p.h;

    ctx.save();

    /* 有外部贴图就用贴图，否则程序化绘制 */
    if (this.heroReady && this.heroImg.width) {
      ctx.translate(cx, bottom);
      ctx.scale(p.facing === 1 ? 1 : -1, 1);
      const bob = p.onGround && Math.abs(p.vx) > 25 ? Math.sin(p.anim * 3) * 1.5 : 0;
      ctx.drawImage(this.heroImg, -w / 2, -h + bob, w, h);
      ctx.restore();
      return;
    }

    const left = cx - w / 2;
    const top = bottom - h;
    const bob = p.onGround && Math.abs(p.vx) > 25 ? Math.sin(p.anim * 3) * 1.2 : 0;

    // 脚
    ctx.fillStyle = '#2b8a63';
    const stepPhase = Math.sin(p.anim * 3);
    if (p.onGround) {
      ctx.beginPath();
      ctx.ellipse(left + w * 0.3, bottom - 1, w * 0.17, 2.6, 0, 0, Math.PI * 2);
      ctx.ellipse(left + w * 0.7, bottom - 1, w * 0.17, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(left + w * 0.34, bottom - 2 + stepPhase * 2, w * 0.15, 2.4, 0, 0, Math.PI * 2);
      ctx.ellipse(left + w * 0.66, bottom - 2 - stepPhase * 2, w * 0.15, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 身体（径向渐变做出体积感）
    const bodyGrad = ctx.createRadialGradient(
      left + w * 0.36, top + h * 0.26, 2,
      cx, top + h * 0.55, w * 0.95
    );
    if (p.climbing) {
      bodyGrad.addColorStop(0, '#c8ffe0');
      bodyGrad.addColorStop(1, '#38c98d');
    } else {
      bodyGrad.addColorStop(0, '#a8f7c9');
      bodyGrad.addColorStop(0.5, '#5ad1a0');
      bodyGrad.addColorStop(1, '#2f9469');
    }

    const rTop = Math.min(w, h) * 0.46;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(left, top + bob, w, h, [rTop, rTop, Math.min(w, h) * 0.28, Math.min(w, h) * 0.28]);
    } else {
      ctx.rect(left, top + bob, w, h);
    }
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // 描边
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(12,60,42,.55)';
    ctx.stroke();

    // 高光
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(left + w * 0.34, top + h * 0.2 + bob, w * 0.16, h * 0.12, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 腮红
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ff9aa8';
    ctx.beginPath();
    ctx.ellipse(left + w * 0.18, top + h * 0.62 + bob, w * 0.11, h * 0.07, 0, 0, Math.PI * 2);
    ctx.ellipse(left + w * 0.82, top + h * 0.62 + bob, w * 0.11, h * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 眼睛（带眨眼）
    const blink = p.onGround && Math.abs(p.vx) < 20 ? (Math.sin(this.time * 1.7) > 0.965 ? 0.15 : 1) : 1;
    const eyeY = top + h * 0.42 + bob;
    const eyeDX = w * 0.16;
    const eyeR = Math.max(2.4, w * 0.115);
    const look = p.facing * w * 0.04;

    for (const dir of [-1, 1]) {
      const ex = cx + dir * eyeDX + look;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#123027';
      ctx.beginPath();
      ctx.ellipse(ex + dir * 0.6, eyeY + 0.3, eyeR * 0.52, eyeR * 0.62 * blink, 0, 0, Math.PI * 2);
      ctx.fill();

      if (blink > 0.5) {
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.beginPath();
        ctx.arc(ex - eyeR * 0.28, eyeY - eyeR * 0.32, eyeR * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 嘴
    if (blink > 0.5) {
      ctx.strokeStyle = 'rgba(18,48,39,.75)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(cx + look, eyeY + h * 0.17, w * 0.09, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    ctx.restore();

    // 攀墙提示
    if (p.climbing) {
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(this.time * 12) * 0.15;
      ctx.fillStyle = '#8ff5b0';
      const wx = p.wall === 1 ? p.x + p.w : p.x - 3;
      ctx.fillRect(wx - 1, p.y + 5, 3.5, p.h - 10);
      ctx.restore();
    }

    // 体力条（贴墙时显示）
    if (p.climbing || p.wallSliding) {
      const ratio = Math.max(0, p.climbStamina / P.CLIMB_STAMINA);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(cx - 11, p.y - 8, 22, 3);
      ctx.fillStyle = ratio > 0.3 ? '#8ff5b0' : '#ffb020';
      ctx.fillRect(cx - 11, p.y - 8, 22 * ratio, 3);
      ctx.restore();
    }
  }

  drawParticles(ctx) {
    for (const q of this.particles) {
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;
  }
}
