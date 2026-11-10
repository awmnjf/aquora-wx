const library = require('./library-data');
const MEDIA = 'https://shuizhiji.com/aquora/learn-media/';

const articlesById = Object.fromEntries(library.articles.map(article => [article.id, article]));
const items = library.articles.concat(library.videos).map(entry => {
  const video = entry.kind === 'video';
  const article = video ? articlesById[entry.articleId] : entry;
  const searchable = [
    entry.title, article.title, article.summary, entry.sourceShort, entry.category,
    ...(article.tags || []),
    ...(article.sections || []).map(section => section.title + ' ' + section.body),
  ].join(' ').toLowerCase();
  const card = {
    id: entry.id, title: entry.title, category: entry.category,
    sourceShort: entry.sourceShort, coverScene: entry.coverScene,
    badge: video ? entry.duration + ' 秒短片' : '图文',
    video,
  };
  return { card, addedOrder: entry.addedOrder || 0, searchable };
}).sort((a, b) => b.addedOrder - a.addedOrder);

const featured = ['chang-gung-rehab', 'fluid-short', 'tiantan-nutrition', 'cma-foamy-urine']
  .map(id => items.find(item => item.card.id === id)?.card).filter(Boolean);

function search(category, query) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item => (category === '最新' || category === item.card.category)
    && words.every(word => item.searchable.includes(word))).map(item => item.card);
}

function findEntry(id) {
  const video = library.videos.find(item => item.id === id);
  const article = articlesById[video ? video.articleId : id];
  if (!article || typeof article.id !== 'string') return null;
  return {
    article,
    video: video ? {
      ...video,
      src: MEDIA + video.id + '.mp4',
      poster: MEDIA + video.id + '.jpg',
      captions: video.frames.map((lines, index) => ({ index, text: lines.join(' · ') })),
    } : null,
    sources: [{ title: '复制来源原文链接', url: article.sourceUrl }].concat(article.additionalSources || []),
  };
}

module.exports = { categories: ['最新', ...library.categories], featured, findEntry, search };
