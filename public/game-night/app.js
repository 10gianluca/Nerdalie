/* Game Night: reads what the online games leave in localStorage (see ../shared/hub.js) and shows games in
   progress, the scoreboard, recent results and the "tell me when it's my move" settings. */
(function () {
  'use strict';

  const hub = window.NerdalieHub;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Every game on the site that reports to the hub. sessionKey is where the game keeps its saved session.
  const GAMES = [
    { id: 'qwinto-online', title: 'Qwinto Online', emoji: '🎲', blurb: 'Roll, choose, fill your sheet', sessionKey: 'qwinto.session' },
    { id: 'agent-avenue', title: 'Agent Avenue', emoji: '🕵️', blurb: 'Bluff your way to the safe house', sessionKey: 'agentavenue.session' },
    { id: 'lost-cities', title: 'Lost Cities', emoji: '🧭', blurb: 'Five expeditions, three rounds', sessionKey: 'lostcities.session' },
    { id: 'scout', title: 'Scout', emoji: '🎪', blurb: 'Show sets, scout cards', sessionKey: 'scout.session' },
    { id: 'hocus-pocus', title: 'Hocus Pocus', emoji: '🔮', blurb: 'Co-op: brew before sunrise', sessionKey: 'hocuspocus.session' },
    { id: 'toy-battle', title: 'Toy Battle', emoji: '🧸', blurb: 'Toy troops on a tabletop', sessionKey: 'toybattle.session' },
    { id: 'jaipur', title: 'Jaipur', emoji: '🐪', blurb: 'Trade goods, hoard camels', sessionKey: 'jaipur.session' },
    { id: 'onitama', title: 'Onitama', emoji: '🥋', blurb: 'Martial arts on a 5x5 board', sessionKey: 'onitama.session' },
    { id: 'schotten-totten', title: 'Schotten Totten', emoji: '🏰', blurb: 'Nine stones, three cards a side', sessionKey: 'schotten-totten.session' },
    { id: 'santorini', title: 'Santorini', emoji: '🏛️', blurb: 'Build up, climb up, win on level 3', sessionKey: 'santorini.session' },
    { id: 'reversi', title: 'Reversi', emoji: '⚫', blurb: 'Flip the board your colour', sessionKey: 'reversi.session' },
    { id: 'mancala', title: 'Mancala', emoji: '🥜', blurb: 'Sow seeds, capture, go again', sessionKey: 'mancala.session' },
    { id: 'quarto', title: 'Quarto', emoji: '🔲', blurb: 'Give a piece, make a line of four', sessionKey: 'quarto.session' },
    { id: 'checkers', title: 'Checkers', emoji: '🔴', blurb: 'Jump, crown and corner', sessionKey: 'checkers.session' },
  ];
  const BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));
  const emojiOf = (id) => (BY_ID[id] ? BY_ID[id].emoji : '🎮');
  const WHY = { 'deck-empty': 'deck ran out', stalled: 'nobody could play' };

  const DAY = 86400000;
  const STALE_AFTER = 7 * DAY;

  function ago(ts, now = Date.now()) {
    const d = now - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return `${Math.round(d / 60000)} min ago`;
    if (d < DAY) return `${Math.round(d / 3600000)} h ago`;
    if (d < 2 * DAY) return 'yesterday';
    if (d < 30 * DAY) return `${Math.floor(d / DAY)} days ago`;
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const rec = (t) => (t.w + t.l + t.d ? hub.formatRecord(t) : '–');

  // ---------- in progress ----------
  function renderNow() {
    const list = hub.inProgress();
    if (!list.length) {
      $('now').innerHTML = '<p class="empty">Nothing in progress here. Start a game below, or open one you left running.</p>';
      return;
    }
    const rank = { 'your-turn': 0, waiting: 1, over: 2 };
    list.sort((a, b) => (rank[a.status] - rank[b.status]) || ((b.at || 0) - (a.at || 0)));
    const now = Date.now();
    $('now').innerHTML = '<div class="live">' + list.map((g) => {
      const solo = g.mode === 'solo';
      const stale = now - (g.at || 0) > STALE_AFTER;
      const who = g.opponent ? esc(g.opponent) : 'your opponent';
      const chip = g.status === 'your-turn' ? '<span class="chip mine">Your move</span>'
        : g.status === 'over' ? '<span class="chip over">Finished</span>'
          : `<span class="chip wait">${solo ? 'Computer’s move' : `Waiting for ${who}`}</span>`;
      const sub = solo ? `vs the computer${g.level ? ` (${esc(g.level)})` : ''}` : `with ${who}${g.code ? ` · room ${esc(g.code)}` : ''}`;
      return `<div class="liveRow${g.status === 'your-turn' ? ' mine' : ''}${stale ? ' stale' : ''}">
        <span class="emoji" aria-hidden="true">${emojiOf(g.id)}</span>
        <div><div class="liveName">${esc(g.title)}${chip}</div><div class="liveSub">${sub} · ${ago(g.at || now)}</div></div>
        <div class="liveAct"><a class="btn" href="../${esc(g.id)}/?resume">${g.status === 'over' ? 'Open' : 'Resume'}</a><button class="link" type="button" data-forget="${esc(g.id)}">Forget</button></div>
      </div>`;
    }).join('') + '</div>';
  }

  // ---------- scoreboard ----------
  function renderScore() {
    const s = hub.summary();
    if (!s.total) {
      $('score').innerHTML = '<p class="empty">No finished games yet. Every game you finish on this device is counted here.</p>';
      $('scoreNote').textContent = '';
      return;
    }
    $('scoreNote').textContent = `${s.total} game${s.total === 1 ? '' : 's'} · records read wins–losses–draws`;
    const opp = Object.values(s.byOpponent).sort((a, b) => (b.w + b.l + b.d) - (a.w + a.l + a.d) || b.last - a.last);
    const games = Object.entries(s.byGame).sort((a, b) => b[1].last - a[1].last);
    const levelText = (g) => ['easy', 'normal', 'hard'].filter((l) => g.levels[l].w + g.levels[l].l + g.levels[l].d)
      .map((l) => `${l[0].toUpperCase()}${l.slice(1)} ${hub.formatRecord(g.levels[l])}`).join(' · ');

    let html = `<div class="totals">
      <div class="total"><b>${rec(s.online)}</b><span>Against people online</span></div>
      <div class="total"><b>${rec(s.solo)}</b><span>Against the computer</span></div>
    </div>`;
    if (opp.length) {
      html += `<div class="sub">Head to head</div><div class="scroll"><table class="table"><thead><tr><th>Opponent</th><th>Record</th><th>Games</th><th>Last played</th></tr></thead><tbody>` +
        opp.map((o) => `<tr><td class="name">${esc(o.name)}</td><td>${hub.formatRecord(o)}</td><td>${o.w + o.l + o.d}</td><td class="dim">${ago(o.last)}</td></tr>`).join('') + '</tbody></table></div>';
    }
    html += `<div class="sub">By game</div><div class="scroll"><table class="table"><thead><tr><th>Game</th><th>Online</th><th>Computer</th><th>By level</th></tr></thead><tbody>` +
      games.map(([id, g]) => `<tr><td class="name">${emojiOf(id)} ${esc(g.title)}${g.coop ? ' <span class="dim">(team)</span>' : ''}</td><td>${rec(g.online)}</td><td>${rec(g.solo)}</td><td class="dim">${levelText(g) || '–'}</td></tr>`).join('') +
      '</tbody></table></div>';
    $('score').innerHTML = html;
  }

  // ---------- recent ----------
  function renderRecent() {
    const list = hub.results().slice(-12).reverse();
    if (!list.length) {
      $('recent').innerHTML = '<p class="empty">Nothing yet.</p>';
      return;
    }
    const label = { win: 'Win', loss: 'Loss', draw: 'Draw' };
    $('recent').innerHTML = '<div class="recent">' + list.map((r) => {
      const against = r.mode === 'solo' ? `vs the computer${r.level ? ` (${esc(r.level)})` : ''}` : r.coop ? `with ${esc(r.opponent)}` : `vs ${esc(r.opponent)}`;
      const detail = r.detail ? ` · ${esc(WHY[r.detail] || r.detail)}` : '';
      return `<div class="recentRow"><span class="when">${ago(r.at)}</span><span class="what">${emojiOf(r.game)} ${esc(r.title || r.game)} <small>${against}${detail}</small></span><span class="chip ${esc(r.outcome)}">${label[r.outcome] || ''}</span></div>`;
    }).join('') + '</div>';
  }

  // ---------- start something ----------
  function renderGames() {
    $('games').innerHTML = GAMES.map((g) => `<a class="game" href="../${esc(g.id)}/"><span class="emoji" aria-hidden="true">${g.emoji}</span><b>${esc(g.title)}</b><span>${esc(g.blurb)}</span></a>`).join('') +
      '<a class="game" href="../Games"><span class="emoji" aria-hidden="true">📚</span><b>Game list</b><span>Your collection, plays and what to play next</span></a>';
  }

  // ---------- alert settings ----------
  function initPrefs() {
    const prefs = hub.prefs();
    $('prefSound').checked = prefs.sound;
    $('prefTitle').checked = prefs.title;
    const supported = typeof Notification !== 'undefined';
    const note = $('notifyNote');
    $('prefNotify').disabled = !supported;
    $('prefNotify').checked = supported && prefs.notify && Notification.permission === 'granted';
    if (!supported) note.textContent = 'This browser can’t show desktop notifications.';
    else if (Notification.permission === 'denied') note.textContent = 'Notifications are blocked for this site in your browser settings.';

    $('prefSound').addEventListener('change', (e) => hub.setPrefs({ sound: e.target.checked }));
    $('prefTitle').addEventListener('change', (e) => hub.setPrefs({ title: e.target.checked }));
    $('prefNotify').addEventListener('change', async (e) => {
      if (!e.target.checked) return hub.setPrefs({ notify: false });
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      const ok = permission === 'granted';
      e.target.checked = ok;
      hub.setPrefs({ notify: ok });
      note.textContent = ok ? '' : 'Notifications are blocked for this site in your browser settings.';
    });
  }

  function render() {
    renderNow();
    renderScore();
    renderRecent();
  }

  function boot() {
    if (!hub) {
      document.querySelector('.wrap').insertAdjacentHTML('beforeend', '<p class="note">This browser is blocking site storage, so there is nothing to show here.</p>');
      return;
    }
    renderGames();
    initPrefs();
    render();
    // Another tab (a game in progress) updates this page as it goes.
    window.addEventListener('storage', render);
    setInterval(render, 60000);

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-forget]');
      if (!btn) return;
      const game = BY_ID[btn.dataset.forget];
      if (!confirm(`Forget this ${game ? game.title : 'game'}? Its saved progress on this device will be deleted.`)) return;
      hub.clear(btn.dataset.forget);
      if (game) { try { localStorage.removeItem(game.sessionKey); } catch (_) { /* nothing to remove */ } }
      render();
    });
    $('clearBtn').addEventListener('click', () => {
      if (!confirm('Clear every result from the scoreboard? This can’t be undone.')) return;
      hub.clearResults();
      render();
    });
  }

  boot();
})();
