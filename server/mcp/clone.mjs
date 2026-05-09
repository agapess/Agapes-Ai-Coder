export function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function checkRobotsDisallowed(robotsTxt) {
  const lines = robotsTxt.split('\n');
  let inStarAgent = false;
  for (const line of lines) {
    const t = line.trim().toLowerCase();
    if (t === 'user-agent: *')      { inStarAgent = true;  continue; }
    if (t.startsWith('user-agent:')) { inStarAgent = false; continue; }
    if (inStarAgent && t === 'disallow: /') return true;
  }
  return false;
}
