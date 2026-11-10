const assert = require('node:assert/strict');
const test = require('node:test');

test('changing the history date drops in-flight rows and paginates from the current result', async () => {
  const calls = [];
  global.wx = {
    getStorageSync: () => ({ token: 'test', user: { id: 'test-user' } }),
    request: options => calls.push(options),
  };
  let definition;
  global.Page = page => { definition = page; };
  require('../miniprogram/pages/reports/index.js');
  const page = {
    ...definition,
    data: { ...definition.data, from: '2026-11-01', to: '2026-11-10', selected: '2026-11-02' },
    setData(patch) { Object.assign(this.data, patch); },
  };
  const older = page.loadHistory(0);
  const current = page.chooseDay('2026-11-03');
  const item = id => ({ id, kind: 'drink', occurred_at: Date.UTC(2026, 10, 3), amount_ml: 80 });
  const finish = (index, id, hasMore) => calls[index].success({
    statusCode: 200,
    data: { events: [item(id)], hasMore },
  });

  finish(1, 'first', true);
  await current;
  finish(0, 'outdated', true);
  await older;
  assert.deepEqual(page.data.events.map(event => event.id), ['first']);

  const next = page.loadMore();
  assert.match(calls[2].url, /date=2026-11-03&kind=all&offset=1$/);
  finish(2, 'next', false);
  await next;
  assert.deepEqual(page.data.events.map(event => event.id), ['first', 'next']);
  assert.equal(page.data.hasMore, false);
});
