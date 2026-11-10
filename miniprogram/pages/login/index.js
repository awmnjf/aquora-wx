const { getSession, request, signIn, signUp, startDemo } = require('../../lib/api');

Page({
  data: { mode: 'login', showPassword: false, terms: false, legal: false, restoring: false, submitting: false, demoBusy: false, error: '' },

  async onLoad() {
    const session = getSession();
    if (!session) return;
    this.setData({ restoring: true, error: '' });
    try {
      await request('/auth/me');
      if (getSession()?.token === session.token) wx.reLaunch({ url: '/pages/today/index' });
    } catch (error) {
      if (error.statusCode !== 401) this.setData({ error: error.message });
    } finally {
      this.setData({ restoring: false });
    }
  },

  chooseMode(event) {
    if (this.data.submitting || this.data.demoBusy) return;
    this.setData({ mode: event.currentTarget.dataset.mode, error: '' });
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  changeTerms(event) {
    this.setData({ terms: event.detail.value.includes('agree') });
  },

  toggleLegal() {
    this.setData({ legal: !this.data.legal });
  },

  async onSubmit(event) {
    if (this.data.restoring || this.data.submitting || this.data.demoBusy) return;
    const { username = '', password = '', displayName } = event.detail.value;
    if (!username.trim() || !password) {
      this.setData({ error: '请输入账号和密码' });
      return;
    }
    const registering = this.data.mode === 'register';
    if (registering && !this.data.terms) {
      this.setData({ error: '请阅读并同意用户协议与隐私说明' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      if (registering) await signUp(username, password, displayName || '', this.data.terms);
      else await signIn(username, password);
      wx.reLaunch({ url: '/pages/today/index' });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async openDemo() {
    if (this.data.restoring || this.data.submitting || this.data.demoBusy) return;
    this.setData({ demoBusy: true, error: '' });
    try {
      await startDemo();
      wx.reLaunch({ url: '/pages/today/index' });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ demoBusy: false });
    }
  },
});
