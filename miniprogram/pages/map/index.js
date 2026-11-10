const { requireSession } = require('../../lib/api');
const { data, methods } = require('../../components/outdoor-map/view');

Page({
  data,
  ...methods,
  onLoad() { this.initialize(); },
  onShow() { requireSession(); },
  onUnload() { this.dispose(); },
});
