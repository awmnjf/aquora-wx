const DAY_MS = 86400000;
const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;

function shanghaiIso(timestamp) {
  const value = new Date(Number(timestamp) + SHANGHAI_OFFSET);
  return Number.isFinite(value.getTime()) ? value.toISOString() : '';
}

function dateInput(timestamp = Date.now()) {
  return shanghaiIso(timestamp).slice(0, 10);
}

function timeInput(timestamp = Date.now()) {
  return shanghaiIso(timestamp).slice(11, 16);
}

function parseShanghai(date, time = '00:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const value = Date.parse(date + 'T' + time + ':00+08:00');
  return dateInput(value) === date && timeInput(value) === time ? value : NaN;
}

function formatDateTime(timestamp) {
  return dateInput(timestamp) + ' ' + timeInput(timestamp);
}

module.exports = { DAY_MS, dateInput, timeInput, parseShanghai, formatDateTime };
