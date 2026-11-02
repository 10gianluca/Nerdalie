// Run with: node --test src/components/collectionSheetStyle.test.mjs
// The sheet's current layout: Book, Game, an unnamed spacer, Min, Max, Time, Type, Year, BGG Rating, House, Played, Added,
// Complete, another spacer and a BGG Link. BGG fills what it knows (and the link), you type the rest, and unnamed columns are left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHeaderIndex, extraHeaders, buildRowFromThing, buildPatchFromThing, incompleteRows, newListLayout, newListFields,
  buildNewListRow, fileInList, parseNewList, inNewList, addPlan, parseCsv,
} from './collectionUtils.js';

const STYLE = ['BOOK', 'GAME', '', 'MIN', 'MAX', 'TIME', 'TYPE', 'YEAR', 'BGG RATING', 'HOUSE', 'PLAYED', 'ADDED', 'COMPLETE', '', 'BGG Link'];
const idx = buildHeaderIndex(STYLE);
const SEVEN = { id: '68448', name: '7 Wonders', year: '2010', minPlayers: '2', maxPlayers: '7', playTime: '30', rating: '7.7', image: 'https://img/7w.jpg', type: 'individual' };
const url = (id) => `https://boardgamegeek.com/boardgame/${id}`;

// rows as they come out of the sheet: tab separated here, like the sheet was pasted
const rowOf = (line) => line.split('\t');
const FULL = rowOf('\t5211\t\t2\t5\t30\tindividual\t2019\t6.3\tGL\tN\t\tYES\t\thttps://boardgamegeek.com/boardgame/271512');
const NO_LINK = rowOf('\t7 Wonders\t\t2\t7\t30\tindividual\t2010\t7.7\tGL\tY\t\tYES\t\t');
const BARE = rowOf('\t1950s Rock n Roll\t\t\t\t\t\t\t\t\t\t\t\t\t');

test('every column of the sheet is found, whatever is around it', () => {
  assert.deepEqual(idx, { GAME: 1, YEAR: 7, MIN: 3, MAX: 4, TIME: 5, TYPE: 6, RATING: 8, IMAGE: -1, BGGID: -1, LINK: 14 });
});

test('the columns you type are Book, House, Played, Added and Complete, not the spacers or the link', () => {
  assert.deepEqual(extraHeaders(STYLE, idx).map((h) => h.name), ['BOOK', 'HOUSE', 'PLAYED', 'ADDED', 'COMPLETE']);
  assert.deepEqual(extraHeaders(STYLE, idx).map((h) => h.i), [0, 9, 10, 11, 12]);
});

test('a new game fills the right cells, the link included, and leaves the spacers empty', () => {
  const row = buildRowFromThing(STYLE, idx, SEVEN, '7 Wonders', { 9: 'GL', 10: 'Y', 12: 'YES' });
  assert.deepEqual(row, ['', '7 Wonders', '', '2', '7', '30', 'individual', '2010', '7.7', 'GL', 'Y', '', 'YES', '', url('68448')]);
  assert.equal(row.length, STYLE.length);
  assert.equal(row[2], '');
  assert.equal(row[13], '');
});

test('a sheet without a link column is filled as before', () => {
  const plain = ['GAME', 'YEAR'];
  assert.deepEqual(buildRowFromThing(plain, buildHeaderIndex(plain), SEVEN, '7 Wonders'), ['7 Wonders', '2010']);
});

test('a game BGG has no id for gets no link', () => {
  assert.equal(buildRowFromThing(STYLE, idx, { ...SEVEN, id: '' }, 'x')[14], '');
});

test('fill in missing info picks the rows with a gap, the missing link counting as one', () => {
  const rows = [FULL, NO_LINK, BARE];
  assert.deepEqual(incompleteRows(rows, idx).map((e) => e.i), [1, 2]);
  // a sheet with no link column does not call a row incomplete for lacking one
  const old = ['GAME', 'YEAR', 'MIN', 'MAX', 'TIME', 'TYPE', 'BGG RATING'];
  assert.deepEqual(incompleteRows([['x', '1', '2', '3', '4', 'solo', '5']], buildHeaderIndex(old)), []);
});

test('filling a row writes only the blanks: a row with everything but the link gets the link and nothing else', () => {
  assert.deepEqual(buildPatchFromThing(idx, NO_LINK, SEVEN), { 14: url('68448') });
  // a bare row gets everything BGG has, never the columns BGG does not know
  assert.deepEqual(buildPatchFromThing(idx, BARE, SEVEN), { 3: '2', 4: '7', 5: '30', 6: 'individual', 7: '2010', 8: '7.7', 14: url('68448') });
  // what was typed stays
  assert.deepEqual(buildPatchFromThing(idx, FULL, { ...SEVEN, year: '1999', rating: '9' }), {});
});

test('the New List tab takes the same columns, and asks for the same five', () => {
  const layout = newListLayout(STYLE);
  assert.deepEqual(layout.header, STYLE);
  assert.equal(layout.link, 14);
  assert.deepEqual(newListFields(STYLE, idx).map((f) => f.name), ['BOOK', 'HOUSE', 'PLAYED', 'ADDED', 'COMPLETE']);
  const row = buildNewListRow(STYLE, idx, SEVEN, '7 Wonders', { 9: 'GL' });
  assert.equal(row[14], url('68448'));
  assert.equal(row[9], 'GL');
  assert.equal(row.length, 15);
});

test('the New List tab is read back with its spacer columns, and finds a game by its link', () => {
  const csv = [STYLE.join(','), FULL.join(','), NO_LINK.join(',')].join('\n');
  const list = parseNewList(csv, ['GAME'], []);
  assert.equal(list.header.length, 15);
  assert.equal(list.rows.length, 2);
  assert.equal(inNewList(list, { id: '271512', name: 'Something else' }, 'Something else'), true, 'by the id in the link');
  assert.equal(inNewList(list, { id: '1', name: '7 wonders' }, ''), true, 'by name');
  assert.equal(inNewList(list, { id: '9', name: 'Azul' }, 'Azul'), false);
});

test('filing a row in a tab of this layout keeps every cell where it was', () => {
  const row = buildNewListRow(STYLE, idx, SEVEN, '7 Wonders', { 9: 'GL' });
  assert.deepEqual(fileInList([], STYLE, row), { header: STYLE, row });
  assert.deepEqual(fileInList(STYLE, STYLE, row), { header: STYLE, row });
});

test('a game already in the main sheet is spotted by name, with the BGG name', () => {
  const rows = [FULL, NO_LINK];
  assert.equal(addPlan({ id: '68448', name: '7 Wonders' }, '7 Wonders', rows, idx, null).sheet, 'have');
  assert.equal(addPlan({ id: '230802', name: 'Azul' }, 'Azul', rows, idx, null).sheet, 'add');
});

test('the pasted sheet reads cleanly as a CSV, blank headers and all', () => {
  const csv = [STYLE.join(','), FULL.join(',')].join('\n');
  const table = parseCsv(csv);
  assert.equal(table[0].length, 15);
  assert.equal(buildHeaderIndex(table[0]).LINK, 14);
  assert.equal(table[1][1], '5211');
});
