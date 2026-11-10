const { getSession, requireSession, request } = require('../../lib/api');
const { dateInput, timeInput, parseShanghai, formatDateTime, DAY_MS } = require('../../lib/date');

const { newRecord } = require('../../lib/navigation');
const { planFields, savePlan } = require('../../lib/care-plan');

const HOUR_MS = 3600000;

function taskLabel(kind) {
  return kind === 'drink' ? '饮水' : '排尿 / 导尿';
}

function showTask(row, now) {
  const detail = {
    done: '已有确认记录',
    skipped: '未执行 · ' + (row.note || ''),
    pending: row.due_at < now ? '已到时，待核对' : '计划提醒',
  };
  return { ...row, time: timeInput(row.due_at), label: taskLabel(row.kind), detail: detail[row.status] || '' };
}

Page({
  data: {
    plan: null, tasks: [], history: [], outings: [], outingResult: null,
    form: {}, editor: '', skipId: '', deletingId: '', loading: true, busy: false, error: '', formError: '', conflict: false,
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
    this.unloaded = true;
    this.refreshId = (this.refreshId || 0) + 1;
  },

  async refresh() {
    if (this.unloaded || !requireSession()) return;
    const token = getSession().token;
    const refreshId = this.refreshId = (this.refreshId || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const [plan, tasks, history, outings] = await Promise.all([
        request('/plan'), request('/tasks'), request('/plan/history'), request('/outings'),
      ]);
      if (refreshId !== this.refreshId || !requireSession() || getSession().token !== token) return;
      const now = Date.now();
      const data = plan.data;
      this.setData({
        plan: { ...plan, drinkText: (data.drinkTimes || []).join('、'), voidText: (data.voidTimes || []).join('、') },
        tasks: tasks.map(task => showTask(task, now)),
        history: history.map(row => ({ ...row, date: dateInput(row.created_at) })),
        outings: outings.map(row => ({
          ...row, time: formatDateTime(row.start_at) + ' 至 ' + formatDateTime(row.end_at),
        })),
      });
    } catch (error) {
      if (refreshId === this.refreshId && requireSession()) this.setData({ error: error.message });
    } finally {
      if (refreshId === this.refreshId) this.setData({ loading: false });
    }
  },

  editPlan() {
    if (!this.data.plan || this.data.loading || this.data.busy) return;
    this.setData({
      editor: 'plan',
      form: planFields(this.data.plan),
      formError: '', conflict: false,
    });
  },

  editOuting() {
    if (this.data.busy) return;
    const now = Date.now();
    this.setData({
      editor: 'outing',
      form: {
        title: '', startDate: dateInput(now + HOUR_MS), startTime: timeInput(now + HOUR_MS),
        endDate: dateInput(now + 2 * HOUR_MS), endTime: timeInput(now + 2 * HOUR_MS),
      },
      outingResult: null,
      formError: '', conflict: false,
    });
  },

  editSkip(event) {
    if (this.data.busy) return;
    const { id } = event.currentTarget.dataset;
    this.setData({ editor: 'skip', skipId: id, form: { reason: '' }, formError: '', conflict: false });
  },

  updateField(event) {
    const { field } = event.currentTarget.dataset;
    if (!this.data.busy) this.setData({ ['form.' + field]: event.detail.value, formError: '' });
  },

  confirmPlan(event) {
    if (!this.data.busy) this.setData({ 'form.confirmed': event.detail.value.length > 0, formError: '' });
  },

  closeEditor() {
    if (!this.data.busy) this.setData({ editor: '', form: {}, outingResult: null, formError: '', conflict: false });
  },

  reloadPlan() {
    if (this.data.busy) return;
    this.closeEditor();
    return this.refresh();
  },

  async submitEditor() {
    if (this.data.busy || this.data.conflict || !requireSession()) return;
    const { editor, form, skipId } = this.data;
    this.setData({ busy: true, formError: '' });
    try {
      if (editor === 'plan') {
        await savePlan(form);
        if (this.unloaded) return;
        this.setData({ editor: '', form: {} });
        wx.showToast({ title: '护理方案已生效', icon: 'none' });
      } else if (editor === 'skip') {
        const reason = form.reason.trim();
        if (!reason || reason.length > 300) throw new Error('请填写 300 字以内的未执行原因');
        await request('/tasks/' + encodeURIComponent(skipId) + '/skip', { method: 'POST', data: { reason } });
        if (this.unloaded) return;
        this.setData({ editor: '', form: {}, skipId: '' });
        wx.showToast({ title: '已记录未执行原因', icon: 'none' });
      } else if (editor === 'outing') {
        const now = Date.now();
        const title = form.title.trim();
        const startAt = parseShanghai(form.startDate, form.startTime);
        const endAt = parseShanghai(form.endDate, form.endTime);
        if (!title || title.length > 100) throw new Error('请填写 100 字以内的外出事项');
        if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt
          || endAt - startAt > DAY_MS || startAt < now - 60000 || endAt > now + 30 * DAY_MS) {
          throw new Error('请选择未来 30 天内、时长不超过一天的行程');
        }
        const result = await request('/outings', { method: 'POST', data: { title, startAt, endAt } });
        if (this.unloaded) return;
        this.setData({
          outingResult: {
            message: result.message,
            conflicts: result.conflicts.map(row => ({ ...row, time: formatDateTime(row.due_at), label: taskLabel(row.kind) })),
          },
        });
      }
      await this.refresh();
    } catch (error) {
      if (!this.unloaded && requireSession()) {
        this.setData({ formError: error.message, conflict: error.statusCode === 409 });
      }
    } finally {
      if (!this.unloaded) this.setData({ busy: false });
    }
  },

  recordTask(event) {
    const { id, kind } = event.currentTarget.dataset;
    if (!requireSession() || (kind !== 'drink' && kind !== 'voiding')) return;
    newRecord(kind, { taskId: id });
  },

  confirmDeleteOuting(event) {
    const { id } = event.currentTarget.dataset;
    if (this.data.deletingId || !requireSession()) return;
    wx.showModal({
      title: '删除外出行程',
      content: '确定删除这段行程？',
      confirmText: '删除',
      success: result => {
        if (result.confirm) this.deleteOuting(id);
      },
    });
  },

  async deleteOuting(id) {
    if (this.data.deletingId || !requireSession()) return;
    this.setData({ deletingId: id, error: '' });
    try {
      await request('/outings/' + encodeURIComponent(id), { method: 'DELETE' });
      await this.refresh();
    } catch (error) {
      if (!this.unloaded && requireSession()) this.setData({ error: error.message });
    } finally {
      if (!this.unloaded) this.setData({ deletingId: '' });
    }
  },
});
