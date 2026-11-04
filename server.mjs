// 超级跳跃工坊 · 服务端（零依赖，只用 Node 内置模块）
// 功能：注册 / 登录 / 头像 / 地图发布与搜索 / 排行榜 / 试玩计数
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const AVATARS = path.join(DATA, 'avatars');
const DB_FILE = path.join(DATA, 'db.json');
const PORT = Number(process.env.PORT || 8787);

fs.mkdirSync(AVATARS, { recursive: true });

/* ---------------- 数据层 ---------------- */
let db = { users: {}, maps: {}, sessions: {} };

function loadDb() {
  if (!fs.existsSync(DB_FILE)) return;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('db.json 读取失败，使用空库：', e.message);
  }
  db.users ||= {};
  db.maps ||= {};
  db.sessions ||= {};
}

let saveTimer = null;
function saveDb() {
  // 合并写入，避免高频写盘
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(db), 'utf8');
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('保存失败：', e.message);
    }
  }, 120);
}
loadDb();

/* ---------------- 工具 ---------------- */
// 地图码字符集：只用 URL 安全的字符，并去掉易混的 l/1/0/o/i
const OK = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LEN = 6;

function newMapCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let s = '';
    const bytes = crypto.randomBytes(CODE_LEN);
    for (let i = 0; i < CODE_LEN; i++) s += OK[bytes[i] % OK.length];
    if (!db.maps[s]) return s;
  }
  throw new Error('地图码生成失败');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function verifyPassword(password, user) {
  const h = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(user.hash, 'hex'));
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        // 去掉可能存在的 UTF-8 BOM，否则 JSON.parse 会失败
        let s = Buffer.concat(chunks).toString('utf8');
        if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
        resolve(JSON.parse(s));
      } catch {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const username = db.sessions[token];
  if (!username || !db.users[username]) return null;
  return db.users[username];
}

function publicUser(u) {
  return {
    username: u.username,
    avatar: u.avatar || null,
    created: u.created,
    maps: Object.values(db.maps).filter((m) => m.author === u.username).length,
  };
}

/* ---------------- 地图校验与难度 ---------------- */
const ALLOWED = new Set(['.', '#', '=', '^', 'o', '*', 'S', 'G', '~', 'M']);
const MAX_COLS = 260;
const MAX_ROWS = 80;
const MIN_COLS = 12;
const MIN_ROWS = 8;

function sanitizeGrid(grid) {
  if (!Array.isArray(grid) || grid.length < MIN_ROWS || grid.length > MAX_ROWS) {
    throw new Error(`行数需在 ${MIN_ROWS}~${MAX_ROWS} 之间`);
  }
  const rows = grid.length;
  let cols = 0;
  const out = [];
  for (const row of grid) {
    if (typeof row !== 'string') throw new Error('网格格式错误');
    cols = Math.max(cols, row.length);
  }
  if (cols < MIN_COLS || cols > MAX_COLS) {
    throw new Error(`列数需在 ${MIN_COLS}~${MAX_COLS} 之间`);
  }
  for (const row of grid) {
    let s = '';
    for (let c = 0; c < cols; c++) {
      const ch = row[c] || '.';
      s += ALLOWED.has(ch) ? ch : '.';
    }
    out.push(s);
  }
  const joined = out.join('');
  const spawns = (joined.match(/S/g) || []).length;
  const goals = (joined.match(/G/g) || []).length;
  if (spawns < 1) throw new Error('地图至少要有一个出生点 S');
  if (goals < 1) throw new Error('地图至少要有一个终点 G');
  return out;
}

/** 自动难度：1~5 星，由机关密度和垂直落差推算 */
function estimateDifficulty(grid) {
  const joined = grid.join('');
  const count = (ch) => (joined.match(new RegExp(`\\${ch}`, 'g')) || []).length;
  const spikes = count('^');
  const gaps = 0; // 空位在下面用逐行统计
  const springs = count('=');
  const rows = grid.length;
  const cols = grid[0].length;

  let empties = 0;
  let platforms = 0;
  let prevSolid = null;
  let heightChanges = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      if (ch === '.') empties++;
      if (ch === '#' || ch === 'M' || ch === '~' || ch === '=') platforms++;
    }
  }
  // 每列最高实体块的高度变化 → 地形起伏
  for (let c = 0; c < cols; c++) {
    let top = -1;
    for (let r = 0; r < rows; r++) {
      const ch = grid[r][c];
      if (ch === '#' || ch === 'M' || ch === '~' || ch === '=') { top = r; break; }
    }
    if (top >= 0) {
      if (prevSolid !== null) heightChanges += Math.abs(top - prevSolid);
      prevSolid = top;
    }
  }

  const total = rows * cols;
  const density = (spikes * 5 + springs * 2 + heightChanges) / Math.max(1, total) * 100;
  const score = spikes * 0.9 + gaps + heightChanges * 0.25 + density * 0.5 + empties / total * 6;

  let stars = 1;
  if (score > 4) stars = 2;
  if (score > 9) stars = 3;
  if (score > 18) stars = 4;
  if (score > 32) stars = 5;
  return stars;
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 找不到');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // 代码类文件不缓存，避免改了代码手机还在跑旧版本
    const noCache = ['.html', '.js', '.css', '.json'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache, must-revalidate' : 'public, max-age=3600',
    });
    res.end(buf);
  });
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);

  if (!p.startsWith('/api/')) return serveStatic(req, res, p);

  try {
    /* ---- 服务信息（给电脑端提示手机访问地址） ---- */
    if (p === '/api/info' && req.method === 'GET') {
      const lan = [];
      for (const list of Object.values(os.networkInterfaces())) {
        for (const n of list || []) {
          if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
        }
      }
      return sendJson(res, 200, {
        port: PORT,
        lan,
        maps: Object.keys(db.maps).length,
        users: Object.keys(db.users).length,
      });
    }

    /* ---- 注册 ---- */
    if (p === '/api/register' && req.method === 'POST') {
      const { username, password } = await readBody(req);
      const u = String(username || '').trim();
      const pw = String(password || '');
      if (!/^[\w\u4e00-\u9fa5]{2,16}$/.test(u)) {
        return sendJson(res, 400, { error: '用户名 2~16 位，可用中文、字母、数字、下划线' });
      }
      if (pw.length < 6 || pw.length > 64) {
        return sendJson(res, 400, { error: '密码长度 6~64 位' });
      }
      if (db.users[u]) return sendJson(res, 409, { error: '这个用户名已被注册' });

      const salt = crypto.randomBytes(16).toString('hex');
      db.users[u] = {
        username: u,
        salt,
        hash: hashPassword(pw, salt),
        avatar: null,
        created: Date.now(),
      };
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = u;
      saveDb();
      return sendJson(res, 200, { token, user: publicUser(db.users[u]) });
    }

    /* ---- 登录 ---- */
    if (p === '/api/login' && req.method === 'POST') {
      const { username, password } = await readBody(req);
      const u = String(username || '').trim();
      const user = db.users[u];
      if (!user) return sendJson(res, 401, { error: '用户名或密码不对' });
      if (!verifyPassword(String(password || ''), user)) {
        return sendJson(res, 401, { error: '用户名或密码不对' });
      }
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = u;
      saveDb();
      return sendJson(res, 200, { token, user: publicUser(user) });
    }

    /* ---- 当前用户 ---- */
    if (p === '/api/me' && req.method === 'GET') {
      const user = authUser(req);
      if (!user) return sendJson(res, 401, { error: '未登录' });
      return sendJson(res, 200, { user: publicUser(user) });
    }

    /* ---- 设置头像（相机抓拍） ---- */
    if (p === '/api/me/avatar' && req.method === 'POST') {
      const user = authUser(req);
      if (!user) return sendJson(res, 401, { error: '未登录' });
      const { image } = await readBody(req);
      if (typeof image !== 'string' || !image.startsWith('data:image/')) {
        return sendJson(res, 400, { error: '头像格式错误' });
      }
      const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(image);
      if (!m) return sendJson(res, 400, { error: '只支持 png/jpeg/webp' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 900 * 1024) return sendJson(res, 400, { error: '图片太大，请压缩' });
      const file = `${encodeURIComponent(user.username)}.png`;
      fs.writeFileSync(path.join(AVATARS, file), buf);
      user.avatar = `/api/avatar/${encodeURIComponent(user.username)}`;
      saveDb();
      return sendJson(res, 200, { user: publicUser(user) });
    }

    /* ---- 读头像 ---- */
    if (p.startsWith('/api/avatar/') && req.method === 'GET') {
      const name = decodeURIComponent(p.slice('/api/avatar/'.length));
      const file = path.join(AVATARS, `${encodeURIComponent(name)}.png`);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: '没有头像' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' });
      return res.end(fs.readFileSync(file));
    }

    /* ---- 发布地图 ---- */
    if (p === '/api/maps' && req.method === 'POST') {
      const user = authUser(req);
      if (!user) return sendJson(res, 401, { error: '请先登录再发布' });
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 24) || '无名地图';
      let grid;
      try {
        grid = sanitizeGrid(body.grid);
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
      const code = newMapCode();
      db.maps[code] = {
        code,
        name,
        author: user.username,
        grid,
        difficulty: estimateDifficulty(grid),
        plays: 0,
        clears: 0,
        likes: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveDb();
      return sendJson(res, 200, { code, difficulty: db.maps[code].difficulty });
    }

    /* ---- 地图列表 / 搜索 ---- */
    if (p === '/api/maps' && req.method === 'GET') {
      const sort = url.searchParams.get('sort') || 'plays';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const limit = Math.min(100, Number(url.searchParams.get('limit')) || 50);

      let list = Object.values(db.maps);
      if (q) {
        list = list.filter(
          (m) =>
            m.code.toLowerCase() === q ||
            m.code.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            m.author.toLowerCase().includes(q)
        );
      }
      if (sort === 'difficulty') {
        list.sort((a, b) => b.difficulty - a.difficulty || b.plays - a.plays);
      } else if (sort === 'new') {
        list.sort((a, b) => b.createdAt - a.createdAt);
      } else {
        list.sort((a, b) => b.plays - a.plays || b.createdAt - a.createdAt);
      }
      return sendJson(
        res,
        200,
        {
          total: list.length,
          maps: list.slice(0, limit).map((m) => ({
            code: m.code,
            name: m.name,
            author: m.author,
            difficulty: m.difficulty,
            plays: m.plays,
            clears: m.clears,
            cols: m.grid[0].length,
            rows: m.grid.length,
            createdAt: m.createdAt,
          })),
        }
      );
    }

    /* ---- 单张地图（含网格） ---- */
    const mMap = /^\/api\/maps\/([a-z0-9]+)$/i.exec(p);
    if (mMap && req.method === 'GET') {
      const m = db.maps[mMap[1]];
      if (!m) return sendJson(res, 404, { error: '找不到这张地图' });
      return sendJson(res, 200, m);
    }

    /* ---- 试玩计数 ---- */
    const mPlay = /^\/api\/maps\/([a-z0-9]+)\/play$/i.exec(p);
    if (mPlay && req.method === 'POST') {
      const m = db.maps[mPlay[1]];
      if (!m) return sendJson(res, 404, { error: '找不到这张地图' });
      const body = await readBody(req);
      // 开局上报是「一次试玩」，通关上报只加通关数，避免重复计数
      if (!body || body.countPlay !== false) m.plays++;
      if (body && body.cleared) m.clears++;
      saveDb();
      return sendJson(res, 200, { plays: m.plays, clears: m.clears });
    }

    /* ---- 删除自己的地图 ---- */
    if (mMap && req.method === 'DELETE') {
      const user = authUser(req);
      if (!user) return sendJson(res, 401, { error: '未登录' });
      const m = db.maps[mMap[1]];
      if (!m) return sendJson(res, 404, { error: '找不到这张地图' });
      if (m.author !== user.username) return sendJson(res, 403, { error: '只能删自己的地图' });
      delete db.maps[mMap[1]];
      saveDb();
      return sendJson(res, 200, { ok: true });
    }

    /* ---- 排行榜 ---- */
    if (p === '/api/leaderboard' && req.method === 'GET') {
      const sort = url.searchParams.get('sort') || 'plays';
      const list = Object.values(db.maps);
      const total = list
        .sort((a, b) => b.plays - a.plays || b.createdAt - a.createdAt)
        .slice(0, 20)
        .map((m) => ({ code: m.code, name: m.name, author: m.author, plays: m.plays, difficulty: m.difficulty }));
      const byDiff = list
        .slice()
        .sort((a, b) => b.difficulty - a.difficulty || b.plays - a.plays)
        .slice(0, 20)
        .map((m) => ({ code: m.code, name: m.name, author: m.author, plays: m.plays, difficulty: m.difficulty }));
      return sendJson(res, 200, { plays: total, difficulty: byDiff, totalMaps: list.length });
    }

    return sendJson(res, 404, { error: '接口不存在' });
  } catch (e) {
    console.error('API 错误：', e);
    return sendJson(res, 500, { error: e.message || '服务器错误' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) nets.push(n.address);
    }
  }
  console.log(`\n超级跳跃工坊已启动`);
  console.log(`  本机:   http://localhost:${PORT}`);
  for (const ip of nets) console.log(`  局域网: http://${ip}:${PORT}`);
  console.log('');
});
