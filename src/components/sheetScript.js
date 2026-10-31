// The Google Apps Script the Settings panel tells you to paste into your sheet. It is the only way this site can
// write to the sheet (a plain web page can't), and it only ever does what is spelled out here:
//   { row }                  add a game to the first tab
//   { update }               fill in blank cells on a game's row
//   { decision }             one answer in the Decisions tab (Keep / Discard / Play and see) or the Wishlist tab
//                            (Buy / Drop / Later): Game, Choice. Answering again replaces the earlier answer.
//   { play }                 one row in the Plays tab: Date, Game, Players, Winner, Notes
//   { newList }              one game in the New List tab: the column names and the values under them. The tab is made
//                            with those columns the first time; after that each value goes under the column of the same name.
//   { ping }                 changes nothing; answers with the script's version so the page can tell it is up to date
// Each reply says what it did, so the page can tell when an older copy of this script is still deployed.
export const SCRIPT_HELP = `function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];
  var data = JSON.parse(e.postData.contents);

  // The page asks this before it saves to the Wishlist or New List tab, to be sure it is talking to this version
  if (data.ping) return reply({ ok: true, kind: 'ping', version: 4 });

  if (data.decision) {
    // Keep / Discard / Play and see answers (Decisions) and Buy / Drop / Later answers (Wishlist): Game, Choice
    var name = data.decision.tab || 'Decisions';
    if (name !== 'Decisions' && name !== 'Wishlist') return reply({ ok: false, error: 'Unknown tab: ' + name });
    var tab = tabFor(ss, name, ['Game', 'Choice']);
    var names = tab.getRange(1, 1, tab.getLastRow(), 1).getValues();
    var found = 0;
    for (var i = 1; i < names.length; i++) {
      if (String(names[i][0]).trim() === data.decision.game) { found = i + 1; break; }
    }
    if (found) tab.getRange(found, 2).setValue(data.decision.choice);
    else tab.appendRow([data.decision.game, data.decision.choice]);
    return reply({ ok: true, kind: 'decision', tab: name });
  }

  if (data.play) {
    // One game you played: Date, Game, Players, Winner, Notes
    var plays = tabFor(ss, 'Plays', ['Date', 'Game', 'Players', 'Winner', 'Notes']);
    var cells = plays.getRange(plays.getLastRow() + 1, 1, 1, 5);
    cells.setNumberFormat('@'); // keep it as typed, so 2026-10-25 stays a plain date
    cells.setValues([[data.play.date, data.play.game, data.play.players, data.play.winner, data.play.notes]]);
    return reply({ ok: true, kind: 'play' });
  }

  if (data.newList) {
    // A game for the New List tab: the column names (your main sheet's, ending with BGG Link) and the values for them.
    // A name the tab doesn't have yet gets a new column at the end, so changing your main sheet's columns later is fine.
    var list = tabFor(ss, 'New List', data.newList.header);
    var have = list.getRange(1, 1, 1, list.getLastColumn()).getValues()[0];
    var out = have.map(function () { return ''; });
    for (var k = 0; k < data.newList.header.length; k++) {
      var want = String(data.newList.header[k]).trim().toLowerCase();
      if (!want) continue;
      var at = -1;
      for (var c = 0; c < have.length; c++) {
        if (String(have[c]).trim().toLowerCase() === want) { at = c; break; }
      }
      if (at < 0) {
        have.push(data.newList.header[k]);
        out.push('');
        at = have.length - 1;
        var head = list.getRange(1, at + 1);
        head.setValue(data.newList.header[k]);
        head.setFontWeight('bold');
      }
      out[at] = data.newList.row[k];
    }
    list.getRange(list.getLastRow() + 1, 1, 1, out.length).setValues([out]);
    return reply({ ok: true, kind: 'newlist' });
  }

  if (data.update) {
    var rowNum = data.update.rowIndex + 2; // row 1 is the header
    var range = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn());
    var values = range.getValues()[0];
    for (var col in data.update.patch) values[Number(col)] = data.update.patch[col];
    range.setValues([values]);
  } else {
    sheet.appendRow(data.row);
  }
  return reply({ ok: true });
}

// The named tab, created at the end (with a bold, frozen header row) the first time it is needed.
function tabFor(ss, name, header) {
  var tab = ss.getSheetByName(name) || ss.insertSheet(name, ss.getNumSheets());
  if (tab.getLastRow() === 0) {
    tab.appendRow(header);
    tab.setFrozenRows(1);
    tab.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return tab;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;
