/* Serverless proxy for reading a public Google Sheet as CSV.
   The docs.google.com export endpoint doesn't send CORS headers, so the browser can't fetch it
   directly; this small server-side hop does the fetch instead and adds its own CORS header. */

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// Accepts a full share/edit link or a bare sheet ID; keeps a gid (a specific tab) if one is given.
function extractCsvUrl(link) {
  const s = String(link || '').trim();
  const idMatch = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || s.match(/^([A-Za-z0-9_-]{20,})$/);
  if (!idMatch) return null;
  const gidMatch = s.match(/[?#&]gid=(\d+)/);
  const base = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv`;
  return gidMatch ? `${base}&gid=${gidMatch[1]}` : base;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const link = (event.queryStringParameters || {}).link;
  const url = extractCsvUrl(link);
  if (!url) return { statusCode: 400, headers: CORS, body: "That doesn't look like a Google Sheets link" };

  try {
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403
        ? ' (make sure the sheet is shared as "Anyone with the link" can view)'
        : '';
      return { statusCode: res.status, headers: { ...CORS, 'Content-Type': 'text/plain' }, body: `Google replied with ${res.status}${hint}`.slice(0, 500) };
    }
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'text/csv' }, body: text };
  } catch (err) {
    return { statusCode: 502, headers: CORS, body: 'Could not reach Google Sheets: ' + (err && err.message ? err.message : String(err)) };
  }
};
