const { requireSession } = require('../../lib/api');
const { data, methods } = require('./form');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { tabPage: Boolean },
  data: { ...data, open: false },
  pageLifetimes: {
    show() {
      if (this.data.open) this.hideTabs();
    },
    hide() {
      this.restoreTabs();
    },
  },
  lifetimes: {
    detached() {
      this.editingRecord = null;
      this.restoreTabs();
    },
  },
  methods: {
    ...methods,

    openEditor(options, record) {
      if (this.data.open || !requireSession()) return;
      this.initialize(options);
      if (record) this.loadRecord(record);
      this.setData({ open: true });
      this.hideTabs();
    },

    hideTabs() {
      if (!this.data.tabPage || this.tabsHidden) return;
      this.tabsHidden = true;
      wx.hideTabBar({ animation: false, fail: () => { this.tabsHidden = false; } });
    },

    restoreTabs() {
      if (!this.tabsHidden) return;
      this.tabsHidden = false;
      wx.showTabBar({ animation: false, fail() {} });
    },

    dismiss() {
      if (!this.data.submitting) this.closeEditor();
    },

    closeEditor() {
      this.editingRecord = null;
      this.setData({ open: false });
      this.restoreTabs();
    },

    finishRecord() {
      this.closeEditor();
      this.triggerEvent('saved');
    },

    keepOpen() {},
  },
});
