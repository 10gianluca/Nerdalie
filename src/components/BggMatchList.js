import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bggThing } from './collectionUtils';

/* Every game BGG found for a search, closest match first, to tap the right one from. The search itself only gives names, so
   the cover, players and rating of the matches on screen are fetched a page at a time in the background and fill in as they
   arrive. Tapping a match hands back its full details (the same shape bggThing gives), fetching them first if they are not
   here yet. Give it a new `key` for each search so it starts again from the top. */

const PAGE = 20; // matches shown at a time, and the most BGG will give details for in one request

export const facts = (g) => [
  g.year,
  (g.minPlayers || g.maxPlayers) && `${g.minPlayers || '?'}–${g.maxPlayers || '?'} players`,
  g.playTime && `${g.playTime} min`,
  g.rating && `★${g.rating}`,
].filter(Boolean).join(' · ');

function BggMatchList({ matches, onPick, selectedId = '', tags = null, autoPick = false, hint = 'Tap one to choose it.' }) {
  const [details, setDetails] = useState({}); // BGG's full details by id, as they are fetched
  const [shown, setShown] = useState(PAGE); // how many matches are on screen
  const [gamesOnly, setGamesOnly] = useState(false); // leave out the expansions
  const [pickingId, setPickingId] = useState(''); // a match whose details are being fetched because you tapped it
  const [detailsFailed, setDetailsFailed] = useState(false);
  const [error, setError] = useState('');
  const asked = useRef(new Set()); // ids whose details have been asked for

  const visible = useMemo(() => (gamesOnly ? matches.filter((m) => m.kind !== 'boardgameexpansion') : matches), [matches, gamesOnly]);

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
    onPick(full);
  }

  // One match means there is nothing to choose between.
  useEffect(() => {
    if (autoPick && matches.length === 1) pick(matches[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {error && <p className="gcError">{error}</p>}
      {matches.length > 1 && (
        <>
          <div className="gcResultsHead">
            <p className="gcHint">{visible.length} match{visible.length === 1 ? '' : 'es'} on BGG, closest first. {hint}</p>
            <button type="button" className={`gcPill${gamesOnly ? ' gcOn' : ''}`} aria-pressed={gamesOnly} onClick={() => setGamesOnly(!gamesOnly)}>Games only</button>
          </div>
          <div className="gcCandidates">
            {visible.slice(0, shown).map((m) => {
              const d = details[m.id] || m; // the search gives name and year; the rest arrives a page at a time
              return (
                <button key={m.id} type="button" className={`gcCandidate${selectedId === m.id ? ' gcSelected' : ''}`} onClick={() => pick(m)} disabled={!!pickingId}>
                  {d.image ? <img src={d.image} alt="" /> : <span className="gcNoImage">🎲</span>}
                  <span className="gcCandName">{m.name}</span>
                  {m.kind === 'boardgameexpansion' && <span className="gcTag">Expansion</span>}
                  {tags && tags(m).map((t) => <span className="gcTag" key={t}>{t}</span>)}
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
          {detailsFailed && <p className="gcMuted">BGG didn't send some of the details. You can still tap a game to choose it.</p>}
        </>
      )}
    </>
  );
}

export default BggMatchList;
