const { getRecordTime, getSession, requireSession, request } = require('../../lib/api');
const { formatDateTime, parseShanghai } = require('../../lib/date');

const START_FIELDS = [
  { key: 'startMl', label: '两小时前实测容量（mL）', max: 3000 },
  { key: 'currentMl', label: '当前实测容量（mL）', max: 3000 },
  { key: 'expelledMl', label: '过去两小时实际排出总量（mL）', max: 10000 },
];
const PLAN_FIELDS = [
  { key: 'planFirst', label: '未来第 1 小时计划饮水（mL，可选）', max: 10000, optional: true },
  { key: 'planSecond', label: '未来第 2 小时计划饮水（mL，可选）', max: 10000, optional: true },
];
const LABEL_FIELDS = [
  { key: 'endMl', label: '目标时刻实测容量（mL）', max: 3000 },
  { key: 'expelledMl', label: '窗口内完整实际排出量（mL）', max: 10000 },
];

function newWindowId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, digit => {
    const bits = Math.floor(Math.random() * 16);
    return (digit === 'x' ? bits : (bits & 3) | 8).toString(16);
  });
}

function preciseTime(timestamp) {
  const date = new Date(timestamp);
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  const millis = String(date.getUTCMilliseconds()).padStart(3, '0');
  return formatDateTime(timestamp) + ':' + seconds + '.' + millis;
}

function parseMeasuredAt(value) {
  const parts = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!parts) return NaN;
  const [, date, time, seconds, millis = '0'] = parts;
  return parseShanghai(date, time) + Number(seconds) * 1000 + Number(millis.padEnd(3, '0'));
}

function amounts(form, fields) {
  const result = {};
  for (const field of fields) {
    const text = String(form[field.key] == null ? '' : form[field.key]).trim();
    if (field.optional && text === '') {
      result[field.key] = null;
      continue;
    }
    const value = Number(text);
    if (!text || !Number.isFinite(value) || value < 0 || value > field.max) {
      throw new Error('请检查' + field.label + '，范围为 0 至 ' + field.max);
    }
    result[field.key] = value;
  }
  return result;
}

Page({
  data: {
    enrolled: false, blocked: false, windows: [], activeWindow: false,
    startFields: START_FIELDS, planFields: PLAN_FIELDS, labelFields: LABEL_FIELDS,
    editor: '', form: {}, selected: null, loading: true, busy: false, ready: false,
    error: '', formError: '', message: '',
  },

  onShow() {
    this.visible = true;
    return this.refresh();
  },

  onHide() {
    this.visible = false;
    clearTimeout(this.windowTimer);
  },

  onUnload() {
    this.onHide();
    this.unloaded = true;
    this.refreshId = (this.refreshId || 0) + 1;
  },

  async onPullDownRefresh() {
    try {
      await this.refresh();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async refresh() {
    if (!requireSession()) return;
    const { token, user } = getSession();
    if (user.demo) {
      this.setData({ blocked: true, loading: false });
      return;
    }
    const refreshId = this.refreshId = (this.refreshId || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const result = await request('/research/participation');
      if (refreshId !== this.refreshId || !requireSession() || getSession().token !== token) return;
      this.setData({ enrolled: result.enrolled, ready: true });
      this.showWindows(result.windows);
    } catch (error) {
      if (refreshId === this.refreshId && requireSession()) this.setData({ error: error.message });
    } finally {
      if (refreshId === this.refreshId) this.setData({ loading: false });
    }
  },

  showWindows(rows) {
    clearTimeout(this.windowTimer);
    const now = getRecordTime();
    const windows = rows.map(row => ({
      ...row, originText: preciseTime(row.origin), targetText: preciseTime(row.target),
      verified: row.label_recorded_at != null, due: row.target <= now,
    }));
    const upcoming = windows.filter(window => !window.due).map(window => window.target);
    this.setData({ windows, activeWindow: upcoming.length > 0 });
    if (this.visible && upcoming.length) {
      this.windowTimer = setTimeout(() => this.showWindows(rows), Math.max(1, Math.min(...upcoming) - now));
    }
  },

  openStart() {
    if (this.data.busy || !this.data.enrolled || this.data.activeWindow) return;
    this.pendingWindow = null;
    this.setData({ editor: 'start', form: {}, selected: null, formError: '', message: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 150 });
  },

  openLabel(event) {
    if (this.data.busy || !this.data.enrolled) return;
    const selected = this.data.windows.find(window => window.id === event.currentTarget.dataset.id);
    if (!selected || selected.verified || !selected.due) return;
    this.setData({ editor: 'label', form: {}, selected, formError: '', message: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 150 });
  },

  closeEditor() {
    if (!this.data.busy) this.setData({ editor: '', form: {}, selected: null, formError: '' });
  },

  updateField(event) {
    const { field } = event.currentTarget.dataset;
    if (!this.data.busy) this.setData({ ['form.' + field]: event.detail.value, formError: '' });
  },

  confirmComplete(event) {
    if (!this.data.busy) this.setData({ 'form.complete': event.detail.value.length > 0, formError: '' });
  },

  submitEditor() {
    if (this.data.busy || !this.data.enrolled) return;
    const { editor, form, selected } = this.data;
    try {
      if (!form.complete) throw new Error('请核对并确认实测区间和记录完整');
      if (editor === 'start') {
        const values = {
          ...amounts(form, START_FIELDS), ...amounts(form, PLAN_FIELDS), timezone: 'Asia/Shanghai', complete: true,
        };
        if ((values.planFirst == null) !== (values.planSecond == null)) {
          throw new Error('请同时填写两段饮水计划，或将两项留空');
        }
        if (values.currentMl - values.startMl + values.expelledMl < 0) {
          throw new Error('请核对实测容量和排出量，计算出的产尿量不能为负数');
        }
        const signature = JSON.stringify(values);
        if (!this.pendingWindow || this.pendingWindow.signature !== signature) {
          this.pendingWindow = { signature, id: newWindowId() };
        }
        return this.mutate('/research/windows', { ...values, id: this.pendingWindow.id }, '已开始观测，请记下目标测量时刻。', result => {
          this.pendingWindow = null;
          this.showWindows([result, ...this.data.windows.filter(window => window.id !== result.id)]);
        });
      }
      if (editor === 'label' && selected) {
        const measuredAt = parseMeasuredAt(form.measuredAt || '');
        if (measuredAt !== selected.target) throw new Error('请填写与目标时刻一致的实际测量时间（北京时间，精确到毫秒）');
        const values = { ...amounts(form, LABEL_FIELDS), measuredAt, complete: true };
        return this.mutate('/research/windows/' + encodeURIComponent(selected.id) + '/label', values, '实测结果已保存。', () => {
          this.showWindows(this.data.windows.map(window => (
            window.id === selected.id ? { ...window, label_recorded_at: getRecordTime() } : window
          )));
        });
      }
    } catch (error) {
      this.setData({ formError: error.message });
    }
  },

  enroll() {
    return this.mutate('/research/enroll', {}, '已加入算法研究。', () => this.setData({ enrolled: true }));
  },

  confirmWithdraw() {
    if (this.data.busy) return;
    wx.showModal({
      title: '退出算法研究',
      content: '退出会删除您的个人研究记录。确定退出？',
      confirmText: '退出',
      success: result => {
        if (result.confirm) {
          this.mutate('/research/withdraw', {}, '已退出，个人研究记录已删除。', () => {
            this.pendingWindow = null;
            this.setData({ enrolled: false });
            this.showWindows([]);
          });
        }
      },
    });
  },

  async mutate(path, data, message, onSaved) {
    if (this.data.busy || this.data.blocked || !requireSession()) return;
    this.setData({ busy: true, error: '', formError: '', message: '' });
    try {
      const result = await request(path, { method: 'POST', data });
      if (this.unloaded) return;
      onSaved(result);
      this.setData({ editor: '', form: {}, selected: null, message });
      await this.refresh();
    } catch (error) {
      if (!this.unloaded && requireSession()) {
        this.setData(this.data.editor ? { formError: error.message } : { error: error.message });
      }
    } finally {
      if (!this.unloaded) this.setData({ busy: false });
    }
  },
});
