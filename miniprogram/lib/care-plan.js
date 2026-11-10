const { request } = require('./api');

function parseTimes(value) {
  const times = value.split(/[,，、\s]+/).filter(Boolean);
  if (times.length > 24) throw new Error('每天每类提醒最多设置 24 个时刻');
  if (times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error('请用 24 小时制填写提醒时间，例如 09:00、11:30');
  }
  return Array.from(new Set(times)).sort();
}

function planFields({ version, data }) {
  return {
    version, waterGoal: data.waterGoal == null ? '' : String(data.waterGoal),
    drinkTimes: (data.drinkTimes || []).join('、'), voidTimes: (data.voidTimes || []).join('、'),
    source: data.source || '', note: data.note || '', confirmed: false,
  };
}

async function savePlan(form) {
  const text = form.waterGoal.trim();
  const waterGoal = text === '' ? null : Number(text);
  if (waterGoal !== null && (!/^\d+$/.test(text) || waterGoal < 100 || waterGoal > 5000)) {
    throw new Error('每日饮水目标需为 100 至 5000 毫升的整数');
  }
  const source = form.source.trim();
  if (!source || source.length > 200) throw new Error('请填写 200 字以内的方案来源');
  if (!form.confirmed) throw new Error('请确认这些时刻来自已有护理安排');
  return request('/plan', {
    method: 'PUT',
    data: {
      version: form.version, waterGoal, drinkTimes: parseTimes(form.drinkTimes),
      voidTimes: parseTimes(form.voidTimes), source, note: form.note, confirmed: true,
    },
  });
}

module.exports = { planFields, savePlan };
