// 与服务器通信的薄封装
const TOKEN_KEY = 'sjw_token';

export const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
};

export function setToken(t) {
  state.token = t || '';
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export const api = {
  info: () => req('GET', '/api/info'),
  register: (username, password) => req('POST', '/api/register', { username, password }),
  login: (username, password) => req('POST', '/api/login', { username, password }),
  me: () => req('GET', '/api/me'),
  setAvatar: (image) => req('POST', '/api/me/avatar', { image }),
  listMaps: (sort = 'plays', q = '') =>
    req('GET', `/api/maps?sort=${encodeURIComponent(sort)}&q=${encodeURIComponent(q)}`),
  getMap: (code) => req('GET', `/api/maps/${encodeURIComponent(code)}`),
  publish: (name, grid) => req('POST', '/api/maps', { name, grid }),
  play: (code, cleared = false) =>
    req('POST', `/api/maps/${encodeURIComponent(code)}/play`, {
      cleared,
      countPlay: cleared ? false : true,
    }),
  leaderboard: () => req('GET', '/api/leaderboard'),
  removeMap: (code) => req('DELETE', `/api/maps/${encodeURIComponent(code)}`),
};
