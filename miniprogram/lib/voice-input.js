const { requireSession, request } = require('./api');

const LONG_REQUEST = 65000;
let recorder;
let recorderOwner;

function readBase64(path) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
    filePath: path,
    encoding: 'base64',
    success: result => resolve(result.data),
    fail: () => reject(new Error('无法读取录音，请重试')),
  }));
}

function getRecorder() {
  if (recorder) return recorder;
  recorder = wx.getRecorderManager();
  recorder.onStart(() => {
    if (!recorderOwner) return;
    if (!recorderOwner.recording || !recorderOwner.visible) recorder.stop();
    else recorderOwner.setData({ voice: 'recording' });
  });
  recorder.onStop(result => {
    const page = recorderOwner;
    recorderOwner = null;
    if (page) page.transcribe(result);
  });
  recorder.onError(() => {
    const page = recorderOwner;
    recorderOwner = null;
    if (page) page.failRecording('录音失败，请检查麦克风权限后重试');
  });
  if (recorder.onInterruptionBegin) {
    recorder.onInterruptionBegin(() => {
      const page = recorderOwner;
      if (!page) return;
      page.cancelVoice();
      if (page.visible) page.setData({ voiceError: '录音被中断，请稍后重试' });
    });
  }
  return recorder;
}

const voiceInput = {
  failRecording(error) {
    this.recording = null;
    if (this.visible) this.setData({ voice: 'idle', voiceError: error });
  },

  cancelVoice() {
    this.voiceEpoch++;
    const recording = this.recording;
    this.recording = null;
    if (recording && recorderOwner === this) recorder.stop();
    if (!this.disposed && this.data.voice !== 'idle') this.setData({ voice: 'idle' });
  },

  toggleVoice() {
    if (this.data.voice === 'recording') this.stopVoice();
    else this.beginVoice();
  },

  stopVoice() {
    if (this.data.voice === 'starting') this.cancelVoice();
    else if (this.data.voice === 'recording' && recorderOwner === this) {
      this.setData({ voice: 'transcribing' });
      recorder.stop();
    }
  },

  beginVoice() {
    if (this.data.voice !== 'idle' || this.data.loading || this.data.busy || !requireSession()) return;
    if (typeof wx.getRecorderManager !== 'function') {
      this.setData({ voiceError: '当前微信版本不支持录音，请使用文字输入' });
      return;
    }
    this.stopSpeech?.();
    const epoch = ++this.voiceEpoch;
    this.setData({ voice: 'starting', voiceError: '' });
    const current = () => epoch === this.voiceEpoch && this.visible;
    wx.getSetting({
      success: ({ authSetting }) => {
        if (!current()) return;
        if (authSetting['scope.record'] === false) {
          this.setData({ voice: 'idle', voiceError: '请在小程序设置中允许使用麦克风' });
          wx.showModal({
            title: '麦克风权限', content: '开启麦克风权限后可向小澜发送语音。',
            confirmText: '去设置', confirmColor: '#13695c',
            success: ({ confirm }) => { if (confirm) wx.openSetting({}); },
          });
          return;
        }
        if (authSetting['scope.record']) this.startRecording(epoch);
        else wx.authorize({
          scope: 'scope.record',
          success: () => { if (current()) this.startRecording(epoch); },
          fail: () => { if (current()) this.failRecording('需要麦克风权限才能录音'); },
        });
      },
      fail: () => {
        if (current()) this.failRecording('无法读取麦克风权限，请重试');
      },
    });
  },

  startRecording(epoch) {
    if (recorderOwner) {
      this.failRecording('正在结束上一次录音，请稍后重试');
      return;
    }
    try {
      const manager = getRecorder();
      recorderOwner = this;
      this.recording = { epoch, token: this.token, scenario: this.data.scenario || this.data.mode };
      manager.start({ duration: 30000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' });
    } catch {
      recorderOwner = null;
      this.failRecording('暂时无法开始录音，请重试');
    }
  },

  async transcribe(result) {
    const turn = this.recording;
    this.recording = null;
    if (!turn || !this.visible) return;
    const current = () => this.visible && turn.epoch === this.voiceEpoch && this.ownsSession(turn.token);
    this.setData({ voice: 'transcribing' });
    try {
      if (!result.tempFilePath || result.duration < 400) throw new Error('录音太短，请再试一次');
      if (result.fileSize > 4000000) throw new Error('录音过长，请分段说话');
      const encoded = await readBase64(result.tempFilePath);
      if (!current()) return;
      if (encoded.length < 100) throw new Error('录音太短，请再试一次');
      if (encoded.length > 5333332) throw new Error('录音过长，请分段说话');
      const response = await request('/ai/transcribe', {
        method: 'POST', timeout: LONG_REQUEST, data: { audio: 'data:audio/mpeg;base64,' + encoded },
      });
      if (!current()) return;
      const text = response.available && typeof response.text === 'string' && response.text.trim().slice(0, 2000);
      if (!text) throw new Error(response.message || '没有识别到语音，请重试或使用文字输入');
      await this.handleVoiceText(text, turn.scenario);
    } catch (error) {
      if (current()) this.showError(error);
    } finally {
      if (current()) this.setData({ voice: 'idle' });
    }
  },
};

module.exports = { voiceInput };
