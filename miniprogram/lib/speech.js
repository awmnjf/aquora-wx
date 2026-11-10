const { request } = require('./api');

function removeAudio(filePath) {
  if (filePath) wx.getFileSystemManager().unlink({ filePath, fail() {} });
}

async function prepareSpeech(text, isCurrent) {
  const result = await request('/ai/speak', {
    method: 'POST', timeout: 65000, data: { text: text.trim().slice(0, 500) },
  });
  if (!isCurrent()) return '';
  const audio = typeof result.audio === 'string' && /^data:audio\/(mpeg|mp3|wav);base64,([A-Za-z0-9+/=]+)$/.exec(result.audio);
  if (!result.available || !audio) throw new Error(result.message || '暂时无法生成朗读音频');
  const name = 'aquora-speech-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const filePath = wx.env.USER_DATA_PATH + '/' + name + (audio[1] === 'wav' ? '.wav' : '.mp3');
  await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
    filePath, data: audio[2], encoding: 'base64',
    success: resolve,
    fail: () => reject(new Error('无法准备播放文件，请重试')),
  }));
  if (isCurrent()) return filePath;
  removeAudio(filePath);
  return '';
}

module.exports = { prepareSpeech, removeAudio };
