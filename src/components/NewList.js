import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  bggSearchAll, bggThing, bggGameUrl, fetchSheetCsv, addPlan, buildHeaderIndex, cellAt, commonValues, newListLayout, newListFields,
  buildNewListRow, parseNewList, inNewList, fileInList, saveNewListRowViaScript, matchKey, NEWLIST_TAB,
} from './collectionUtils';

/* The New list tab: search BGG, tap the right game from everything that matches, type in your own columns (the ones BGG
   doesn't know, like House, Played and Complete), and it goes into a "New List" tab of your sheet with everything else filled
   in from BGG and a link to the game's BGG page. The tab has the same columns as your main sheet, plus the link. */

const PAGE = 20; // matches shown at a time, and the most BGG will give details for in one request

const facts = (g) => [
  g.year,
  (g.minPlayers || g.maxPlayers) && `${g.minPlayers || '?'}–${g.maxPlayers || '?'} players`,
  g.playTime && `${g.playTime} min`,
  g.rating && `★${g.rating}`,
].filter(Boolean).join(' · ');

function NewList({ active, hasSheet, headers, rows, idx, loading, settings, onNeedScript, onCount }) {
  const [title, setTitle] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState([]); // everything BGG found for the search: { id, name, year, kind }, best first
  const [details, setDetails] = useState({}); // BGG's full details (cover, players, rating...) by id, as they are fetched
  const [shown, setShown] = useState(PAGE); // how many matches are on screen
  const [gamesOnly, setGamesOnly] = useState(false); // leave out the expansions
  const [pickingId, setPickingId] = useState(''); // a match whose details are being fetched because you tapped it
  const [detailsFailed, setDetailsFailed] = useState(false);
  const [picked, setPicked] = useState(null); // the BGG game you chose
  const [name, setName] = useState('');
  const [values, setValues] = useState({}); // your own columns: { columnIndex: text }
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null); // { name, id } of the game just added
  const [list, setList] = useState({ status: 'idle', error: '', data: null }); // data: { header, rows }, or null while the tab doesn't exist
  const added = useRef([]); // the games added on this visit: { id, name, header, row }
  const listCard = useRef(null);
  const formCard = useRef(null);
  const reviewCard = useRef(null);
  const asked = useRef(new Set()); // ids whose details have been asked for

  const visible = useMemo(() => (gamesOnly ? matches.filter((m) => m.kind !== 'boardgameexpansion') : matches), [matches, gamesOnly]);
  const fields = useMemo(() => newListFields(headers, idx), [headers, idx]);
  const choices = useMemo(() => Object.fromEntries(fields.map(({ i }) => [i, commonValues(rows, i)])), [fields, rows]);
  const ready = hasSheet && !loading && headers.length > 0 && idx.GAME >= 0;

  // The tab as read from the sheet, plus anything added on this visit that Google hasn't shown yet, so a refresh a moment
  // after adding never takes the new game off the screen.
  function withAdded(data) {
    let out = data;
    for (const a of added.current) {
      if (inNewList(out, { id: a.id, name: a.name }, a.name)) continue;
      const filed = fileInList(out ? out.header : [], a.header, a.row);
      out = { header: filed.header, rows: [...(out ? out.rows : []), filed.row] };
    }
    return out;
  }

  const readTab = async () => withAdded(parseNewList(await fetchSheetCsv(settings.sheetLink, NEWLIST_TAB), headers, rows));

  async function loadList() {
    setList((l) => ({ ...l, status: 'loading', error: '' }));
    try {
      setList({ status: 'ready', error: '', data: await readTab() });
    } catch (err) {
      setList((l) => ({ ...l, status: 'error', error: err.message || 'Could not read the sheet' }));
    }
  }

  // Read the tab the first time you open this one, once your main sheet is in (it tells a missing tab from a real one).
  useEffect(() => {
    if (active && ready && list.status === 'idle') loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready, list.status]);

  useEffect(() => {
    if (list.status === 'ready') onCount(list.data ? list.data.rows.length : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  // Show the list as soon as a game goes in, with the confirmation at the top of it.
  useEffect(() => {
    if (done && listCard.current && listCard.current.scrollIntoView) listCard.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [done]);

  // The search only gives names, so the cover, players and rating of the matches on screen are fetched a page at a time,
  // in the background, and fill in as they arrive.
  async function loadDetails(items) {
    const ids = items.map((m) => m.id).filter((id) => !asked.current.has(id));
    ids.forEach((id) => asked.current.add(id));
    for (let i = 0; i < ids.length; i += PAGE) {
      const batch = ids.slice(i, i + PAGE);
      try {
        const things = await bggThing(batch);
        setDetails((d) => ({ ...d, ...Object.fromEntries(things.map((t) => [t.id, t])) }));
      } catch (_) {
        batch.forEach((id) => asked.current.delete(id)); // so showing them again tries again
        setDetailsFailed(true);
      }
    }
  }

  useEffect(() => {
    loadDetails(visible.slice(0, shown));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, shown]);

  // Tapping a match: its full details are needed to fill the row, so fetch them now if they haven't arrived yet.
  async function pick(match) {
    setError('');
    let full = details[match.id];
    if (!full) {
      setPickingId(match.id);
      try {
        [full] = await bggThing([match.id]);
      } catch (err) {
        setError(err.message || 'Could not get that game from BGG.');
      }
      setPickingId('');
      if (!full) {
        setError((e) => e || "BGG didn't send that game's details. Try again.");
        return;
      }
      setDetails((d) => ({ ...d, [full.id]: full }));
    }
    setPicked(full);
    setName(full.name);
    setValues({});
  }

  // Bring the form into view when a game is picked: the match you tapped may be far down a long list.
  useEffect(() => {
    if (picked && reviewCard.current && reviewCard.current.scrollIntoView) reviewCard.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [picked]);

  async function search(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSearching(true);
    setError('');
    setMatches([]);
    setShown(PAGE);
    setDetailsFailed(false);
    setPicked(null);
    setDone(null);
    try {
      const found = await bggSearchAll(title);
      setMatches(found);
      if (!found.length) setError('No matches on BGG for that title. Try a different spelling.');
      else if (found.length === 1) pick(found[0]); // nothing to choose between
    } catch (err) {
      setError(err.message || 'The search failed');
    } finally {
      setSearching(false);
    }
  }

  async function add() {
    if (!settings.scriptUrl) {
      onNeedScript('Set up the sheet script first (steps below), so games can be saved to the New List tab.');
      return;
    }
    const layout = newListLayout(headers);
    const finalName = name.trim() || picked.name;
    const row = buildNewListRow(headers, idx, picked, finalName, values);
    const duplicate = `“${finalName}” is already on your new list, so I didn't add it again.`;
    if (alreadyListed) {
      setError(duplicate);
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Look at the tab as it is right now, not just as it was when this page read it (it may have changed since, from
      // another device or a moment ago). If it can't be read, what is on screen has to do.
      let current = list.data;
      try {
        current = await readTab();
        setList({ status: 'ready', error: '', data: current });
      } catch (_) {
        // keep what is on screen
      }
      if (inNewList(current, picked, finalName)) {
        setError(duplicate);
        return;
      }
      await saveNewListRowViaScript(settings.scriptUrl, layout.header, row);
      added.current.push({ id: picked.id, name: finalName, header: layout.header, row });
      const filed = fileInList(current ? current.header : [], layout.header, row);
      setList({ status: 'ready', error: '', data: { header: filed.header, rows: [...(current ? current.rows : []), filed.row] } });
      setDone({ name: finalName, id: picked.id });
      setPicked(null);
      setMatches([]);
      setTitle('');
    } catch (err) {
      setError(err.message || 'Could not save that game. Double check the script URL in Settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!hasSheet) return <section className="gcCard"><p className="gcEmpty">Add your Google Sheet link in Settings to keep a new list.</p></section>;
  if (loading || !headers.length) return <section className="gcCard"><p className="gcEmpty">Loading your sheet…</p></section>;
  if (idx.GAME < 0) return <section className="gcCard"><p className="gcEmpty">Your sheet needs a column called Game (or Title, or Name) for this to work.</p></section>;

  const alreadyListed = picked ? inNewList(list.data, picked, name) : false;
  const inMain = picked ? addPlan(picked, name, rows, idx, null).sheet === 'have' : false;
  const listIdx = list.data ? buildHeaderIndex(list.data.header) : null;
  const linkCol = list.data ? list.data.header.findIndex((h) => h.trim().toLowerCase() === 'bgg link') : -1;
  const freshKey = done ? matchKey(done.name) : '';

  return (
    <>
      <section className="gcCard" ref={formCard}>
        <div className="gcCardHead">
          <h2>Add to your new list</h2>
          <span className="gcHint">Goes in the “{NEWLIST_TAB}” tab of your sheet, with its BGG link</span>
        </div>
        <form className="gcRow" onSubmit={search}>
          <input className="gcInput gcGrow" placeholder="Game title…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="gcBtn gcPrimary" type="submit" disabled={searching || !title.trim()}>{searching ? 'Searching…' : 'Search BGG'}</button>
        </form>
        {error && !picked && <p className="gcError">{error}</p>}

        {picked && (
          <div className="gcReview" ref={reviewCard}>
            <div className="gcReviewHead">
              {picked.image ? <img className="gcCover" src={picked.image} alt="" onError={(e) => (e.target.style.visibility = 'hidden')} /> : <div className="gcCover" />}
              <div>
                <div className="gcCandName gcBig">{picked.name}</div>
                <div className="gcMuted">{facts(picked)}{picked.type ? ` · ${picked.type}` : ''}</div>
                <div className="gcMuted">
                  Link for the sheet: <a className="gcLinkBtn gcSmall" href={bggGameUrl(picked.id)} target="_blank" rel="noreferrer">{bggGameUrl(picked.id).replace('https://', '')} ↗</a>
                </div>
                {inMain && <ul className="gcStatus"><li>This one is in your main sheet too.</li></ul>}
              </div>
            </div>

            {alreadyListed && <div className="gcAlert" role="alert">“{name.trim() || picked.name}” is already on your new list, so it can't be added again.</div>}

            <label className="gcField">
              <span>Name in your sheet</span>
              <input className="gcInput" value={name} onChange={(e) => setName(e.target.value)} />
            </label>

            {!!fields.length && (
              <div className="gcExtras">
                <p className="gcHint">From your sheet. BGG fills in the rest.</p>
                {fields.map(({ name: label, i }) => (
                  <div className="gcField" key={i}>
                    <span>{label}</span>
                    {choices[i].length > 0 && (
                      <div className="gcPills">
                        {choices[i].map((v) => (
                          <button key={v} type="button" className={`gcPill${values[i] === v ? ' gcOn' : ''}`} aria-pressed={values[i] === v} onClick={() => setValues({ ...values, [i]: values[i] === v ? '' : v })}>{v}</button>
                        ))}
                      </div>
                    )}
                    <input className="gcInput" aria-label={label} value={values[i] || ''} onChange={(e) => setValues({ ...values, [i]: e.target.value })} />
                  </div>
                ))}
              </div>
            )}

            <div className="gcRow">
              <button className="gcBtn gcPrimary" onClick={add} disabled={saving || alreadyListed}>{saving ? 'Adding…' : alreadyListed ? 'Already on your new list' : 'Add to my new list'}</button>
              <button className="gcBtn gcGhost" onClick={() => setPicked(null)} disabled={saving}>Cancel</button>
            </div>
            {error && <p className="gcError">{error}</p>}
          </div>
        )}

        {matches.length > 1 && (
          <>
            <div className="gcResultsHead">
              <p className="gcHint">{visible.length} match{visible.length === 1 ? '' : 'es'} on BGG, closest first. Tap one to add it.</p>
              <button type="button" className={`gcPill${gamesOnly ? ' gcOn' : ''}`} aria-pressed={gamesOnly} onClick={() => setGamesOnly(!gamesOnly)}>Games only</button>
            </div>
            <div className="gcCandidates">
              {visible.slice(0, shown).map((m) => {
                const d = details[m.id] || m; // the search gives name and year; the rest arrives a page at a time
                return (
                  <button key={m.id} type="button" className={`gcCandidate${picked && picked.id === m.id ? ' gcSelected' : ''}`} onClick={() => pick(m)} disabled={!!pickingId}>
                    {d.image ? <img src={d.image} alt="" /> : <span className="gcNoImage">🎲</span>}
                    <span className="gcCandName">{m.name}</span>
                    {m.kind === 'boardgameexpansion' && <span className="gcTag">Expansion</span>}
                    {inNewList(list.data, m, '') && <span className="gcTag">On your list</span>}
                    <span className="gcMuted">{pickingId === m.id ? 'Getting details…' : facts(d)}</span>
                  </button>
                );
              })}
            </div>
            {!visible.length && <p className="gcMuted">Only expansions match. Turn off “Games only” to see them.</p>}
            {visible.length > shown && (
              <div className="gcRow">
                <button type="button" className="gcBtn gcSecondary" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more ({visible.length - shown} left)</button>
              </div>
            )}
            {detailsFailed && <p className="gcMuted">BGG didn't send some of the details. You can still tap a game to add it.</p>}
          </>
        )}
      </section>

      <section className="gcCard gcListCard" ref={listCard}>
        <div className="gcCardHead">
          <h2>Your new list</h2>
          <span className="gcHint">
            {list.status === 'loading' ? 'Reading the tab…' : `${list.data ? list.data.rows.length : 0} game${list.data && list.data.rows.length === 1 ? '' : 's'}`}
            {' · '}<button className="gcLinkBtn gcSmall" onClick={loadList}>Refresh</button>
          </span>
        </div>
        {done && (
          <div className="gcReview gcAddResult">
            <p className="gcStOk">✓ Added “{done.name}” to your new list, with its BGG link. It's at the top below.</p>
            <div className="gcRow">
              <button className="gcBtn gcSecondary" onClick={() => { setDone(null); if (formCard.current && formCard.current.scrollIntoView) formCard.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Add another game</button>
            </div>
          </div>
        )}
        {list.status === 'error' && <p className="gcError">Couldn't read the “{NEWLIST_TAB}” tab ({list.error}). <button className="gcLinkBtn" onClick={loadList}>Try again</button></p>}
        {!(list.data && list.data.rows.length) && list.status !== 'loading' && list.status !== 'error' && (
          <p className="gcMuted">Nothing here yet. The first game you add creates the tab.</p>
        )}
        {list.data && list.data.rows.length > 0 && (
          <div className="gcTableWrap gcPlaysWrap">
            <table className="gcTable">
              <thead><tr>{list.data.header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {list.data.rows.map((row, r) => ({ row, r })).reverse().map(({ row, r }) => (
                  <tr key={r} className={freshKey && matchKey(cellAt(row, listIdx.GAME)) === freshKey ? 'gcFresh' : ''}>
                    {list.data.header.map((_, j) => {
                      const cell = cellAt(row, j);
                      return (
                        <td key={j} className={j === listIdx.GAME ? 'gcName' : ''}>
                          {j === listIdx.IMAGE && cell ? <img className="gcThumb" src={cell} alt="" />
                            : j === linkCol && /^https?:\/\//.test(cell) ? <a className="gcLinkBtn" href={cell} target="_blank" rel="noreferrer">BGG ↗</a>
                            : cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default NewList;
