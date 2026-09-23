import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Collection.css';
import {
  fetchSheetCsv, parseCsv, buildHeaderIndex, extraHeaders, distinctValues, filterRows, sortEntries,
  bggFindCandidates, bggOwnedCollection, missingFromSheet, buildRowFromThing, appendRowViaScript,
  bggGameUrl, bggCollectionUrl,
} from './collectionUtils';

const SETTINGS_KEY = 'nerdalie.collection.settings';
const SCRIPT_HELP = `function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = JSON.parse(e.postData.contents);
  sheet.appendRow(data.row);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}`;

const loadSettings = () => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch (_) {
    return {};
  }
};

function Collection() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(() => !loadSettings().sheetLink);
  const [showScriptHelp, setShowScriptHelp] = useState(false);
  const [form, setForm] = useState(() => ({ sheetLink: '', bggUsername: '', scriptUrl: '', ...loadSettings() }));

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

  // One shared review card, opened either from the sync queue or from a manual search pick.
  const [review, setReview] = useState(null); // { item, title, source: 'sync' | 'search' }
  const [reviewExtra, setReviewExtra] = useState({});
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewStatus, setReviewStatus] = useState('');

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
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSettings(next);
    setShowSettings(false);
    if (next.sheetLink !== settings.sheetLink && next.sheetLink) loadSheet(next.sheetLink);
  }

  function openReview(item, title, source) {
    setReview({ item, title, source });
    setReviewExtra({});
    setReviewStatus('');
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
      const need = missingFromSheet(owned, rows, idx);
      setMissing(need);
      if (need.length) openReview(need[0], need[0].name, 'sync');
    } catch (err) {
      setSyncError(err.message || 'Could not read your BGG collection');
    } finally {
      setSyncing(false);
    }
  }

  function nextInQueue(afterId) {
    setMissing((list) => {
      const rest = (list || []).filter((g) => g.id !== afterId);
      if (rest.length) openReview(rest[0], rest[0].name, 'sync');
      else closeReview();
      return rest;
    });
  }

  async function searchAdd(e) {
    e.preventDefault();
    if (!addTitle.trim()) return;
    setAddBusy(true);
    setAddError('');
    setAddCandidates([]);
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

  async function confirmAdd() {
    if (!review) return;
    if (!headers.length) {
      setReviewStatus('Load your sheet first (see Settings above) so I know which columns to fill.');
      return;
    }
    if (!settings.scriptUrl) {
      setShowSettings(true);
      setShowScriptHelp(true);
      setReviewStatus('Set up 1-click adding below first (a one-time, 5-minute step), then come back and try again.');
      return;
    }
    const row = buildRowFromThing(headers, idx, review.item, review.title, reviewExtra);
    setReviewBusy(true);
    setReviewStatus('Adding to your sheet…');
    try {
      await appendRowViaScript(settings.scriptUrl, row);
      setRows((r) => [...r, row]);
      if (review.source === 'sync') nextInQueue(review.item.id);
      else {
        setReviewStatus(`Added "${review.title}".`);
        setAddTitle('');
        setAddCandidates([]);
        setTimeout(closeReview, 1200);
      }
    } catch (err) {
      setReviewStatus('');
      setReviewBusy(false);
      alert(err.message || 'Could not reach your sheet script. Double check the URL in Settings.');
      return;
    }
    setReviewBusy(false);
  }

  const back = (e) => {
    e.preventDefault();
    navigate('/Board');
  };

  const reviewCard = review && (
    <div className="gcCard gcReview">
      <div className="gcReviewHead">
        <img className="gcCover" src={review.item.image} alt="" onError={(e) => (e.target.style.visibility = 'hidden')} />
        <div>
          <div className="gcCandName">{review.title}{review.item.year ? ` (${review.item.year})` : ''}</div>
          <div className="gcMuted">
            {review.item.minPlayers || '?'}–{review.item.maxPlayers || '?'} players · {review.item.playTime || '?'} min
            {review.item.type ? ` · ${review.item.type}` : ''}{review.item.rating ? ` · BGG ★${review.item.rating}` : ''}
          </div>
          {review.source === 'sync' && (
            <div className="gcMuted">In your BGG collection, not yet in your sheet{missing && missing.length > 1 ? ` · ${missing.length - 1} more to review after this` : ''}</div>
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
        <button className="gcBtn gcPrimary" onClick={confirmAdd} disabled={reviewBusy}>{reviewBusy ? 'Adding…' : 'Add to my Sheet'}</button>
        {review.source === 'sync' && <button className="gcBtn gcGhost" onClick={() => nextInQueue(review.item.id)} disabled={reviewBusy}>Skip</button>}
        <a className="gcBtn" href={bggGameUrl(review.item.id)} target="_blank" rel="noreferrer">View on BoardGameGeek ↗</a>
        <button className="gcBtn gcGhost" onClick={closeReview} disabled={reviewBusy}>Close</button>
      </div>
      {reviewStatus && <p className="gcMuted">{reviewStatus}</p>}
    </div>
  );

  return (
    <body className="gcPage">
      <div className="gcWrap">
        <a href="/Board" className="gcBack" onClick={back}>&larr; Back to games</a>
        <h1 className="gcTitle">My Game Collection</h1>
        <p className="gcSubtitle">Your Google Sheet and your BoardGameGeek collection, in one place.</p>

        <section className="gcCard">
          {!showSettings ? (
            <div className="gcConnectedBar">
              {settings.sheetLink && <a className="gcBtn" href={settings.sheetLink} target="_blank" rel="noreferrer">Open Google Sheet ↗</a>}
              {settings.bggUsername && <a className="gcBtn" href={bggCollectionUrl(settings.bggUsername)} target="_blank" rel="noreferrer">Open BGG collection ↗</a>}
              <button className="gcBtn gcGhost" onClick={() => setShowSettings(true)}>Settings</button>
            </div>
          ) : (
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
                  {showScriptHelp ? '▾' : '▸'} Set up 1-click adding to your Sheet (one time, ~5 min)
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
                    <p className="gcWarn">Keep this URL private — anyone who has it can add rows to your sheet. It's only saved in this browser, never in the site's code.</p>
                    <label className="gcField">
                      <span>Sheet add-script URL</span>
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
          )}
        </section>

        <section className="gcCard">
          <div className="gcCardHead">
            <h2>Sync from BGG</h2>
          </div>
          {!settings.bggUsername ? (
            <p className="gcMuted">Add your BGG username above to check what's missing from your sheet.</p>
          ) : !settings.sheetLink ? (
            <p className="gcMuted">Add your Google Sheet above too — I need both to compare them.</p>
          ) : (
            <>
              <div className="gcRow">
                <button className="gcBtn gcPrimary" onClick={runSync} disabled={syncing || loading}>{syncing ? 'Checking your BGG collection…' : 'Check for games missing from my sheet'}</button>
              </div>
              {syncError && <p className="gcError">{syncError}</p>}
              {missing && !syncing && (
                <p className="gcMuted">
                  {missing.length ? `${missing.length} game${missing.length === 1 ? '' : 's'} on BGG ${missing.length === 1 ? "isn't" : "aren't"} in your sheet yet.` : "Everything you own on BGG is already in your sheet. 🎉"}
                </p>
              )}
            </>
          )}
          {review && review.source === 'sync' && reviewCard}
        </section>

        <section className="gcCard">
          <div className="gcCardHead">
            <h2>Your collection</h2>
            {rows.length > 0 && <span className="gcHint">{entries.length} of {rows.length} games shown</span>}
          </div>
          {!settings.sheetLink ? (
            <p className="gcMuted">Add your Google Sheet link above to see your collection here.</p>
          ) : loading ? (
            <p className="gcMuted">Loading your sheet…</p>
          ) : loadError ? (
            <p className="gcError">{loadError} <button className="gcLinkBtn" onClick={() => loadSheet(settings.sheetLink)}>Retry</button></p>
          ) : (
            <>
              <div className="gcFilters">
                <input className="gcInput" placeholder="Search…" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
                <input className="gcInput gcNarrow" type="number" min="1" placeholder="Players" value={filterPlayers} onChange={(e) => setFilterPlayers(e.target.value)} />
                {typeOptions.length > 0 && (
                  <select className="gcInput gcNarrow" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                    <option value="">Any type</option>
                    {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                <select className="gcInput gcNarrow" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  <option value="">Sort: sheet order</option>
                  {idx.GAME >= 0 && <option value="GAME">Name</option>}
                  {idx.YEAR >= 0 && <option value="YEAR">Year</option>}
                  {idx.RATING >= 0 && <option value="RATING">BGG rating</option>}
                  {idx.TIME >= 0 && <option value="TIME">Play time</option>}
                </select>
                {sortKey && (
                  <button className="gcBtn gcGhost" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>{sortDir === 'asc' ? '↑' : '↓'}</button>
                )}
              </div>
              <div className="gcTableWrap">
                <table className="gcTable">
                  <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                  <tbody>
                    {entries.map(({ row, i }) => (
                      <tr key={i}>
                        {headers.map((_, j) => (
                          <td key={j}>
                            {j === idx.IMAGE && row[j] ? <img className="gcThumb" src={row[j]} alt="" /> : (row[j] || '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!entries.length && <tr><td className="gcMuted" colSpan={headers.length || 1}>No games match those filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="gcCard">
          <h2>Add a game not on BGG yet</h2>
          <form className="gcRow" onSubmit={searchAdd}>
            <input className="gcInput" placeholder="Game title…" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} />
            <button className="gcBtn gcPrimary" type="submit" disabled={addBusy || !addTitle.trim()}>{addBusy ? 'Searching…' : 'Search BGG'}</button>
          </form>
          {addError && <p className="gcError">{addError}</p>}

          {!!addCandidates.length && (
            <div className="gcCandidates">
              {addCandidates.map((c) => (
                <button key={c.id} type="button" className={`gcCandidate${review?.item.id === c.id && review.source === 'search' ? ' gcSelected' : ''}`} onClick={() => openReview(c, addTitle, 'search')}>
                  {c.image ? <img src={c.image} alt="" /> : <span className="gcNoImage">🎲</span>}
                  <span className="gcCandName">{c.name}</span>
                  <span className="gcMuted">{c.year}{c.rating ? ` · ★${c.rating}` : ''}</span>
                </button>
              ))}
            </div>
          )}
          {review && review.source === 'search' && reviewCard}
        </section>

        <details className="gcCard gcRules">
          <summary>How this works</summary>
          <ul>
            <li>The <b>collection view</b> and <b>BGG sync</b> read your Sheet and your public "owned" BGG list directly — nothing needs to be typed twice.</li>
            <li><b>Adding to your Sheet</b> is fully automatic once you set up the small script above — no login needed on this page.</li>
            <li>BoardGameGeek has no way for another website to add to a collection there — not even for official apps — so if a game isn't on BGG yet, add it there yourself in the normal way; this page only reads what's already there.</li>
            <li>Add a <b>BGGID</b> column to your sheet (optional) and future syncs will match by BGG's own ID instead of the name, which is more reliable for reprints and renamed editions.</li>
            <li>Nothing here is sent anywhere but Google, BoardGameGeek, and your own browser's storage. This page keeps no database of its own.</li>
          </ul>
        </details>
      </div>
    </body>
  );
}

export default Collection;
