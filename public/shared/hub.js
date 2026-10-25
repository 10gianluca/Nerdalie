/* Shared by the online games and the Game Night page. It keeps three small things in this browser's
   localStorage (so every game on the site, and the Game Night page, can see them):

     nerdalie.hub.games    which games are in progress here, and whose move it is
     nerdalie.hub.results  every finished game, from this browser's point of view (win / loss / draw)
     nerdalie.hub.prefs    how to be told it's your move (sound, flashing tab, desktop notification)

   Nothing leaves the browser. A game gets its own handle with NerdalieHub.game(id, title) and calls
   sync() each time it draws, finish() when a game ends and leave() when the player walks away. */
(function (root) {
  'use strict';

  const KEYS = { games: 'nerdalie.hub.games', results: 'nerdalie.hub.results', prefs: 'nerdalie.hub.prefs' };
  const MAX_RESULTS = 500;
  const DEFAULT_PREFS = { sound: true, title: true, notify: false };
  const LEVELS = ['easy', 'normal', 'hard'];

  function createStore(storage) {
    return {
      get(key, fallback) {
        try {
          const value = JSON.parse(storage.getItem(key));
          return value == null ? fallback : value;
        } catch (_) {
          return fallback;
        }
      },
      set(key, value) {
        try {
          storage.setItem(key, JSON.stringify(value));
          return true;
        } catch (_) {
          return false; // private mode or storage full: the hub just forgets
        }
      },
    };
  }

  const blank = () => ({ w: 0, l: 0, d: 0 });
  function count(tally, outcome) {
    if (outcome === 'win') tally.w += 1;
    else if (outcome === 'loss') tally.l += 1;
    else tally.d += 1;
  }

  // Wins, losses and draws, overall and per game (online and against the computer kept apart), plus a
  // head-to-head record against each online opponent. Co-op results have no opponent, so they only count
  // toward their game's record.
  function summarize(results) {
    const out = { online: blank(), solo: blank(), byGame: {}, byOpponent: {}, total: results.length };
    for (const r of results) {
      const solo = r.mode === 'solo';
      count(solo ? out.solo : out.online, r.outcome);
      const g = out.byGame[r.game] || (out.byGame[r.game] = { title: r.title || r.game, coop: !!r.coop, online: blank(), solo: blank(), levels: { easy: blank(), normal: blank(), hard: blank() }, last: 0 });
      g.title = r.title || g.title;
      g.coop = g.coop || !!r.coop;
      g.last = Math.max(g.last, r.at || 0);
      count(solo ? g.solo : g.online, r.outcome);
      if (solo && LEVELS.includes(r.level)) count(g.levels[r.level], r.outcome);
      if (!solo && !r.coop && r.opponent) {
        const key = String(r.opponent).trim().toLowerCase();
        const o = out.byOpponent[key] || (out.byOpponent[key] = { name: String(r.opponent).trim(), ...blank(), last: 0 });
        count(o, r.outcome);
        o.last = Math.max(o.last, r.at || 0);
      }
    }
    return out;
  }

  // 5–3 or 5–3–1 (wins–losses–draws)
  const formatRecord = (t) => `${t.w}–${t.l}${t.d ? `–${t.d}` : ''}`;

  function createHub(storage, env = {}) {
    const store = createStore(storage);
    const now = env.now || Date.now;
    const alertTurn = env.alertTurn || (() => {});

    const api = {
      KEYS,
      prefs: () => ({ ...DEFAULT_PREFS, ...store.get(KEYS.prefs, {}) }),
      setPrefs: (patch) => store.set(KEYS.prefs, { ...api.prefs(), ...patch }),

      games: () => store.get(KEYS.games, {}),
      results: () => store.get(KEYS.results, []),
      summary: () => summarize(api.results()),

      // Games in progress here, newest activity first.
      inProgress() {
        return Object.values(api.games()).filter((g) => g && g.status !== 'gone').sort((a, b) => (b.at || 0) - (a.at || 0));
      },

      report(id, info) {
        const games = api.games();
        const before = games[id];
        const next = { ...before, ...info, id };
        const changed = !before || ['status', 'mode', 'opponent', 'level', 'code', 'title'].some((k) => before[k] !== next[k]);
        if (!changed) return;
        next.at = now();
        games[id] = next;
        store.set(KEYS.games, games);
      },

      clear(id) {
        const games = api.games();
        if (!(id in games)) return;
        delete games[id];
        store.set(KEYS.games, games);
      },

      // result: { game, title, mode: 'solo'|'online', level, opponent, outcome: 'win'|'loss'|'draw', detail, coop }
      record(result) {
        const list = api.results();
        list.push({ ...result, at: now() });
        store.set(KEYS.results, list.slice(-MAX_RESULTS));
      },

      clearResults: () => store.set(KEYS.results, []),

      // A handle for one game.
      game(id, title) {
        let wasMyMove = null; // unknown until the first draw, so reopening a page mid-turn doesn't ping
        return {
          // needsMe: it's this player's move. over: the game has ended. Alerts only fire for online games, on
          // the moment the move passes to you while this tab is in the background.
          sync({ needsMe, over, solo, opponent, level, code }) {
            const status = over ? 'over' : needsMe ? 'your-turn' : 'waiting';
            api.report(id, { title, status, mode: solo ? 'solo' : 'online', opponent: opponent || '', level: solo ? level || 'normal' : '', code: code || '' });
            if (wasMyMove === false && needsMe && !over && !solo) alertTurn(title, api.prefs());
            wasMyMove = !!needsMe;
          },
          finish(result) {
            api.record({ game: id, title, ...result });
          },
          leave() {
            wasMyMove = null;
            api.clear(id);
          },
        };
      },
    };
    return api;
  }

  // ---------- being told it's your move (browser only) ----------
  function browserAlert(title, prefs) {
    if (typeof document === 'undefined' || !document.hidden) return;
    if (prefs.sound) beep();
    if (prefs.title) flashTitle(`🔔 Your move · ${title}`);
    if (prefs.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(`Your move in ${title}`, { tag: 'nerdalie-turn', renotify: true }); } catch (_) { /* some browsers only allow these from a service worker */ }
    }
  }

  let audio = null;
  function beep() {
    try {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      audio = audio || new Ctx();
      if (audio.state === 'suspended') audio.resume();
      [[880, 0], [660, 0.16]].forEach(([freq, at]) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, audio.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.14);
        osc.connect(gain).connect(audio.destination);
        osc.start(audio.currentTime + at);
        osc.stop(audio.currentTime + at + 0.16);
      });
    } catch (_) { /* no audio available */ }
  }

  let flashTimer = null;
  function flashTitle(text) {
    if (flashTimer) return;
    const base = document.title;
    let on = false;
    flashTimer = setInterval(() => { on = !on; document.title = on ? text : base; }, 1000);
    const stop = () => {
      if (document.hidden) return;
      clearInterval(flashTimer);
      flashTimer = null;
      document.title = base;
      document.removeEventListener('visibilitychange', stop);
    };
    document.addEventListener('visibilitychange', stop);
  }

  const api = { createHub, summarize, formatRecord, KEYS, DEFAULT_PREFS, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    let storage = null;
    try { storage = root.localStorage; } catch (_) { /* blocked */ }
    root.NerdalieHub = storage
      ? Object.assign(createHub(storage, { alertTurn: browserAlert }), { summarize, formatRecord, LEVELS })
      : null; // games check for this and carry on without it
  }
})(typeof window !== 'undefined' ? window : globalThis);
