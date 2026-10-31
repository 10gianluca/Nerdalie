// Run with: node --test src/components/sheetScript.test.mjs
// Runs the Apps Script that Settings tells the user to paste (SCRIPT_HELP in sheetScript.js) against a fake spreadsheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCRIPT_HELP } from './sheetScript.js';

function fakeSheet(name, rows = []) {
  const s = {
    name, rows, frozen: 0, bold: null, formats: [],
    appendRow(r) { rows.push(r.slice()); },
    getLastRow() { return rows.length; },
    getLastColumn() { return rows.reduce((n, r) => Math.max(n, r.length), 0); },
    setFrozenRows(n) { s.frozen = n; },
    getRange(r, c, nr = 1, nc = 1) {
      if (nr < 1 || nc < 1) throw new Error('Range must have at least 1 row/column');
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
        setValue: (v) => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; },
        setValues: (vals) => vals.forEach((vr, i) => vr.forEach((v, j) => { rows[r - 1 + i] = rows[r - 1 + i] || []; rows[r - 1 + i][c - 1 + j] = v; })),
        setFontWeight: (w) => { s.bold = w; },
        setNumberFormat: (f) => { s.formats.push({ row: r, format: f }); },
      };
    },
  };
  return s;
}

function run(sheets, body) {
  const ss = {
    getSheets: () => sheets,
    getNumSheets: () => sheets.length,
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n, i) => { const s = fakeSheet(n); sheets.splice(i, 0, s); return s; },
  };
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) };
  const SpreadsheetApp = { getActiveSpreadsheet: () => ss };
  const doPost = new Function('SpreadsheetApp', 'ContentService', `${SCRIPT_HELP}\nreturn doPost;`)(SpreadsheetApp, ContentService);
  return JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).t);
}

const decision = (game, choice, tab) => ({ decision: { game, choice, ...(tab ? { tab } : {}) } });

test('first answer creates a Decisions tab at the end with a bold, frozen Game/Choice header', () => {
  const main = fakeSheet('Games', [['GAME', 'YEAR'], ['Catan', '1995']]);
  const sheets = [main];
  const r = run(sheets, decision('Catan', 'Keep'));
  assert.deepEqual(r, { ok: true, kind: 'decision', tab: 'Decisions' });
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0], main);
  assert.equal(sheets[1].name, 'Decisions');
  assert.deepEqual(sheets[1].rows, [['Game', 'Choice'], ['Catan', 'Keep']]);
  assert.equal(sheets[1].frozen, 1);
  assert.equal(sheets[1].bold, 'bold');
  assert.deepEqual(main.rows, [['GAME', 'YEAR'], ['Catan', '1995']], 'the main sheet is untouched');
});

test('answering the same game again updates its row; a new game appends', () => {
  const sheets = [fakeSheet('Games', [['GAME']])];
  run(sheets, decision('Catan', 'Keep'));
  run(sheets, decision('Azul', 'Discard'));
  run(sheets, decision('Catan', 'Play and see'));
  assert.deepEqual(sheets[1].rows, [['Game', 'Choice'], ['Catan', 'Play and see'], ['Azul', 'Discard']]);
});

test('wishlist answers go to their own Wishlist tab and say so in the reply', () => {
  const sheets = [fakeSheet('Games', [['GAME']])];
  run(sheets, decision('Catan', 'Keep'));
  const r = run(sheets, decision('Wingspan', 'Buy', 'Wishlist'));
  assert.deepEqual(r, { ok: true, kind: 'decision', tab: 'Wishlist' });
  assert.deepEqual(sheets.map((s) => s.name), ['Games', 'Decisions', 'Wishlist']);
  assert.deepEqual(sheets[2].rows, [['Game', 'Choice'], ['Wingspan', 'Buy']]);
  assert.deepEqual(sheets[1].rows, [['Game', 'Choice'], ['Catan', 'Keep']], 'Decisions is left alone');
  run(sheets, decision('Wingspan', 'Later', 'Wishlist'));
  assert.deepEqual(sheets[2].rows, [['Game', 'Choice'], ['Wingspan', 'Later']]);
});

test('a request for any other tab name is refused instead of making a tab', () => {
  const sheets = [fakeSheet('Games', [['GAME']])];
  const r = run(sheets, decision('Catan', 'Keep', 'Passwords'));
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown tab/);
  assert.equal(sheets.length, 1);
});

test('a Decisions tab that exists but is empty gets its header instead of crashing', () => {
  const sheets = [fakeSheet('Games', [['GAME']]), fakeSheet('Decisions', [])];
  const r = run(sheets, decision('Catan', 'Keep'));
  assert.equal(r.kind, 'decision');
  assert.deepEqual(sheets[1].rows, [['Game', 'Choice'], ['Catan', 'Keep']]);
});

test('a Decisions tab you made yourself with the header keeps your rows', () => {
  const sheets = [fakeSheet('Games', [['GAME']]), fakeSheet('Decisions', [['Game', 'Choice'], ['Azul', 'Keep']])];
  run(sheets, decision('Catan', 'Discard'));
  assert.deepEqual(sheets[1].rows, [['Game', 'Choice'], ['Azul', 'Keep'], ['Catan', 'Discard']]);
});

test('names with quotes, commas and apostrophes are stored as typed', () => {
  const sheets = [fakeSheet('Games', [['GAME']])];
  run(sheets, decision(`Uncle Ben's "Best", Vol. 2`, 'Keep'));
  assert.equal(sheets[1].rows[1][0], `Uncle Ben's "Best", Vol. 2`);
});

test('a play creates the Plays tab and each one adds a row, stored as text so the date stays as typed', () => {
  const sheets = [fakeSheet('Games', [['GAME']])];
  const r = run(sheets, { play: { date: '2026-10-25', game: 'Catan', players: 'Sam, Nalie', winner: 'Nalie', notes: 'close' } });
  assert.deepEqual(r, { ok: true, kind: 'play' });
  assert.equal(sheets[1].name, 'Plays');
  assert.deepEqual(sheets[1].rows, [['Date', 'Game', 'Players', 'Winner', 'Notes'], ['2026-10-25', 'Catan', 'Sam, Nalie', 'Nalie', 'close']]);
  assert.deepEqual(sheets[1].formats, [{ row: 2, format: '@' }]);
  run(sheets, { play: { date: '2026-10-26', game: 'Azul', players: '', winner: '', notes: '' } });
  assert.equal(sheets[1].rows.length, 3);
  assert.equal(sheets[1].rows[2][1], 'Azul');
  assert.deepEqual(sheets[1].formats.map((f) => f.row), [2, 3]);
  assert.equal(sheets[1].frozen, 1);
});

test('a ping answers with the version and changes nothing', () => {
  const main = fakeSheet('Games', [['GAME'], ['Catan']]);
  const sheets = [main];
  assert.deepEqual(run(sheets, { ping: true }), { ok: true, kind: 'ping', version: 4 });
  assert.equal(sheets.length, 1);
  assert.deepEqual(main.rows, [['GAME'], ['Catan']]);
});

const HEADER = ['Game', 'Year', 'House', 'Played', 'Complete', 'BGG Link'];
const newList = (row, header = HEADER) => ({ newList: { header, row } });

test('the first New List game creates the tab at the end with the given columns, bold and frozen', () => {
  const main = fakeSheet('Games', [['Game', 'Year', 'House', 'Played', 'Complete'], ['Catan', '1995', 'Sam', 'Yes', 'Yes']]);
  const sheets = [main];
  const r = run(sheets, newList(['Azul', '2017', 'Nalie', 'No', 'No', 'https://boardgamegeek.com/boardgame/230802']));
  assert.deepEqual(r, { ok: true, kind: 'newlist' });
  assert.equal(sheets.length, 2);
  assert.equal(sheets[1].name, 'New List');
  assert.deepEqual(sheets[1].rows, [HEADER, ['Azul', '2017', 'Nalie', 'No', 'No', 'https://boardgamegeek.com/boardgame/230802']]);
  assert.equal(sheets[1].frozen, 1);
  assert.equal(sheets[1].bold, 'bold');
  assert.deepEqual(main.rows[1], ['Catan', '1995', 'Sam', 'Yes', 'Yes'], 'the main sheet is untouched');
});

test('later games are added under the tab\'s own columns, matched by name', () => {
  // a tab whose columns are in another order, as if the main sheet was rearranged after it was made
  const list = fakeSheet('New List', [['BGG Link', 'Game', 'Year']]);
  const sheets = [fakeSheet('Games', [['Game']]), list];
  run(sheets, newList(['Azul', '2017', 'Nalie', 'No', 'No', 'https://x/230802']));
  assert.deepEqual(list.rows[0],['BGG Link', 'Game', 'Year', 'House', 'Played', 'Complete'], 'columns the tab lacked were added at the end');
  assert.deepEqual(list.rows[1], ['https://x/230802', 'Azul', '2017', 'Nalie', 'No', 'No']);
  run(sheets, newList(['Wingspan', '2019', 'Sam', 'Yes', 'Yes', 'https://x/266192']));
  assert.deepEqual(list.rows[2], ['https://x/266192', 'Wingspan', '2019', 'Sam', 'Yes', 'Yes']);
  assert.equal(sheets.length, 2, 'no second tab');
});

test('New List column names match whatever the case, and a blank column name is skipped', () => {
  const list = fakeSheet('New List', [['GAME', 'house']]);
  const sheets = [fakeSheet('Games', [['Game']]), list];
  run(sheets, newList(['Azul', 'Nalie', 'ignored'], ['Game', 'House', '']));
  assert.deepEqual(list.rows, [['GAME', 'house'], ['Azul', 'Nalie']]);
});

test('an empty New List tab gets its header instead of crashing', () => {
  const sheets = [fakeSheet('Games', [['Game']]), fakeSheet('New List', [])];
  assert.equal(run(sheets, newList(['Azul', '2017', '', '', '', 'u'])).kind, 'newlist');
  assert.deepEqual(sheets[1].rows, [HEADER, ['Azul', '2017', '', '', '', 'u']]);
});

test('the original add-row and update-row requests still work', () => {
  const main = fakeSheet('Games', [['GAME', 'YEAR', 'MIN'], ['Catan', '', '']]);
  const sheets = [main];
  assert.deepEqual(run(sheets, { row: ['Azul', '2017', '2'] }), { ok: true });
  assert.deepEqual(main.rows[2], ['Azul', '2017', '2']);
  assert.deepEqual(run(sheets, { update: { rowIndex: 0, patch: { 1: '1995', 2: '3' } } }), { ok: true });
  assert.deepEqual(main.rows[1], ['Catan', '1995', '3']);
  assert.equal(sheets.length, 1, 'no extra tab is created by those');
});
