const { getSession, requireSession, request, signOut } = require('../../lib/api');
const { formatDateTime } = require('../../lib/date');

const METHODS = [
  { value: 'catheter', label: '间歇性导尿' },
  { value: 'voiding', label: '自主排尿' },
  { value: 'drainage', label: '留置导尿（仅记录）' },
];

const PERSONAL_FIELDS = [
  { key: 'age', label: '年龄（岁，可选）', type: 'number', min: 18, max: 120 },
  { key: 'weight', label: '体重（kg，可选）', type: 'digit', min: 20, max: 300 },
];

const ESTIMATE_FIELDS = [
  { key: 'bladderCapacity', label: '总膀胱储量（毫升）', type: 'number', min: 1, max: 1000, placeholder: '默认 400' },
  { key: 'referenceVolume', label: '充盈参考量（毫升）', type: 'digit', min: 50, max: 1000, placeholder: '默认 300' },
  { key: 'residual', label: '充分排空后的残余尿量（毫升）', type: 'digit', min: 0, max: 1000, placeholder: '未知请留空' },
];

const ADVANCED_FIELDS = [
  { key: 'baselineRate', label: '基础产尿速率（mL/h）', type: 'digit', min: 0, max: 180 },
  { key: 'conversionRatio', label: '液体转化比例（0 至 1）', type: 'digit', min: 0, max: 1 },
];

function showProfile(record, user) {
  const { data } = record;
  const name = data.displayName || user.displayName || user.username || '水知己';
  const method = METHODS.find(item => item.value === data.method) || METHODS[0];
  return {
    name, initial: Array.from(name)[0], method: method.label, modelEnabled: data.modelEnabled !== false,
    calibratedAt: data.calibration && data.calibration.at ? formatDateTime(data.calibration.at) : '',
  };
}

function validateNumber(form, field) {
  const raw = form[field.key];
  if (raw == null || String(raw).trim() === '') return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < field.min || value > field.max
    || (field.type === 'number' && !Number.isInteger(value))) {
    throw new Error('请检查' + field.label + '，范围为 ' + field.min + ' 至 ' + field.max);
  }
}

Page({
  data: {
    user: null, profile: null, identity: null, loading: true, busy: false, error: '', formError: '',
    editor: '', form: {}, conflict: false, methodIndex: 0, methods: METHODS, personalFields: PERSONAL_FIELDS,
    estimateFields: ESTIMATE_FIELDS, advancedFields: ADVANCED_FIELDS, advanced: false,
    devices: null, loadingDevices: false, devicesError: '',
  },

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
    const { token, user } = getSession();
    const refreshId = this.refreshId = (this.refreshId || 0) + 1;
    this.setData({ user, loading: true, error: '' });
    try {
      const profile = await request('/profile');
      if (refreshId !== this.refreshId || !requireSession() || getSession().token !== token) return;
      this.setData({ profile, identity: showProfile(profile, user) });
    } catch (error) {
      if (refreshId === this.refreshId && requireSession()) this.setData({ error: error.message });
    } finally {
      if (refreshId === this.refreshId) this.setData({ loading: false });
    }
  },

  openEditor(event) {
    const editor = event.currentTarget.dataset.editor;
    if (this.data.busy || !requireSession()) return;
    const { profile, identity, user } = this.data;
    if (editor === 'password' && user.demo) return;
    if (editor === 'devices') {
      this.setData({ editor, devices: null, formError: '', conflict: false });
      return this.loadDevices();
    }
    if (editor === 'account' || editor === 'password') {
      this.setData({ editor, form: {}, formError: '', conflict: false });
      return;
    }
    if (!profile || this.data.loading) return;
    const methodIndex = Math.max(0, METHODS.findIndex(item => item.value === profile.data.method));
    const form = editor === 'calibration' ? { version: profile.version, volumeMl: '' } : {
      ...profile.data, version: profile.version, displayName: identity.name,
      modelEnabled: identity.modelEnabled, method: METHODS[methodIndex].value,
      bladderCapacity: profile.data.bladderCapacity == null ? 400 : profile.data.bladderCapacity,
    };
    for (const field of [...PERSONAL_FIELDS, ...ESTIMATE_FIELDS, ...ADVANCED_FIELDS]) {
      if (form[field.key] != null) form[field.key] = String(form[field.key]);
    }
    this.setData({ editor, form, methodIndex, advanced: false, formError: '', conflict: false });
  },

  closeEditor() {
    if (!this.data.busy) this.setData({ editor: '', form: {}, formError: '', conflict: false });
  },

  reloadProfile() {
    if (this.data.busy) return;
    this.closeEditor();
    return this.refresh();
  },

  updateField(event) {
    const { field } = event.currentTarget.dataset;
    if (!this.data.busy) this.setData({ ['form.' + field]: event.detail.value, formError: '' });
  },

  updateMethod(event) {
    const index = Number(event.detail.value);
    if (!this.data.busy && METHODS[index]) this.setData({ methodIndex: index, 'form.method': METHODS[index].value, formError: '' });
  },

  toggleModel(event) {
    if (!this.data.busy) this.setData({ 'form.modelEnabled': event.detail.value, formError: '' });
  },

  toggleAdvanced() {
    this.setData({ advanced: !this.data.advanced });
  },

  async submitEditor() {
    if (this.data.busy || this.data.conflict || !requireSession()) return;
    const { editor, form, user } = this.data;
    this.setData({ busy: true, formError: '' });
    try {
      if (editor === 'password') {
        const { currentPassword = '', newPassword = '' } = form;
        if (user.demo) return;
        if (!currentPassword.trim() || currentPassword.length > 72) throw new Error('请填写当前密码');
        if (!newPassword.trim() || newPassword.length < 10 || newPassword.length > 72) {
          throw new Error('新密码需为 10 至 72 位');
        }
        await request('/auth/password', { method: 'POST', data: { currentPassword, newPassword } });
        this.setData({ editor: 'account', form: {} });
        wx.showToast({ title: '密码已修改，其他会话已退出', icon: 'none' });
        return;
      }

      let saved;
      if (editor === 'calibration') {
        const text = form.volumeMl.trim();
        const volumeMl = text === '' ? null : Number(text);
        if (volumeMl !== null && (!Number.isFinite(volumeMl) || volumeMl < 0 || volumeMl > 1000)) {
          throw new Error('当前实测量应在 0 至 1000 毫升之间');
        }
        saved = await request('/profile/calibration', { method: 'POST', data: { version: form.version, volumeMl } });
      } else {
        const displayName = form.displayName.trim();
        if (!displayName || displayName.length > 40) throw new Error('请填写 40 字以内的昵称');
        for (const field of [...PERSONAL_FIELDS, ...ESTIMATE_FIELDS, ...ADVANCED_FIELDS]) validateNumber(form, field);
        const reference = String(form.referenceVolume == null ? '' : form.referenceVolume).trim() || 300;
        const capacity = String(form.bladderCapacity).trim() || 400;
        if (Number(reference) >= Number(capacity)) {
          throw new Error('充盈参考量必须小于总膀胱储量，参考量留空时按 300 毫升计算');
        }
        saved = await request('/profile', { method: 'PUT', data: { ...form, displayName } });
      }
      this.refreshId = (this.refreshId || 0) + 1;
      this.setData({ profile: saved, identity: showProfile(saved, user), editor: '', form: {}, loading: false });
      wx.showToast({ title: editor === 'calibration' ? '已从现在重新校准' : '已保存', icon: 'none' });
    } catch (error) {
      if (requireSession()) this.setData({ formError: error.message, conflict: error.statusCode === 409 });
    } finally {
      this.setData({ busy: false });
    }
  },

  async loadDevices() {
    if (this.data.loadingDevices || !requireSession()) return;
    this.setData({ loadingDevices: true, devicesError: '' });
    try {
      this.setData({ devices: await request('/devices') });
    } catch (error) {
      if (requireSession()) this.setData({ devicesError: error.message });
    } finally {
      this.setData({ loadingDevices: false });
    }
  },

  async logout() {
    if (this.data.busy) return;
    this.setData({ busy: true, formError: '' });
    try {
      await signOut();
      this.setData({ editor: '', form: {} });
      wx.reLaunch({ url: '/pages/login/index' });
    } catch (error) {
      this.setData({ formError: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
});
