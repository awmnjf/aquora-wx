const ORIGIN = 'https://shuizhiji.com';
let config;

function get(url, data) {
  return new Promise((resolve, reject) => wx.request({
    url: ORIGIN + url,
    data,
    timeout: 12000,
    success: response => {
      if (response.statusCode >= 200 && response.statusCode < 300 && response.data) resolve(response.data);
      else reject(new Error('地图服务暂时无法响应，请稍后重试'));
    },
    fail: () => reject(new Error('地图请求失败，请检查网络后重试')),
  }));
}

function getKey() {
  if (!config) {
    config = get('/aquora/map-config.json').then(result => {
      if (!/^[a-zA-Z0-9]{32}$/.test(result.key || '')) throw new Error('地图配置尚未就绪');
      return result.key;
    }).catch(error => {
      config = null;
      throw error;
    });
  }
  return config;
}

async function placeRequest(path, options) {
  // The deployed proxy supplies the AMap security code. The public config only carries the JS API key.
  const key = await getKey();
  const result = await get('/_AMapService/v3/place/' + path, { ...options, key, s: 'rsv3', output: 'JSON' });
  if (String(result.status) !== '1') throw new Error('地点搜索暂不可用，请稍后重试');
  return Array.isArray(result.pois) ? result.pois : [];
}

function coordinates(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (parts.length !== 2 || parts.some(part => !part.trim())) return null;
  const [longitude, latitude] = parts.map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  return { longitude, latitude };
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return Math.round(6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h))));
}

const scalar = value => typeof value === 'string' ? value.trim() : '';

function normalizePlace(poi) {
  const location = coordinates(poi.location);
  const name = scalar(poi.name);
  if (!location || !name) return null;
  return {
    id: scalar(poi.id) || `${location.longitude},${location.latitude}:${name}`,
    name,
    ...location,
    address: [scalar(poi.adname), scalar(poi.address)].filter(Boolean).join(' · ') || '暂未提供详细地址',
  };
}

function normalizeToilets(pois, center, radius) {
  const unique = new Map();
  for (const poi of pois) {
    const place = normalizePlace(poi);
    if (!place) continue;
    const distance = distanceMeters(center, place);
    if (distance > radius) continue;
    const category = /(?:^|\|)200303(?:\||$)/.test(scalar(poi.typecode)) || /残障洗手间|无障碍洗手间/.test(scalar(poi.type));
    const named = /无障碍|残障|残疾人|轮椅/.test(place.name) && /厕|卫生间|洗手间/.test(place.name);
    const negated = /无无障碍|非无障碍|不支持|没有无障碍|未设无障碍/.test(place.name);
    const accessible = !negated && (category || named);
    if (!unique.has(place.id) || accessible) {
      unique.set(place.id, {
        ...place, accessible, distance,
        distanceLabel: distance < 1000 ? `${distance} 米` : `${(distance / 1000).toFixed(1)} 公里`,
      });
    }
  }
  return [...unique.values()].sort((a, b) => a.distance - b.distance);
}

async function nearbyToilets(center, radius, includeOther) {
  const location = `${center.longitude},${center.latitude}`;
  const common = { location, radius, sortrule: 'distance', offset: 25, page: 1, extensions: 'base' };
  const searches = [
    { ...common, types: '200303' },
    { ...common, types: '200300', keywords: '无障碍' },
  ];
  if (includeOther) searches.push({ ...common, types: '200300' });
  const results = await Promise.all(searches.map(options => placeRequest('around', options).catch(() => null)));
  const succeeded = results.filter(Boolean);
  if (!succeeded.length) throw new Error('附近地点暂时无法搜索，请稍后重试');
  const places = normalizeToilets([].concat(...succeeded), center, radius);
  return { places: includeOther ? places : places.filter(place => place.accessible), partial: succeeded.length < results.length };
}

async function searchCenters(keywords) {
  const pois = await placeRequest('text', { keywords, offset: 5, page: 1, extensions: 'base' });
  return pois.map(normalizePlace).filter(Boolean);
}

module.exports = { nearbyToilets, searchCenters };
