function openRecord(url, eventName, payload, options = {}) {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const current = pages[pages.length - 1];
  const editor = current?.selectComponent?.('#record-editor');
  if (editor) {
    editor.openEditor(options, payload);
    return;
  }
  wx.navigateTo({
    url,
    success(result) { if (eventName) result.eventChannel.emit(eventName, payload); },
    fail() { wx.showToast({ title: '暂时无法打开记录', icon: 'none' }); },
  });
}

function newRecord(kind, options = {}) {
  const task = options.taskId ? 'taskId=' + encodeURIComponent(options.taskId) + '&' : '';
  const compact = options.simple ? '&simple=1' : '';
  openRecord('/pages/record/index?' + task + 'kind=' + kind + compact, null, null, { ...options, kind });
}

function editRecord(event) {
  openRecord('/pages/record/index?edit=1', 'editRecord', event);
}

function draftRecord(draft) {
  const pages = getCurrentPages();
  const fromPhoto = pages[pages.length - 1]?.route === 'pages/photo/index';
  openRecord('/pages/record/index?draft=1' + (fromPhoto ? '&fromPhoto=1' : ''), 'recordDraft', draft,
    { simple: ['drink', 'food', 'voiding'].includes(draft.kind) });
}

module.exports = { newRecord, editRecord, draftRecord };
