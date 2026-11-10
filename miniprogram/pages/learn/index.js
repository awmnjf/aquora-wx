const { requireSession } = require('../../lib/api');
const library = require('./library');

Page({
  data: {
    categories: library.categories, featured: library.featured,
    category: '最新', query: '', entries: [], rotating: true, active: false, searchOpen: false, slide: 0,
  },

  onLoad() {
    this.updateFeed('最新', '');
  },

  onShow() {
    if (requireSession()) this.setData({ active: true });
  },

  onHide() {
    this.setData({ active: false });
  },

  updateFeed(category, query) {
    const entries = library.search(category, query);
    this.setData({ category, query, entries, searching: Boolean(query.trim()) });
  },

  chooseCategory(event) {
    this.updateFeed(event.currentTarget.dataset.category, this.data.query);
  },

  changeQuery(event) {
    this.updateFeed(this.data.category, event.detail.value);
  },

  clearQuery() {
    this.updateFeed(this.data.category, '');
  },

  toggleSearch() {
    this.setData({ searchOpen: !this.data.searchOpen });
    this.clearQuery();
  },

  changeSlide(event) {
    if (event.detail.current !== this.data.slide) this.setData({ slide: event.detail.current });
  },

  stepSlide(event) {
    const length = this.data.featured.length;
    if (!length) return;
    const delta = Number(event.currentTarget.dataset.delta);
    this.setData({ slide: (this.data.slide + delta + length) % length });
  },

  chooseSlide(event) {
    this.setData({ slide: Number(event.currentTarget.dataset.index) });
  },

  toggleRotation() {
    this.setData({ rotating: !this.data.rotating });
  },

  openEntry(event) {
    wx.navigateTo({ url: '/pages/learn/reader?id=' + encodeURIComponent(event.currentTarget.dataset.id) });
  },
});
