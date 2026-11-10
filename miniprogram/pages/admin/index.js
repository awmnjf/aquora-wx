const { getSession, requireSession, request } = require('../../lib/api');
const { formatDateTime } = require('../../lib/date');

const TABS = [
  { id: 'users', label: '账号管理' },
  { id: 'knowledge', label: '知识发布' },
  { id: 'audit', label: '审计日志' },
  { id: 'config', label: '接入状态' },
  { id: 'ridge', label: '算法研究' },
];
const STATUSES = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已审核，发布' },
  { value: 'archived', label: '下线' },
];
const KNOWLEDGE_LABELS = { draft: '草稿', published: '已发布', archived: '已下线' };
const MODES = [
  { id: 'advance', label: '普通提前预测' },
  { id: 'conditional', label: '给定饮水计划' },
];
const MODE_LABELS = Object.fromEntries(MODES.map(mode => [mode.id, mode.label]));
const FEATURE_LABELS = {
  previous_production: '上一时段产尿量',
  clock_sin: '日周期 · 正弦',
  clock_cos: '日周期 · 余弦',
  drink_0_30: '饮水 0–30 分钟',
  drink_30_60: '饮水 30–60 分钟',
  drink_60_120: '饮水 60–120 分钟',
  drink_120_240: '饮水 2–4 小时',
  drink_240_480: '饮水 4–8 小时',
  drink_480_720: '饮水 8–12 小时',
  drink_720_1440: '饮水 12–24 小时',
  planned_0_60: '计划 · 第 1 小时',
  planned_60_120: '计划 · 第 2 小时',
};
const decimal = value => value == null ? '—' : Number(value).toFixed(1);
const stats = (source, entries) => entries.map(([key, label]) => ({ key, label, value: source[key] ?? '—' }));
const overviewStats = source => stats(source, [
  ['users', '正式账号'], ['demos', '体验空间'], ['events', '已保存事件'], ['knowledge', '已发布知识'],
]);

function score(label, value = {}) {
  return { label, n: value.n ?? '—', mae: decimal(value.mae), rmse: decimal(value.rmse), bias: decimal(value.bias) };
}

function syntheticRun(synthetic, mode) {
  const run = synthetic.results.find(item => item.mode === mode);
  if (!run) return null;
  const { metrics, examples } = run;
  const maximum = Math.max(1, ...examples.map(row => Math.max(row.actual, row.prediction)));
  return {
    rows: [
      score('个人岭回归', metrics.ridge), score('上一时段产尿量', metrics.previous),
      score('延迟响应灰箱', metrics.grey), score('群体岭回归 · 整人留出', metrics.unseenPerson),
    ],
    trace: examples.map((row, index) => ({
      index, number: index + 1, actual: decimal(row.actual), prediction: decimal(row.prediction),
      actualHeight: row.actual / maximum * 100, predictionHeight: row.prediction / maximum * 100,
    })),
  };
}

function describeMonitor(data) {
  const { synthetic, daily } = data.benchmark;
  return {
    asOf: formatDateTime(data.asOf),
    live: stats(data.live, [['people', '参加人数'], ['events', '采集事件'], ['windows', '研究窗口'], ['verified', '已核验'], ['overdue', '到期待核验']]),
    scores: data.scores.map(row => score(MODE_LABELS[row.mode] + ' · ' + row.version + ' / ' + String(row.model_id || '').slice(0, 7), row)),
    synthetic: {
      people: synthetic.people, train: synthetic.train, validation: synthetic.validation, test: synthetic.test,
      runs: Object.fromEntries(MODES.map(mode => [mode.id, syntheticRun(synthetic, mode.id)])),
    },
    daily: {
      people: daily.people, days: daily.days, rawRows: daily.rawRows,
      candidateDays: daily.candidateDays, missingDiet: daily.missingDiet,
      scores: [
        score('液体摄入、体重、年龄', daily.metrics.basic),
        score('加入饮食成分', daily.metrics.diet),
        score('训练人群均值', daily.metrics.trainMean),
      ],
    },
  };
}

function describeProviders(status) {
  if (!status.services) return [];
  return [['chat', '文本问答'], ['vision', '图像理解'], ['asr', '语音识别'], ['tts', '语音合成']].map(([key, label]) => {
    const service = status.services[key] || {};
    return {
      key, label,
      models: (service.providers || []).map(provider => provider.model).join(' → ') || '未配置',
      available: service.available,
      state: service.available ? '可调用' : service.configured ? '暂不可用' : '未配置',
    };
  });
}

Page({
  data: {
    allowed: false, tabs: TABS, tab: 'users', overview: overviewStats({}), overviewError: '',
    users: [], knowledge: [], audit: [], config: null, providers: [], providerError: '',
    sectionBusy: false, sectionError: '', statusBusy: '', reloadBusy: false,
    draft: null, statusIndex: 0, statuses: STATUSES, editorBusy: false, editorError: '',
    research: null, run: null, modeOptions: MODES, mode: 'advance',
    exampleVolume: '100', examplePlan: '150', exampleModeIndex: 0, example: null, exampleBusy: false, exampleError: '',
    showContributions: false,
  },

  onLoad(options = {}) {
    if (TABS.some(tab => tab.id === options.view)) this.setData({ tab: options.view });
  },

  onShow() {
    if (!requireSession()) return;
    const session = getSession();
    if (session.user?.role !== 'admin') return this.setData({ allowed: false });
    this.setData({ allowed: true });
    clearInterval(this.monitorTimer);
    this.monitorTimer = setInterval(() => {
      if (this.data.tab === 'ridge' && !this.data.sectionBusy) this.loadTab();
    }, 60000);
    return Promise.all([this.loadOverview(), this.loadTab()]);
  },

  onHide() {
    clearInterval(this.monitorTimer);
  },

  onUnload() {
    this.onHide();
    this.unloaded = true;
  },

  authorized(error) {
    if (this.unloaded) return false;
    if (!requireSession()) return false;
    if (error?.statusCode === 403 || getSession().user?.role !== 'admin') {
      clearInterval(this.monitorTimer);
      this.knowledgeEntries = [];
      this.setData({
        allowed: false, overview: overviewStats({}), users: [], knowledge: [], audit: [], config: null,
        providers: [], research: null, run: null, draft: null, example: null,
      });
    }
    return this.data.allowed;
  },

  async loadOverview() {
    if (!this.authorized()) return;
    const token = this.overviewToken = {};
    this.setData({ overviewError: '' });
    try {
      const result = await request('/admin/overview');
      if (this.overviewToken === token && this.authorized()) this.setData({ overview: overviewStats(result) });
    } catch (error) {
      if (this.overviewToken === token && this.authorized(error)) this.setData({ overviewError: error.message });
    }
  },

  async loadTab() {
    if (!this.authorized()) return;
    const token = this.sectionToken = {};
    const { tab } = this.data;
    this.setData({ sectionBusy: true, sectionError: '' });
    try {
      let patch;
      if (tab === 'config') {
        const [config, ai] = await Promise.all([request('/admin/integrations'), request('/admin/ai/providers')]);
        patch = {
          config: { ...config, items: stats(config, [['model', '大模型问答'], ['wechat', '微信登录'], ['alipay', '支付宝登录'], ['sms', '短信验证码']]) },
          providers: describeProviders(ai),
          providerError: ai.config_error ? 'AI 配置文件无效，服务继续使用上次有效配置。' : '',
        };
      } else if (tab === 'ridge') {
        const research = describeMonitor(await request('/admin/research/monitor'));
        patch = { research, run: research.synthetic.runs[this.data.mode] };
      } else {
        const rows = await request('/admin/' + tab);
        if (this.sectionToken !== token || !this.authorized()) return;
        if (tab === 'users') {
          patch = { users: rows.map(row => ({
            ...row,
            roleLabel: row.role === 'admin' ? '管理员' : row.demo ? '体验' : '正式用户',
            statusLabel: row.status === 'active' ? '正常' : '已停用',
          })) };
        } else if (tab === 'knowledge') {
          this.knowledgeEntries = rows;
          patch = { knowledge: rows.map(({ id, title, source, version, status }) => ({
            id, title, source, version, status, statusLabel: KNOWLEDGE_LABELS[status] || status,
          })) };
        } else {
          patch = { audit: rows.map(row => ({ ...row, time: formatDateTime(row.created_at) })) };
        }
      }
      if (this.sectionToken === token && this.authorized()) this.setData({ ...patch, sectionBusy: false });
    } catch (error) {
      if (this.sectionToken === token && this.authorized(error)) this.setData({ sectionBusy: false, sectionError: error.message });
    }
  },

  chooseTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab === this.data.tab || this.data.editorBusy) return;
    this.setData({ tab, draft: null, editorError: '' });
    return this.loadTab();
  },

  async toggleStatus(event) {
    if (this.data.statusBusy || !this.authorized()) return;
    const user = this.data.users.find(row => row.id === event.currentTarget.dataset.id);
    if (!user || user.role === 'admin') return;
    const status = user.status === 'active' ? 'disabled' : 'active';
    this.setData({ statusBusy: user.id, sectionError: '' });
    try {
      await request('/admin/users/' + encodeURIComponent(user.id) + '/status', { method: 'POST', data: { status } });
      if (!this.authorized()) return;
      wx.showToast({ title: '账号状态已更新', icon: 'success' });
      if (this.data.tab === 'users') await this.loadTab();
    } catch (error) {
      if (this.authorized(error) && this.data.tab === 'users') this.setData({ sectionError: error.message });
    } finally {
      if (!this.unloaded) this.setData({ statusBusy: '' });
    }
  },

  openEditor(event) {
    const initial = (this.knowledgeEntries || []).find(row => row.id === event.currentTarget.dataset.id);
    const draft = initial || { title: '', source: '', content: '', status: 'draft' };
    this.setData({ draft, statusIndex: Math.max(0, STATUSES.findIndex(item => item.value === draft.status)), editorError: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 150 });
  },

  closeEditor() {
    if (!this.data.editorBusy) this.setData({ draft: null, editorError: '' });
  },

  chooseStatus(event) {
    this.setData({ statusIndex: Number(event.detail.value) });
  },

  async saveKnowledge(event) {
    if (this.data.editorBusy || !this.data.draft || !this.authorized()) return;
    const { title, source, content } = event.detail.value;
    if (![title, source, content].every(value => value.trim())) {
      this.setData({ editorError: '请填写标题、正文和来源' });
      return;
    }
    const { draft, statusIndex } = this.data;
    this.setData({ editorBusy: true, editorError: '' });
    try {
      await request('/admin/knowledge', { method: 'POST', data: {
        id: draft.id, title: title.trim(), source: source.trim(), content: content.trim(), status: STATUSES[statusIndex].value,
      } });
      if (!this.authorized()) return;
      this.setData({ draft: null });
      wx.showToast({ title: '内容已保存', icon: 'success' });
      await Promise.all([this.loadOverview(), this.loadTab()]);
    } catch (error) {
      if (this.authorized(error)) this.setData({ editorError: error.message });
    } finally {
      if (!this.unloaded) this.setData({ editorBusy: false });
    }
  },

  async reloadAi() {
    if (this.data.reloadBusy || !this.authorized()) return;
    this.setData({ reloadBusy: true, sectionError: '' });
    try {
      const result = await request('/admin/ai/reload', { method: 'POST' });
      if (!this.authorized()) return;
      if (result.available === false && !result.services) throw new Error(result.message || 'AI 配置暂时无法读取');
      wx.showToast({ title: '已读取 AI 配置', icon: 'success' });
      if (this.data.tab === 'config') await this.loadTab();
    } catch (error) {
      if (this.authorized(error) && this.data.tab === 'config') this.setData({ sectionError: error.message });
    } finally {
      if (!this.unloaded) this.setData({ reloadBusy: false });
    }
  },

  chooseResearchMode(event) {
    const mode = event.currentTarget.dataset.mode;
    const { research } = this.data;
    if (research) this.setData({ mode, run: research.synthetic.runs[mode] });
  },

  chooseExampleMode(event) {
    this.setData({ exampleModeIndex: Number(event.detail.value), example: null, exampleError: '' });
  },

  updateExampleVolume(event) {
    this.setData({ exampleVolume: event.detail.value, example: null, exampleError: '' });
  },

  updateExamplePlan(event) {
    this.setData({ examplePlan: event.detail.value, example: null, exampleError: '' });
  },

  async runExample() {
    if (this.data.exampleBusy || !this.authorized()) return;
    const { exampleVolume, examplePlan, exampleModeIndex } = this.data;
    const mode = MODES[exampleModeIndex].id;
    const volume = Number(exampleVolume);
    const plan = Number(examplePlan);
    if (!exampleVolume.trim() || !Number.isFinite(volume) || volume < 0 || volume > 1000
      || (mode === 'conditional' && (!examplePlan.trim() || !Number.isFinite(plan) || plan < 0 || plan > 3000))) {
      this.setData({ exampleError: '请填写 0–1000 mL 的产尿量和 0–3000 mL 的计划饮水量' });
      return;
    }
    const t = 1704074400000;
    this.setData({ exampleBusy: true, example: null, exampleError: '', showContributions: false });
    try {
      const result = await request('/admin/research/example', { method: 'POST', data: {
        t, timezone: 'Asia/Shanghai', startMl: 0, currentMl: volume, expelledMl: 0,
        drinks: [{ occurredAt: t - 1800000, recordedAt: t - 1800000, amountMl: 200 }],
        plans: mode === 'conditional' ? [{ occurredAt: t + 1800000, recordedAt: t, amountMl: plan }] : null,
      } });
      if (!this.authorized()) return;
      const prediction = result[mode];
      if (!prediction) throw new Error('未取得有效的研究预测');
      this.setData({ example: {
        predicted: decimal(prediction.predictedMl), raw: decimal(prediction.rawMl),
        intercept: decimal(prediction.intercept), alpha: prediction.alpha,
        contributions: Object.entries(FEATURE_LABELS).map(([key, label]) => ({
          key, label, value: decimal(prediction.contributions[key]),
        })),
      } });
    } catch (error) {
      if (this.authorized(error)) this.setData({ exampleError: error.message });
    } finally {
      if (!this.unloaded) this.setData({ exampleBusy: false });
    }
  },

  toggleContributions() {
    this.setData({ showContributions: !this.data.showContributions });
  },

  copyResearchSource() {
    wx.setClipboardData({ data: 'https://doi.org/10.1186/s40795-022-00660-2' });
  },
});
