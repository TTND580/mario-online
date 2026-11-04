// 超级跳跃工坊 · 前端主控
import { api, state, setToken } from './net.js';
import { Game } from './game.js';
import { Editor, PALETTE } from './editor.js';

const $ = (id) => document.getElementById(id);
const screens = ['home', 'auth', 'levels', 'leaderboard', 'profile', 'game', 'editor'];

/* ================= 基础 UI ================= */
let toastTimer = null;
function toast(msg, ms = 1900) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const NAV_CFG = {
  home: { top: false, tab: true, title: '首页' },
  auth: { top: true, tab: true, title: '账号' },
  levels: { top: true, tab: true, title: '地图' },
  leaderboard: { top: true, tab: true, title: '排行榜' },
  profile: { top: true, tab: true, title: '我的' },
  game: { top: false, tab: false, title: '' },
  editor: { top: false, tab: false, title: '' },
};

let current = 'home';

function showScreen(name) {
  if (!screens.includes(name)) return;
  current = name;
  for (const s of screens) {
    const el = $(`screen-${s}`);
    if (el) el.classList.toggle('hidden', s !== name);
  }
  const cfg = NAV_CFG[name];
  $('topbar').classList.toggle('hidden', !cfg.top);
  $('tabbar').classList.toggle('hidden', !cfg.tab);
  $('topTitle').textContent = cfg.title;
  document.querySelectorAll('#tabbar .tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.go === name);
  });
  if (name === 'levels') loadLevels();
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'profile') renderProfile();
  if (name === 'editor') enterEditor();
}

/* ================= 手机限制 ================= */
async function checkDevice() {
  const isMobile =
    /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|MicroMessenger/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints || 0) > 1;
  const bypass = location.search.includes('pc=1');

  // 桌面调试模式下去掉 viewport 声明，否则部分浏览器会按手机宽度缩放
  if (bypass) {
    const mv = document.querySelector('meta[name="viewport"]');
    if (mv) mv.remove();
  }
  if (isMobile || bypass) return;

  $('pcGate').classList.remove('hidden');
  try {
    const info = await api.info();
    const urls = info.lan.map((ip) => `http://${ip}:${info.port}`);
    const box = $('pcUrl');
    if (urls.length) {
      box.innerHTML = urls.map((u) => `<div>${esc(u)}</div>`).join('');
      $('pcHint').textContent = '手机和电脑连同一个 Wi-Fi，用手机浏览器打开上面任意一个地址。';
    } else {
      box.textContent = `http://localhost:${info.port}`;
      $('pcHint').textContent = '没检测到局域网地址，请确认电脑已连接 Wi-Fi。';
    }
  } catch {
    $('pcUrl').textContent = '无法连接服务器';
  }
}

/* ================= 账号 ================= */
let authMode = 'login';
let pendingAction = null;

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  $('authSubmit').textContent = mode === 'login' ? '登录' : '注册';
  $('authErr').textContent = '';
}

async function doAuth() {
  const username = $('authUser').value.trim();
  const password = $('authPass').value;
  const err = $('authErr');
  err.textContent = '';
  if (!username) { err.textContent = '请输入用户名'; return; }
  if (password.length < 6) { err.textContent = '密码至少 6 位'; return; }

  $('authSubmit').disabled = true;
  try {
    const fn = authMode === 'login' ? api.login : api.register;
    const res = await fn(username, password);
    setToken(res.token);
    state.user = res.user;
    toast(authMode === 'login' ? '登录成功' : '注册成功，欢迎！');
    $('authPass').value = '';
    renderProfile();
    if (pendingAction) {
      const p = pendingAction;
      pendingAction = null;
      p();
    } else {
      showScreen('home');
    }
  } catch (e) {
    err.textContent = e.message;
  } finally {
    $('authSubmit').disabled = false;
  }
}

function logout() {
  setToken('');
  state.user = null;
  renderProfile();
  toast('已退出登录');
}

function requireLogin(action) {
  if (state.user) { action(); return; }
  pendingAction = action;
  toast('请先登录');
  showScreen('auth');
}

/* ================= 我的 / 头像 ================= */
function renderProfile() {
  const u = state.user;
  $('profileName').textContent = u ? u.username : '未登录';
  $('profileStats').innerHTML = u
    ? `已发布 ${u.maps} 张地图`
    : '<button class="btn small" id="btnGoLogin">去登录 / 注册</button>';

  const img = $('avatarImg');
  if (u && u.avatar) img.src = `${u.avatar}?t=${Date.now()}`;
  else img.removeAttribute('src');

  const loginBtn = $('btnGoLogin');
  if (loginBtn) loginBtn.onclick = () => showScreen('auth');

  $('btnLogout').classList.toggle('hidden', !u);
  $('btnCamera').classList.toggle('hidden', !u);

  if (u) loadMyMaps();
  else $('myMaps').innerHTML = '<div class="dim center small" style="padding:20px">登录后可查看</div>';
}

async function loadMyMaps() {
  try {
    const res = await api.listMaps('new', '');
    const mine = res.maps.filter((m) => m.author === state.user.username);
    const box = $('myMaps');
    if (!mine.length) {
      box.innerHTML = '<div class="dim center small" style="padding:20px">还没发布过地图，去工坊做一张吧</div>';
      return;
    }
    box.innerHTML = mine.map((m) => `
      <div class="level-item">
        <div class="level-main">
          <div class="level-name">${esc(m.name)}</div>
          <div class="level-sub">
            <span class="level-code">${esc(m.code)}</span>
            <span>${'★'.repeat(m.difficulty)}${'☆'.repeat(5 - m.difficulty)}</span>
            <span>试玩 ${m.plays}</span>
          </div>
        </div>
        <button class="play-btn" data-play="${esc(m.code)}">玩</button>
      </div>`).join('');
  } catch (e) {
    $('myMaps').innerHTML = `<div class="dim center small">${esc(e.message)}</div>`;
  }
}

/** 从相册选图（不调用摄像头，http 下也能用） */
function pickAvatar() {
  const input = $('avatarFile');
  if (!input) return;
  input.value = '';
  input.click();
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这张图片无法读取，换一张试试'));
    };
    img.src = url;
  });
}

/** 居中裁成正方形，缩到 256，压缩后作为头像 */
function makeAvatarDataUrl(img, size = 256) {
  const cv = $('camCanvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#121722';
  ctx.fillRect(0, 0, size, size);

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const side = Math.min(iw, ih);
  const sx = (iw - side) / 2;
  const sy = (ih - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  return cv.toDataURL('image/jpeg', 0.85);
}

async function onAvatarPicked(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    toast('请选择图片文件');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    toast('图片太大了，换张小一点的');
    return;
  }
  const btn = $('btnCamera');
  btn.disabled = true;
  btn.textContent = '上传中…';
  try {
    const img = await loadImageFromFile(file);
    const dataUrl = makeAvatarDataUrl(img, 256);
    const res = await api.setAvatar(dataUrl);
    state.user = res.user;
    $('avatarImg').src = `${res.user.avatar}?t=${Date.now()}`;
    toast('头像已更新');
  } catch (e) {
    toast(String(e.message || e).slice(0, 40));
  } finally {
    btn.disabled = false;
    btn.textContent = '换头像';
  }
}

/* ================= 地图列表 ================= */
let sortMode = 'plays';

function stars(n) {
  return `<span class="stars">${'★'.repeat(n)}${'<span style="opacity:.25">' + '★'.repeat(5 - n) + '</span>'}</span>`;
}

function levelItemHtml(m, withDelete = false) {
  return `
    <div class="level-item">
      <div class="level-main">
        <div class="level-name">${esc(m.name)}</div>
        <div class="level-sub">
          <span class="level-code">${esc(m.code)}</span>
          ${stars(m.difficulty)}
          <span>试玩 ${m.plays}</span>
          <span>${esc(m.author)}</span>
        </div>
      </div>
      ${withDelete ? `<button class="play-btn" style="background:#3a2230" data-del="${esc(m.code)}">删</button>` : ''}
      <button class="play-btn" data-play="${esc(m.code)}">玩</button>
    </div>`;
}

async function loadLevels() {
  const q = $('searchInput').value.trim();
  const box = $('levelList');
  box.innerHTML = '<div class="dim center small" style="padding:24px">加载中…</div>';
  try {
    const res = await api.listMaps(sortMode, q);
    if (!res.maps.length) {
      box.innerHTML = q
        ? `<div class="dim center small" style="padding:24px">没找到「${esc(q)}」相关的图</div>`
        : '<div class="dim center small" style="padding:24px">还没有人发布地图，去工坊做第一张吧</div>';
      return;
    }
    box.innerHTML = res.maps.map((m) => levelItemHtml(m)).join('');
  } catch (e) {
    box.innerHTML = `<div class="dim center small" style="padding:24px">${esc(e.message)}</div>`;
  }
}

async function loadLeaderboard() {
  const box = $('lbList');
  box.innerHTML = '<div class="dim center small" style="padding:24px">加载中…</div>';
  try {
    const res = await api.leaderboard();
    const mode = document.querySelector('#lbTabs .tab.active')?.dataset.lb || 'plays';
    const list = mode === 'difficulty' ? res.difficulty : res.plays;
    if (!list.length) {
      box.innerHTML = '<div class="dim center small" style="padding:24px">还没有上榜的地图</div>';
      return;
    }
    box.innerHTML = list.map((m, i) => `
      <div class="level-item">
        <div style="width:26px;text-align:center;font-weight:800;color:${i < 3 ? '#ffd23f' : '#8b97ab'}">${i + 1}</div>
        <div class="level-main">
          <div class="level-name">${esc(m.name)}</div>
          <div class="level-sub">
            <span class="level-code">${esc(m.code)}</span>
            ${stars(m.difficulty)}
            <span>试玩 ${m.plays}</span>
            <span>${esc(m.author)}</span>
          </div>
        </div>
        <button class="play-btn" data-play="${esc(m.code)}">玩</button>
      </div>`).join('');
  } catch (e) {
    box.innerHTML = `<div class="dim center small" style="padding:24px">${esc(e.message)}</div>`;
  }
}

/* ================= 游戏 ================= */
let game = null;
let currentMap = null;

function initGame() {
  if (game) return;
  const canvas = $('gameCanvas');
  game = new Game(canvas, {
    onWin: (r) => onWin(r),
    onDeath: () => {},
    onCoin: (n) => { $('hudCoins').textContent = `🪙 ${n}`; },
  });
  bindTouchControls(game.input);
  bindKeyboard(game.input);
  $('btnPause').onclick = () => togglePause(true);
}

function bindTouchControls(input) {
  const bind = (el, on, off) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('on');
      on();
    });
    const up = (e) => {
      if (e) e.preventDefault();
      el.classList.remove('on');
      off();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  };
  bind($('btnLeft'), () => input.setDir(-1, true), () => input.setDir(-1, false));
  bind($('btnRight'), () => input.setDir(1, true), () => input.setDir(1, false));
  bind($('btnJump'), () => input.pressJump(), () => input.releaseJump());
}

function bindKeyboard(input) {
  window.addEventListener('keydown', (e) => {
    if (current !== 'game') return;
    if (e.key === 'ArrowLeft' || e.key === 'a') input.setDir(-1, true);
    if (e.key === 'ArrowRight' || e.key === 'd') input.setDir(1, true);
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); input.pressJump(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') input.setDir(-1, false);
    if (e.key === 'ArrowRight' || e.key === 'd') input.setDir(1, false);
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') input.releaseJump();
  });
}

async function playMap(code) {
  showScreen('game');
  $('gameOverlay').classList.add('hidden');
  $('hudName').textContent = '加载中…';
  try {
    const map = await api.getMap(code);
    currentMap = map;
    initGame();
    game.input.reset();
    game.resize();
    game.load(map);
    game.start();
    $('hudName').textContent = `${map.name} · ${map.code}`;
    $('hudCoins').textContent = '🪙 0';
    updateHudTime();
    api.play(code, false).catch(() => {});
  } catch (e) {
    toast(e.message);
    showScreen('levels');
  }
}

let hudTimer = null;
function updateHudTime() {
  clearInterval(hudTimer);
  hudTimer = setInterval(() => {
    if (current !== 'game' || !game || game.paused) return;
    $('hudTime').textContent = `${game.time.toFixed(1)}s`;
  }, 100);
}

function onWin(result) {
  if (!currentMap) return;
  api.play(currentMap.code, true).catch(() => {});
  const box = $('gameOverlayBox');
  box.innerHTML = `
    <h2>通关！</h2>
    <p>用时 ${result.time.toFixed(2)} 秒 · 金币 ${result.coins} · 失误 ${result.deaths} 次</p>
    <button class="btn big" id="ovAgain">再玩一次</button>
    <button class="btn big ghost" id="ovNext">回到地图列表</button>`;
  $('gameOverlay').classList.remove('hidden');
  $('ovAgain').onclick = () => {
    $('gameOverlay').classList.add('hidden');
    game.load(currentMap);
    game.start();
  };
  $('ovNext').onclick = () => {
    $('gameOverlay').classList.add('hidden');
    showScreen('levels');
  };
}

function togglePause(show) {
  if (!game) return;
  game.paused = show;
  const ov = $('gameOverlay');
  if (show) {
    $('gameOverlayBox').innerHTML = `
      <h2>已暂停</h2>
      <p>${esc(currentMap?.name || '')}</p>
      <button class="btn big" id="ovResume">继续</button>
      <button class="btn big ghost" id="ovRestart">重新开始</button>
      <button class="btn big ghost" id="ovQuit">退出</button>`;
    ov.classList.remove('hidden');
    $('ovResume').onclick = () => { ov.classList.add('hidden'); game.paused = false; };
    $('ovRestart').onclick = () => {
      ov.classList.add('hidden');
      game.paused = false;
      game.load(currentMap);
      game.start();
    };
    $('ovQuit').onclick = () => { ov.classList.add('hidden'); showScreen('levels'); };
  } else {
    ov.classList.add('hidden');
  }
}

/* ================= 编辑器 ================= */
let editor = null;

function initEditor() {
  if (editor) return;
  editor = new Editor($('editCanvas'), {});
  const pal = $('palette');
  pal.innerHTML = PALETTE.map(
    (p, i) => `<button class="pal${i === 1 ? ' active' : ''}" data-ch="${p.ch}" title="${p.name}">
        <b style="color:${p.color}">${p.icon}</b><span>${p.name}</span>
      </button>`
  ).join('');
  pal.addEventListener('click', (e) => {
    const btn = e.target.closest('.pal');
    if (!btn) return;
    editor.tool = btn.dataset.ch;
    document.querySelectorAll('.pal').forEach((b) => b.classList.toggle('active', b === btn));
  });

  $('btnMode').onclick = () => {
    const m = editor.setMode(editor.mode === 'paint' ? 'pan' : 'paint');
    $('btnMode').textContent = m === 'pan' ? '✏️ 画笔模式' : '✋ 移动模式';
    $('editHint').textContent = m === 'pan' ? '单指拖动查看地图' : '单指画，双指拖动缩放';
  };
  $('btnZoomIn').onclick = () => editor.zoomBy(1.3);
  $('btnZoomOut').onclick = () => editor.zoomBy(0.77);

  $('btnClear').onclick = () => {
    if (confirm('确定清空整张地图吗？')) {
      editor.clear();
      toast('已清空');
    }
  };
  $('btnTest').onclick = () => {
    const grid = editor.toGridStrings();
    if (!grid.join('').includes('S')) { toast('先放一个出生点'); return; }
    if (!grid.join('').includes('G')) { toast('先放一个终点'); return; }
    showScreen('game');
    $('gameOverlay').classList.add('hidden');
    currentMap = { code: '', name: $('mapName').value.trim() || '测试地图', grid, author: state.user?.username || '' };
    initGame();
    game.input.reset();
    game.resize();
    game.load(currentMap);
    game.start();
    $('hudName').textContent = '试玩中（不会上传）';
    $('hudCoins').textContent = '🪙 0';
    updateHudTime();
  };
  $('btnPublish').onclick = () => {
    requireLogin(async () => {
      const name = $('mapName').value.trim();
      if (!name) { toast('先给地图起个名字'); return; }
      $('btnPublish').disabled = true;
      try {
        const res = await api.publish(name, editor.toGridStrings());
        toast(`发布成功！地图码 ${res.code}`);
        state.user.maps = (state.user.maps || 0) + 1;
      } catch (e) {
        toast(e.message);
      } finally {
        $('btnPublish').disabled = false;
      }
    });
  };
}

function enterEditor() {
  initEditor();
  setTimeout(() => editor.resize(), 60);
}

/* ================= 事件绑定 ================= */
function bindGlobal() {
  document.body.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      const target = go.dataset.go;
      if (target === 'editor') { showScreen('editor'); return; }
      showScreen(target);
      return;
    }
    const play = e.target.closest('[data-play]');
    if (play) { playMap(play.dataset.play); return; }
  });

  $('btnBack').onclick = () => showScreen('home');

  document.querySelectorAll('.auth-tab').forEach((t) => {
    t.onclick = () => setAuthMode(t.dataset.mode);
  });
  $('authSubmit').onclick = doAuth;
  $('authPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });

  $('sortTabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    sortMode = t.dataset.sort;
    document.querySelectorAll('#sortTabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    loadLevels();
  });

  $('lbTabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    document.querySelectorAll('#lbTabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    loadLeaderboard();
  });

  $('searchBtn').onclick = () => loadLevels();
  $('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadLevels(); });

  $('btnCamera').onclick = () => requireLogin(pickAvatar);
  $('avatarFile').addEventListener('change', onAvatarPicked);
  $('btnLogout').onclick = logout;
}

/* ================= 启动 ================= */
async function boot() {
  bindGlobal();
  setAuthMode('login');
  checkDevice();

  if (state.token) {
    try {
      const res = await api.me();
      state.user = res.user;
    } catch {
      setToken('');
      state.user = null;
    }
  }
  renderProfile();

  try {
    const res = await api.listMaps('plays', '');
    $('homeFoot').innerHTML = `共 ${res.total} 张地图 · 登录后可在工坊做图并发布`;
  } catch {
    $('homeFoot').textContent = '连接服务器失败';
  }

  // 深链：?map=地图码 直接开玩，?screen=editor 直接进工坊
  const params = new URLSearchParams(location.search);
  const deepMap = params.get('map');
  const deepScreen = params.get('screen');
  if (deepMap) {
    playMap(deepMap);
  } else if (deepScreen && screens.includes(deepScreen)) {
    showScreen(deepScreen);
  } else {
    showScreen('home');
  }
}

boot();
