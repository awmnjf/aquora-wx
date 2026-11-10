const { getRecordTime, requireSession, request } = require('../../lib/api');
const { dateInput, timeInput, parseShanghai, formatDateTime, DAY_MS } = require('../../lib/date');
const { KIND_OPTIONS, KIND_LABELS, DRINK_OPTIONS } = require('../../lib/records');

const EMPTYING_OPTIONS = [
  { value: 'unknown', label: '未确认' },
  { value: 'complete', label: '已排尽' },
  { value: 'incomplete', label: '未排尽' },
];
const PRESETS = { drink: [150, 250, 350], food: [100, 200, 300], voiding: [150, 300] };

function optionIndex(options, value) {
  return Math.max(0, options.findIndex(option => option.value === value));
}

function newRecordKey() {
  return 'mini-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

const data = {
  kind: 'drink',
  kindOptions: KIND_OPTIONS,
  drinkOptions: DRINK_OPTIONS,
  drinkIndex: 0,
  emptyingOptions: EMPTYING_OPTIONS,
  emptyingIndex: 0,
  amount: '',
  presets: PRESETS.drink,
  note: '',
  showMore: false,
  fromPhoto: false,
  urinaryInfection: false,
  urineLeakage: false,
  reason: '',
  date: '',
  time: '',
  latestDate: '',
  editing: false,
  waiting: false,
  linkedTask: false,
  fromAssistant: false,
  history: [],
  historyError: '',
  submitting: false,
  error: '',
};

const methods = {
  initialize(options = {}) {
    const now = getRecordTime();
    this.setData({ ...data, fromPhoto: Boolean(options.fromPhoto), date: dateInput(now), time: timeInput(now), latestDate: dateInput(now) });
    this.editingRecord = null;
    this.initialTime = null;
    this.timeChanged = false;
    this.pending = null;
    if (options.simple) this.setData({
      kindOptions: KIND_OPTIONS.slice(0, 3).map(option => ({
        ...option, label: { drink: '饮水', food: '食物', voiding: '排尿' }[option.value],
      })),
    });
    if (KIND_LABELS[options.kind]) this.setData({ kind: options.kind, presets: PRESETS[options.kind] || [] });

    this.taskId = options.taskId || null;
    if (this.taskId) {
      const kinds = options.kind === 'voiding' ? ['voiding'] : ['drink', 'food'];
      this.setData({
        linkedTask: true,
        kind: kinds[0],
        presets: PRESETS[kinds[0]],
        kindOptions: KIND_OPTIONS.filter(option => kinds.includes(option.value)),
      });
    }
  },

  loadRecord(record) {
    const time = record.occurred_at ?? record.occurredAt;
    const amount = record.amount_ml ?? record.amountMl;
    const kind = KIND_LABELS[record.kind] ? record.kind : 'drink';
    if (record.id && Number.isInteger(record.version)) this.editingRecord = record;
    this.initialTime = Number.isFinite(time) ? time : null;
    this.setData({
      kind,
      presets: PRESETS[kind] || [],
      amount: amount == null ? '' : String(amount),
      note: record.note || '',
      urinaryInfection: typeof record.urinary_infection === 'boolean' ? record.urinary_infection : this.editingRecord ? null : false,
      urineLeakage: typeof record.urine_leakage === 'boolean' ? record.urine_leakage : this.editingRecord ? null : false,
      drinkIndex: optionIndex(DRINK_OPTIONS, record.drink_type || record.drinkType),
      emptyingIndex: optionIndex(EMPTYING_OPTIONS, record.emptying),
      editing: Boolean(this.editingRecord),
      waiting: false,
      fromAssistant: !this.editingRecord && record.source === 'assistant',
      ...(this.initialTime == null ? {} : { date: dateInput(time), time: timeInput(time) }),
    });
    if (this.editingRecord) this.loadHistory();
  },

  async loadHistory() {
    const record = this.editingRecord;
    if (!record) return;
    try {
      const items = await request('/events/' + encodeURIComponent(record.id) + '/history');
      if (record === this.editingRecord) {
        this.setData({ history: items.map(row => ({ ...row, time: formatDateTime(row.created_at) })), historyError: '' });
      }
    } catch (error) {
      if (record === this.editingRecord) this.setData({ historyError: error.message });
    }
  },

  chooseKind(event) {
    const kind = event.currentTarget.dataset.kind;
    if (!this.data.submitting && kind !== this.data.kind && this.data.kindOptions.some(option => option.value === kind)) {
      this.setData({ kind, amount: '', presets: PRESETS[kind] || [], error: '' });
    }
  },

  changeAmount(event) {
    this.setData({ amount: event.detail.value });
  },

  chooseAmount(event) {
    if (!this.data.submitting) this.setData({ amount: String(event.currentTarget.dataset.amount ?? '') });
  },

  chooseDrink(event) {
    const index = Number(event.detail.value);
    if (DRINK_OPTIONS[index]) this.setData({ drinkIndex: index });
  },

  chooseEmptying(event) {
    const index = Number(event.detail.value);
    if (EMPTYING_OPTIONS[index]) this.setData({ emptyingIndex: index });
  },

  chooseDate(event) {
    this.timeChanged = true;
    this.setData({ date: event.detail.value });
  },

  chooseTime(event) {
    this.timeChanged = true;
    this.setData({ time: event.detail.value });
  },

  changeNote(event) {
    this.setData({ note: event.detail.value });
  },

  toggleMore() {
    this.setData({ showMore: !this.data.showMore });
  },

  toggleObservation(event) {
    const field = event.currentTarget.dataset.field;
    if (field === 'urinaryInfection' || field === 'urineLeakage') {
      this.setData({ [field]: event.detail.value });
    }
  },

  openPhoto() {
    if (this.data.submitting) return;
    wx.navigateTo({
      url: '/pages/photo/index?fromRecord=1&kind=' + this.data.kind,
      events: {
        recordPhoto: candidate => {
          if (!this.data.kindOptions.some(option => option.value === candidate.kind)) return;
          this.setData({
            kind: candidate.kind, presets: PRESETS[candidate.kind] || [], amount: String(candidate.amountMl),
            drinkIndex: candidate.drinkType ? optionIndex(DRINK_OPTIONS, candidate.drinkType) : this.data.drinkIndex,
            note: candidate.note || this.data.note, fromAssistant: true, error: '',
          });
        },
      },
    });
  },

  changeReason(event) {
    this.setData({ reason: event.detail.value });
  },

  async onSubmit(event) {
    if (this.data.submitting || this.data.waiting || !requireSession()) return;
    const { amount, note, reason } = event.detail.value;
    const { kind, drinkIndex, emptyingIndex } = this.data;
    const text = String(amount ?? '').trim();
    const amountMl = text ? Number(text) : null;
    if (text && (!/^\d+$/.test(text) || amountMl > 3000)) {
      this.setData({ error: '请输入 0 到 3000 之间的整数毫升数' });
      return;
    }
    if ((kind === 'drink' || kind === 'food') && !amountMl) {
      this.setData({ error: '请填写摄入量' });
      return;
    }

    const now = getRecordTime();
    const specifiedTime = this.timeChanged ? parseShanghai(this.data.date, this.data.time) : this.initialTime;
    const occurredAt = specifiedTime ?? now;
    if (!Number.isFinite(occurredAt) || occurredAt > now + 60000 || occurredAt < now - 366 * DAY_MS) {
      this.setData({ error: '记录时间需在过去一年内，且不能晚于现在' });
      return;
    }

    const values = {
      kind,
      amountMl,
      drinkType: kind === 'drink' || kind === 'food' ? DRINK_OPTIONS[drinkIndex].value : null,
      emptying: kind === 'voiding' ? EMPTYING_OPTIONS[emptyingIndex].value : 'unknown',
      note: String(note ?? this.data.note).trim(),
      source: this.data.fromAssistant ? 'assistant' : 'manual',
      taskId: this.taskId || null,
    };

    if (kind === 'voiding') {
      for (const field of ['urinaryInfection', 'urineLeakage']) {
        const value = this.data[field];
        if (typeof value === 'boolean') values[field] = value ? 'yes' : 'no';
      }
    }

    if (this.editingRecord) {
      const changeReason = String(reason || this.data.reason).trim();
      if (!changeReason) {
        this.setData({ error: '请填写修订原因' });
        return;
      }
      await this.save(
        '/events/' + encodeURIComponent(this.editingRecord.id), 'PUT',
        { ...values, occurredAt, version: this.editingRecord.version, reason: changeReason }, '已修订',
      );
      return;
    }

    const signature = JSON.stringify({ ...values, specifiedTime });
    if (!this.pending || this.pending.signature !== signature) {
      this.pending = { signature, record: { ...values, occurredAt, idempotencyKey: newRecordKey() } };
    }
    await this.save('/events', 'POST', this.pending.record, '已保存');
  },

  revoke() {
    if (this.data.submitting || !this.editingRecord || !requireSession()) return;
    const reason = this.data.reason.trim();
    if (!reason) {
      this.setData({ error: '请填写撤销原因' });
      return;
    }
    wx.showModal({
      title: '撤销这笔记录',
      content: '撤销后，今日状态和报告会重新统计，修订历史会保留。',
      confirmText: '撤销记录',
      success: result => {
        if (!result.confirm || this.data.submitting) return;
        this.save('/events/' + encodeURIComponent(this.editingRecord.id) + '/revoke', 'POST',
          { version: this.editingRecord.version, reason }, '已撤销');
      },
    });
  },

  async save(path, method, data, message) {
    this.setData({ submitting: true, error: '' });
    try {
      const saved = await request(path, { method, data });
      if (!saved.id) throw new Error('暂未确认保存结果，请重试');
      this.pending = null;
      const header = typeof getApp === 'function' ? getApp().currentHeader?.() : null;
      this.finishRecord();
      if (header) header.flash(message);
      else wx.showToast({ title: message, icon: 'success' });
    } catch (error) {
      if (requireSession()) this.setData({ error: error.message });
    } finally {
      this.setData({ submitting: false });
    }
  },
};

module.exports = { data, methods };
