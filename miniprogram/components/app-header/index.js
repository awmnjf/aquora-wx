const { getSession, requireSession, request } = require('../../lib/api');
const { formatDateTime } = require('../../lib/date');
const { prepareSpeech, removeAudio } = require('../../lib/speech');

Component({
  options: { styleIsolation: 'apply-shared' },
  data: { avatar: '', voiceEnabled: false, items: [], unread: false, bellOpen: false, message: '', loading: false, error: '' },

  lifetimes: {
    attached() { this.syncSession(); },
    detached() { this.clearMessage(); },
  },
  pageLifetimes: {
    show() { this.syncSession(); },
    hide() {
      this.clearMessage();
      if (this.data.bellOpen) this.setData({ bellOpen: false });
    },
  },
  methods: {
    syncSession() {
      const app = getApp();
      const session = getSession();
      if (!session) return;
      const name = session.user.displayName || session.user.username || '水';
      this.setData({
        avatar: Array.from(name)[0],
        voiceEnabled: app.voiceAccount === session.user.id,
      });
      this.setNotices(app.noticeCache?.token === session.token ? app.noticeCache.items : []);
      app.checkReminders();
    },

    setNotices(items) {
      this.setData({
        items: items.map(item => ({ ...item, time: formatDateTime(item.created_at) })),
        unread: items.some(item => !item.seen),
      });
    },

    async toggleBell() {
      if (this.data.bellOpen) {
        this.setData({ bellOpen: false });
        return;
      }
      if (!requireSession()) return;
      this.setData({ bellOpen: true, loading: true, error: '' });
      try {
        this.setNotices(await request('/notifications'));
      } catch (error) {
        if (requireSession()) this.setData({ error: error.message });
      } finally {
        this.setData({ loading: false });
      }
    },

    async openReminder(event) {
      const item = this.data.items.find(row => row.id === event.currentTarget.dataset.id);
      if (!item || this.reading || !requireSession()) return;
      this.reading = true;
      try {
        if (!item.seen) await request('/notifications/' + encodeURIComponent(item.id) + '/read', { method: 'POST' });
        this.setNotices(this.data.items.map(row => row.id === item.id ? { ...row, seen: true } : row));
        this.setData({ bellOpen: false });
        wx.navigateTo({ url: '/pages/plan/index' });
      } catch (error) {
        if (requireSession()) this.setData({ error: error.message });
      } finally {
        this.reading = false;
      }
    },

    toggleVoice() {
      const session = getSession();
      if (!session) return;
      const enabled = !this.data.voiceEnabled;
      getApp().voiceAccount = enabled ? session.user.id : null;
      this.setData({ voiceEnabled: enabled });
      this.flash(enabled ? '语音播报已开启' : '语音播报已关闭');
    },

    clearMessage() {
      clearTimeout(this.messageTimer);
      if (this.data.message) this.setData({ message: '' });
      this.stopSpeech();
    },

    flash(message) {
      this.clearMessage();
      this.setData({ message });
      this.messageTimer = setTimeout(() => this.setData({ message: '' }), message.length > 40 ? 9000 : 4800);
      if (this.data.voiceEnabled) this.speak(message);
    },

    stopSpeech() {
      this.speechEpoch = (this.speechEpoch || 0) + 1;
      clearTimeout(this.playTimer);
      if (this.player) this.player.destroy();
      this.player = null;
      removeAudio(this.audioPath);
      this.audioPath = '';
    },

    async speak(message) {
      const epoch = this.speechEpoch;
      const token = getSession()?.token;
      const current = () => this.speechEpoch === epoch && getSession()?.token === token;
      try {
        const filePath = await prepareSpeech(message, current);
        if (!filePath) return;
        if (!current()) {
          removeAudio(filePath);
          return;
        }
        this.audioPath = filePath;
        const player = this.player = wx.createInnerAudioContext();
        const stop = () => { if (current()) this.stopSpeech(); };
        player.onError(stop);
        player.onEnded(stop);
        player.onPlay(() => { if (current()) clearTimeout(this.playTimer); });
        this.playTimer = setTimeout(stop, 8000);
        player.src = filePath;
        player.play();
      } catch {
        if (current()) this.stopSpeech();
      }
    },
  },
});
