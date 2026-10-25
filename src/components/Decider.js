import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSheetCsv, parseDecisions, undecidedGames, wishlistQueue, saveDecisionViaScript, bggOwnedCollection, bggWishlist,
  bggGameUrl, matchKey, DECISIONS_TAB, WISHLIST_TAB, PRIORITY_LABELS,
} from './collectionUtils';

/* One game at a time, answered with big buttons (or the keys), and every answer saved to its own tab of the sheet.
   The same component runs two decks:
     OWNED_DECK    the games you own on BGG  ->  Keep / Discard / Play and see  ->  the "Decisions" tab
     WISHLIST_DECK your BGG wishlist         ->  Buy / Drop / Later             ->  the "Wishlist" tab
   Games already answered are skipped, answers go to the sheet in the background (with Retry if that fails),
   and "Change my last answer" steps back one. */

const TONE_BUTTON = { good: 'gcKeep', bad: 'gcDiscard', warn: 'gcPlay' };
const TONE_CHIP = { good: 'gcKeepChip', bad: 'gcDiscardChip', warn: 'gcPlayChip' };

export const OWNED_DECK = {
  id: 'owned',
  tab: DECISIONS_TAB,
  choices: [
    { label: 'Keep', short: 'Keep', tone: 'good', key: 'K' },
    { label: 'Discard', short: 'Discard', tone: 'bad', key: 'D' },
    { label: 'Play and see', short: 'Play', tone: 'warn', key: 'P' },
  ],
  load: async (username, sheetLink) => {
    const [games, tabCsv] = await Promise.all([bggOwnedCollection(username), readTab(sheetLink, DECISIONS_TAB)]);
    return { games, ...tabCsv };
  },
  order: (games, answered) => undecidedGames(games, answered),
  text: {
    needSettings: 'Add your Google Sheet link and BoardGameGeek username in Settings to start deciding.',
    loading: 'Reading your BGG collection and your Decisions tab… this can take a few seconds.',
    done: 'You have decided on every game you own. 🎉',
    none: 'No owned games found in your BGG collection.',
    progress: 'decided',
    needScript: 'Set up the sheet script first (steps below), so your answers can be saved to the Decisions tab.',
  },
};

export const WISHLIST_DECK = {
  id: 'wishlist',
  tab: WISHLIST_TAB,
  choices: [
    { label: 'Buy', short: 'Buy', tone: 'good', key: 'B' },
    { label: 'Drop', short: 'Drop', tone: 'bad', key: 'D' },
    { label: 'Later', short: 'Later', tone: 'warn', key: 'L' },
  ],
  load: async (username, sheetLink) => {
    const [games, tabCsv] = await Promise.all([bggWishlist(username), readTab(sheetLink, WISHLIST_TAB)]);
    return { games, ...tabCsv };
  },
  order: (games, answered) => wishlistQueue(games, answered),
  text: {
    needSettings: 'Add your Google Sheet link and BoardGameGeek username in Settings to go through your wishlist.',
    loading: 'Reading your BGG wishlist and your Wishlist tab… this can take a few seconds.',
    done: 'You have been through your whole wishlist. 🎉',
    none: 'Nothing on your BGG wishlist.',
    progress: 'reviewed',
    needScript: 'Set up the sheet script first (steps below), so your answers can be saved to the Wishlist tab.',
  },
};

// A tab that doesn't exist yet isn't an error (Google just answers with the first sheet), so a read that really
// fails lets you carry on, with a warning that answered games may come up again.
async function readTab(sheetLink, tab) {
  try {
    return { csv: await fetchSheetCsv(sheetLink, tab), warning: '' };
  } catch (err) {
    return { csv: '', warning: err.message || 'unknown error' };
  }
}

export default function Decider({ deck, active, settings, onNeedScript, onCount, onLoaded }) {
  const [dec, setDec] = useState({ status: 'idle', error: '', total: 0, warning: '' }); // idle | loading | ready | error
  const [queue, setQueue] = useState([]); // games still to answer; queue[0] is on screen
  const [answers, setAnswers] = useState(() => new Map()); // matchKey(game) -> { game, choice }
  const [history, setHistory] = useState([]); // answered this visit, newest last: { game, choice }
  const [saving, setSaving] = useState({ sent: 0, pending: 0, failed: [] });
  const sendQueue = useRef([]);
  const sending = useRef(false);
  const ready = !!(settings.bggUsername && settings.sheetLink);

  async function load() {
    setDec({ status: 'loading', error: '', total: 0, warning: '' });
    try {
      const { games, csv, warning } = await deck.load(settings.bggUsername, settings.sheetLink);
      const known = parseDecisions(csv);
      setAnswers(known);
      setHistory([]);
      setQueue(deck.order(games, known));
      setDec({ status: 'ready', error: '', total: games.length, warning });
      if (onLoaded) onLoaded(games);
    } catch (err) {
      setDec({ status: 'error', error: err.message || 'Could not read your BGG list', total: 0, warning: '' });
    }
  }

  // The first time this tab is opened, load it.
  useEffect(() => {
    if (active && dec.status === 'idle' && ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, dec.status]);

  // The tab badge: how many are left.
  useEffect(() => {
    if (onCount) onCount(dec.status === 'ready' ? queue.length : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dec.status, queue.length]);

  // Answers are sent to the sheet one at a time, in order, in the background, so you can keep tapping.
  async function pumpSaves(scriptUrl) {
    if (sending.current) return;
    sending.current = true;
    while (sendQueue.current.length) {
      const item = sendQueue.current[0];
      try {
        await saveDecisionViaScript(scriptUrl, item.game, item.choice, deck.tab);
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
      onNeedScript(deck.text.needScript);
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
  function undo() {
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

  // The keys answer the game on screen.
  useEffect(() => {
    if (!active || dec.status !== 'ready') return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      const hit = deck.choices.find((c) => c.key.toLowerCase() === e.key.toLowerCase());
      if (hit) decide(hit.label);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const counts = useMemo(() => {
    const c = Object.fromEntries(deck.choices.map((x) => [x.label, 0]));
    answers.forEach((a) => {
      if (c[a.choice] !== undefined) c[a.choice] += 1;
    });
    return c;
  }, [answers, deck]);

  const current = queue[0];
  const answered = dec.total - queue.length;

  return (
    <section className="gcCard gcDecide">
      {!ready ? (
        <p className="gcEmpty">{deck.text.needSettings}</p>
      ) : dec.status === 'loading' || dec.status === 'idle' ? (
        <p className="gcEmpty">{deck.text.loading}</p>
      ) : dec.status === 'error' ? (
        <p className="gcEmpty gcError">{dec.error} <button className="gcLinkBtn" onClick={load}>Retry</button></p>
      ) : (
        <>
          <div className="gcProgress">
            <div className="gcProgressTop">
              <span><b>{answered}</b> of {dec.total} {deck.text.progress}</span>
              <span className="gcChips">
                {deck.choices.map((c) => <span key={c.label} className={`gcChip ${TONE_CHIP[c.tone]}`}>{c.short} {counts[c.label]}</span>)}
              </span>
            </div>
            <div className="gcBar"><div className="gcBarFill" style={{ width: `${dec.total ? Math.round((answered / dec.total) * 100) : 0}%` }} /></div>
          </div>

          {dec.warning && (
            <div className="gcAlert">Couldn't read your “{deck.tab}” tab ({dec.warning}), so games you've already answered may come up again. <button className="gcLinkBtn" onClick={load}>Try again</button></div>
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
                  {PRIORITY_LABELS[current.priority] && <span className="gcFact gcPriority">{PRIORITY_LABELS[current.priority]}</span>}
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
                {deck.choices.map((c) => (
                  <button key={c.label} className={`gcChoice ${TONE_BUTTON[c.tone]}`} onClick={() => decide(c.label)}>
                    <span>{c.label}</span>
                    <kbd>{c.key}</kbd>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="gcEmpty">{dec.total ? deck.text.done : deck.text.none}</p>
          )}

          <div className="gcDecideFoot">
            <button className="gcLinkBtn gcSmall" onClick={undo} disabled={!history.length}>← Change my last answer</button>
            <span className="gcSaved">
              {saving.pending ? 'Saving…' : saving.sent ? `✓ ${saving.sent} saved to your sheet's “${deck.tab}” tab` : `Answers go to the “${deck.tab}” tab of your sheet`}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
