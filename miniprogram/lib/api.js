const BASE_URL = 'https://shuizhiji.com/aquora/api';
const SESSION_KEY = 'aquora.mini.session';
const LOGIN_PAGE = '/pages/login/index';
let dashboardClock;

function jsonBody(data) {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function getSession() {
  const session = wx.getStorageSync(SESSION_KEY);
  return session && typeof session.token === 'string' && session.token ? session : null;
}

function clearSession(token) {
  const current = getSession();
  if (current && current.token === token) wx.removeStorageSync(SESSION_KEY);
}

function requireSession() {
  if (getSession()) return true;
  wx.reLaunch({ url: LOGIN_PAGE });
  return false;
}

function request(path, options = {}) {
  const session = options.auth === false ? null : getSession();
  const token = session && session.token;
  const header = { 'Content-Type': 'application/json' };
  if (token) header.Authorization = 'Bearer ' + token;

  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + path,
      method: options.method || 'GET',
      data: options.data,
      header,
      timeout: options.timeout || 12000,
      dataType: 'json',
      responseType: options.responseType || 'text',
      success(response) {
        const status = response.statusCode;
        const body = jsonBody(response.data);
        if (status >= 200 && status < 300 && body && typeof body === 'object') {
          resolve(body);
          return;
        }

        if (status === 401 && token) clearSession(token);
        const fallback = status === 401 ? '账号、密码或登录状态有误'
          : status >= 200 && status < 300 ? '服务返回了无法读取的数据，请重试'
          : '服务暂时无法响应，请稍后重试';
        const error = new Error(body && typeof body.message === 'string' ? body.message : fallback);
        error.statusCode = status;
        reject(error);
      },
      fail(error) {
        const message = error?.errMsg || '';
        if (/not in domain list|不在.*合法域名/i.test(message)) {
          reject(new Error('小程序的服务器域名尚未配置，请联系水知己运营人员'));
          return;
        }
        if (/timeout|timed out|超时/i.test(message)) {
          reject(new Error('连接水知己超时，请检查网络后重试'));
          return;
        }
        if (/ssl|tls|certificate|证书/i.test(message)) {
          reject(new Error('无法建立 HTTPS 连接，请检查手机日期和网络后重试'));
          return;
        }
        reject(new Error('暂时无法连接水知己，请检查网络后重试'));
      },
    });
  });
}

async function authenticate(action, data) {
  const session = await request('/auth/' + action, {
    method: 'POST',
    auth: false,
    data,
  });
  if (typeof session.token !== 'string' || !session.token || !session.user || !session.user.id) {
    throw new Error('暂时无法建立登录会话，请重试');
  }
  wx.setStorageSync(SESSION_KEY, { token: session.token, user: session.user });
  return session.user;
}

function signIn(username, password) {
  return authenticate('login', { username: username.trim(), password });
}

function signUp(username, password, displayName, terms) {
  return authenticate('register', { username: username.trim(), password, displayName: displayName.trim(), terms });
}

function startDemo() {
  return authenticate('demo', {});
}

async function getDashboard() {
  const dashboard = await request('/dashboard');
  if (Number.isFinite(dashboard.updatedAt)) {
    dashboardClock = { serverTime: dashboard.updatedAt, receivedAt: Date.now() };
  }
  return dashboard;
}

function getRecordTime() {
  const now = Date.now();
  if (!dashboardClock) return now;
  // Keep new records inside the same server time window as today's dashboard.
  return dashboardClock.serverTime + Math.max(0, now - dashboardClock.receivedAt);
}

async function signOut() {
  const session = getSession();
  if (!session) return;
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch (error) {
    if (error.statusCode !== 401) throw error;
  }
  clearSession(session.token);
}

module.exports = { getDashboard, getRecordTime, getSession, requireSession, request, signIn, signOut, signUp, startDemo };
