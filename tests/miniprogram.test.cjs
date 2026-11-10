const assert = require('node:assert/strict');
const test = require('node:test');

function installWx(handler, session) {
  const storage = new Map(session ? [['aquora.mini.session', session]] : []);
  const calls = [];
  global.wx = {
    request(options) {
      calls.push(options);
      handler(options);
    },
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    navigateBack() {},
    reLaunch() {},
    showToast() {},
  };
  return calls;
}

function loadPage(name = 'record') {
  let definition;
  global.Page = value => { definition = value; };
  const modulePath = require.resolve('../miniprogram/pages/' + name + '/index.js');
  delete require.cache[modulePath];
  require(modulePath);
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); },
  };
}

test('existing account login uses a bearer session and keeps the password intact', async () => {
  const { signIn, request, getSession } = require('../miniprogram/lib/api.js');
  const user = { id: 'fixture-user', displayName: '体验账号' };
  const calls = installWx(options => options.success({
    statusCode: 200,
    data: options.url.endsWith('/auth/login') ? { token: 'fixture-session', user } : { user },
  }));
  await signIn('  fixture  ', ' passphrase with spaces ');
  await request('/dashboard');

  assert.equal(calls[0].url, 'https://shuizhiji.com/aquora/api/auth/login');
  assert.deepEqual(calls[0].data, { username: 'fixture', password: ' passphrase with spaces ' });
  assert.equal(calls[0].header['X-Aquora-Browser'], undefined);
  assert.equal(calls[0].header.Authorization, undefined);
  assert.equal(calls[1].header.Authorization, 'Bearer fixture-session');
  assert.equal(getSession().user.id, user.id);
});

test('retrying an uncertain record save reuses its timestamp and idempotency key', async () => {
  let attempt = 0;
  const calls = installWx(options => {
    if (++attempt === 1) options.fail({ errMsg: 'request:fail timeout' });
    else options.success({ statusCode: 200, data: { id: 'saved-event' } });
  }, { token: 'fixture-session', user: { id: 'fixture-user' } });
  const page = loadPage();
  const submit = { detail: { value: { amount: '240', note: '' } } };
  await page.onSubmit(submit);
  assert.ok(page.data.error);
  await page.onSubmit(submit);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://shuizhiji.com/aquora/api/events');
  assert.deepEqual(calls[0].data, calls[1].data);
  assert.equal(calls[1].data.amountMl, 240);
  assert.match(calls[1].data.idempotencyKey, /^[A-Za-z0-9_-]{8,100}$/);
});

test('an unmeasured voiding record preserves a null volume', async () => {
  const calls = installWx(options => {
    options.success({ statusCode: 200, data: { id: 'saved-event' } });
  }, { token: 'fixture-session', user: { id: 'fixture-user' } });
  const page = loadPage();
  page.data.kind = 'voiding';
  page.toggleObservation({ currentTarget: { dataset: { field: 'urinaryInfection' } }, detail: { value: true } });
  await page.onSubmit({ detail: { value: { amount: '', note: '未测量' } } });

  assert.equal(calls[0].data.kind, 'voiding');
  assert.equal(calls[0].data.amountMl, null);
  assert.equal(calls[0].data.emptying, 'unknown');
  assert.equal(calls[0].data.urinaryInfection, 'yes');
  assert.equal(calls[0].data.urineLeakage, 'no');
});

test('today displays dashboard data while estimate and recent history are still loading', async () => {
  const user = { id: 'fixture-user', displayName: '体验账号' };
  const time = Date.now();
  const pending = [];
  installWx(options => {
    if (options.url.endsWith('/dashboard')) {
      options.success({
        statusCode: 200, data: { user, updatedAt: time, plan: { version: 1, data: { waterGoal: 900 } },
          events: [{ id: 'drink', kind: 'drink', occurred_at: time - 1000, amount_ml: 240 }] },
      });
    } else {
      pending.push(options);
    }
  }, { token: 'fixture-session', user });

  const page = loadPage('today');
  const load = page.onShow();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pending.length, 2);
    assert.equal(page.data.overview?.drinks, 240);
    assert.equal(page.data.overview?.goal, 900);
    assert.equal(page.data.loading, false);
  } finally {
    for (const request of pending) {
      request.success({ statusCode: 200, data: request.url.endsWith('/state') ? { available: false } : [] });
    }
    await load;
  }
});

test('a new record follows the server clock when the device clock is ahead', async t => {
  const serverTime = Date.UTC(2026, 10, 9, 16);
  let deviceTime = serverTime + 1500;
  t.mock.method(Date, 'now', () => deviceTime);
  const user = { id: 'fixture-user', displayName: '体验账号' };
  const calls = installWx(options => {
    let data = { id: 'saved-event' };
    if (options.url.endsWith('/dashboard')) {
      data = { user, updatedAt: serverTime, intake: 0, output: 0, voids: 0, unmeasured: 0, events: [] };
    }
    if (options.url.endsWith('/state')) data = { available: false, message: '暂无估算' };
    options.success({ statusCode: 200, data });
  }, { token: 'fixture-session', user });
  await loadPage('today').onShow();
  deviceTime += 350;
  await loadPage().onSubmit({ detail: { value: { amount: '240', note: '' } } });

  assert.equal(calls.find(call => call.method === 'POST').data.occurredAt, serverTime + 350);
});

test('a care task can be completed by a food record with its original task ID', async () => {
  const calls = installWx(options => options.success({ statusCode: 200, data: { id: 'event' } }),
    { token: 'fixture-session', user: { id: 'fixture-user' } });
  const page = loadPage();
  page.onLoad({ kind: 'drink', taskId: 'task-id' });
  page.chooseKind({ currentTarget: { dataset: { kind: 'food' } } });
  await page.onSubmit({ detail: { value: { amount: '140', note: '' } } });
  assert.equal(calls[0].data.kind, 'food');
  assert.equal(calls[0].data.taskId, 'task-id');
});

test('record revisions preserve the event timestamp and send the expected version and reason', async () => {
  const calls = installWx(options => options.success({
    statusCode: 200, data: options.method === 'GET' ? [] : { id: 'event-id' },
  }), { token: 'fixture-session', user: { id: 'fixture-user' } });
  const page = loadPage();
  const originalTime = Date.now() - 500000;
  page.getOpenerEventChannel = () => ({
    on(name, receive) {
      if (name === 'editRecord') receive({
        id: 'event-id', version: 3, kind: 'drink', amount_ml: 220, occurred_at: originalTime, drink_type: 'tea',
      });
    },
  });
  page.onLoad({ edit: '1' });
  await page.onSubmit({ detail: { value: { amount: '225', note: '', reason: '补齐记录' } } });
  const revision = calls.find(call => call.method === 'PUT');
  assert.ok(revision);
  assert.match(revision.url, /\/events\/event-id$/);
  assert.equal(revision.data.version, 3);
  assert.equal(revision.data.reason, '补齐记录');
  assert.equal(revision.data.occurredAt, originalTime);
  assert.equal(revision.data.drinkType, 'tea');
});

test('Shanghai input and CSV export preserve boundaries and protect text cells', () => {
  const { dateInput, timeInput, parseShanghai } = require('../miniprogram/lib/date');
  const { toCsv } = require('../miniprogram/lib/csv');
  const timestamp = Date.UTC(2026, 10, 9, 16, 1);
  assert.equal(dateInput(timestamp), '2026-11-10');
  assert.equal(timeInput(timestamp), '00:01');
  assert.equal(parseShanghai('2026-11-10', '00:01'), timestamp);
  assert.ok(Number.isNaN(parseShanghai('2026-02-30', '09:00')));
  assert.equal(toCsv(['量', '备注'], [[260, '=HYPERLINK("bad")']]),
    '\uFEFF"量","备注"\r\n"260","\'=HYPERLINK(""bad"")"');
});
