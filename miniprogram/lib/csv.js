function cell(value) {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv(columns, rows) {
  return '\uFEFF' + [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}

function shareFile(fileName, content) {
  if (!/^[\w\u4e00-\u9fff.-]+\.(csv|json)$/.test(fileName)) {
    return Promise.reject(new Error('导出文件名无效'));
  }
  return new Promise((resolve, reject) => {
    if (typeof wx.shareFileMessage !== 'function') {
      wx.setClipboardData({ data: content, success: resolve, fail: () => reject(new Error('复制失败')) });
      return;
    }
    const filePath = wx.env.USER_DATA_PATH + '/' + fileName;
    wx.getFileSystemManager().writeFile({
      filePath, data: content, encoding: 'utf8',
      success() {
        wx.shareFileMessage({
          filePath, fileName, success: resolve,
          fail(error) {
            if (/cancel/i.test(error.errMsg || '')) resolve();
            else reject(new Error('暂时无法分享导出文件，请稍后重试'));
          },
        });
      },
      fail() { reject(new Error('导出文件保存失败')); },
    });
  });
}

module.exports = { toCsv, shareCsv: shareFile, shareFile };
