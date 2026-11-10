const assert = require('node:assert/strict');
const test = require('node:test');

function pageWithApi(t, name, api) {
  const calls = [];
  const navigation = [];
  const session = { token: 'test-session', user: { id: 'test-user', username: 'fixture', role: 'user' } };
  global.wx = {
    getStorageSync: () => session,
    request(options) {
      const path = new URL(options.url).pathname.replace('/aquora/api', '');
      const call = { path, method: options.method, data: options.data };
      calls.push(call);
      const result = api(call);
      if (result === undefined) options.fail();
      else options.success({ statusCode: 200, data: result });
    },
    showToast() {},
    pageScrollTo() {},
    navigateTo(options) { navigation.push(options.url); },
  };
  let definition;
  global.Page = value => { definition = value; };
  const path = require.resolve('../miniprogram/pages/' + name + '/index');
  delete require.cache[path];
  require(path);
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); },
  };
  t.after(() => page.onUnload());
  return { page, calls, navigation };
}

function event(dataset) {
  return { currentTarget: { dataset } };
}

test('plan uses the loaded version, requires confirmation, and links to task records', async t => {
  const { page, calls, navigation } = pageWithApi(t, 'plan', ({ path }) => {
    if (path === '/plan') return { data: { source: '既有安排' }, version: 5 };
    return [];
  });
  await page.onShow();
  page.editPlan();
  Object.assign(page.data.form, { waterGoal: '900', drinkTimes: '11:00，09:00、11:00', voidTimes: '08:00 12:30' });
  await page.submitEditor();
  assert.match(page.data.formError, /确认/);
  assert.equal(calls.some(call => call.method === 'PUT'), false);

  page.data.form.confirmed = true;
  await page.submitEditor();
  assert.deepEqual(calls.find(call => call.method === 'PUT'), {
    path: '/plan', method: 'PUT',
    data: {
      version: 5, waterGoal: 900, drinkTimes: ['09:00', '11:00'], voidTimes: ['08:00', '12:30'],
      source: '既有安排', note: '', confirmed: true,
    },
  });

  page.recordTask(event({ id: 'task-id', kind: 'voiding' }));
  assert.deepEqual(navigation, ['/pages/record/index?taskId=task-id&kind=voiding']);

  page.editSkip(event({ id: 'task-id' }));
  page.data.form.reason = '  行程重叠  ';
  await page.submitEditor();
  assert.deepEqual(calls.find(call => call.path === '/tasks/task-id/skip'), {
    path: '/tasks/task-id/skip', method: 'POST', data: { reason: '行程重叠' },
  });
});

test('an outing spanning midnight submits Shanghai timestamps and shows conflicts', async t => {
  const now = Date.UTC(2026, 10, 9, 14);
  t.mock.method(Date, 'now', () => now);
  const { page, calls } = pageWithApi(t, 'plan', ({ path, method }) => {
    if (path === '/plan') return { data: {}, version: 0 };
    if (path === '/outings' && method === 'POST') {
      return { message: '行程与护理安排重叠', conflicts: [{ id: 'task-id', kind: 'drink', due_at: now + 5400000 }] };
    }
    return [];
  });
  await page.onShow();
  page.editOuting();
  assert.equal(page.data.form.startDate, '2026-11-09');
  assert.equal(page.data.form.endDate, '2026-11-10');
  page.data.form.title = '外出';
  await page.submitEditor();
  assert.deepEqual(calls.find(call => call.method === 'POST').data, {
    title: '外出', startAt: now + 3600000, endAt: now + 7200000,
  });
  assert.equal(page.data.outingResult.conflicts[0].time, '2026-11-09 23:30');
});

test('profile edits preserve existing settings and calibration uses the new version and a measured zero', async t => {
  let profile = { version: 8, data: { displayName: '原昵称', bladderCapacity: 450, recommendedEmptyMl: 280 } };
  const { page, calls } = pageWithApi(t, 'profile', ({ path, method, data }) => {
    if (path === '/profile' && method === 'PUT') profile = { version: 9, data };
    if (path === '/profile/calibration') return { ...profile, version: 10 };
    return profile;
  });
  await page.onShow();
  page.openEditor(event({ editor: 'profile' }));
  page.data.form.displayName = '新昵称';
  await page.submitEditor();
  const saved = calls.find(call => call.method === 'PUT');
  assert.equal(saved.data.version, 8);
  assert.equal(saved.data.recommendedEmptyMl, 280);
  assert.equal(page.data.identity.name, '新昵称');

  page.openEditor(event({ editor: 'calibration' }));
  page.data.form.volumeMl = '0';
  await page.submitEditor();
  assert.deepEqual(calls.find(call => call.path === '/profile/calibration').data, { version: 9, volumeMl: 0 });
});

test('research retries retain the UUID and only submit labels at the exact Shanghai target', async t => {
  const now = Date.UTC(2026, 10, 9, 16, 10);
  t.mock.method(Date, 'now', () => now);
  const target = Date.UTC(2026, 10, 9, 16, 0, 5, 123);
  const windows = [{ id: 'older-window', origin: target - 7200000, target, label_recorded_at: null }];
  let attempts = 0;
  const { page, calls } = pageWithApi(t, 'research', ({ path, data }) => {
    if (path === '/research/windows') {
      if (++attempts === 1) return undefined;
      const saved = { id: data.id, origin: now, target: now + 7200000 };
      windows.unshift(saved);
      return saved;
    }
    if (path === '/research/windows/older-window/label') {
      windows[1].label_recorded_at = now;
      return { saved: true };
    }
    return { enrolled: true, windows };
  });
  await page.onShow();
  page.openStart();
  Object.assign(page.data.form, { startMl: '100', currentMl: '80', expelledMl: '70', complete: true });
  await page.submitEditor();
  assert.ok(page.data.formError);
  await page.submitEditor();
  const submissions = calls.filter(call => call.path === '/research/windows');
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[0].data, submissions[1].data);
  assert.match(submissions[1].data.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(submissions[1].data.timezone, 'Asia/Shanghai');

  page.openLabel(event({ id: 'older-window' }));
  assert.equal(page.data.selected.targetText, '2026-11-10 00:00:05.123');
  Object.assign(page.data.form, {
    measuredAt: '2026-11-10 00:00:05.122', endMl: '85', expelledMl: '30', complete: true,
  });
  await page.submitEditor();
  assert.match(page.data.formError, /目标时刻/);
  assert.equal(calls.some(call => call.path.endsWith('/label')), false);

  page.data.form.measuredAt = '2026-11-10 00:00:05.123';
  await page.submitEditor();
  assert.deepEqual(calls.find(call => call.path.endsWith('/label')).data, {
    measuredAt: target, endMl: 85, expelledMl: 30, complete: true,
  });
  assert.equal(page.data.windows[1].verified, true);
});
