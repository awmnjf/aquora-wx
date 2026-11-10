const { getSession, requireSession, request } = require('../../lib/api');
const { formatDateTime } = require('../../lib/date');

Page({
  data: { items: [], unread: 0, loading: true, readingId: '', error: '' },

  onShow() {
    return this.refresh();
  },

  async onPullDownRefresh() {
    try {
      await this.refresh();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onUnload() {
    this.refreshId = (this.refreshId || 0) + 1;
  },

  async refresh() {
    if (!requireSession()) return;
    const token = getSession().token;
    const refreshId = this.refreshId = (this.refreshId || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const rows = await request('/notifications');
      if (refreshId !== this.refreshId || !requireSession() || getSession().token !== token) return;
      const items = rows.map(item => ({ ...item, time: formatDateTime(item.created_at) }));
      this.setData({ items, unread: items.filter(item => !item.seen).length });
    } catch (error) {
      if (refreshId === this.refreshId && requireSession()) this.setData({ error: error.message });
    } finally {
      if (refreshId === this.refreshId) this.setData({ loading: false });
    }
  },

  async markRead(event) {
    if (this.data.readingId || !requireSession()) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ readingId: id, error: '' });
    try {
      await request('/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST' });
      await this.refresh();
    } catch (error) {
      if (requireSession()) this.setData({ error: error.message });
    } finally {
      this.setData({ readingId: '' });
    }
  },

  openPlan() {
    if (!requireSession()) return;
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === 'pages/plan/index') {
      wx.navigateBack();
    } else {
      wx.navigateTo({ url: '/pages/plan/index' });
    }
  },
});
