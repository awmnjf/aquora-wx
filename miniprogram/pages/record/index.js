const { requireSession } = require('../../lib/api');
const { data, methods } = require('../../components/record-editor/form');

Page({
  data,
  ...methods,

  onLoad(options) {
    this.initialize(options);
    this.backSteps = options.fromPhoto ? 2 : 1;
    if (options.edit || options.draft) {
      this.setData({ waiting: true });
      const channel = this.getOpenerEventChannel();
      channel.on(options.edit ? 'editRecord' : 'recordDraft', record => this.loadRecord(record));
    }
  },

  onShow() {
    requireSession();
  },

  finishRecord() {
    wx.navigateBack({ delta: this.backSteps || 1, fail: () => wx.reLaunch({ url: '/pages/today/index' }) });
  },
});
