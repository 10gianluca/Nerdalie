import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sheetGames, typeChoices, pickableGames, themeCounts, shuffled, bggThemes, bggGameUrl, matchKey, daysSince, TIME_STEPS } from './collectionUtils';

/* The "Pick a game" tab: say how many players, how long, what kind of game and (from BoardGameGeek's
   categories) what theme, and it deals your matching games one at a time in random order. Skip moves on
   to the next. Players, time and type are read from the sheet; themes are looked up on BGG by the sheet's
   BGGID and remembered in this browser so they're only fetched once. */

const THEMES_KEY = 'nerdalie.collection.themes';
const PLAYER_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const THEMES_SHOWN = 12;

const loadThemeCache = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(THEMES_KEY));
    return saved && typeof saved === 'object' ? saved : {};
  } catch (_) {
    return {};
  }
};
const saveThemeCache = (map) => {
  try {
    localStorage.setItem(THEMES_KEY, JSON.stringify(map));
  } catch (_) {
    // storage full or blocked: the themes just get fetched again next visit
  }
};

// "Played 3 times, last 12 days ago" / "Never played"
function playedText(s) {
  if (!s) return 'Never played';
  const days = daysSince(s.lastTs);
  const last = days == null ? '' : days === 0 ? ', last today' : days === 1 ? ', last yesterday' : `, last ${days} days ago`;
  return `Played ${s.count} time${s.count === 1 ? '' : 's'}${last}`;
}

const timeLabel = (m) => (m < 60 ? `${m} min` : m === 60 ? '1 hr' : `${m / 60} hr`);
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function Pill({ on, onClick, children }) {
  return (
    <button type="button" className={`gcPill${on ? ' gcOn' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function PickRow({ label, children }) {
  return (
    <div className="gcPickRow">
      <span className="gcPickLabel">{label}</span>
      <div className="gcPills">{children}</div>
    </div>
  );
}

// stats: playStats() of the Plays tab (null until read). discards: matchKey()s of games marked Discard.
function GamePicker({ rows, idx, hasSheet, loading, loadError, onRetry, stats, discards, extras }) {
  const games = useMemo(() => sheetGames(rows, idx), [rows, idx]);
  const types = useMemo(() => typeChoices(rows, idx), [rows, idx]);
  const ids = useMemo(() => [...new Set(games.map((g) => g.id).filter(Boolean))], [games]);
  const idsKey = ids.join(',');

  const [players, setPlayers] = useState(null); // a number, or null for any
  const [maxTime, setMaxTime] = useState(null); // minutes, or null for any
  const [type, setType] = useState('');
  const [history, setHistory] = useState(''); // '' | 'never' | 'stale' (see pickableGames)
  const [hideDiscards, setHideDiscards] = useState(true);
  const [chosen, setChosen] = useState([]); // BGG categories; a game needs at least one of them
  const [showAllThemes, setShowAllThemes] = useState(false);
  const [deck, setDeck] = useState(null); // { list, pos } once "Pick a game" is pressed; pos === list.length means all skipped

  const [themes, setThemes] = useState(loadThemeCache); // { bggId: [categories] }
  const [themeLoad, setThemeLoad] = useState({ busy: false, done: 0, total: 0, error: '' });
  const themesRef = useRef(themes);
  const run = useRef(0);
  const cardRef = useRef(null);

  // Look up the themes of any game not already remembered, 20 at a time, keeping each batch as it arrives.
  async function loadThemes() {
    const need = ids.filter((id) => !(id in themesRef.current));
    if (!need.length) return;
    const mine = ++run.current;
    let done = 0;
    setThemeLoad({ busy: true, done, total: need.length, error: '' });
    try {
      await bggThemes(need, (found) => {
        if (mine !== run.current) return;
        themesRef.current = { ...themesRef.current, ...found };
        saveThemeCache(themesRef.current);
        done += Object.keys(found).length;
        setThemes(themesRef.current);
        setThemeLoad({ busy: true, done, total: need.length, error: '' });
      });
      if (mine === run.current) setThemeLoad({ busy: false, done, total: need.length, error: '' });
    } catch (err) {
      if (mine === run.current) setThemeLoad({ busy: false, done, total: need.length, error: err.message || 'Could not reach BoardGameGeek' });
    }
  }

  useEffect(() => {
    loadThemes();
    return () => { run.current += 1; }; // a newer load, or leaving the tab, ends this one's updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Changing what you're after throws away the current deal.
  useEffect(() => { setDeck(null); }, [players, maxTime, type, chosen, history, hideDiscards]);

  const exclude = hideDiscards && discards && discards.size ? discards : null;
  const base = useMemo(
    () => pickableGames(games, themes, { players, maxTime, type, history, stats, exclude }),
    [games, themes, players, maxTime, type, history, stats, exclude],
  );
  const matches = useMemo(() => (chosen.length ? pickableGames(base, themes, { themes: chosen }) : base), [base, themes, chosen]);

  // Theme chips show how many of the games that fit the other choices have each theme.
  const themeList = useMemo(() => {
    const list = themeCounts(base, themes);
    chosen.forEach((c) => { if (!list.some((t) => t.name === c)) list.push({ name: c, count: 0 }); });
    return list;
  }, [base, themes, chosen]);
  const shownThemes = showAllThemes ? themeList : themeList.filter((t, i) => i < THEMES_SHOWN || chosen.includes(t.name));

  const anyFilter = players != null || maxTime != null || type || chosen.length || history;
  const current = deck && deck.list[deck.pos];
  const deckList = deck ? deck.list : null;

  const toggle = (value, now, set) => set(now === value ? null : value);
  const toggleTheme = (name) => setChosen((c) => (c.includes(name) ? c.filter((x) => x !== name) : [...c, name]));
  const clearFilters = () => { setPlayers(null); setMaxTime(null); setType(''); setChosen([]); setHistory(''); };
  const pick = () => setDeck({ list: shuffled(matches), pos: 0 });
  const skip = () => setDeck((d) => (d && d.pos < d.list.length ? { ...d, pos: d.pos + 1 } : d));

  // On a phone the result lands below the fold, so bring it into view when a new deal starts.
  useEffect(() => {
    const el = cardRef.current;
    if (deckList && el && el.getBoundingClientRect().top > window.innerHeight * 0.5) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [deckList]);

  // S or the right arrow skips.
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      if (e.key.toLowerCase() === 's' || e.key === 'ArrowRight') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!hasSheet) return <section className="gcCard"><p className="gcEmpty">Add your Google Sheet link in Settings to pick from your collection.</p></section>;
  if (loading) return <section className="gcCard"><p className="gcEmpty">Loading your sheet…</p></section>;
  if (loadError) return <section className="gcCard"><p className="gcEmpty gcError">{loadError} <button className="gcLinkBtn" onClick={onRetry}>Retry</button></p></section>;
  if (!games.length) return <section className="gcCard"><p className="gcEmpty">Your sheet has no games in it yet.</p></section>;

  const noId = games.filter((g) => !g.id).length;
  const currentThemes = current ? themes[current.id] || [] : [];

  return (
    <>
      <section className="gcCard">
        <div className="gcCardHead">
          <h2>What should we play?</h2>
          <span className="gcHint">Choose what you're after, then pick. It's drawn at random from your sheet.</span>
        </div>

        {(idx.MIN >= 0 || idx.MAX >= 0) && (
          <PickRow label="Players">
            <Pill on={players == null} onClick={() => setPlayers(null)}>Any</Pill>
            {PLAYER_OPTIONS.map((n) => (
              <Pill key={n} on={players === n} onClick={() => toggle(n, players, setPlayers)}>{n === 7 ? '7+' : n}</Pill>
            ))}
          </PickRow>
        )}

        {idx.TIME >= 0 && (
          <PickRow label="Time">
            <Pill on={maxTime == null} onClick={() => setMaxTime(null)}>Any</Pill>
            {TIME_STEPS.map((m) => (
              <Pill key={m} on={maxTime === m} onClick={() => toggle(m, maxTime, setMaxTime)}>≤ {timeLabel(m)}</Pill>
            ))}
          </PickRow>
        )}

        {types.length > 0 && (
          <PickRow label="Type">
            <Pill on={!type} onClick={() => setType('')}>Any</Pill>
            {types.map((t) => (
              <Pill key={t} on={type.toLowerCase() === t.toLowerCase()} onClick={() => setType(type.toLowerCase() === t.toLowerCase() ? '' : t)}>{capitalise(t)}</Pill>
            ))}
          </PickRow>
        )}

        {stats && (
          <PickRow label="History">
            <Pill on={!history} onClick={() => setHistory('')}>Any</Pill>
            <Pill on={history === 'never'} onClick={() => setHistory(history === 'never' ? '' : 'never')}>Never played</Pill>
            <Pill on={history === 'stale'} onClick={() => setHistory(history === 'stale' ? '' : 'stale')}>Not in 30+ days</Pill>
            {discards && discards.size > 0 && (
              <Pill on={hideDiscards} onClick={() => setHideDiscards((h) => !h)}>Hide ones I discarded</Pill>
            )}
          </PickRow>
        )}
        {extras && extras.status === 'loading' && <p className="gcHint gcThemeStatus">Reading your plays and decisions…</p>}
        {extras && extras.status === 'error' && <p className="gcHint gcThemeStatus">Couldn't read your plays and decisions ({extras.error}), so the history filters are off. <button className="gcLinkBtn gcSmall" onClick={extras.retry}>Retry</button></p>}

        {ids.length > 0 ? (
          <PickRow label="Theme">
            <Pill on={!chosen.length} onClick={() => setChosen([])}>Any</Pill>
            {shownThemes.map((t) => (
              <Pill key={t.name} on={chosen.includes(t.name)} onClick={() => toggleTheme(t.name)}>
                {t.name} <span className="gcPillCount">{t.count}</span>
              </Pill>
            ))}
            {themeList.length > THEMES_SHOWN && (
              <button type="button" className="gcLinkBtn gcSmall" onClick={() => setShowAllThemes((s) => !s)}>
                {showAllThemes ? 'Show fewer' : `Show all ${themeList.length}`}
              </button>
            )}
          </PickRow>
        ) : (
          <p className="gcHint">Themes come from BoardGameGeek. Add a <b>BGGID</b> column to your sheet (Sync → Fill in missing info can then fill it in) to filter by theme.</p>
        )}

        {ids.length > 0 && (
          <p className="gcHint gcThemeStatus">
            {themeLoad.busy && `Loading themes from BoardGameGeek… ${themeLoad.done} of ${themeLoad.total}`}
            {!themeLoad.busy && themeLoad.error && (
              <>Couldn't load every theme: {themeLoad.error} <button className="gcLinkBtn gcSmall" onClick={loadThemes}>Retry</button></>
            )}
            {!themeLoad.busy && !themeLoad.error && noId > 0 && `${noId} game${noId === 1 ? ' has' : 's have'} no BGGID in your sheet, so a theme choice leaves ${noId === 1 ? 'it' : 'them'} out.`}
          </p>
        )}

        <div className="gcPickBar">
          <span><b>{matches.length}</b> of {games.length} games match{anyFilter ? <> · <button type="button" className="gcLinkBtn gcSmall" onClick={clearFilters}>Clear choices</button></> : null}</span>
          <button className="gcBtn gcPickBtn" onClick={pick} disabled={!matches.length}>{deck ? 'Pick again' : 'Pick a game'}</button>
        </div>
        {!matches.length && <p className="gcHint">Nothing in your sheet fits all of that. Loosen one of the choices.</p>}
      </section>

      {deck && (
        <section className="gcCard gcPickResult" ref={cardRef}>
          {current ? (
            <div className="gcGame">
              {current.image ? <img className="gcPoster" src={current.image} alt="" onError={(e) => (e.target.style.visibility = 'hidden')} /> : <div className="gcPoster gcNoPoster">🎲</div>}
              <div className="gcGameInfo">
                <div className="gcPickCount">Match {deck.pos + 1} of {deck.list.length}</div>
                <h2 className="gcGameName">{current.name}</h2>
                <div className="gcFacts">
                  {current.year && <span className="gcFact">{current.year}</span>}
                  {(current.minPlayers || current.maxPlayers) && (
                    <span className="gcFact">{current.minPlayers || '?'}{current.maxPlayers && current.maxPlayers !== current.minPlayers ? `–${current.maxPlayers}` : ''} players</span>
                  )}
                  {current.playTime && <span className="gcFact">{current.playTime} min</span>}
                  {current.type && <span className="gcFact">{current.type}</span>}
                  {current.rating && <span className="gcFact">★ {current.rating}</span>}
                </div>
                {stats && <p className="gcLast">{playedText(stats.get(matchKey(current.name)))}</p>}
                {currentThemes.length > 0 && (
                  <div className="gcTags">{currentThemes.map((t) => <span key={t} className="gcTag">{t}</span>)}</div>
                )}
                {current.id && <a className="gcLinkBtn gcSmall" href={bggGameUrl(current.id)} target="_blank" rel="noreferrer">View on BoardGameGeek ↗</a>}
              </div>
              <div className="gcPickActions">
                <button className="gcBtn gcSecondary gcSkip" onClick={skip}>Skip <kbd>S</kbd></button>
              </div>
            </div>
          ) : (
            <div className="gcPickDone">
              <p>That was all {deck.list.length} match{deck.list.length === 1 ? '' : 'es'}.</p>
              <button className="gcBtn" onClick={pick}>Deal them again</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export default GamePicker;
