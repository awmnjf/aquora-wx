const { data, methods } = require('./view');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { estimate: Object, voice: String, busy: Boolean },
  data: { ...data, embedded: true },
  lifetimes: {
    attached() { this.initialize(); },
    detached() { this.dispose(); },
  },
  methods: {
    ...methods,
    openDetails() { this.triggerEvent('details'); },
    startVoice() { this.triggerEvent('voicestart'); },
    stopVoice() { this.triggerEvent('voiceend'); },
    cancelVoice() { this.triggerEvent('voicecancel'); },
  },
});
