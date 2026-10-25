import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Collection.css';
import {
  fetchSheetCsv, parseCsv, buildHeaderIndex, extraHeaders, distinctValues, filterRows, sortEntries,
  bggFindCandidates, bggOwnedCollection, missingFromSheet, incompleteRows, buildRowFromThing,
  buildPatchFromThing, appendRowViaScript, updateRowViaScript, bggGameUrl, bggCollectionUrl, cellAt, addPlan,
  DECISIONS_TAB, CHOICES, parseDecisions, undecidedGames, saveDecisionViaScript, matchKey,
} from './collectionUtils';
import GamePicker from './GamePicker';

const SETTINGS_KEY = 'nerdalie.collection.settings';
const SCRIPT_HELP = `function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];
  var data = JSON.parse(e.postData.contents);

  if (data.decision) {
    // Keep / Discard / Play and see answers go in a second tab: Game, Choice
    var tab = ss.getSheetByName('Decisions') || ss.insertSheet('Decisions', ss.getNumSheets());
    if (tab.getLastRow() === 0) {
      tab.appendRow(['Game', 'Choice']);
      tab.setFrozenRows(1);
      tab.getRange(1, 1, 1, 2).setFontWeight('bold');
    }
    var names = tab.getRange(1, 1, tab.getLastRow(), 1).getValues();
    var found = 0;
    for (var i = 1; i < names.length; i++) {
      if (String(names[i][0]).trim() === data.decision.game) { found = i + 1; break; }
    }
    if (found) tab.getRange(found, 2).setValue(data.decision.choice);
    else tab.appendRow([data.decision.game, data.decision.choice]);
    return reply({ ok: true, kind: 'decision' });
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

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;

const CHOICE_CLASS = { Keep: 'gcKeep', Discard: 'gcDiscard', 'Play and see': 'gcPlay' };
const CHOICE_KEY = { Keep: 'K', Discard: 'D', 'Play and see': 'P' };

const loadSettings = () => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch (_) {
    return {};
  }
};

function Collection() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('collection'); // 'collection' | 'decide' | 'pick' | 'sync' | 'add'
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(() => !loadSettings().sheetLink);
  const [showScriptHelp, setShowScriptHelp] = useState(false);
  const [form, setForm] = useState(() => ({ sheetLink: '', bggUsername: '', scriptUrl: '', ...loadSettings() }));
  const [notice, setNotice] = useState('');

  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [filterText, setFilterText] = useState('');
  const [filterPlayers, setFilterPlayers] = useState('');
  const [filterType, setFilterType] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  // The BGG collection sync: games you own on BGG that this sheet doesn't have yet.
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [missing, setMissing] = useState(null); // null = not synced yet this visit

  // The manual "search any title" add flow.
  const [addTitle, setAddTitle] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [addCandidates, setAddCandidates] = useState([]);
  const [addResult, setAddResult] = useState(null); // what the last "add" did: { title, id, sheet: 'added'|'already', bgg: 'have'|'opened'|'unknown' }

  // The games you own on BGG, read once and kept so the Add tab can tell whether a game is already there.
  const [bggOwned, setBggOwned] = useState({ status: 'idle', items: [], error: '' }); // idle | loading | ready | error

  // One shared review card, opened from the sync queue, a manual search pick, or the enrich queue.
  const [review, setReview] = useState(null); // { item, title, source: 'sync'|'search'|'enrich', rowIndex?, existingRow? }
  const [reviewExtra, setReviewExtra] = useState({});
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewStatus, setReviewStatus] = useState('');

  // "Fill in missing info": existing rows with a name but blank BGG-fillable columns, reviewed
  // one at a time — each one auto-searches BGG so there's a match to confirm.
  const [enrichQueue, setEnrichQueue] = useState(null); // null = not started this visit
  const [enrichCandidates, setEnrichCandidates] = useState([]);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichError, setEnrichError] = useState('');

  // Decide: one owned game at a time -> Keep / Discard / Play and see, saved to the sheet's Decisions tab.
  const [dec, setDec] = useState({ status: 'idle', error: '', total: 0 }); // idle | loading | ready | error
  const [queue, setQueue] = useState([]); // games still to answer; queue[0] is on screen
  const [answers, setAnswers] = useState(() => new Map()); // matchKey(game) -> { game, choice }
  const [history, setHistory] = useState([]); // answered this visit, newest last: { game, choice }
  const [saving, setSaving] = useState({ sent: 0, pending: 0, failed: [] });
  const sendQueue = useRef([]);
  const sending = useRef(false);

  const idx = useMemo(() => buildHeaderIndex(headers), [headers]);
  const extras = useMemo(() => extraHeaders(headers, idx), [headers, idx]);
  const typeOptions = useMemo(() => distinctValues(rows, idx.TYPE), [rows, idx]);
  const entries = useMemo(() => {
    const filtered = filterRows(rows, idx, { text: filterText, players: filterPlayers, type: filterType });
    return sortKey ? sortEntries(filtered, idx, sortKey, sortDir) : filtered;
  }, [rows, idx, filterText, filterPlayers, filterType, sortKey, sortDir]);

  async function loadSheet(link) {
    if (!link) return;
    setLoading(true);
    setLoadError('');
    try {
      const text = await fetchSheetCsv(link);
      const table = parseCsv(text);
      if (!table.length) throw new Error('That sheet looks empty');
      setHeaders(table[0].map((h) => (h || '').trim()));
      setRows(table.slice(1));
    } catch (e) {
      setLoadError(e.message || 'Could not load the sheet');
    } finally {
      setLoading(false);
    }
  }

  // Load automatically once, whenever a saved sheet link exists.
  useEffect(() => {
    if (settings.sheetLink) loadSheet(settings.sheetLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveSettings(e) {
    e.preventDefault();
    const next = { sheetLink: form.sheetLink.trim(), bggUsername: form.bggUsername.trim(), scriptUrl: form.scriptUrl.trim() };
    // Only invalidate an in-progress sync/review when the sheet or the BGG account actually
    // changed — e.g. just adding the add-script URL (the common path: Add -> redirected here to
    // set it up -> Save) should return you to the review you were already doing, not lose it.
    if (next.sheetLink !== settings.sheetLink || next.bggUsername !== settings.bggUsername) {
      setMissing(null);
      closeReview();
      setDec({ status: 'idle', error: '', total: 0 });
      setBggOwned({ status: 'idle', items: [], error: '' });
      setAddResult(null);
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSettings(next);
    setShowSettings(false);
    setNotice('');
    if (next.sheetLink !== settings.sheetLink && next.sheetLink) loadSheet(next.sheetLink);
  }

  function openReview(next) {
    setReview(next); // { item, title, source, rowIndex?, existingRow? }
    setReviewExtra(next.presetExtra || {});
    setReviewStatus('');
  }

  // The extra (non-BGG) column values a row already has, keyed by column index — so reviewing an
  // existing row shows what's there already instead of blank inputs.
  function presetExtrasFor(row) {
    const preset = {};
    extras.forEach(({ i: colI }) => {
      const v = cellAt(row, colI);
      if (v) preset[colI] = v;
    });
    return preset;
  }

  function closeReview() {
    setReview(null);
    setReviewExtra({});
    setReviewStatus('');
  }

  async function runSync() {
    if (!settings.bggUsername || !headers.length) return;
    setSyncing(true);
    setSyncError('');
    setMissing(null);
    closeReview();
    try {
      const owned = await bggOwnedCollection(settings.bggUsername);
      setBggOwned({ status: 'ready', items: owned, error: '' });
      const need = missingFromSheet(owned, rows, idx);
      setMissing(need);
      if (need.length) openReview({ item: need[0], title: need[0].name, source: 'sync' });
    } catch (err) {
      setSyncError(err.message || 'Could not read your BGG collection');
    } finally {
      setSyncing(false);
    }
  }

  async function loadOwned() {
    if (!settings.bggUsername) return;
    setBggOwned((o) => ({ ...o, status: 'loading', error: '' }));
    try {
      setBggOwned({ status: 'ready', items: await bggOwnedCollection(settings.bggUsername), error: '' });
    } catch (err) {
      setBggOwned({ status: 'error', items: [], error: err.message || 'Could not read your BGG collection' });
    }
  }

  // Opening the Add tab starts reading your BGG collection, so it's ready by the time you've picked a game.
  useEffect(() => {
    if (tab === 'add' && bggOwned.status === 'idle' && settings.bggUsername) loadOwned();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, bggOwned.status]);

  function nextInQueue(afterId) {
    setMissing((list) => {
      const rest = (list || []).filter((g) => g.id !== afterId);
      if (rest.length) openReview({ item: rest[0], title: rest[0].name, source: 'sync' });
      else closeReview();
      return rest;
    });
  }

  // The BGG search for whichever row is now first in the enrich queue; auto-runs whenever that
  // changes (starting the queue, skipping, or saving a row), so there's always something to review.
  async function searchEnrichHead(queueNow) {
    setEnrichCandidates([]);
    setEnrichError('');
    if (!queueNow.length) return;
    const name = cellAt(queueNow[0].row, idx.GAME);
    setEnrichBusy(true);
    try {
      const found = await bggFindCandidates(name);
      setEnrichCandidates(found);
      if (!found.length) setEnrichError(`No BGG matches for "${name}". You can still save any extra info below.`);
    } catch (err) {
      setEnrichError(err.message || 'The search failed');
    } finally {
      setEnrichBusy(false);
    }
  }

  function runEnrich() {
    if (!headers.length) return;
    const list = incompleteRows(rows, idx);
    setEnrichQueue(list);
    closeReview();
    searchEnrichHead(list);
  }

  function pickEnrichCandidate(candidate) {
    const entry = enrichQueue[0];
    openReview({ item: candidate, title: cellAt(entry.row, idx.GAME), source: 'enrich', rowIndex: entry.i, existingRow: entry.row, presetExtra: presetExtrasFor(entry.row) });
  }

  // "No BGG match" still lets the row's extra columns be saved: an all-blank BGG item contributes
  // nothing via buildPatchFromThing, so only whatever is typed into the extras below gets written.
  function saveEnrichWithoutMatch() {
    const entry = enrichQueue[0];
    const empty = { id: '', name: '', year: '', minPlayers: '', maxPlayers: '', playTime: '', rating: '', image: '', type: '' };
    openReview({ item: empty, title: cellAt(entry.row, idx.GAME), source: 'enrich', rowIndex: entry.i, existingRow: entry.row, presetExtra: presetExtrasFor(entry.row) });
  }

  function nextEnrichItem() {
    setEnrichQueue((q) => {
      const rest = (q || []).slice(1);
      searchEnrichHead(rest);
      return rest;
    });
    closeReview();
  }

  async function searchAdd(e) {
    e.preventDefault();
    if (!addTitle.trim()) return;
    setAddBusy(true);
    setAddError('');
    setAddCandidates([]);
    setAddResult(null);
    closeReview();
    try {
      const found = await bggFindCandidates(addTitle);
      setAddCandidates(found);
      if (!found.length) setAddError('No matches on BGG for that title. Try a different spelling.');
    } catch (err) {
      setAddError(err.message || 'The search failed');
    } finally {
      setAddBusy(false);
    }
  }

  // Adding a game you searched for: put it in the sheet unless it's already there, and send you to its BGG page
  // if it isn't in your BGG collection (BGG has no way for another site to add it, so the last click is yours).
  async function confirmAddSearch() {
    const plan = addPlan(review.item, review.title, rows, idx, bggOwned.status === 'ready' ? bggOwned.items : null);
    if (plan.sheet === 'add') {
      if (!headers.length) {
        setReviewStatus('Load your sheet first (see Settings above) so I know which columns to fill.');
        return;
      }
      if (!settings.scriptUrl) {
        setShowSettings(true);
        setShowScriptHelp(true);
        setReviewStatus('Set up 1-click adding in Settings first (a one-time, 5-minute step), then come back and try again.');
        return;
      }
    }
    // Opened here, inside the click, because browsers only allow a new tab straight from one.
    if (plan.bgg === 'missing') window.open(bggGameUrl(review.item.id), '_blank', 'noopener,noreferrer');
    const done = (sheet) => {
      setAddResult({ title: review.title, id: review.item.id, sheet, bgg: plan.bgg === 'missing' ? 'opened' : plan.bgg });
      setAddTitle('');
      setAddCandidates([]);
      closeReview();
    };
    if (plan.sheet === 'have') {
      done('already');
      return;
    }
    const row = buildRowFromThing(headers, idx, review.item, review.title, reviewExtra);
    setReviewBusy(true);
    setReviewStatus('Adding to your sheet…');
    try {
      await appendRowViaScript(settings.scriptUrl, row);
      setRows((r) => [...r, row]);
      done('added');
    } catch (err) {
      setReviewStatus('');
      alert(err.message || 'Could not reach your sheet script. Double check the URL in Settings.');
    }
    setReviewBusy(false);
  }

  async function confirmAdd() {
    if (!review) return;
    if (review.source === 'search') {
      await confirmAddSearch();
      return;
    }
    if (!headers.length) {
      setReviewStatus('Load your sheet first (see Settings above) so I know which columns to fill.');
      return;
    }
    if (!settings.scriptUrl) {
      setShowSettings(true);
      setShowScriptHelp(true);
      setReviewStatus('Set up 1-click adding in Settings first (a one-time, 5-minute step), then come back and try again.');
      return;
    }
    if (review.source === 'enrich') {
      const patch = buildPatchFromThing(idx, review.existingRow, review.item);
      for (const [i, v] of Object.entries(reviewExtra)) if (v) patch[Number(i)] = v;
      if (!Object.keys(patch).length) {
        setReviewStatus('Nothing to save — no BGG match and no extra info typed in.');
        return;
      }
      setReviewBusy(true);
      setReviewStatus('Saving…');
      try {
        await updateRowViaScript(settings.scriptUrl, review.rowIndex, patch);
        setRows((r) => {
          const copy = [...r];
          const updated = [...copy[review.rowIndex]];
          for (const [i, v] of Object.entries(patch)) updated[Number(i)] = v;
          copy[review.rowIndex] = updated;
          return copy;
        });
        nextEnrichItem();
      } catch (err) {
        setReviewStatus('');
        setReviewBusy(false);
        alert(err.message || 'Could not reach your sheet script. Double check the URL in Settings, and that it has the update branch shown in the setup help.');
        return;
      }
      setReviewBusy(false);
      return;
    }

    const row = buildRowFromThing(headers, idx, review.item, review.title, reviewExtra);
    setReviewBusy(true);
    setReviewStatus('Adding to your sheet…');
    try {
      await appendRowViaScript(settings.scriptUrl, row);
      setRows((r) => [...r, row]);
      nextInQueue(review.item.id); // only the BGG sync queue gets here; searched games go through confirmAddSearch
    } catch (err) {
      setReviewStatus('');
      setReviewBusy(false);
      alert(err.message || 'Could not reach your sheet script. Double check the URL in Settings.');
      return;
    }
    setReviewBusy(false);
  }

  // ---------- Decide ----------

  async function loadDecide() {
    setDec({ status: 'loading', error: '', total: 0 });
    try {
      let warning = '';
      const [owned, decisionsCsv] = await Promise.all([
        bggOwnedCollection(settings.bggUsername),
        // a missing Decisions tab isn't an error (Google just answers with the first sheet), so a read that
        // really fails still lets you carry on, with a warning that answered games may come up again
        fetchSheetCsv(settings.sheetLink, DECISIONS_TAB).catch((err) => {
          warning = err.message || 'unknown error';
          return '';
        }),
      ]);
      setBggOwned({ status: 'ready', items: owned, error: '' });
      const known = parseDecisions(decisionsCsv);
      setAnswers(known);
      setHistory([]);
      setQueue(undecidedGames(owned, known));
      setDec({ status: 'ready', error: '', total: owned.length, warning });
    } catch (err) {
      setDec({ status: 'error', error: err.message || 'Could not read your BGG collection', total: 0 });
    }
  }

  // Open the Decide tab -> load it the first time.
  useEffect(() => {
    if (tab === 'decide' && dec.status === 'idle' && settings.bggUsername && settings.sheetLink) loadDecide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dec.status]);

  // Answers are sent to the sheet one at a time, in order, in the background, so you can keep tapping.
  async function pumpSaves(scriptUrl) {
    if (sending.current) return;
    sending.current = true;
    while (sendQueue.current.length) {
      const item = sendQueue.current[0];
      try {
        await saveDecisionViaScript(scriptUrl, item.game, item.choice);
        sendQueue.current.shift();
        setSaving((s) => ({ ...s, sent: s.sent + 1, pending: sendQueue.current.length }));
      } catch (err) {
        sendQueue.current.shift();
        setSaving((s) => ({ ...s, failed: [...s.failed, { ...item, error: err.message }], pending: sendQueue.current.length }));
      }
    }
    sending.current = false;
  }

  function decide(choice) {
    if (!queue.length) return;
    if (!settings.scriptUrl) {
      setShowSettings(true);
      setShowScriptHelp(true);
      setNotice('Set up the sheet script first (steps below), so your answers can be saved to the Decisions tab.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const game = queue[0];
    setHistory((h) => [...h, { game, choice }]);
    setAnswers((m) => new Map(m).set(matchKey(game.name), { game: game.name, choice }));
    setQueue((q) => q.slice(1));
    sendQueue.current.push({ game: game.name.trim(), choice });
    setSaving((s) => ({ ...s, pending: sendQueue.current.length }));
    pumpSaves(settings.scriptUrl);
  }

  // Go back to the last game to answer it differently; the new answer replaces the saved one.
  function undoDecision() {
    if (!history.length) return;
    const last = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setQueue([last.game, ...queue]);
    setAnswers((m) => {
      const next = new Map(m);
      next.delete(matchKey(last.game.name));
      return next;
    });
  }

  function retryFailed() {
    sendQueue.current.push(...saving.failed.map(({ game, choice }) => ({ game, choice })));
    setSaving((s) => ({ ...s, failed: [], pending: sendQueue.current.length }));
    pumpSaves(settings.scriptUrl);
  }

  // K / D / P answer the game on screen.
  useEffect(() => {
    if (tab !== 'decide' || dec.status !== 'ready') return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      const choice = { k: 'Keep', d: 'Discard', p: 'Play and see' }[e.key.toLowerCase()];
      if (choice) decide(choice);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const back = (e) => {
    e.preventDefault();
    navigate('/Board');
  };

  const counts = useMemo(() => {
    const c = { Keep: 0, Discard: 0, 'Play and see': 0 };
    answers.forEach((a) => {
      if (c[a.choice] !== undefined) c[a.choice] += 1;
    });
    return c;
  }, [answers]);

  const current = queue[0];
  const answeredOwned = dec.total - queue.length;

  // For a searched game: is it in the sheet, and is it in your BGG collection?
  const plan = review && review.source === 'search'
    ? addPlan(review.item, review.title, rows, idx, bggOwned.status === 'ready' ? bggOwned.items : null)
    : null;
  const bggLine = !plan ? null : !settings.bggUsername ? (
    'Add your BGG username in Settings to check your BGG collection.'
  ) : bggOwned.status === 'error' ? (
    <>Couldn't check your BGG collection: {bggOwned.error} <button className="gcLinkBtn gcSmall" onClick={loadOwned}>Retry</button></>
  ) : bggOwned.status !== 'ready' ? (
    'Checking your BGG collection…'
  ) : plan.bgg === 'have' ? (
    <>✓ Already in your BGG collection <button className="gcLinkBtn gcSmall" onClick={loadOwned}>Check again</button></>
  ) : plan.bgg === 'missing' ? (
    <>Not in your BGG collection yet. BoardGameGeek doesn't let other sites add games, so its page opens for you to press “Add to Collection”. <button className="gcLinkBtn gcSmall" onClick={loadOwned}>Check again</button></>
  ) : (
    "Couldn't match it to a BGG game."
  );
  // Nothing to do when the sheet already has it and BGG either has it too or can't be reached to say.
  const nothingToAdd = !!plan && plan.sheet === 'have' && plan.bgg !== 'missing';
  const addLabel = !plan ? 'Add to my Sheet'
    : plan.sheet === 'add' ? (plan.bgg === 'missing' ? 'Add to sheet & open on BGG' : 'Add to my sheet')
    : plan.bgg === 'missing' ? 'Open on BGG to add it'
    : plan.bgg === 'have' ? 'Already in both' : 'Already in your sheet';

  const reviewCard = review && (
    <div className="gcReview">
      <div className="gcReviewHead">
        {review.item.image
          ? <img className="gcCover" src={review.item.image} alt="" onError={(e) => (e.target.style.visibility = 'hidden')} />
          : <div className="gcCover" />}
        <div>
          <div className="gcCandName gcBig">{review.title}{review.item.year ? ` (${review.item.year})` : ''}</div>
          {(review.item.minPlayers || review.item.maxPlayers || review.item.playTime || review.item.rating) && (
            <div className="gcMuted">
              {review.item.minPlayers || '?'}–{review.item.maxPlayers || '?'} players · {review.item.playTime || '?'} min
              {review.item.type ? ` · ${review.item.type}` : ''}{review.item.rating ? ` · BGG ★${review.item.rating}` : ''}
            </div>
          )}
          {review.source === 'sync' && (
            <div className="gcMuted">In your BGG collection, not yet in your sheet{missing && missing.length > 1 ? ` · ${missing.length - 1} more to review after this` : ''}</div>
          )}
          {review.source === 'enrich' && (
            <div className="gcMuted">{review.item.id ? 'Confirmed match — fills in whatever is blank' : 'No BGG match picked'}{enrichQueue && enrichQueue.length > 1 ? ` · ${enrichQueue.length - 1} more to review after this` : ''}</div>
          )}
          {plan && (
            <ul className="gcStatus">
              <li className={plan.sheet === 'have' ? 'gcStOk' : ''}>{plan.sheet === 'have' ? '✓ Already in your sheet' : 'Not in your sheet yet, so it will be added.'}</li>
              <li className={plan.bgg === 'have' ? 'gcStOk' : ''}>{bggLine}</li>
            </ul>
          )}
        </div>
      </div>

      {!!extras.length && (
        <div className="gcExtras">
          <p className="gcHint">Not on BGG — fill these in yourself:</p>
          {extras.map(({ name, i }) => (
            <label className="gcField" key={i}>
              <span>{name}</span>
              <input className="gcInput" value={reviewExtra[i] || ''} onChange={(e) => setReviewExtra({ ...reviewExtra, [i]: e.target.value })} />
            </label>
          ))}
        </div>
      )}

      <div className="gcRow">
        <button className="gcBtn gcPrimary" onClick={confirmAdd} disabled={reviewBusy || nothingToAdd}>
          {review.source === 'enrich' ? (reviewBusy ? 'Saving…' : 'Save to this row') : (reviewBusy ? 'Adding…' : addLabel)}
        </button>
        {review.source === 'sync' && <button className="gcBtn gcGhost" onClick={() => nextInQueue(review.item.id)} disabled={reviewBusy}>Skip</button>}
        {review.source === 'enrich' && <button className="gcBtn gcGhost" onClick={nextEnrichItem} disabled={reviewBusy}>Skip this row</button>}
        {review.item.id && <a className="gcBtn gcSecondary" href={bggGameUrl(review.item.id)} target="_blank" rel="noreferrer">View on BGG ↗</a>}
        <button className="gcBtn gcGhost" onClick={closeReview} disabled={reviewBusy}>Close</button>
      </div>
      {reviewStatus && <p className="gcMuted">{reviewStatus}</p>}
    </div>
  );

  const readyToCompare = settings.bggUsername && settings.sheetLink;

  return (
    <div className="gcPage">
      <div className="gcWrap">
        <header className="gcHeader">
          <div>
            <a href="/Board" className="gcBack" onClick={back}>&larr; Games</a>
            <h1 className="gcTitle">My Game Collection</h1>
            <p className="gcSubtitle">
              {rows.length ? `${rows.length} games in your sheet` : 'Your Google Sheet and your BoardGameGeek collection, together.'}
            </p>
          </div>
          <div className="gcHeaderActions">
            {settings.sheetLink && <a className="gcBtn gcSecondary gcSm" href={settings.sheetLink} target="_blank" rel="noreferrer">Sheet ↗</a>}
            {settings.bggUsername && <a className="gcBtn gcSecondary gcSm" href={bggCollectionUrl(settings.bggUsername)} target="_blank" rel="noreferrer">BGG ↗</a>}
            <button className="gcBtn gcGhost gcSm" onClick={() => setShowSettings((s) => !s)}>{showSettings ? 'Close settings' : 'Settings'}</button>
          </div>
        </header>

        {notice && <div className="gcAlert">{notice}</div>}

        {showSettings && (
          <section className="gcCard">
            <form className="gcSettingsForm" onSubmit={saveSettings}>
              <label className="gcField">
                <span>Google Sheet link</span>
                <input className="gcInput" placeholder="Paste your Sheet's share link" value={form.sheetLink} onChange={(e) => setForm({ ...form, sheetLink: e.target.value })} />
                <small>Share it as "Anyone with the link can view" (Share → General access) so this page can read it without you logging in.</small>
              </label>
              <label className="gcField">
                <span>BoardGameGeek username</span>
                <input className="gcInput" placeholder="e.g. yourname" value={form.bggUsername} onChange={(e) => setForm({ ...form, bggUsername: e.target.value })} />
                <small>The name in boardgamegeek.com/collection/user/yourname — used to read your public "owned" list.</small>
              </label>
              <div className="gcField">
                <button type="button" className="gcLinkBtn" onClick={() => setShowScriptHelp((s) => !s)}>
                  {showScriptHelp ? '▾' : '▸'} Set up saving to your Sheet (one time, ~5 min)
                </button>
                {showScriptHelp && (
                  <div className="gcHelp">
                    <ol>
                      <li>Open your Sheet, then <b>Extensions → Apps Script</b>.</li>
                      <li>Delete the placeholder code and paste this in its place:</li>
                    </ol>
                    <pre className="gcCode">{SCRIPT_HELP}</pre>
                    <ol start="3">
                      <li>Click <b>Save</b>, then <b>Deploy → New deployment</b>.</li>
                      <li>Click the gear icon and choose <b>Web app</b>.</li>
                      <li>Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then <b>Deploy</b> (approve the permission prompt — it's your own script on your own sheet).</li>
                      <li>Copy the <b>Web app URL</b> it gives you and paste it below.</li>
                    </ol>
                    <p className="gcNote"><b>Already set this up before?</b> Replace the code with the version above, then <b>Deploy → Manage deployments</b>, click the pencil, choose <b>Version: New version</b> and <b>Deploy</b>. The URL stays the same, so there's nothing to change here. The new version adds the <b>Decisions</b> tab for Keep / Discard / Play and see.</p>
                    <p className="gcWarn">Keep this URL private — anyone who has it can add rows to your sheet. It's only saved in this browser, never in the site's code.</p>
                    <label className="gcField">
                      <span>Sheet script URL</span>
                      <input className="gcInput" placeholder="https://script.google.com/macros/s/…/exec" value={form.scriptUrl} onChange={(e) => setForm({ ...form, scriptUrl: e.target.value })} />
                    </label>
                  </div>
                )}
              </div>
              <div className="gcRow">
                <button className="gcBtn gcPrimary" type="submit">Save</button>
                {settings.sheetLink && <button type="button" className="gcBtn gcGhost" onClick={() => setShowSettings(false)}>Cancel</button>}
              </div>
            </form>
          </section>
        )}

        <nav className="gcTabs" role="tablist" aria-label="Collection sections">
          <button role="tab" aria-selected={tab === 'collection'} className={`gcTab${tab === 'collection' ? ' gcOn' : ''}`} onClick={() => setTab('collection')}>
            Collection{rows.length ? <span className="gcCount">{rows.length}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === 'decide'} className={`gcTab${tab === 'decide' ? ' gcOn' : ''}`} onClick={() => setTab('decide')}>
            Decide{dec.status === 'ready' && queue.length ? <span className="gcCount">{queue.length}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === 'pick'} className={`gcTab${tab === 'pick' ? ' gcOn' : ''}`} onClick={() => setTab('pick')}>
            Pick a game
          </button>
          <button role="tab" aria-selected={tab === 'sync'} className={`gcTab${tab === 'sync' ? ' gcOn' : ''}`} onClick={() => setTab('sync')}>
            Sync{missing && missing.length ? <span className="gcCount">{missing.length}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === 'add'} className={`gcTab${tab === 'add' ? ' gcOn' : ''}`} onClick={() => setTab('add')}>
            Add
          </button>
        </nav>

        {tab === 'collection' && (
          <section className="gcCard gcFlush">
            {!settings.sheetLink ? (
              <p className="gcEmpty">Add your Google Sheet link in Settings to see your collection here.</p>
            ) : loading ? (
              <p className="gcEmpty">Loading your sheet…</p>
            ) : loadError ? (
              <p className="gcEmpty gcError">{loadError} <button className="gcLinkBtn" onClick={() => loadSheet(settings.sheetLink)}>Retry</button></p>
            ) : (
              <>
                <div className="gcFilters">
                  <input className="gcInput gcGrow" placeholder="Search games…" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
                  <input className="gcInput gcNarrow" type="number" min="1" placeholder="Players" value={filterPlayers} onChange={(e) => setFilterPlayers(e.target.value)} />
                  {typeOptions.length > 0 && (
                    <select className="gcInput gcNarrow" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                      <option value="">Any type</option>
                      {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                  <select className="gcInput gcNarrow" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                    <option value="">Sheet order</option>
                    {idx.GAME >= 0 && <option value="GAME">Name</option>}
                    {idx.YEAR >= 0 && <option value="YEAR">Year</option>}
                    {idx.RATING >= 0 && <option value="RATING">BGG rating</option>}
                    {idx.TIME >= 0 && <option value="TIME">Play time</option>}
                  </select>
                  {sortKey && (
                    <button className="gcBtn gcSecondary gcSm" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} aria-label="Reverse sort order">{sortDir === 'asc' ? '↑' : '↓'}</button>
                  )}
                  <span className="gcShown">{entries.length} of {rows.length}</span>
                </div>
                <div className="gcTableWrap">
                  <table className="gcTable">
                    <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                    <tbody>
                      {entries.map(({ row, i }) => (
                        <tr key={i}>
                          {headers.map((_, j) => (
                            <td key={j} className={j === idx.GAME ? 'gcName' : ''}>
                              {j === idx.IMAGE && row[j] ? <img className="gcThumb" src={row[j]} alt="" /> : (row[j] || '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {!entries.length && <tr><td className="gcEmpty" colSpan={headers.length || 1}>No games match those filters.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {tab === 'decide' && (
          <section className="gcCard gcDecide">
            {!readyToCompare ? (
              <p className="gcEmpty">Add your Google Sheet link and BoardGameGeek username in Settings to start deciding.</p>
            ) : dec.status === 'loading' || dec.status === 'idle' ? (
              <p className="gcEmpty">Reading your BGG collection and your Decisions tab… this can take a few seconds.</p>
            ) : dec.status === 'error' ? (
              <p className="gcEmpty gcError">{dec.error} <button className="gcLinkBtn" onClick={loadDecide}>Retry</button></p>
            ) : (
              <>
                <div className="gcProgress">
                  <div className="gcProgressTop">
                    <span><b>{answeredOwned}</b> of {dec.total} decided</span>
                    <span className="gcChips">
                      <span className="gcChip gcKeepChip">Keep {counts.Keep}</span>
                      <span className="gcChip gcDiscardChip">Discard {counts.Discard}</span>
                      <span className="gcChip gcPlayChip">Play {counts['Play and see']}</span>
                    </span>
                  </div>
                  <div className="gcBar"><div className="gcBarFill" style={{ width: `${dec.total ? Math.round((answeredOwned / dec.total) * 100) : 0}%` }} /></div>
                </div>

                {dec.warning && (
                  <div className="gcAlert">Couldn't read your “{DECISIONS_TAB}” tab ({dec.warning}), so games you've already answered may come up again. <button className="gcLinkBtn" onClick={loadDecide}>Try again</button></div>
                )}

                {!!saving.failed.length && (
                  <div className="gcAlert">
                    Couldn't save {saving.failed.length} answer{saving.failed.length === 1 ? '' : 's'}: {saving.failed[saving.failed.length - 1].error}{' '}
                    <button className="gcLinkBtn" onClick={retryFailed}>Retry saving</button>
                  </div>
                )}

                {current ? (
                  <div className="gcGame">
                    {current.image ? <img className="gcPoster" src={current.image} alt="" /> : <div className="gcPoster gcNoPoster">🎲</div>}
                    <div className="gcGameInfo">
                      <h2 className="gcGameName">{current.name}</h2>
                      <div className="gcFacts">
                        {current.year && <span className="gcFact">{current.year}</span>}
                        {(current.minPlayers || current.maxPlayers) && (
                          <span className="gcFact">{current.minPlayers || '?'}{current.maxPlayers && current.maxPlayers !== current.minPlayers ? `–${current.maxPlayers}` : ''} players</span>
                        )}
                        {current.playTime && <span className="gcFact">{current.playTime} min</span>}
                        {current.rating && <span className="gcFact">★ {current.rating}</span>}
                      </div>
                      {current.id && <a className="gcLinkBtn gcSmall" href={bggGameUrl(current.id)} target="_blank" rel="noreferrer">View on BoardGameGeek ↗</a>}
                    </div>
                    <div className="gcChoices">
                      {CHOICES.map((c) => (
                        <button key={c} className={`gcChoice ${CHOICE_CLASS[c]}`} onClick={() => decide(c)}>
                          <span>{c}</span>
                          <kbd>{CHOICE_KEY[c]}</kbd>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="gcEmpty">{dec.total ? 'You have decided on every game you own. 🎉' : 'No owned games found in your BGG collection.'}</p>
                )}

                <div className="gcDecideFoot">
                  <button className="gcLinkBtn gcSmall" onClick={undoDecision} disabled={!history.length}>← Change my last answer</button>
                  <span className="gcSaved">
                    {saving.pending ? 'Saving…' : saving.sent ? `✓ ${saving.sent} saved to your sheet's “${DECISIONS_TAB}” tab` : `Answers go to the “${DECISIONS_TAB}” tab of your sheet`}
                  </span>
                </div>
              </>
            )}
          </section>
        )}

        {tab === 'pick' && (
          <GamePicker rows={rows} idx={idx} hasSheet={!!settings.sheetLink} loading={loading} loadError={loadError} onRetry={() => loadSheet(settings.sheetLink)} />
        )}

        {tab === 'sync' && (
          <>
            <section className="gcCard">
              <div className="gcCardHead">
                <h2>Sync from BGG</h2>
                <span className="gcHint">Games you own on BGG that your sheet doesn't have yet</span>
              </div>
              {!readyToCompare ? (
                <p className="gcMuted">Add your Google Sheet link and BGG username in Settings so I can compare them.</p>
              ) : (
                <>
                  <div className="gcRow">
                    <button className="gcBtn gcPrimary" onClick={runSync} disabled={syncing || loading}>{syncing ? 'Checking your BGG collection…' : 'Check for missing games'}</button>
                  </div>
                  {syncError && <p className="gcError">{syncError}</p>}
                  {missing && !syncing && (
                    <p className="gcMuted">
                      {missing.length ? `${missing.length} game${missing.length === 1 ? '' : 's'} on BGG ${missing.length === 1 ? "isn't" : "aren't"} in your sheet yet.` : 'Everything you own on BGG is already in your sheet. 🎉'}
                    </p>
                  )}
                </>
              )}
              {review && review.source === 'sync' && reviewCard}
            </section>

            <section className="gcCard">
              <div className="gcCardHead">
                <h2>Fill in missing info</h2>
                <span className="gcHint">Rows with blank year, players, time, rating or image</span>
              </div>
              {!settings.sheetLink ? (
                <p className="gcMuted">Add your Google Sheet link in Settings to use this.</p>
              ) : (
                <>
                  <div className="gcRow">
                    <button className="gcBtn gcPrimary" onClick={runEnrich} disabled={loading || !rows.length}>
                      {enrichQueue ? 'Check again' : 'Find games missing info'}
                    </button>
                  </div>
                  {enrichQueue && !enrichQueue.length && !review && <p className="gcMuted">Every row already has its BGG info filled in. 🎉</p>}
                  {enrichQueue && enrichQueue.length > 0 && !review && (
                    <p className="gcHint">Row: {cellAt(enrichQueue[0].row, idx.GAME)}{enrichQueue.length > 1 ? ` (+${enrichQueue.length - 1} more)` : ''}</p>
                  )}
                  {enrichBusy && <p className="gcMuted">Searching BGG…</p>}
                  {enrichError && <p className="gcError">{enrichError}</p>}

                  {!!enrichCandidates.length && review?.source !== 'enrich' && (
                    <div className="gcCandidates">
                      {enrichCandidates.map((c) => (
                        <button key={c.id} type="button" className="gcCandidate" onClick={() => pickEnrichCandidate(c)}>
                          {c.image ? <img src={c.image} alt="" /> : <span className="gcNoImage">🎲</span>}
                          <span className="gcCandName">{c.name}</span>
                          <span className="gcMuted">{c.year}{c.rating ? ` · ★${c.rating}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {enrichQueue && enrichQueue.length > 0 && !enrichBusy && review?.source !== 'enrich' && (
                    <div className="gcRow">
                      <button className="gcBtn gcGhost" onClick={nextEnrichItem}>Skip this row</button>
                      <button className="gcBtn gcGhost" onClick={saveEnrichWithoutMatch}>No BGG match — save extra info only</button>
                    </div>
                  )}
                  {review && review.source === 'enrich' && reviewCard}
                </>
              )}
            </section>
          </>
        )}

        {tab === 'add' && (
          <>
            <section className="gcCard">
              <div className="gcCardHead">
                <h2>Add a game</h2>
                <span className="gcHint">Search BGG. It goes into your sheet, and you're sent to BGG if it isn't in your collection there.</span>
              </div>
              <form className="gcRow" onSubmit={searchAdd}>
                <input className="gcInput gcGrow" placeholder="Game title…" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} />
                <button className="gcBtn gcPrimary" type="submit" disabled={addBusy || !addTitle.trim()}>{addBusy ? 'Searching…' : 'Search BGG'}</button>
              </form>
              {addError && <p className="gcError">{addError}</p>}

              {!!addCandidates.length && (
                <div className="gcCandidates">
                  {addCandidates.map((c) => (
                    <button key={c.id} type="button" className={`gcCandidate${review?.item.id === c.id && review.source === 'search' ? ' gcSelected' : ''}`} onClick={() => openReview({ item: c, title: addTitle, source: 'search' })}>
                      {c.image ? <img src={c.image} alt="" /> : <span className="gcNoImage">🎲</span>}
                      <span className="gcCandName">{c.name}</span>
                      <span className="gcMuted">{c.year}{c.rating ? ` · ★${c.rating}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
              {review && review.source === 'search' && reviewCard}

              {addResult && (
                <div className="gcReview gcAddResult">
                  <p className="gcStOk">{addResult.sheet === 'added' ? `✓ Added “${addResult.title}” to your sheet.` : `✓ “${addResult.title}” was already in your sheet.`}</p>
                  {addResult.bgg === 'have' && <p className="gcStOk">✓ It's already in your BGG collection.</p>}
                  {addResult.bgg === 'opened' && (
                    <p>BoardGameGeek should have opened in a new tab. Press <b>Add to Collection</b> there to finish. Nothing opened? <a className="gcLinkBtn gcSmall" href={bggGameUrl(addResult.id)} target="_blank" rel="noreferrer">Open it on BGG ↗</a></p>
                  )}
                  {addResult.bgg === 'unknown' && (
                    <p>I couldn't check your BGG collection. If it isn't there, <a className="gcLinkBtn gcSmall" href={bggGameUrl(addResult.id)} target="_blank" rel="noreferrer">open it on BGG ↗</a> and press <b>Add to Collection</b>.</p>
                  )}
                  <div className="gcRow">
                    <button className="gcBtn gcSecondary" onClick={() => setAddResult(null)}>Add another game</button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        <details className="gcCard gcRules">
          <summary>How this works</summary>
          <ul>
            <li>The <b>Collection</b> tab and <b>Sync</b> read your Sheet and your public "owned" BGG list directly — nothing needs to be typed twice. <b>Sync</b> adds the games you own on BGG that your sheet is missing, one at a time.</li>
            <li><b>Add</b> searches BGG for a game. It adds it to your sheet unless it's already there, and checks your BGG collection too. If the game isn't in your BGG collection, BGG's page opens so you can press Add to Collection yourself: BoardGameGeek doesn't let other websites change your collection.</li>
            <li><b>Decide</b> shows one game you own at a time. Keep, Discard or Play and see (or press <kbd>K</kbd> <kbd>D</kbd> <kbd>P</kbd>) saves the game and your choice to a second tab of your sheet called <b>Decisions</b>, and the game doesn't come up again. Changed your mind? Use "Change my last answer", or answer it again later by editing the tab.</li>
            <li><b>Pick a game</b> chooses one of the games in your sheet at random. Narrow it by players, time, type (solo, co-op, team…) and theme, then press Skip until one sounds right. Players, time and type come from your sheet; themes are BoardGameGeek's categories, looked up with the BGGID column and remembered in this browser.</li>
            <li><b>Fill in missing info</b> looks at rows already in your sheet, searches BGG for each one, and — once you confirm the match — fills in only the blank cells, leaving anything you've already typed alone.</li>
            <li>Saving to the sheet works through the small script in Settings — no login needed on this page. If you set the script up before the Decide feature existed, paste in the latest code and redeploy it as a new version (same URL).</li>
            <li>This page only ever reads your BGG collection; it never changes it.</li>
            <li>Add a <b>BGGID</b> column to your sheet (optional) and future syncs will match by BGG's own ID instead of the name, which is more reliable for reprints and renamed editions.</li>
            <li>Nothing here is sent anywhere but Google, BoardGameGeek, and your own browser's storage. This page keeps no database of its own.</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

export default Collection;
