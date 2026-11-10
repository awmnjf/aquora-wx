const { getRecordTime, requireSession, request } = require('../../lib/api');
const { DAY_MS, dateInput } = require('../../lib/date');
const { KIND_OPTIONS, recordSummary } = require('../../lib/records');
const { editRecord, newRecord } = require('../../lib/navigation');
const { shareFile } = require('../../lib/csv');

const PAGE_SIZE = 60;

Page({
  data: {
    kind: 'all', kinds: [{ value: 'all', label: '全部' }, ...KIND_OPTIONS],
    groups: [], hasMore: false, loading: false, exporting: false, error: '',
  },

  onShow() { return this.refresh(); },

  async onPullDownRefresh() {
    try { await this.refresh(); } finally { wx.stopPullDownRefresh(); }
  },

  async refresh() {
    if (!requireSession() || this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      this.rows = await request('/events?from=' + Math.max(0, getRecordTime() - 30 * DAY_MS));
      this.limit = PAGE_SIZE;
      this.showRows();
    } catch (error) {
      if (requireSession()) this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  showRows() {
    const filtered = (this.rows || []).filter(row => this.data.kind === 'all' || this.data.kind === row.kind);
    const grouped = new Map();
    for (const row of filtered.slice(0, this.limit)) {
      const date = dateInput(row.occurred_at);
      if (!grouped.has(date)) grouped.set(date, []);
      grouped.get(date).push(recordSummary(row));
    }
    this.setData({
      groups: Array.from(grouped, ([date, records]) => ({ date, records })),
      hasMore: filtered.length > this.limit,
    });
  },

  changeKind(event) {
    this.limit = PAGE_SIZE;
    this.setData({ kind: event.currentTarget.dataset.kind });
    this.showRows();
  },

  loadMore() {
    this.limit += PAGE_SIZE;
    this.showRows();
  },

  openRecord() {
    if (requireSession()) {
      const kind = this.data.kind === 'all' ? 'drink' : this.data.kind;
      newRecord(kind);
    }
  },

  openEdit(event) {
    const row = this.rows?.find(item => item.id === event.currentTarget.dataset.id);
    if (row && requireSession()) editRecord(row);
  },

  async exportRecords() {
    if (!this.rows || this.data.exporting || !requireSession()) return;
    this.setData({ exporting: true, error: '' });
    try {
      await shareFile('水知己-护理记录.json', JSON.stringify({
        exportedAt: new Date().toISOString(),
        events: this.rows,
      }, null, 2));
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ exporting: false });
    }
  },
});
