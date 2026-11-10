const { requireSession, request } = require('../../lib/api');
const { draftRecord } = require('../../lib/navigation');

const MAX_ORIGINAL_SIZE = 12 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 2500000;

function pickFile(sourceType) {
  return new Promise((resolve, reject) => {
    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1, mediaType: ['image'], sourceType: [sourceType], camera: 'back', sizeType: ['compressed'],
        success: result => resolve(result.tempFiles[0]), fail: reject,
      });
    } else {
      wx.chooseImage({
        count: 1, sourceType: [sourceType], sizeType: ['compressed'],
        success: result => resolve(result.tempFiles[0]), fail: reject,
      });
    }
  });
}

function imageInfo(src) {
  return new Promise((resolve, reject) => wx.getImageInfo({
    src, success: resolve, fail: () => reject(new Error('无法读取照片，请重新选择')),
  }));
}

function compress(src, info) {
  if (typeof wx.compressImage !== 'function') return Promise.resolve(src);
  const dimension = info.width >= info.height ? { compressedWidth: 1280 } : { compressedHeight: 1280 };
  return new Promise(resolve => wx.compressImage({
    src, quality: 78, ...(Math.max(info.width, info.height) > 1280 ? dimension : {}),
    success: result => resolve(result.tempFilePath || src), fail: () => resolve(src),
  }));
}

function encodeImage(filePath) {
  const fs = wx.getFileSystemManager();
  return new Promise((resolve, reject) => fs.getFileInfo({
    filePath,
    success: ({ size }) => {
      if (size < 16 || size > MAX_UPLOAD_SIZE) {
        reject(new Error('每张照片需在 2.5 MB 以内，请重新选择'));
        return;
      }
      fs.readFile({
        filePath, encoding: 'base64', success: result => resolve(result.data),
        fail: () => reject(new Error('无法读取照片，请重新选择')),
      });
    },
    fail: () => reject(new Error('无法读取照片，请重新选择')),
  }));
}

async function prepare(file) {
  const path = file && (file.tempFilePath || file.path);
  if (!path) throw new Error('没有选中照片，请重新选择');
  if (file.size > MAX_ORIGINAL_SIZE) throw new Error('每张原始照片需在 12 MB 以内');
  const info = await imageInfo(path);
  if (!info.width || !info.height || info.width * info.height > 60000000) {
    throw new Error('照片尺寸过大，请重新拍摄');
  }
  const preview = await compress(path, info);
  const data = await encodeImage(preview);
  const mime = data.startsWith('/9j/') ? 'jpeg' : data.startsWith('iVBORw0KGgo') ? 'png' :
    (data.startsWith('UklGR') && data.slice(11, 16) === 'XRUJQ') ? 'webp' : '';
  if (!mime) throw new Error('请选择 JPG、PNG 或 WebP 照片');
  return { preview, image: 'data:image/' + mime + ';base64,' + data };
}

Page({
  data: {
    kind: 'drink',
    before: '',
    after: '',
    context: '',
    checking: true,
    available: false,
    stage: '',
    error: '',
    estimate: null,
    amount: null,
  },

  onLoad(options) {
    this.photos = {};
    this.epoch = 0;
    this.fromRecord = Boolean(options?.fromRecord);
    if (options?.kind === 'food' || options?.kind === 'voiding') this.setData({ kind: options.kind });
    if (this.fromRecord) this.setData({ fixedKind: true });
    this.loadCapability();
  },

  onShow() {
    requireSession();
  },

  onUnload() {
    this.epoch++;
    this.closed = true;
    this.photos = {};
    this.candidate = null;
  },

  showError(error) {
    if (error.statusCode === 401) requireSession();
    else this.setData({ error: error.message || '暂时无法处理照片，请重试' });
  },

  async loadCapability() {
    if (!requireSession()) return;
    this.setData({ checking: true, error: '' });
    try {
      const result = await request('/vision/capability');
      if (!this.closed) this.setData({ available: result.available === true });
    } catch (error) {
      if (!this.closed) this.showError(error);
    } finally {
      if (!this.closed) this.setData({ checking: false });
    }
  },

  resetEstimate() {
    this.candidate = null;
    this.setData({ estimate: null, amount: null, error: '' });
  },

  chooseKind(event) {
    const kind = event.currentTarget.dataset.kind;
    if (this.fromRecord || this.data.stage || kind === this.data.kind || (kind !== 'drink' && kind !== 'food')) return;
    this.photos = {};
    this.resetEstimate();
    this.setData({ kind, before: '', after: '', context: '' });
  },

  async choosePhoto(event) {
    const { slot, source } = event.currentTarget.dataset;
    if (this.data.stage || (slot !== 'before' && slot !== 'after') || (source !== 'camera' && source !== 'album')) return;
    const epoch = ++this.epoch;
    this.setData({ stage: 'pick', error: '' });
    try {
      const file = await pickFile(source);
      if (epoch !== this.epoch) return;
      const photo = await prepare(file);
      if (epoch !== this.epoch) return;
      this.resetEstimate();
      this.photos[slot] = photo.image;
      this.setData({ [slot]: photo.preview });
    } catch (error) {
      if (epoch !== this.epoch || /cancel/i.test(error.errMsg || '')) return;
      this.showError(error.message ? error : new Error('无法打开' + (source === 'camera' ? '相机' : '相册') + '，请检查微信权限后重试'));
    } finally {
      if (epoch === this.epoch) this.setData({ stage: '' });
    }
  },

  clearPhoto(event) {
    const slot = event.currentTarget.dataset.slot;
    if (this.data.stage || (slot !== 'before' && slot !== 'after')) return;
    this.resetEstimate();
    delete this.photos[slot];
    this.setData({ [slot]: '' });
  },

  setContext(event) {
    if (this.data.stage) return;
    this.resetEstimate();
    this.setData({ context: event.detail.value });
  },

  async estimate() {
    const { before: beforeImage, after: afterImage } = this.photos;
    const { kind, context, stage } = this.data;
    const single = kind === 'voiding';
    if (stage || !beforeImage || (!single && !afterImage) || !requireSession()) return;
    this.resetEstimate();
    if (beforeImage === afterImage) {
      this.setData({ error: '请使用不同的前后照片' });
      return;
    }
    const epoch = ++this.epoch;
    this.setData({ stage: 'estimate' });
    try {
      const result = await request('/vision', {
        method: 'POST', timeout: 65000,
        data: single ? { image: beforeImage } : { kind, beforeImage, afterImage, context: context.trim() },
      });
      if (epoch !== this.epoch) return;
      const candidate = result.candidate;
      if (!result.available || !candidate || candidate.kind !== kind || !Number.isInteger(candidate.amountMl) ||
          candidate.amountMl < (single ? 0 : 1) || candidate.amountMl > 3000) {
        throw new Error(result.message || '暂时无法估算，请补充容量、份量或手动填写');
      }
      this.candidate = candidate;
      this.setData({ estimate: result.estimate || {}, amount: candidate.amountMl });
    } catch (error) {
      if (epoch === this.epoch) this.showError(error);
    } finally {
      if (epoch === this.epoch) this.setData({ stage: '' });
    }
  },

  openDraft() {
    if (!this.candidate || this.data.stage) return;
    if (this.fromRecord) {
      this.getOpenerEventChannel().emit('recordPhoto', this.candidate);
      wx.navigateBack();
    } else {
      draftRecord({ ...this.candidate, source: 'assistant' });
    }
  },

  manualRecord() {
    if (this.data.stage) return;
    const previous = getCurrentPages().slice(-2)[0];
    if (this.fromRecord || (previous && previous.route === 'pages/record/index' && previous.data.kind === this.data.kind)) wx.navigateBack();
    else draftRecord({ kind: this.data.kind, source: 'manual' });
  },
});
