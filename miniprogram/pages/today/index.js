const { getDashboard, getRecordTime, getSession, requireSession, request } = require('../../lib/api');
const { DAY_MS, dateInput, timeInput, formatDateTime } = require('../../lib/date');
const { recordSummary } = require('../../lib/records');
const { newRecord, editRecord, draftRecord } = require('../../lib/navigation');
const { voiceInput } = require('../../lib/voice-input');

const QUICK_KINDS = [
  { value: 'drink', label: '饮水' },
  { value: 'food', label: '食物' },
  { value: 'voiding', label: '排尿' },
];

function waterTone(current, target) {
  if (!target) return 'green';
  if (current >= target) return 'red';
  return current >= target * 2 / 3 ? 'amber' : 'green';
}

function showDashboard(dashboard, recent) {
  const now = dashboard.updatedAt || getRecordTime();
  const today = dateInput(now);
  const drinks = dashboard.events.filter(row => row.kind === 'drink').reduce((sum, row) => sum + (row.amount_ml || 0), 0);
  const goal = Number(dashboard.plan?.data?.waterGoal) || 0;
  const records = recent.map(row => {
    const record = recordSummary(row);
    return {
      ...record, time: (dateInput(row.occurred_at) === today ? '' : '昨天 ') + record.time,
      volume: row.amount_ml, kind: row.kind,
    };
  });
  return {
    drinks, goal, progress: goal ? Math.min(100, Math.round(drinks / goal * 100)) : 0,
    records, timeline: records.slice().reverse(), timelineEnd: 'now-' + (recent[0]?.occurred_at || 0),
  };
}

function showEstimate(state) {
  if (!state.available || !Number.isFinite(state.current)) {
    const footer = state.failed ? '更新失败' : state.code === 'insufficient_history'
      ? '校准记录 ' + (state.calibrationIntervals || 0) + '/3' : '记录后自动更新';
    return { available: false, message: state.message || '当前暂无估算', footer, percent: 0 };
  }
  const absolute = state.volumeKind === 'absolute';
  const forecast = state.fullness;
  const scale = Math.round(forecast?.scaleMl ?? 400);
  const percent = forecast?.waterPercent ?? (forecast && scale > 0 ? state.current / scale * 100 : 0);
  let target = '';
  let when = '';
  if (forecast) {
    target = (forecast.basis === 'net_gain' ? '预计新增 ' : '预计达到 ') + forecast.targetMl + ' mL';
    if (forecast.minutes == null) when = (forecast.horizonMinutes || 360) / 60 + '小时内未达';
    else if (forecast.minutes === 0) when = '已到参考量';
    else {
      const at = state.computedAt + forecast.minutes * 60000;
      when = (dateInput(at) === dateInput(state.computedAt) ? '' : '明天 ') + timeInput(at);
    }
  }
  const footer = !forecast ? '记录后自动更新' : forecast.basis === 'net_gain'
    ? '按新增尿量估算，实际充盈可能更早'
    : forecast.source === 'personal' ? '按您在“我的”里填写的尿量估算' : '按默认充盈参考量估算';
  return {
    available: true, amount: state.current, label: absolute ? '现在膀胱里约有' : '估计增加了约',
    initial: state.model === 'starter_response',
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0,
    target, when, absolute, footer, scale, targetMl: forecast?.targetMl, tone: waterTone(state.current, forecast?.targetMl),
    points: (state.points || []).filter(point => [30, 60, 120, 240, 360].includes(point.minutes)).map(point => ({
      ...point, time: point.minutes < 60 ? point.minutes + ' 分钟' : point.minutes / 60 + ' 小时',
    })),
    source: state.anchorAt ? formatDateTime(state.anchorAt) : '',
    range: state.low == null || state.high == null ? '' : state.low + '–' + state.high + ' mL',
    intervals: state.calibration?.intervals || 0,
    computed: state.computedAt ? timeInput(state.computedAt) : '',
  };
}

Page({
  data: {
    overview: null, estimate: { percent: 0, footer: '正在更新膀胱状态…' }, kinds: QUICK_KINDS,
    loading: true, recentLoading: true, error: '',
    mode: 'home', details: false, moreEstimate: false, expanded: false, deleting: false,
    voice: 'idle', busy: false,
  },
  ...voiceInput,
  onLoad() {
    this.voiceEpoch = 0;
  },
  onShow() {
    this.visible = true;
    this.token = getSession()?.token;
    return this.refresh();
  },
  onHide() {
    this.visible = false;
    if (this.data.voice !== 'idle') this.cancelVoice();
    this.setData({ details: false, moreEstimate: false, busy: false });
  },
  async onPullDownRefresh() {
    try { await this.refresh(); } finally { wx.stopPullDownRefresh(); }
  },
  onUnload() {
    this.disposed = true;
    this.visible = false;
    if (this.data.voice !== 'idle') this.cancelVoice();
    this.refreshId = (this.refreshId || 0) + 1;
  },
  async refresh() {
    if (!requireSession()) return;
    const session = getSession();
    const refreshId = this.refreshId = (this.refreshId || 0) + 1;
    this.setData({ loading: true, recentLoading: true, error: '', recentError: '' });
    const current = () => refreshId === this.refreshId && getSession()?.token === session.token;
    const dashboardRequest = getDashboard();
    const estimateRequest = request('/state')
      .catch(error => ({ available: false, message: error.message, failed: true }))
      .then(state => { if (current()) this.setData({ estimate: showEstimate(state) }); });
    const recentRequest = request('/events?from=' + Math.max(0, getRecordTime() - DAY_MS))
      .catch(error => error);

    try {
      const dashboard = await dashboardRequest;
      if (!current()) {
        if (refreshId === this.refreshId) requireSession();
        return;
      }
      this.currentPlan = dashboard.plan;
      this.showRecent(dashboard, dashboard.events);
      this.setData({ loading: false });

      const recent = await recentRequest;
      if (!current()) {
        if (refreshId === this.refreshId) requireSession();
        return;
      }
      if (Array.isArray(recent)) this.showRecent(dashboard, recent);
      else this.setData({ recentError: recent.message || '最近记录暂时无法读取' });
    } catch (error) {
      if (refreshId === this.refreshId && requireSession()) this.setData({ error: error.message });
    } finally {
      if (refreshId === this.refreshId) this.setData({ loading: false, recentLoading: false });
    }
    await estimateRequest;
  },

  showRecent(dashboard, rows) {
    const now = getRecordTime();
    this.recent = rows.filter(row => Number.isFinite(row.occurred_at) && row.occurred_at >= now - DAY_MS && row.occurred_at <= now)
      .sort((left, right) => right.occurred_at - left.occurred_at);
    this.setData({ overview: showDashboard(dashboard, this.recent) });
  },
  chooseMode(event) {
    if (!this.data.busy && this.data.voice === 'idle') this.setData({ mode: event.currentTarget.dataset.mode });
  },
  toggleDetails() {
    this.setData({ details: !this.data.details, moreEstimate: false });
  },
  toggleEstimateMethod() {
    this.setData({ moreEstimate: !this.data.moreEstimate });
  },
  openRecord(event) {
    if (!requireSession()) return;
    const kind = event?.currentTarget?.dataset?.kind || 'drink';
    newRecord(kind, { simple: true });
  },
  editRecent(event) {
    const row = this.recent?.find(item => item.id === event.currentTarget.dataset.id);
    if (row && requireSession()) editRecord(row);
  },
  toggleRecent() {
    this.setData({ expanded: !this.data.expanded });
  },

  confirmDelete(event) {
    const row = this.recent?.find(item => item.id === event.currentTarget.dataset.id);
    if (!row || this.data.deleting || !requireSession()) return;
    const summary = recordSummary(row);
    wx.showModal({
      title: '删除这条记录？', content: [summary.time, summary.label, summary.amount].filter(Boolean).join(' · '),
      confirmText: '确认删除', confirmColor: '#a35043',
      success: result => { if (result.confirm) this.deleteRecent(row); },
    });
  },

  async deleteRecent(row) {
    if (this.data.deleting || !requireSession()) return;
    this.setData({ deleting: true, recentError: '' });
    try {
      await request('/events/' + encodeURIComponent(row.id) + '/revoke', {
        method: 'POST', data: { version: row.version, reason: '用户在今日页面确认删除' },
      });
      wx.showToast({ title: '记录已删除', icon: 'success' });
      await this.refresh();
    } catch (error) {
      if (requireSession()) this.setData({ recentError: error.message });
    } finally {
      this.setData({ deleting: false });
    }
  },

  openGoal() {
    if (this.currentPlan) this.selectComponent('#plan-editor')?.openEditor(this.currentPlan);
  },

  ownsSession(token) {
    return !this.disposed && getSession()?.token === token;
  },

  showError(error) {
    if (requireSession()) this.setData({ voiceError: error.message });
  },

  async handleVoiceText(text, scenario) {
    const epoch = this.voiceEpoch;
    const token = this.token;
    this.setData({ busy: true, voiceError: '' });
    try {
      const answer = await request('/agent/run', { method: 'POST', timeout: 65000, data: { message: text, scenario } });
      if (!this.visible || epoch !== this.voiceEpoch || !this.ownsSession(token)) return;
      getApp().showMessage(answer.reply || answer.message || '暂时无法回答，请稍后重试。');
      if (answer.candidate) draftRecord({ ...answer.candidate, source: 'assistant' });
    } finally {
      if (epoch === this.voiceEpoch && this.ownsSession(token)) this.setData({ busy: false });
    }
  },
});
