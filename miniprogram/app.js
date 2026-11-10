const { getSession, request } = require('./lib/api');

App({
  globalData: {},

  onShow() {
    this.foreground = true;
    this.checkReminders();
    if (this.reminderTimer == null) {
      this.reminderTimer = setInterval(() => this.checkReminders(), 30000);
    }
  },

  onHide() {
    this.foreground = false;
    clearInterval(this.reminderTimer);
    this.reminderTimer = null;
  },

  currentHeader() {
    const pages = getCurrentPages();
    return pages[pages.length - 1]?.selectComponent?.('#app-header');
  },

  showMessage(message) {
    const header = this.currentHeader();
    if (header) header.flash(String(message));
    else wx.showToast({ title: String(message), icon: 'none', duration: 3500 });
  },

  async checkReminders() {
    const session = getSession();
    if (!session || this.readingReminders) return;
    if (this.reminderAccount !== session.user.id) {
      this.reminderAccount = session.user.id;
      this.notified = new Set();
    }
    this.readingReminders = true;
    try {
      const items = await request('/notifications');
      if (!Array.isArray(items) || getSession()?.token !== session.token) return;
      this.noticeCache = { token: session.token, items };
      this.currentHeader()?.setNotices(items);
      if (!this.foreground) return;
      for (const item of items) {
        if (item.seen || this.notified.has(item.id) || Date.now() - item.created_at > 300000) continue;
        this.notified.add(item.id);
        this.showMessage(item.body || item.title || '护理安排提醒');
        break;
      }
    } catch {
      // The reminder page can retry independently when the connection returns.
    } finally {
      this.readingReminders = false;
    }
  },
});
