const { getSession, requireSession, request } = require('../../lib/api');
const { draftRecord } = require('../../lib/navigation');
const { KIND_LABELS } = require('../../lib/records');
const { voiceInput } = require('../../lib/voice-input');
const { prepareSpeech, removeAudio } = require('../../lib/speech');

const SCENARIOS = [
  { id: 'chat', label: '对话' },
  { id: 'home', label: '居家' },
  { id: 'outdoor', label: '外出' },
  { id: 'knowledge', label: '使用知识' },
];
const SUGGESTIONS = {
  chat: ['刚喝了200毫升水', '最近一次导尿是什么时候', '查看我的护理计划'],
  home: ['刚喝了200毫升水', '查看我的护理计划', '记住我平时喜欢喝温水'],
  outdoor: ['查一下北京今天的天气', '查看今天的护理安排', '刚喝了200毫升水'],
  knowledge: ['导尿时有哪些卫生注意事项', '怎么记录饮水量', '如何使用外出模式'],
};
const LONG_REQUEST = 65000;
Page({
  data: {
    scenarios: SCENARIOS,
    scenario: 'chat',
    suggestions: SUGGESTIONS.chat,
    chatLabels: ['喝了200毫升水', '查最近导尿', '看护理计划'],
    messages: [],
    scrollTarget: '',
    text: '',
    loading: false,
    busy: false,
    error: '',
    historyError: false,
    voice: 'idle',
    speechId: '',
    speechLabel: '',
    help: false,
    knowledge: [],
    knowledgeOpen: '',
    knowledgeLoading: false,
    knowledgeError: '',
  },

  onLoad() {
    this.messageId = 0;
    this.voiceEpoch = 0;
    this.speechEpoch = 0;
  },

  onShow() {
    if (!requireSession()) return;
    this.visible = true;
    const session = getSession();
    if (this.token !== session.token) {
      this.token = session.token;
      this.setData({
        messages: [], text: '', scrollTarget: '', busy: false, loading: false,
        voice: 'idle', error: '', voiceError: '', historyError: false, help: false, knowledgeOpen: '',
      });
      this.setScenario('chat');
      this.loadHistory();
    }
    const global = getApp().globalData;
    if (global && global.assistantScenario) {
      this.setScenario(global.assistantScenario);
      delete global.assistantScenario;
    }
    if (global && typeof global.assistantMessage === 'string') {
      this.setData({ text: global.assistantMessage.slice(0, 2000) });
      delete global.assistantMessage;
    }
  },

  onHide() {
    this.visible = false;
    this.cancelVoice();
    this.stopSpeech();
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  ownsSession(token) {
    return !this.disposed && this.token === token;
  },

  showError(error) {
    if (error.statusCode === 401) {
      if (this.visible) requireSession();
      return;
    }
    this.setData({ error: error.message });
  },

  makeMessage(role, content, candidate, sources) {
    const kindLabel = candidate && KIND_LABELS[candidate.kind];
    return {
      id: 'msg-' + ++this.messageId,
      role,
      content,
      candidate: kindLabel ? candidate : null,
      candidateLabel: kindLabel ? kindLabel + ' · ' +
        (candidate.amountMl == null ? '数量待填写' : candidate.amountMl + ' mL') : '',
      sources: Array.isArray(sources) ? sources : [],
    };
  },

  setMessages(messages) {
    const recent = messages.slice(-40);
    const last = recent[recent.length - 1];
    this.setData({ messages: recent, scrollTarget: last ? last.id : '' });
  },

  async loadHistory() {
    if (this.data.loading || this.data.busy || !requireSession()) return;
    const token = this.token;
    this.setData({ loading: true, error: '', historyError: false });
    try {
      const history = await request('/chat');
      if (!this.ownsSession(token)) return;
      if (!Array.isArray(history)) throw new Error('暂时无法读取对话记录');
      this.setMessages(history.map(item => this.makeMessage(item.role, item.content)));
    } catch (error) {
      if (!this.ownsSession(token)) return;
      this.setData({ historyError: true });
      this.showError(error);
    } finally {
      if (this.ownsSession(token)) this.setData({ loading: false });
    }
  },

  setScenario(scenario) {
    if (SUGGESTIONS[scenario]) this.setData({ scenario, suggestions: SUGGESTIONS[scenario] });
  },

  chooseScenario(event) {
    if (this.data.voice === 'idle' && !this.data.busy) this.setScenario(event.currentTarget.dataset.id);
  },

  onInput(event) {
    this.setData({ text: event.detail.value });
  },

  sendText() {
    if (this.data.voice === 'idle') this.ask(this.data.text);
  },

  sendSuggestion(event) {
    if (this.data.voice === 'idle') this.ask(event.currentTarget.dataset.text);
  },

  async ask(input, scenario = this.data.scenario) {
    const message = String(input || '').trim();
    if (!message || message.length > 2000 || this.data.busy || this.data.loading || !requireSession()) return;
    const token = this.token;
    const userMessage = this.makeMessage('user', message);
    this.setData({
      text: '', busy: true, error: '', historyError: false, scrollTarget: 'working',
      messages: [...this.data.messages, userMessage],
    });
    try {
      const chat = scenario === 'chat';
      const response = await request(chat ? '/chat' : '/agent/run', {
        method: 'POST',
        timeout: LONG_REQUEST,
        data: chat ? { message } : { message, scenario },
      });
      if (!this.ownsSession(token)) return;
      const reply = response.reply || response.message || '暂时无法回答，请稍后重试。';
      this.setMessages([...this.data.messages,
        this.makeMessage('assistant', reply, response.candidate, response.sources)]);
    } catch (error) {
      if (!this.ownsSession(token)) return;
      if (!this.data.text) this.setData({ text: message });
      this.setMessages(this.data.messages.filter(item => item.id !== userMessage.id));
      this.showError(error);
    } finally {
      if (this.ownsSession(token)) this.setData({ busy: false });
    }
  },

  clearHistory() {
    if (this.data.busy || this.data.loading || this.data.voice !== 'idle' || !this.data.messages.length) return;
    const token = this.token;
    wx.showModal({
      title: '清空对话',
      content: '确定清空与小澜的对话记录吗？',
      confirmColor: '#13695c',
      success: async ({ confirm }) => {
        if (!confirm || !this.ownsSession(token) || this.data.busy || !requireSession()) return;
        this.setData({ loading: true, error: '' });
        try {
          await request('/chat', { method: 'DELETE' });
          if (!this.ownsSession(token)) return;
          this.stopSpeech();
          this.setMessages([]);
        } catch (error) {
          if (this.ownsSession(token)) this.showError(error);
        } finally {
          if (this.ownsSession(token)) this.setData({ loading: false });
        }
      },
    });
  },

  openDraft(event) {
    const item = this.data.messages.find(message => message.id === event.currentTarget.dataset.id);
    if (item && item.candidate) draftRecord({ ...item.candidate, source: 'assistant' });
  },

  async toggleHelp() {
    this.setData({ help: !this.data.help });
    if (!this.data.help || this.data.knowledgeLoading || this.knowledgeLoaded) return;
    this.setData({ knowledgeLoading: true, knowledgeError: '' });
    try {
      const items = await request('/knowledge');
      if (!this.disposed) {
        this.knowledgeLoaded = true;
        this.setData({ knowledge: Array.isArray(items) ? items : [] });
      }
    } catch (error) {
      if (!this.disposed) this.setData({ knowledgeError: error.message });
    } finally {
      if (!this.disposed) this.setData({ knowledgeLoading: false });
    }
  },

  toggleKnowledge(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ knowledgeOpen: this.data.knowledgeOpen === id ? '' : id });
  },

  ...voiceInput,

  async handleVoiceText(text, scenario) {
    if (scenario === 'chat') this.setData({ text });
    else await this.ask(text, scenario);
  },

  stopSpeech() {
    this.speechEpoch++;
    clearTimeout(this.playTimer);
    if (this.player) this.player.destroy();
    this.player = null;
    removeAudio(this.audioPath);
    this.audioPath = '';
    if (!this.disposed && this.data.speechId) this.setData({ speechId: '', speechLabel: '' });
  },

  async speak(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.voice !== 'idle') return;
    const same = this.data.speechId === id;
    this.stopSpeech();
    if (same || !requireSession()) return;
    const item = this.data.messages.find(message => message.id === id);
    if (!item || item.role !== 'assistant' || typeof item.content !== 'string') return;
    const token = this.token;
    const epoch = this.speechEpoch;
    const current = () => epoch === this.speechEpoch && this.visible && this.ownsSession(token);
    this.setData({ speechId: id, speechLabel: '生成中 · 取消', error: '' });
    let filePath;
    try {
      filePath = await prepareSpeech(item.content, current);
      if (!filePath) return;
      if (!current()) {
        removeAudio(filePath);
        return;
      }
      this.audioPath = filePath;
      const player = this.player = wx.createInnerAudioContext();
      const fail = () => {
        if (!current()) return;
        this.stopSpeech();
        this.setData({ error: '音频未能播放，请重试' });
      };
      player.onPlay(() => {
        if (!current()) return;
        clearTimeout(this.playTimer);
        this.setData({ speechLabel: '正在朗读 · 停止' });
      });
      player.onEnded(() => { if (current()) this.stopSpeech(); });
      player.onError(fail);
      this.setData({ speechLabel: '启动播放 · 取消' });
      this.playTimer = setTimeout(fail, 8000);
      player.src = filePath;
      player.play();
    } catch (error) {
      if (this.audioPath !== filePath) removeAudio(filePath);
      if (current()) {
        this.stopSpeech();
        this.showError(error);
      }
    }
  },
});
