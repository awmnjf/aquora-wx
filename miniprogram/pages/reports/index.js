const { requireSession, request } = require('../../lib/api');
const { dateInput, parseShanghai, DAY_MS } = require('../../lib/date');
const { editRecord } = require('../../lib/navigation');
const { toCsv, shareCsv } = require('../../lib/csv');
const { recordSummary } = require('../../lib/records');

const KINDS = [
  { id: 'all', label: '全部' },
  { id: 'drink', label: '饮水' },
  { id: 'food', label: '食物' },
  { id: 'voiding', label: '排尿' },
  { id: 'other', label: '其他' },
];
const CSV_COLUMNS = ['日期', '饮水量ml', '饮水次数', '记录摄入ml', '测量排出ml', '排尿导尿次数', '已测量次数', '未测量次数', '尿道感染记录次数', '漏尿次数', '记录数'];
const number = value => Number(value).toLocaleString('zh-CN');
const shortDate = date => date.slice(5).replace('-', '/');
const shiftDate = (date, delta) => dateInput(parseShanghai(date, '00:00') + delta * DAY_MS);
const textRows = rows => (rows || []).map((text, index) => ({ text, index }));

function average(value, volume = false) {
  if (value == null) return '—';
  if (volume && value > 0 && value < 1) return '<1';
  return number(volume ? Math.round(value) : Math.round(value * 100) / 100);
}

function metrics(summary) {
  return [
    { icon: 'drink', label: '日均饮水量', value: average(summary.averageDailyDrinkMl, true), unit: 'ml', note: '仅饮水记录，不含食物水分' },
    { icon: 'voiding', label: '日均排尿量', value: average(summary.averageDailyOutputMl, true), unit: 'ml', note: summary.unmeasured ? summary.unmeasured + ' 次未测量，未计入尿量' : '仅统计已测量尿量' },
    { icon: 'drink', label: '日均饮水次数', value: average(summary.averageDailyDrinkCount), unit: '次', note: '按饮水记录次数计算' },
    { icon: 'leakage', label: '日均排尿次数', value: average(summary.averageDailyVoidCount), unit: '次', note: '含导尿及未测量记录' },
  ].concat([
    { icon: 'symptom', label: '尿道感染次数', value: summary.infections, unit: '次', note: '所选周期内标记次数' },
    { icon: 'leakage', label: '漏尿次数', value: summary.leakage, unit: '次', note: '所选周期内累计次数' },
  ].filter(item => item.value != null));
}

function describeEvent(event) {
  const amount = event.kind === 'leakage' || event.kind === 'symptom'
    ? '›'
    : event.amount_ml == null ? '未测量' : number(event.amount_ml) + ' mL';
  return {
    ...event,
    ...recordSummary(event),
    amount,
    incomplete: event.kind === 'voiding' && event.emptying === 'incomplete',
  };
}

Page({
  data: {
    periods: [7, 30, 90], period: 7, kinds: KINDS, kind: 'all',
    today: '', from: '', to: '', selected: '',
    report: null, metrics: [], chartDays: [], axis: [], selectedDay: null,
    reportBusy: true, reportError: '', events: [], historyBusy: false, historyError: '', hasMore: false,
    interpretation: null, interpretBusy: false, interpretError: '', exporting: false,
  },

  onShow() {
    if (!requireSession()) return;
    const today = dateInput(Date.now());
    const first = !this.data.to;
    this.setData({ today, to: this.data.to || today });
    return this.loadReport(first);
  },

  onUnload() {
    this.unloaded = true;
  },

  async onPullDownRefresh() {
    try {
      await this.loadReport();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  choosePeriod(event) {
    const period = Number(event.currentTarget.dataset.period);
    if (period === this.data.period) return;
    this.setData({ period });
    return this.loadReport(true);
  },

  chooseEnd(event) {
    const to = event.detail.value;
    if (!to || to > this.data.today || to === this.data.to) return;
    this.setData({ to });
    return this.loadReport(true);
  },

  async loadReport(resetDay = false) {
    if (!requireSession() || !this.data.to) return;
    const token = this.reportToken = {};
    const { to, period, selected } = this.data;
    const from = shiftDate(to, 1 - period);
    this.historyToken = null;
    this.interpretToken = null;
    this.setData({
      from, report: null, reportBusy: true, reportError: '',
      events: [], hasMore: false, historyError: '', historyBusy: false,
      interpretation: null, interpretBusy: false, interpretError: '',
    });
    try {
      const report = await request('/personal-report?from=' + from + '&to=' + to);
      if (this.unloaded || this.reportToken !== token) return;
      const days = report.days;
      const latest = days.slice().reverse().find(day => day.records);
      const day = (!resetDay && days.find(entry => entry.date === selected)) || latest || days[days.length - 1];
      const maximum = Math.ceil(Math.max(500, ...days.map(entry => Math.max(entry.intake, entry.output))) / 500) * 500;
      const chartDays = days.map(entry => ({
        date: entry.date,
        label: entry.date.slice(8),
        intakeHeight: entry.drinks + entry.foods ? Math.max(1, entry.intake / maximum * 100) : 0,
        outputHeight: entry.measured ? Math.max(1, entry.output / maximum * 100) : 0,
        records: entry.records,
      }));
      this.setData({
        report, chartDays, metrics: metrics(report.summary),
        axis: [number(maximum), number(maximum / 2), '0'], reportBusy: false,
        rangeLabel: shortDate(from) + ' – ' + shortDate(to),
        rangeDates: from.replace(/-/g, '.') + ' — ' + to.replace(/-/g, '.'),
      });
      return this.chooseDay(day.date);
    } catch (error) {
      if (this.unloaded || this.reportToken !== token || !requireSession()) return;
      this.setData({ reportError: error.message, reportBusy: false });
    }
  },

  retryReport() {
    return this.loadReport();
  },

  reloadAfterEdit() {
    return this.loadReport();
  },

  chooseChartDay(event) {
    return this.chooseDay(event.currentTarget.dataset.date);
  },

  chooseHistoryDay(event) {
    return this.chooseDay(event.detail.value);
  },

  stepDay(event) {
    return this.chooseDay(shiftDate(this.data.selected, Number(event.currentTarget.dataset.step)));
  },

  chooseDay(date) {
    if (!date || date < this.data.from || date > this.data.to) return;
    const day = this.data.report && this.data.report.days.find(entry => entry.date === date);
    this.setData({
      selected: date,
      selectedDay: day && {
        date: shortDate(date),
        intake: day.drinks + day.foods ? number(day.intake) + ' mL' : '—',
        output: day.measured ? number(day.output) + ' mL' : '—',
        records: day.records,
      },
    });
    return this.loadHistory(0);
  },

  chooseKind(event) {
    const kind = event.currentTarget.dataset.kind;
    if (kind === this.data.kind) return;
    this.setData({ kind });
    return this.loadHistory(0);
  },

  loadMore() {
    if (this.data.hasMore && !this.data.historyBusy) return this.loadHistory(this.data.events.length);
  },

  retryHistory() {
    return this.loadHistory(this.data.events.length);
  },

  async loadHistory(offset) {
    if (!requireSession()) return;
    const token = this.historyToken = {};
    const { selected, kind, events } = this.data;
    this.setData({ events: offset ? events : [], historyBusy: true, historyError: '', hasMore: false });
    try {
      const result = await request('/personal-report/events?date=' + selected + '&kind=' + kind + '&offset=' + offset);
      if (this.unloaded || this.historyToken !== token) return;
      this.setData({
        events: (offset ? events : []).concat(result.events.map(describeEvent)),
        hasMore: result.hasMore,
        historyBusy: false,
      });
    } catch (error) {
      if (this.unloaded || this.historyToken !== token || !requireSession()) return;
      this.setData({ historyError: error.message, historyBusy: false });
    }
  },

  openEvent(event) {
    const selected = this.data.events.find(entry => entry.id === event.currentTarget.dataset.id);
    if (selected) editRecord(selected);
  },

  async interpret() {
    if (this.data.interpretBusy || !this.data.report || !requireSession()) return;
    const token = this.interpretToken = {};
    const { from, to } = this.data;
    this.setData({ interpretBusy: true, interpretError: '' });
    try {
      const result = await request('/personal-report/interpret', { method: 'POST', data: { from, to }, timeout: 55000 });
      if (this.unloaded || this.interpretToken !== token) return;
      if (!result.available) throw new Error(result.message || '解读暂未生成，请重试');
      this.setData({
        interpretation: {
          ...result, observations: textRows(result.observations), suggestions: textRows(result.suggestions),
        },
        interpretBusy: false,
      });
    } catch (error) {
      if (this.unloaded || this.interpretToken !== token || !requireSession()) return;
      this.setData({ interpretError: error.message, interpretBusy: false });
    }
  },

  async exportReport() {
    if (this.data.exporting || !this.data.report || !requireSession()) return;
    const { from, to, report } = this.data;
    const rows = report.days.map(day => [
      day.date, day.drinks ? day.drinkVolume : '', day.drinks,
      day.drinks + day.foods ? day.intake : '', day.measured ? day.output : '',
      day.voids, day.measured, day.unmeasured, day.infections, day.leakage, day.records,
    ]);
    this.setData({ exporting: true });
    try {
      await shareCsv('水知己-个人报告-' + from + '-' + to + '.csv', toCsv(CSV_COLUMNS, rows));
    } catch (error) {
      wx.showToast({ title: error.message || '导出失败，请重试', icon: 'none' });
    } finally {
      if (!this.unloaded) this.setData({ exporting: false });
    }
  },
});
