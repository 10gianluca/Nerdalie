/* Serverless proxy for the BoardGameGeek XML API2.
   Runs server-side so it can send the Authorization header BGG now requires for API access —
   something a plain browser fetch (blocked by CORS) or a public read-through proxy cannot do.

   Setup (one time, on Netlify): Site configuration -> Environment variables -> add BGG_API_TOKEN,
   using the token from your BGG application at https://boardgamegeek.com/applications. The token
   never reaches the browser or this repo; it only lives in Netlify's environment.

   Read-only: BGG's API has no write access for collections at all (not even for registered
   applications), so this only ever proxies GET-style lookups — search, thing, and collection. */

const BASE = 'https://boardgamegeek.com/xmlapi2';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function bggFetch(url) {
  const headers = {};
  if (process.env.BGG_API_TOKEN) headers.Authorization = `Bearer ${process.env.BGG_API_TOKEN}`;
  return fetch(url, { headers });
}

// The collection endpoint queues the export and answers 202 until it's ready; poll briefly rather
// than making the browser retry through several round trips of its own.
async function fetchCollection(username) {
  const url = `${BASE}/collection?username=${encodeURIComponent(username)}&own=1&stats=1`;
  let res;
  for (let i = 0; i < 8; i++) {
    res = await bggFetch(url);
    if (res.status !== 202) return res;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return res;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const { mode, q, ids, username } = event.queryStringParameters || {};
  try {
    let res;
    if (mode === 'search' && q) {
      res = await bggFetch(`${BASE}/search?query=${encodeURIComponent(q)}&type=boardgame,boardgameexpansion`);
    } else if (mode === 'thing' && ids) {
      res = await bggFetch(`${BASE}/thing?id=${encodeURIComponent(ids)}&stats=1`);
    } else if (mode === 'collection' && username) {
      res = await fetchCollection(username);
    } else {
      return { statusCode: 400, headers: CORS, body: 'Missing or unrecognised "mode" parameter' };
    }
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403
        ? ' (check that BGG_API_TOKEN is set correctly in this site’s environment variables)'
        : '';
      return { statusCode: res.status, headers: { ...CORS, 'Content-Type': 'text/plain' }, body: `BoardGameGeek replied with ${res.status}${hint}\n\n${text}`.slice(0, 2000) };
    }
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/xml' }, body: text };
  } catch (err) {
    return { statusCode: 502, headers: CORS, body: 'Could not reach BoardGameGeek: ' + (err && err.message ? err.message : String(err)) };
  }
};
