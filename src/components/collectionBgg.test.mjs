// Run with: node --test src/components/collectionBgg.test.mjs
// Runs the BGG parsing code over XML laid out the way the real API sends it. Needs jsdom (installed with react-scripts)
// to stand in for the browser's DOMParser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bggOwnedCollection, bggWishlist, bggThing, bggThemes } from './collectionUtils.js';

global.DOMParser = new JSDOM('').window.DOMParser;

const COLLECTION = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<items totalitems="2" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse" pubdate="Sat, 24 Oct 2026 10:00:00 +0000">
  <item objecttype="thing" objectid="13" subtype="boardgame" collid="111">
    <name sortindex="1">CATAN</name>
    <yearpublished>1995</yearpublished>
    <image>https://cf.geekdo-images.com/a/img/catan.jpg</image>
    <thumbnail>https://cf.geekdo-images.com/a/img/catan_t.jpg</thumbnail>
    <stats minplayers="3" maxplayers="4" minplaytime="60" maxplaytime="120" playingtime="120" numowned="200000">
      <rating value="N/A"><usersrated value="100"/><average value="7.1234"/><bayesaverage value="7.0"/><stddev value="1.4"/><median value="0"/></rating>
    </stats>
    <status own="1" prevowned="0" fortrade="0" want="0" wanttoplay="0" wanttobuy="0" wishlist="0" preordered="0" lastmodified="2024-01-01 10:00:00"/>
    <numplays>0</numplays>
  </item>
  <item objecttype="thing" objectid="9209" subtype="boardgame" collid="222">
    <name sortindex="1">Ticket to Ride &amp; Co: "Europe"</name>
    <yearpublished>2004</yearpublished>
    <stats minplayers="2" maxplayers="5" minplaytime="30" maxplaytime="60" playingtime="60" numowned="1">
      <rating value="N/A"><usersrated value="1"/><average value="N/A"/></rating>
    </stats>
    <status own="1"/>
  </item>
</items>`;

const ACCEPTED = `<?xml version="1.0" encoding="utf-8" standalone="yes" ?><message>
\tYour request for this collection has been accepted and will be processed.  Please try again later for access.
</message>`;

const thingXml = (items) => `<?xml version="1.0" encoding="utf-8"?><items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">${items.map(({ id, cats }) => `
<item type="boardgame" id="${id}">
  <thumbnail>https://x/t.jpg</thumbnail><image>https://x/i.jpg</image>
  <name type="primary" sortindex="1" value="Game ${id}" />
  <name type="alternate" sortindex="1" value="Alt ${id}" />
  <description>Some text with entities</description>
  <yearpublished value="2000" /><minplayers value="2" /><maxplayers value="4" /><playingtime value="45" />
  <poll name="suggested_numplayers" title="User Suggested Number of Players" totalvotes="0"><results numplayers="1"><result value="Best" numvotes="0" /></results></poll>
  ${cats.map((c, k) => `<link type="boardgamecategory" id="${1000 + k}" value="${c}" />`).join('\n  ')}
  <link type="boardgamemechanic" id="2023" value="Cooperative Game" />
  <link type="boardgamefamily" id="1" value="Fam" />
  <statistics page="1"><ratings><usersrated value="5" /><average value="7.5" /><bayesaverage value="7" /></ratings></statistics>
</item>`).join('')}</items>`;

const askedIds = (url) => decodeURIComponent(new URL(url, 'http://x').searchParams.get('ids')).split(',');

const stubFetch = (handler) => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const { status = 200, body } = await handler(String(url), calls.length);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return calls;
};

test('bggOwnedCollection reads a collection export laid out like the real one', async () => {
  stubFetch(() => ({ body: COLLECTION }));
  const owned = await bggOwnedCollection('tester');
  assert.equal(owned.length, 2);
  assert.deepEqual({ ...owned[0] }, { id: '13', name: 'CATAN', year: '1995', minPlayers: '3', maxPlayers: '4', playTime: '120', image: 'https://cf.geekdo-images.com/a/img/catan.jpg', rating: '7.1', type: '', priority: '' });
  assert.equal(owned[1].name, 'Ticket to Ride & Co: "Europe"');
  assert.equal(owned[1].rating, '');
  assert.equal(owned[1].image, '');
});

test('bggWishlist asks for the wishlist and reads each game\'s priority', async () => {
  const WISHLIST = `<?xml version="1.0" encoding="utf-8" standalone="yes"?><items totalitems="2" termsofuse="x" pubdate="x">
    <item objecttype="thing" objectid="266192" subtype="boardgame" collid="1"><name sortindex="1">Wingspan</name><yearpublished>2019</yearpublished>
      <stats minplayers="1" maxplayers="5" playingtime="70"><rating value="N/A"><average value="8.1"/></rating></stats>
      <status own="0" wishlist="1" wishlistpriority="2" lastmodified="2025-01-01 10:00:00"/></item>
    <item objecttype="thing" objectid="13" subtype="boardgame" collid="2"><name sortindex="1">Catan</name><status own="0" wishlist="1"/></item>
  </items>`;
  const calls = stubFetch(() => ({ body: WISHLIST }));
  const list = await bggWishlist('tester');
  assert.match(calls[0], /mode=wishlist/);
  assert.deepEqual(list.map((g) => [g.name, g.priority]), [['Wingspan', '2'], ['Catan', '']]);
  assert.equal(list[0].playTime, '70');
});

test('bggOwnedCollection says so when BGG is still preparing the export, instead of finding no games', async () => {
  stubFetch(() => ({ body: ACCEPTED }));
  await assert.rejects(() => bggOwnedCollection('tester'), /still preparing/);
});

test('bggOwnedCollection passes on BGG\'s own error message', async () => {
  stubFetch(() => ({ body: '<?xml version="1.0"?><errors><error><message>Invalid username specified</message></error></errors>' }));
  await assert.rejects(() => bggOwnedCollection('nobody'), /Invalid username/);
});

test('bggThing returns categories and ignores mechanics and families', async () => {
  stubFetch(() => ({ body: thingXml([{ id: '5', cats: ['Fantasy', 'Card Game'] }, { id: '6', cats: [] }]) }));
  const things = await bggThing(['5', '6']);
  assert.deepEqual(things.map((t) => [t.id, t.categories]), [['5', ['Fantasy', 'Card Game']], ['6', []]]);
  assert.equal(things[0].name, 'Game 5');
});

test('bggThemes asks for 20 ids at a time and reports each batch', async () => {
  const ids = Array.from({ length: 45 }, (_, i) => String(100 + i));
  const calls = stubFetch((url) => ({ body: thingXml(askedIds(url).map((id) => ({ id, cats: ['Cat ' + (Number(id) % 3)] }))) }));
  const chunks = [];
  await bggThemes(ids, (found) => chunks.push(found), 0);
  assert.deepEqual(chunks.map((c) => Object.keys(c).length), [20, 20, 5]);
  assert.equal(calls.length, 3);
  assert.deepEqual(chunks[0]['100'], ['Cat 1']);
});

test('bggThemes: an id BGG omits is [] when the batch otherwise answered', async () => {
  stubFetch(() => ({ body: thingXml([{ id: '1', cats: ['Fantasy'] }]) }));
  const chunks = [];
  await bggThemes(['1', '2'], (f) => chunks.push(f), 0);
  assert.deepEqual(chunks[0], { 1: ['Fantasy'], 2: [] });
});

test('bggThemes: a batch that fails once is retried and carries on', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => String(i + 1));
  const calls = stubFetch((url, n) => (n === 2
    ? { status: 429, body: 'BoardGameGeek replied with 429' }
    : { body: thingXml(askedIds(url).map((id) => ({ id, cats: ['A'] }))) }));
  const chunks = [];
  await bggThemes(ids, (f) => chunks.push(f), 0);
  assert.equal(chunks.length, 2);
  assert.equal(calls.length, 3, 'the second batch was asked for twice');
});

test('bggThemes: a batch that keeps failing is an error, and earlier batches are kept', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => String(i + 1));
  stubFetch((url, n) => (n >= 2
    ? { body: '<?xml version="1.0"?><items termsofuse="x"></items>' }
    : { body: thingXml(askedIds(url).map((id) => ({ id, cats: ['A'] }))) }));
  const chunks = [];
  await assert.rejects(() => bggThemes(ids, (f) => chunks.push(f), 0), /nothing/);
  assert.equal(chunks.length, 1);
});

test('bggThemes: an http error from the proxy is passed on once the retry fails too', async () => {
  stubFetch(() => ({ status: 502, body: 'BoardGameGeek replied with 502' }));
  await assert.rejects(() => bggThemes(['1', '2'], () => {}, 0), /502/);
});
