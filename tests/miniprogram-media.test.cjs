const assert = require('node:assert/strict');
const test = require('node:test');

const session = { token: 'fixture-session', user: { id: 'fixture-user' } };
const dataset = data => ({ currentTarget: { dataset: data } });
const settled = () => new Promise(resolve => setImmediate(resolve));
const respond = (options, data) => options.success({ statusCode: 200, data });

function setup(handler, overrides = {}) {
  const calls = [];
  const drafts = [];
  const app = { globalData: {} };
  global.getApp = () => app;
  global.getCurrentPages = () => [];
  global.wx = {
    getStorageSync: () => session,
    request(options) {
      calls.push(options);
      handler(options);
    },
    navigateTo(options) {
      options.success({ eventChannel: { emit: (name, draft) => drafts.push({ name, draft }) } });
    },
    showModal(options) { options.success({ confirm: true }); },
    ...overrides,
  };
  return { app, calls, drafts };
}

function loadPage(name, options = {}) {
  let definition;
  global.Page = value => { definition = value; };
  const modulePath = require.resolve('../miniprogram/pages/' + name + '/index.js');
  delete require.cache[modulePath];
  require(modulePath);
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); },
  };
  page.onLoad(options);
  page.onShow();
  return page;
}

test('opening the outdoor assistant prefills text and sends the scenario only on confirmation', async () => {
  const candidate = { kind: 'drink', amountMl: 180, drinkType: 'water', occurredAt: 1794262800000 };
  const { app, calls, drafts } = setup(options => {
    if (options.method === 'DELETE') return respond(options, { ok: true });
    if (options.url.endsWith('/agent/run')) return respond(options, { reply: '请核对饮水量', candidate });
    respond(options, [{ role: 'assistant', content: '你好' }]);
  });
  app.globalData.assistantScenario = 'outdoor';
  app.globalData.assistantMessage = '刚喝了180毫升水';
  const page = loadPage('assistant');
  await settled();

  assert.equal(page.data.scenario, 'outdoor');
  assert.equal(page.data.text, '刚喝了180毫升水');
  assert.deepEqual(app.globalData, {});
  assert.equal(calls.length, 1);
  assert.equal(page.data.messages[0].content, '你好');
  await page.ask(page.data.text);
  assert.match(calls[1].url, /\/agent\/run$/);
  assert.deepEqual(calls[1].data, { message: '刚喝了180毫升水', scenario: 'outdoor' });

  page.openDraft(dataset({ id: page.data.messages.at(-1).id }));
  assert.deepEqual(drafts, [{ name: 'recordDraft', draft: { ...candidate, source: 'assistant' } }]);
  page.clearHistory();
  await settled();
  assert.equal(calls[2].method, 'DELETE');
  assert.match(calls[2].url, /\/chat$/);
  assert.deepEqual(page.data.messages, []);
});

test('foreground voice fills the chat composer and ignores transcription after the tab is hidden', async () => {
  let start;
  let stop;
  let transcribe;
  const manager = {
    onStart(callback) { start = callback; },
    onStop(callback) { stop = callback; },
    onError() {},
    start(options) {
      assert.equal(options.format, 'mp3');
      assert.equal(options.duration, 30000);
      start();
    },
    stop() { stop({ duration: 1200, fileSize: 240, tempFilePath: 'voice.mp3' }); },
  };
  const { calls } = setup(options => {
    if (options.url.endsWith('/ai/transcribe')) transcribe = options;
    else respond(options, []);
  }, {
    getSetting(options) { options.success({ authSetting: { 'scope.record': true } }); },
    getRecorderManager: () => manager,
    getFileSystemManager: () => ({ readFile(options) { options.success({ data: 'A'.repeat(320) }); } }),
  });
  const page = loadPage('assistant');
  await settled();

  page.toggleVoice();
  assert.equal(page.data.voice, 'recording');
  page.toggleVoice();
  await settled();
  assert.match(transcribe.data.audio, /^data:audio\/mpeg;base64,/);
  respond(transcribe, { available: true, text: '查看护理计划' });
  await settled();
  assert.equal(page.data.text, '查看护理计划');
  assert.equal(page.data.voice, 'idle');

  page.toggleVoice();
  page.toggleVoice();
  await settled();
  page.onHide();
  respond(transcribe, { available: true, text: '这句话过期了' });
  await settled();
  assert.equal(page.data.text, '查看护理计划');
  assert.equal(calls.length, 3);
});

test('photo estimation rejects an identical pair and only hands a confirmed result to the editor', async () => {
  const image = Object.fromEntries([
    ['before.jpg', Buffer.from('ffd8ff00000000000000000000000000', 'hex')],
    ['after.webp', Buffer.from('RIFF\0\0\0\0WEBPtest')],
  ]);
  let albumPath = 'before.jpg';
  const candidate = { kind: 'food', amountMl: 120, note: '同一份西瓜' };
  const { calls, drafts } = setup(options => {
    if (options.url.endsWith('/vision/capability')) respond(options, { available: true });
    else respond(options, { available: true, candidate, estimate: { rangeMl: { min: 100, max: 140 } } });
  }, {
    chooseMedia(options) {
      const path = options.sourceType[0] === 'camera' ? 'before.jpg' : albumPath;
      options.success({ tempFiles: [{ tempFilePath: path, size: image[path].length }] });
    },
    getImageInfo(options) { options.success({ width: 1500, height: 1000 }); },
    compressImage(options) {
      assert.equal(options.compressedWidth, 1280);
      options.success({ tempFilePath: options.src });
    },
    getFileSystemManager: () => ({
      getFileInfo(options) { options.success({ size: image[options.filePath].length }); },
      readFile(options) { options.success({ data: image[options.filePath].toString('base64') }); },
    }),
  });
  const page = loadPage('photo', { kind: 'food' });
  await settled();

  await page.choosePhoto(dataset({ slot: 'before', source: 'camera' }));
  await page.choosePhoto(dataset({ slot: 'after', source: 'album' }));
  await page.estimate();
  assert.equal(calls.length, 1);
  assert.match(page.data.error, /不同/);

  albumPath = 'after.webp';
  await page.choosePhoto(dataset({ slot: 'after', source: 'album' }));
  page.setContext({ detail: { value: '餐前西瓜约 200 克' } });
  await page.estimate();
  assert.match(calls[1].url, /\/vision$/);
  assert.match(calls[1].data.beforeImage, /^data:image\/jpeg;base64,/);
  assert.match(calls[1].data.afterImage, /^data:image\/webp;base64,/);
  assert.equal(calls[1].data.context, '餐前西瓜约 200 克');
  assert.equal(page.data.amount, 120);
  assert.deepEqual(drafts, []);
  page.openDraft();
  assert.deepEqual(drafts, [{ name: 'recordDraft', draft: { ...candidate, source: 'assistant' } }]);
});

test('nearby map search de-duplicates accessible results and uses native place selection', async () => {
  let directions;
  const ordinary = { id: 'ordinary', name: '没有无障碍设施的卫生间', location: '116.3975,39.9093', typecode: '200300' };
  const accessible = { id: 'accessible', name: '公共卫生间', location: '116.3980,39.9093', typecode: '200303' };
  const { calls } = setup(options => {
    if (options.url.endsWith('/map-config.json')) respond(options, { key: 'a'.repeat(32) });
    else if (options.data.types === '200303') respond(options, { status: '1', pois: [accessible] });
    else respond(options, { status: '1', pois: [ordinary, accessible] });
  }, {
    chooseLocation(options) { options.success({ name: '搜索中心', latitude: '39.9093', longitude: '116.3974' }); },
    openLocation(options) { directions = options; },
  });
  const page = loadPage('map');
  page.chooseOnMap();
  await settled();

  assert.equal(page.data.center.latitude, 39.9093);
  assert.equal(page.data.places.length, 1);
  assert.equal(page.data.selected.id, 'accessible');
  assert.equal(calls.filter(call => call.url.includes('/_AMapService/')).length, 2);
  assert.equal(calls[1].data.radius, 3000);
  assert.equal(calls[1].data.location, '116.3974,39.9093');

  page.toggleOther({ detail: { value: true } });
  await settled();
  assert.deepEqual(page.data.places.map(item => item.id), ['ordinary', 'accessible']);
  assert.equal(page.data.places[0].accessible, false);
  page.selectMarker({ detail: { markerId: 1 } });
  page.openDirections();
  assert.equal(directions.longitude, 116.3975);
  assert.equal(directions.name, ordinary.name);
});
