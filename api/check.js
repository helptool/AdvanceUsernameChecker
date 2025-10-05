// api/check.js
// Vercel Serverless function — POST { usernames: ["abc", "def"] } -> returns { "abc": { available: true }, ... }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const INSTAGRAM_SESSIONID = process.env.INSTAGRAM_SESSIONID;
  if (!INSTAGRAM_SESSIONID) return res.status(500).json({ error: 'Missing INSTAGRAM_SESSIONID env var' });

  let body;
  try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body); } catch (e) { body = {}; }
  const { usernames } = body;
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ error: 'Send { "usernames": ["name1","name2"] }' });
  }

  const results = {};
  // small concurrency to avoid flood from server IP
  const concurrency = 3;
  let idx = 0;

  async function worker() {
    while (idx < usernames.length) {
      const i = idx++;
      const username = usernames[i];
      try {
        const url = 'https://www.instagram.com/web/search/topsearch/?query=' + encodeURIComponent(username);
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://www.instagram.com/',
            // session cookie auth
            'Cookie': `sessionid=${INSTAGRAM_SESSIONID};`,
          },
        });

        if (resp.status === 200) {
          const data = await resp.json();
          // If users[] is empty => available
          const available = !data.users || data.users.length === 0;
          results[username] = { available: !!available };
        } else if (resp.status === 429) {
          results[username] = { available: null, error: 'rate_limited' };
        } else if (resp.status === 403 || resp.status === 401) {
          results[username] = { available: null, error: `auth_or_block_${resp.status}` };
        } else {
          results[username] = { available: null, error: `status_${resp.status}` };
        }
      } catch (err) {
        results[username] = { available: null, error: err.message };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }).map(() => worker()));

  // enable CORS so your frontend can call it
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(200).json(results);
}
