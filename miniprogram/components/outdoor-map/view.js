const { getRecordTime, requireSession, request } = require('../../lib/api');
const { DAY_MS, dateInput, parseShanghai, timeInput } = require('../../lib/date');
const { draftRecord } = require('../../lib/navigation');
const { nearbyToilets, searchCenters } = require('../../pages/map/places');

const RADII = [1000, 3000, 5000];
const SCALES = [15, 13, 12];

const data = {
  longitude: 116.3974,
  latitude: 39.9093,
  scale: 13,
  center: null,
  radiusIndex: 1,
  radiusOptions: ['1 km', '3 km', '5 km'],
  includeOther: false,
  locating: false,
  searching: false,
  finding: false,
  showSearch: false,
  query: '',
  centers: [],
  places: [],
  markers: [],
  circles: [],
  selected: null,
  partial: false,
  mapError: '',
  addressError: '',
  showOuting: false,
  outingTitle: '',
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  minDate: '',
  maxDate: '',
  outingSaving: false,
  outingError: '',
  outingResult: null,
};

const methods = {
  initialize() {
    this.nearbyEpoch = 0;
    this.addressEpoch = 0;
  },

  dispose() { this.closed = true; this.nearbyEpoch++; this.addressEpoch++; },

  toggleSearch() {
    this.setData({ showSearch: !this.data.showSearch });
  },

  setQuery(event) {
    this.addressEpoch++;
    this.setData({ query: event.detail.value, centers: [], finding: false, addressError: '' });
  },

  async findCenters() {
    const query = this.data.query.trim();
    if (!query || this.data.finding) return;
    const epoch = ++this.addressEpoch;
    this.setData({ finding: true, addressError: '', centers: [] });
    try {
      const centers = await searchCenters(query);
      if (epoch === this.addressEpoch) this.setData({ centers, addressError: centers.length ? '' : '未找到匹配的地点' });
    } catch (error) {
      if (epoch === this.addressEpoch) this.setData({ addressError: error.message });
    } finally {
      if (epoch === this.addressEpoch) this.setData({ finding: false });
    }
  },

  chooseCenter(event) {
    const center = this.data.centers.find(place => place.id === event.currentTarget.dataset.id);
    if (center) this.setCenter(center);
  },

  chooseOnMap() {
    if (this.data.locating) return;
    const center = this.data.center;
    wx.chooseLocation({
      ...(center ? { latitude: center.latitude, longitude: center.longitude } : {}),
      success: result => {
        if (this.closed) return;
        this.setCenter({ name: result.name || result.address || '已选地点', latitude: Number(result.latitude), longitude: Number(result.longitude) });
      },
      fail: error => {
        if (!this.closed && !/cancel/i.test(error.errMsg || '')) {
          this.setData({ showSearch: true, addressError: '微信选点暂不可用，请试试按名称搜索' });
        }
      },
    });
  },

  locate() {
    if (this.data.locating || !requireSession()) return;
    this.setData({ locating: true, mapError: '' });
    wx.getLocation({
      type: 'gcj02',
      success: ({ latitude, longitude, accuracy }) => {
        if (this.closed) return;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || accuracy > 1000) {
          this.setData({ showSearch: true, mapError: '定位范围较大，请搜索附近地点或从地图选择' });
          return;
        }
        this.setCenter({ name: '当前位置', latitude, longitude });
      },
      fail: () => {
        if (!this.closed) this.setData({ showSearch: true, mapError: '无法获取当前位置，请检查定位权限或搜索地点' });
      },
      complete: () => { if (!this.closed) this.setData({ locating: false }); },
    });
  },

  setCenter(center) {
    if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) return;
    this.setData({
      center, longitude: center.longitude, latitude: center.latitude, scale: SCALES[this.data.radiusIndex],
      showSearch: false, places: [], selected: null, markers: [], partial: false,
      circles: [{ latitude: center.latitude, longitude: center.longitude, radius: 85, color: '#13695ccc', fillColor: '#13695c42', strokeWidth: 2 }],
    });
    this.refreshNearby();
  },

  chooseRadius(event) {
    const radiusIndex = Number(event.detail.value);
    if (!RADII[radiusIndex] || radiusIndex === this.data.radiusIndex) return;
    this.setData({ radiusIndex, scale: SCALES[radiusIndex] });
    const places = this.data.places.filter(place => place.distance <= RADII[radiusIndex]);
    this.showPlaces(places, places.find(place => this.data.selected && place.id === this.data.selected.id) || places[0]);
    this.refreshNearby();
  },

  toggleOther(event) {
    this.setData({ includeOther: event.detail.value });
    if (!this.data.includeOther) {
      const places = this.data.places.filter(place => place.accessible);
      this.showPlaces(places, places.find(place => this.data.selected && place.id === this.data.selected.id) || places[0]);
    }
    this.refreshNearby();
  },

  async refreshNearby() {
    const { center, radiusIndex, includeOther } = this.data;
    if (!center) return;
    const epoch = ++this.nearbyEpoch;
    this.setData({ searching: true, mapError: '', partial: false });
    try {
      const { places, partial } = await nearbyToilets(center, RADII[radiusIndex], includeOther);
      if (epoch !== this.nearbyEpoch) return;
      const prior = this.data.selected;
      const selected = (prior && places.find(place => place.id === prior.id)) || places.find(place => place.accessible) || places[0];
      this.showPlaces(places, selected);
      this.setData({ partial });
    } catch (error) {
      if (epoch === this.nearbyEpoch) this.setData({ mapError: error.message });
    } finally {
      if (epoch === this.nearbyEpoch) this.setData({ searching: false });
    }
  },

  showPlaces(places, selected) {
    const markers = places.map((place, index) => ({
      id: index + 1,
      latitude: place.latitude,
      longitude: place.longitude,
      iconPath: place.accessible ? '/pages/map/pin.png' : '/pages/map/pin-other.png',
      width: 22,
      height: 28,
      callout: selected && place.id === selected.id ? {
        content: place.name, display: 'ALWAYS', color: '#17483e', bgColor: '#ffffff', borderRadius: 8, padding: 6, fontSize: 12,
      } : undefined,
    }));
    this.setData({ places, markers, selected: selected || null });
  },

  selectPlace(event) {
    const selected = this.data.places.find(place => place.id === event.currentTarget.dataset.id);
    if (selected) this.focusPlace(selected);
  },

  selectMarker(event) {
    const markerId = event.detail && event.detail.markerId !== undefined ? event.detail.markerId : event.markerId;
    const place = this.data.places[markerId - 1];
    if (place) this.focusPlace(place);
  },

  focusPlace(place) {
    this.showPlaces(this.data.places, place);
    this.setData({ latitude: place.latitude, longitude: place.longitude });
  },

  recenter() {
    const center = this.data.center;
    if (center) this.setData({ latitude: center.latitude, longitude: center.longitude, scale: SCALES[this.data.radiusIndex] });
  },

  openDirections() {
    const place = this.data.selected;
    if (!place) return;
    wx.openLocation({
      latitude: place.latitude, longitude: place.longitude, name: place.name, address: place.address, scale: 16,
      fail: () => { if (!this.closed) this.setData({ mapError: '暂时无法打开微信导航，请稍后重试' }); },
    });
  },

  quickDrink() { draftRecord({ kind: 'drink', source: 'manual' }); },

  askAssistant() {
    getApp().globalData.assistantScenario = 'outdoor';
    wx.switchTab({ url: '/pages/assistant/index' });
  },

  toggleOuting() {
    if (this.data.outingSaving) return;
    if (this.data.showOuting) {
      this.setData({ showOuting: false });
      return;
    }
    const now = getRecordTime();
    const start = now + 3600000;
    const end = now + 7200000;
    this.setData({
      showOuting: true, outingTitle: '', startDate: dateInput(start), startTime: timeInput(start),
      endDate: dateInput(end), endTime: timeInput(end), minDate: dateInput(now),
      maxDate: dateInput(now + 30 * DAY_MS), outingError: '', outingResult: null,
    });
  },

  setOutingField(event) {
    const field = event.currentTarget.dataset.field;
    if (!this.data.outingSaving && ['outingTitle', 'startDate', 'startTime', 'endDate', 'endTime'].includes(field)) {
      this.setData({ [field]: event.detail.value, outingError: '' });
    }
  },

  async saveOuting() {
    if (this.data.outingSaving || this.data.outingResult || !requireSession()) return;
    const title = this.data.outingTitle.trim();
    const startAt = parseShanghai(this.data.startDate, this.data.startTime);
    const endAt = parseShanghai(this.data.endDate, this.data.endTime);
    const now = getRecordTime();
    if (!title || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt ||
        endAt - startAt > DAY_MS || startAt < now - 60000 || endAt > now + 30 * DAY_MS) {
      this.setData({ outingError: '请填写外出事项，并选择未来 30 天内、一天以内的有效行程' });
      return;
    }
    this.setData({ outingSaving: true, outingError: '' });
    try {
      const result = await request('/outings', { method: 'POST', data: { title, startAt, endAt } });
      if (this.closed) return;
      if (!result.id) throw new Error('暂未确认保存结果，请稍后查看行程');
      const conflicts = (Array.isArray(result.conflicts) ? result.conflicts : []).map(item => ({
        id: item.id,
        text: `${timeInput(item.due_at)} · ${item.kind === 'drink' ? '饮水' : '排尿 / 导尿'}`,
      }));
      this.setData({ outingResult: { message: result.message || '行程已保存', conflicts } });
    } catch (error) {
      if (this.closed) return;
      if (error.statusCode === 401) requireSession();
      else this.setData({ outingError: error.message });
    } finally {
      if (!this.closed) this.setData({ outingSaving: false });
    }
  },
};

module.exports = { data, methods };
