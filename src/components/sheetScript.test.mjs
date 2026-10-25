// Run with: node --test src/components/sheetScript.test.mjs
// Runs the Apps Script that Settings tells the user to paste (the SCRIPT_HELP text in Collection.js) against a fake spreadsheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./Collection.js', import.meta.url), 'utf8');
const m = src.match(/const SCRIPT_HELP = `([\s\S]*?)`;/);
assert.ok(m, 'found the script text');
const code = m[1];

function fakeSheet(name, rows = []) {
  const s = {
    name, rows, frozen: 0, bold: null,
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
      };
    },
  };
  return s;
}

function run(sheets, body) {
  const ss = {
    sheets,
    getSheets: () => sheets,
    getNumSheets: () => sheets.length,
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n, i) => { const s = fakeSheet(n); sheets.splice(i, 0, s); return s; },
  };
  const out = [];
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) };
  const SpreadsheetApp = { getActiveSpreadsheet: () => ss };
  const doPost = new Function('SpreadsheetApp', 'ContentService', `${code}\nreturn doPost;`)(SpreadsheetApp, ContentService);
  const reply = JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).t);
  return reply;
}

test('first answer creates a Decisions tab at the end with a bold, frozen Game/Choice header', () => {
  const main = fakeSheet('Games', [['GAME', 'YEAR'], ['Catan', '1995']]);
  const sheets = [main];
  const r = run(sheets, { decision: { game: 'Catan', choice: 'Keep' } });
  assert.deepEqual(r, { ok: true, kind: 'decision' });
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
  run(sheets, { decision: { game: 'Catan', choice: 'Keep' } });
  run(sheets, { decision: { game: 'Azul', choice: 'Discard' } });
  run(sheets, { decision: { game: 'Catan', choice: 'Play and see' } });
  assert.deepEqual(sheets[1].rows, [['Game', 'Choice'], ['Catan', 'Play and see'], ['Azul', 'Discard']]);
});

test('a Decisions tab that exists but is empty gets its header instead of crashing', () => {
  const sheets = [fakeSheet('Games', [['GAME']]), fakeSheet('Decisions', [])];
  const r = run(sheets, { decision: { game: 'Catan', choice: 'Keep' } });
  assert.equal(r.kind, 'decision');
  assert.deepEqual(sheets[1].rows, [['Game', 'Choice'], ['Catan', 'Keep']]);
});

test('a Decisions tab you made yourself with the header keeps your rows', () => {
  const sheets = [fakeSheet('Games', [['GAME']]), fakeSheet('Decisions', [['Game', 'Choice'], ['Azul', 'Keep']])];
  run(sheets, { decision: { game: 'Catan', choice: 'Discard' } });
  assert.deepEqual(sheets[1].rows, [['Game', 'Choice'], ['Azul', 'Keep'], ['Catan', 'Discard']]);
});

test('names with quotes, commas and apostrophes are stored as typed', () => {
  const sheets = [fakeSheet('Games', [['GAME']])];
  run(sheets, { decision: { game: `Uncle Ben's "Best", Vol. 2`, choice: 'Keep' } });
  assert.equal(sheets[1].rows[1][0], `Uncle Ben's "Best", Vol. 2`);
});

test('the original add-row and update-row requests still work', () => {
  const main = fakeSheet('Games', [['GAME', 'YEAR', 'MIN'], ['Catan', '', '']]);
  const sheets = [main];
  assert.deepEqual(run(sheets, { row: ['Azul', '2017', '2'] }), { ok: true });
  assert.deepEqual(main.rows[2], ['Azul', '2017', '2']);
  assert.deepEqual(run(sheets, { update: { rowIndex: 0, patch: { 1: '1995', 2: '3' } } }), { ok: true });
  assert.deepEqual(main.rows[1], ['Catan', '1995', '3']);
  assert.equal(sheets.length, 1, 'no Decisions tab is created by those');
});
