const { requireSession } = require('../../lib/api');
const { findEntry } = require('./library');

Page({
  data: { article: null, video: null, sources: [], videoError: false },

  onLoad(options) {
    if (!requireSession()) return;
    const entry = findEntry(options.id);
    if (entry) this.setData(entry);
  },

  onShow() {
    requireSession();
  },

  videoFailed() {
    this.setData({ videoError: true });
  },

  retryVideo() {
    this.setData({ videoError: false });
  },

  copySource(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      fail() { wx.showToast({ title: '链接暂时无法复制', icon: 'none' }); },
    });
  },
});
