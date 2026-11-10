const { requireSession } = require('../../lib/api');
const { planFields, savePlan } = require('../../lib/care-plan');

Component({
  options: { styleIsolation: 'apply-shared' },
  data: { open: false, form: {}, busy: false, error: '', conflict: false },
  methods: {
    openEditor(plan) {
      if (!this.data.busy) this.setData({ open: true, form: planFields(plan), error: '', conflict: false });
    },

    closeEditor() {
      if (!this.data.busy) this.setData({ open: false });
    },

    updateField(event) {
      if (!this.data.busy) this.setData({ ['form.' + event.currentTarget.dataset.field]: event.detail.value, error: '' });
    },

    confirmPlan(event) {
      if (!this.data.busy) this.setData({ 'form.confirmed': event.detail.value.length > 0, error: '' });
    },

    reload() {
      this.closeEditor();
      this.triggerEvent('saved');
    },

    async save() {
      if (this.data.busy || this.data.conflict || !requireSession()) return;
      this.setData({ busy: true, error: '' });
      try {
        await savePlan(this.data.form);
        this.setData({ open: false });
        wx.showToast({ title: '饮水目标已更新', icon: 'none' });
        this.triggerEvent('saved');
      } catch (error) {
        if (requireSession()) this.setData({ error: error.message, conflict: error.statusCode === 409 });
      } finally {
        this.setData({ busy: false });
      }
    },
  },
});
