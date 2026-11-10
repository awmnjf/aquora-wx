const { timeInput } = require('./date');

const KIND_LABELS = {
  drink: '饮水', food: '食物含水', voiding: '排尿 / 导尿', leakage: '漏尿', symptom: '不适',
};
const DRINK_LABELS = {
  water: '白水', tea: '茶', coffee: '咖啡', milk: '牛奶', juice: '果汁', soup: '汤', other: '其他',
};
const KIND_OPTIONS = Object.keys(KIND_LABELS).map(value => ({ value, label: KIND_LABELS[value] }));
const DRINK_OPTIONS = Object.keys(DRINK_LABELS).map(value => ({ value, label: DRINK_LABELS[value] }));

function recordSummary(row) {
  const infection = row.kind === 'voiding' && row.urinary_infection === true;
  const leakage = row.kind === 'voiding' && row.urine_leakage === true;
  return {
    id: row.id,
    label: row.kind === 'drink' && DRINK_LABELS[row.drink_type]
      ? DRINK_LABELS[row.drink_type] : KIND_LABELS[row.kind] || '记录',
    time: timeInput(row.occurred_at),
    amount: row.amount_ml == null
      ? (row.kind === 'voiding' || row.kind === 'leakage' ? '未测量' : '') : row.amount_ml + ' mL',
    note: row.note || '',
    infection,
    observations: [infection && '尿道感染', leakage && '漏尿'].filter(Boolean).join(' · '),
  };
}

module.exports = { KIND_OPTIONS, DRINK_OPTIONS, KIND_LABELS, DRINK_LABELS, recordSummary };
