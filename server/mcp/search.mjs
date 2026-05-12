import https from 'https';

const DDG_BASE = 'https://api.duckduckgo.com/';

/** @param {string} query @returns {string} */
export function buildSearchUrl(query) {
  const params = new URLSearchParams({
    q:             query,
    format:        'json',
    no_html:       '1',
    skip_disambig: '1',
  });
  return `${DDG_BASE}?${params}`;
}

/** @param {string} url @returns {Promise<string>} */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

/**
 * @param {object} data - DuckDuckGo JSON response
 * @param {number} maxResults
 * @returns {{ title: string; snippet: string; url: string }[]}
 */
export function parseResults(data, maxResults) {
  const results = [];

  if (data.AbstractText) {
    results.push({
      title:   data.AbstractSource || 'Reference',
      snippet: data.AbstractText.slice(0, 300),
      url:     data.AbstractURL || '',
    });
  }

  for (const topic of (data.RelatedTopics ?? [])) {
    if (results.length >= maxResults) break;
    if (!topic.Text || !topic.FirstURL) continue;
    results.push({
      title:   topic.Text.split(' - ')[0].slice(0, 80),
      snippet: topic.Text.slice(0, 250),
      url:     topic.FirstURL,
    });
  }

  return results;
}

/**
 * @param {{ query: string; maxResults?: number }} opts
 * @returns {Promise<{ title: string; snippet: string; url: string }[]>}
 */
export async function webSearch({ query, maxResults = 5 }) {
  const url  = buildSearchUrl(query.slice(0, 200));
  const raw  = await fetchUrl(url);
  const data = JSON.parse(raw);
  return parseResults(data, maxResults);
}
