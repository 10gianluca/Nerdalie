import React, { useMemo, useState } from 'react';
import { savePlayViaScript, playStats, matchKey, daysSince, sheetGames, PLAYS_TAB } from './collectionUtils';

/* The Plays tab: a log of the games you've actually played (Date, Game, Players, Winner, Notes), kept in a third tab
   of the sheet. The Pick a game tab reads it to offer "never played" and "not in a while". */

const PLAYERS_KEY = 'nerdalie.plays.players';
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const lastPlayers = () => {
  try {
    return localStorage.getItem(PLAYERS_KEY) || '';
  } catch (_) {
    return '';
  }
};

const timeOf = (d) => {
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
};

export const formatDay = (d) => {
  const t = timeOf(d);
  return t == null ? d || 'no date' : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function PlaysTab({ hasSheet, rows, idx, settings, plays, setPlays, load, onNeedScript }) {
  const [game, setGame] = useState('');
  const [date, setDate] = useState(todayLocal);
  const [players, setPlayers] = useState(lastPlayers);
  const [winner, setWinner] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const names = useMemo(() => sheetGames(rows, idx).map((g) => g.name), [rows, idx]);
  const stats = useMemo(() => playStats(plays.items), [plays.items]);
  const people = useMemo(() => [...new Set(players.split(',').map((p) => p.trim()).filter(Boolean))], [players]);

  // Newest first (an unreadable date sorts last), and later rows win a tie.
  const history = useMemo(() => plays.items
    .map((p, i) => ({ ...p, i, t: timeOf(p.date) }))
    .sort((a, b) => (b.t ?? -Infinity) - (a.t ?? -Infinity) || b.i - a.i), [plays.items]);

  const mostPlayed = useMemo(() => {
    const byName = new Map();
    plays.items.forEach((p) => { const k = matchKey(p.game); if (k && !byName.has(k)) byName.set(k, p.game); });
    return [...stats.entries()].map(([k, s]) => ({ name: byName.get(k), ...s })).sort((a, b) => b.count - a.count || (b.lastTs ?? 0) - (a.lastTs ?? 0)).slice(0, 5);
  }, [plays.items, stats]);

  const wins = useMemo(() => {
    const tally = new Map();
    plays.items.forEach((p) => {
      const k = p.winner.trim().toLowerCase();
      if (!k || k === 'tie' || k === 'draw') return;
      const cur = tally.get(k) || { name: p.winner.trim(), n: 0 };
      cur.n += 1;
      tally.set(k, cur);
    });
    return [...tally.values()].sort((a, b) => b.n - a.n);
  }, [plays.items]);

  const unplayed = useMemo(() => {
    const seen = new Set();
    return names.filter((n) => { const k = matchKey(n); if (seen.has(k)) return false; seen.add(k); return !stats.has(k); }).length;
  }, [names, stats]);

  async function save(e) {
    e.preventDefault();
    const gameName = game.trim();
    if (!gameName) {
      setError('Pick or type the game you played.');
      return;
    }
    if (!settings.scriptUrl) {
      onNeedScript('Set up the sheet script first (steps below), so your plays can be saved to the Plays tab.');
      return;
    }
    const play = { date: date || todayLocal(), game: gameName, players: players.trim(), winner: winner.trim(), notes: notes.trim() };
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await savePlayViaScript(settings.scriptUrl, play);
      setPlays((p) => ({ ...p, items: [...p.items, play] }));
      try { localStorage.setItem(PLAYERS_KEY, play.players); } catch (_) { /* remembering the names is optional */ }
      setGame('');
      setWinner('');
      setNotes('');
      setStatus(`✓ Logged ${gameName}.`);
    } catch (err) {
      setError(err.message || 'Could not save that play.');
    } finally {
      setBusy(false);
    }
  }

  if (!hasSheet) return <section className="gcCard"><p className="gcEmpty">Add your Google Sheet link in Settings to keep a play log.</p></section>;

  return (
    <>
      <section className="gcCard">
        <div className="gcCardHead">
          <h2>Log a play</h2>
          <span className="gcHint">Goes in the “{PLAYS_TAB}” tab of your sheet</span>
        </div>
        <form className="gcPlayForm" onSubmit={save}>
          <label className="gcField gcSpan2">
            <span>Game</span>
            <input className="gcInput" list="gcPlayGames" placeholder="What did you play?" value={game} onChange={(e) => setGame(e.target.value)} />
            <datalist id="gcPlayGames">{names.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label className="gcField">
            <span>Date</span>
            <input className="gcInput" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="gcField">
            <span>Who played</span>
            <input className="gcInput" placeholder="e.g. Sam, Nalie" value={players} onChange={(e) => setPlayers(e.target.value)} />
          </label>
          <div className="gcField gcSpan2">
            <span>Winner</span>
            <div className="gcPills">
              {people.map((p) => <button key={p} type="button" className={`gcPill${winner === p ? ' gcOn' : ''}`} aria-pressed={winner === p} onClick={() => setWinner(winner === p ? '' : p)}>{p}</button>)}
              <button type="button" className={`gcPill${winner === 'Tie' ? ' gcOn' : ''}`} aria-pressed={winner === 'Tie'} onClick={() => setWinner(winner === 'Tie' ? '' : 'Tie')}>Tie</button>
              <input className="gcInput gcWinnerInput" placeholder="or type a name" value={people.includes(winner) || winner === 'Tie' ? '' : winner} onChange={(e) => setWinner(e.target.value)} />
            </div>
          </div>
          <label className="gcField gcSpan2">
            <span>Notes <small>(optional)</small></span>
            <input className="gcInput" placeholder="Anything worth remembering" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="gcRow gcSpan2">
            <button className="gcBtn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Log this play'}</button>
            {status && <span className="gcStOk">{status}</span>}
          </div>
          {error && <p className="gcError gcSpan2">{error}</p>}
        </form>
      </section>

      <section className="gcCard">
        <div className="gcCardHead">
          <h2>Your plays</h2>
          <span className="gcHint">
            {plays.status === 'loading' ? 'Reading the Plays tab…' : `${plays.items.length} logged`}
            {' · '}<button className="gcLinkBtn gcSmall" onClick={load}>Refresh</button>
          </span>
        </div>
        {plays.status === 'error' && <p className="gcError">Couldn't read the Plays tab ({plays.error}). <button className="gcLinkBtn" onClick={load}>Try again</button></p>}
        {!plays.items.length && plays.status !== 'loading' && plays.status !== 'error' && <p className="gcMuted">Nothing logged yet. The first play you log creates the tab.</p>}

        {plays.items.length > 0 && (
          <div className="gcStatRow">
            <div className="gcStat"><b>{plays.items.length}</b><span>plays logged</span></div>
            <div className="gcStat"><b>{stats.size}</b><span>different games</span></div>
            <div className="gcStat"><b>{unplayed}</b><span>in your sheet, never played</span></div>
          </div>
        )}

        {mostPlayed.length > 0 && (
          <>
            <div className="gcSubhead">Most played</div>
            <ul className="gcList">
              {mostPlayed.map((m) => (
                <li key={m.name}><b>{m.name}</b><span>{m.count} play{m.count === 1 ? '' : 's'}{m.lastTs != null ? ` · last ${daysSince(m.lastTs) === 0 ? 'today' : `${daysSince(m.lastTs)} days ago`}` : ''}</span></li>
              ))}
            </ul>
          </>
        )}

        {wins.length > 0 && (
          <>
            <div className="gcSubhead">Wins</div>
            <ul className="gcList">{wins.map((w) => <li key={w.name}><b>{w.name}</b><span>{w.n} win{w.n === 1 ? '' : 's'}</span></li>)}</ul>
          </>
        )}

        {history.length > 0 && (
          <>
            <div className="gcSubhead">Recent</div>
            <div className="gcTableWrap gcPlaysWrap">
              <table className="gcTable">
                <thead><tr><th>Date</th><th>Game</th><th>Winner</th><th>Players</th><th>Notes</th></tr></thead>
                <tbody>
                  {history.slice(0, 25).map((p) => (
                    <tr key={p.i}>
                      <td>{formatDay(p.date)}</td>
                      <td className="gcName">{p.game}</td>
                      <td>{p.winner || '–'}</td>
                      <td>{p.players || '–'}</td>
                      <td className="gcNotes">{p.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}

export default PlaysTab;
