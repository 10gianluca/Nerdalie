/* UI controller: screens, rendering, and wiring game actions to the network. */
(function () {
  'use strict';

  const G = window.Onitama;
  const Bot = window.OnitamaBot;
  const Net = window.OnitamaNet;
  const { SIZE, CARDS } = G;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SESSION_KEY = 'onitama.session';
  const hub = window.NerdalieHub ? window.NerdalieHub.game('onitama', 'Onitama') : null;

  const app = {
    role: null, // 'host' | 'guest'
    solo: false, // playing against the computer: this browser is the host, with no network
    seat: 0,
    session: null, // persisted: { role, code, name, token | guestToken, state }
    state: null, // the full state (Onitama has no hidden information)
    net: null,
    connected: false,
    guestLink: null,
    card: null, // the card picked from your hand
    from: null, // the pawn picked, as [x, y]
    pending: null, // moves that could be played with either card, waiting for you to say which
    busy: false,
    overShown: false,
    hostRetries: 0,
  };

  // ---------- helpers ----------
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2800);
  }

  function show(screen) {
    for (const id of ['home', 'lobby', 'game']) $(id).hidden = id !== screen;
  }

  function myToken() {
    let t = store.get('onitama.token');
    if (!t) {
      t = (crypto.randomUUID && crypto.randomUUID()) || Net.makeCode(16);
      store.set('onitama.token', t);
    }
    return t;
  }

  function saveSession() {
    if (app.role === 'host') app.session.state = app.state;
    store.set(SESSION_KEY, app.session);
  }

  const view = () => app.state;

  function inviteUrl(code) {
    const url = new URL(location.href);
    url.search = '?join=' + code;
    url.hash = '';
    return url.toString();
  }

  function clearPicks() {
    app.card = null;
    app.from = null;
    app.pending = null;
  }

  // ---------- actions ----------
  function act(action) {
    if (!app.state) return;
    clearPicks();
    if (app.role === 'host') return applyAction(0, action);
    if (app.busy) return;
    if (!app.connected) return toast('Reconnecting… try again in a moment');
    app.busy = true;
    app.net.send({ t: 'act', action });
    render();
    setTimeout(() => { if (app.busy) { app.busy = false; render(); } }, 4000);
  }

  function applyAction(player, action) {
    try {
      app.state = G.apply(app.state, player, action);
    } catch (e) {
      if (player === 0) toast(e.message);
      else if (app.solo) console.warn("The computer's move was rejected:", e.message);
      else app.net.send({ t: 'error', message: e.message });
      render();
      return;
    }
    saveSession();
    pushState();
    render();
    scheduleBot();
  }

  function pushState() {
    if (app.state && app.guestLink) app.guestLink.send({ t: 'state', state: G.viewFor(app.state, 1) });
  }

  // ---------- hosting ----------
  function startHost(session) {
    app.role = 'host';
    app.seat = 0;
    app.session = session;
    app.state = session.state || null;
    app.connected = false;
    app.guestLink = null;
    saveSession();

    if (app.state) { show('game'); render(); } else showLobby('Opening room…');

    app.net = Net.hostRoom(session.code, {
      onReady: () => {
        app.hostRetries = 0;
        if (!app.state) showLobby('Waiting for your friend to join…');
        render();
      },
      onGuestMessage: hostReceive,
      onGuestLost: () => {
        app.connected = false;
        app.guestLink = null;
        render();
      },
      onError: (err, text) => {
        if (err.type !== 'unavailable-id') return toast(text);
        app.net.destroy();
        // Our own previous connection may still hold the code for a few seconds after a reload.
        if (app.hostRetries++ < 8) {
          setTimeout(() => app.session === session && startHost(session), 2500);
        } else if (!session.state) {
          session.code = Net.makeCode();
          app.hostRetries = 0;
          startHost(session);
        } else {
          toast(text);
        }
      },
    });
  }

  function hostReceive(msg, link) {
    const s = app.session;
    if (msg.t === 'hello') {
      const name = String(msg.name || 'Friend').slice(0, 16);
      const known = msg.token === s.guestToken;
      if (!known && s.guestToken && app.connected) {
        link.send({ t: 'full' });
        return;
      }
      s.guestToken = msg.token;
      link.accept();
      app.guestLink = link;
      app.connected = true;
      if (!app.state) {
        app.state = G.newGame([s.name, name], Math.random() < 0.5 ? 0 : 1);
        show('game');
      } else {
        app.state.players[1].name = name;
      }
      saveSession();
      link.send({ t: 'welcome', seat: 1 });
      pushState();
      render();
      if (!known) toast(`${name} joined`);
    } else if (msg.t === 'act' && link === app.guestLink && msg.action) {
      applyAction(1, msg.action);
    }
  }

  // ---------- solo: play against the computer ----------
  const LEVEL_KEY = 'onitama.level';
  const LEVELS = ['easy', 'normal', 'hard'];
  let botTimer = null;

  // The computer is player 1. After every action it checks whether it has something to do and answers after a pause.
  function scheduleBot() {
    clearTimeout(botTimer);
    if (!app.solo || !app.state || app.state.phase !== 'play' || app.state.active !== 1) return;
    const level = app.session.level || 'normal';
    botTimer = setTimeout(() => {
      if (!app.solo || !app.state) return;
      const action = Bot.choose(app.state, 1, Math.random, level);
      if (action) applyAction(1, action);
    }, 850);
  }

  function startSolo(session) {
    app.role = 'host';
    app.solo = true;
    app.seat = 0;
    app.session = session;
    app.net = null;
    app.guestLink = null;
    app.connected = true;
    app.state = session.state || G.newGame([session.name, 'Computer'], Math.random() < 0.5 ? 0 : 1);
    saveSession();
    show('game');
    render();
    scheduleBot();
  }

  function initLevels() {
    const saved = store.get(LEVEL_KEY);
    const current = LEVELS.includes(saved) ? saved : 'normal';
    const chips = document.querySelectorAll('.levels .lvl');
    for (const chip of chips) {
      chip.classList.toggle('on', chip.dataset.level === current);
      chip.addEventListener('click', () => {
        for (const c of chips) c.classList.toggle('on', c === chip);
        store.set(LEVEL_KEY, chip.dataset.level);
      });
    }
  }

  const chosenLevel = () => {
    const on = document.querySelector('.levels .lvl.on');
    return on ? on.dataset.level : 'normal';
  };

  // ---------- joining ----------
  function startGuest(session) {
    app.role = 'guest';
    app.seat = 1;
    app.session = session;
    app.state = null;
    app.connected = false;
    saveSession();
    showLobby('Joining…');

    app.net = Net.joinRoom(session.code, {
      onOpen: () => app.net.send({ t: 'hello', name: session.name, token: session.token }),
      onMessage: (msg) => {
        if (msg.t === 'state') {
          app.state = msg.state;
          app.connected = true;
          app.busy = false;
          show('game');
          render();
        } else if (msg.t === 'welcome') {
          app.connected = true;
        } else if (msg.t === 'error') {
          app.busy = false;
          toast(msg.message);
          render();
        } else if (msg.t === 'full') {
          toast('That game already has two players');
          leave(true);
        }
      },
      onLost: () => {
        app.connected = false;
        render();
      },
      onError: (err, text) => {
        if (app.state) return render();
        showLobby(err.type === 'peer-unavailable' ? 'Room not found yet. Retrying… (check the code)' : text);
      },
    });
  }

  function leave(skipConfirm) {
    const running = app.state && app.state.phase !== 'over';
    if (!skipConfirm && running && !confirm(app.solo ? 'Leave this game? It will not be saved.' : 'Leave this game? Your opponent will be left waiting.')) return;
    if (app.net) app.net.destroy();
    clearTimeout(botTimer);
    Object.assign(app, { solo: false, role: null, session: null, state: null, net: null, connected: false, guestLink: null, busy: false });
    clearPicks();
    store.del(SESSION_KEY);
    if (hub) hub.leave();
    if ($('overDialog').open) $('overDialog').close();
    history.replaceState(null, '', location.pathname);
    document.title = 'Onitama Online';
    initHome();
    show('home');
  }

  // ---------- lobby ----------
  function showLobby(message) {
    show('lobby');
    $('lobbyCode').textContent = app.session.code;
    $('lobbyMsg').innerHTML = `<span class="spinner"></span>${esc(message)}`;
    const hosting = app.role === 'host';
    $('shareBtn').hidden = !hosting;
    $('copyBtn').hidden = !hosting;
  }

  async function copyInvite() {
    const url = inviteUrl(app.session.code);
    try {
      await navigator.clipboard.writeText(url);
      toast(location.protocol === 'file:' ? 'Copied. Tip: host the app online so the link works for your friend.' : 'Invite link copied');
    } catch (_) {
      prompt('Copy this link:', url);
    }
  }

  async function shareInvite() {
    const code = app.session.code;
    if (!navigator.share) return copyInvite();
    try {
      await navigator.share({ title: 'Onitama', text: `Play Onitama with me! Room code: ${code}`, url: inviteUrl(code) });
    } catch (_) { /* user closed the share sheet */ }
  }

  // ---------- rendering ----------
  const myTurn = (s) => s.phase === 'play' && s.active === app.seat;
  const cardName = (id) => CARDS[id].name;

  // Where a board square sits on this player's screen: your own side is always at the bottom.
  const screenOf = (x, y) => (app.seat === 0 ? { row: SIZE - 1 - y, col: x } : { row: y, col: SIZE - 1 - x });

  // One card with its little move diagram. `flip` draws it from the other player's side of the table.
  function cardHtml(id, o = {}) {
    const tag = o.pickable ? 'button' : 'div';
    const marks = new Set(CARDS[id].moves.map(([right, fwd]) => (o.flip ? `${2 - right},${2 + fwd}` : `${2 + right},${2 - fwd}`)));
    let cells = '';
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) cells += `<i class="${r === 2 && c === 2 ? 'me' : marks.has(`${c},${r}`) ? 'go' : ''}"></i>`;
    }
    const cls = ['ocard', o.pickable && 'pickable', o.sel && 'sel', o.side && 'side'].filter(Boolean).join(' ');
    return `<${tag} class="${cls}"${o.pickable ? ` data-card="${id}"` : ''} aria-label="${cardName(id)} card">` +
      `<div class="mini" aria-hidden="true">${cells}</div><b>${cardName(id)}</b></${tag}>`;
  }

  function renderScoreboard(s) {
    const me = app.seat;
    const opp = 1 - me;
    const who = (i, label, cls) =>
      `<div class="who${s.active === i && s.phase !== 'over' ? ' turn' : ''}"><span><i class="swatch ${cls}"></i>${esc(label)}</span><b>${s.wins[i]}</b><small>${s.wins[i] === 1 ? 'game won' : 'games won'}</small></div>`;
    $('scoreboard').innerHTML = who(me, 'You', 'mine') + `<div class="mid">Move<b>${s.turn}</b></div>` + who(opp, s.players[opp].name, 'theirs');
  }

  function renderCards(s, moves) {
    const me = app.seat;
    const opp = 1 - me;
    $('oppName').textContent = s.players[opp].name;
    $('myName').textContent = `${s.players[me].name} (you)`;
    $('oppCards').innerHTML = s.hands[opp].map((id) => cardHtml(id, { flip: true })).join('');
    const mine = myTurn(s) && !app.busy && moves.length > 0;
    $('myCards').innerHTML = s.hands[me].map((id) => cardHtml(id, { pickable: mine, sel: app.card === id })).join('');
    // the card beside the board goes to whoever moves next, so it is drawn from their side
    $('sideCard').innerHTML = cardHtml(s.side, { side: true, flip: s.active !== me });
    $('sideNote').textContent = s.phase === 'over' ? '' : s.active === me ? 'You take this after your move' : `${esc(s.players[s.active].name)} takes this after their move`;
  }

  function renderBoard(s, moves) {
    const me = app.seat;
    const mine = myTurn(s) && !app.busy;
    const usable = app.card ? moves.filter((m) => m.card === app.card) : moves;
    const targets = app.from ? usable.filter((m) => m.from[0] === app.from[0] && m.from[1] === app.from[1]) : [];
    const movable = new Set(usable.map((m) => G.at(m.from[0], m.from[1])));
    const targetAt = new Map(targets.map((m) => [G.at(m.to[0], m.to[1]), m]));
    const last = s.last && s.last.kind === 'move' ? [G.at(s.last.from[0], s.last.from[1]), G.at(s.last.to[0], s.last.to[1])] : [];
    const temples = G.TEMPLE.map(([x, y]) => G.at(x, y));

    const grid = Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = G.at(x, y);
        const piece = s.board[i];
        const { row, col } = screenOf(x, y);
        const go = targetAt.has(i);
        const sel = app.from && app.from[0] === x && app.from[1] === y;
        const can = mine && piece && piece.p === me && movable.has(i) && !app.from;
        const clickable = mine && (go || (piece && piece.p === me && movable.has(i)));
        const cls = ['cell', temples.includes(i) && 'temple', last.includes(i) && 'last', go && 'go', go && piece && 'hit', sel && 'sel', can && 'can', clickable && 'pick'].filter(Boolean).join(' ');
        const pawn = piece ? `<span class="pawn ${piece.p === me ? 'mine' : 'theirs'}${piece.m ? ' master' : ''}"></span>` : '';
        const label = `${piece ? `${piece.p === me ? 'Your' : 'Their'} ${piece.m ? 'master' : 'student'}` : 'Empty'}${go ? ', can move here' : ''}`;
        grid[row * SIZE + col] = `<button class="${cls}" data-x="${x}" data-y="${y}" role="gridcell" aria-label="${label}">${pawn}</button>`;
      }
    }
    $('board').innerHTML = grid.join('');
  }

  function renderBar(s, moves) {
    const active = myTurn(s);
    const other = esc(s.players[s.active].name);
    const btn = (a, label, cls = '', data = '') => `<button class="btn small ${cls}" data-act="${a}" ${data}${app.busy ? ' disabled' : ''}>${label}</button>`;
    let status = '';
    let sub = '';
    let actions = '';
    if (s.phase === 'over') {
      status = 'Game over';
      actions = btn('results', 'See result', 'primary');
    } else if (!active) {
      status = `${other} is thinking…`;
    } else if (!moves.length) {
      status = 'You have no move. Swap a card and pass.';
      actions = s.hands[app.seat].map((id) => btn('pass', `Swap ${cardName(id)}`, 'primary', `data-card="${id}"`)).join('');
    } else if (app.pending) {
      status = 'Which card do you want to use?';
      actions = app.pending.map((m) => btn('use', `Use ${cardName(m.card)}`, 'primary', `data-card="${m.card}"`)).join('') + btn('clear', 'Cancel', 'ghost');
    } else if (app.from) {
      status = 'Tap a highlighted square';
      sub = app.card ? `Using the ${cardName(app.card)}.` : 'Both cards are shown. Pick a card to narrow it down.';
      actions = btn('clear', 'Cancel', 'ghost');
    } else if (app.card) {
      status = `${cardName(app.card)}: tap a glowing pawn`;
      actions = btn('clear', 'Cancel', 'ghost');
    } else {
      status = 'Your move';
      sub = 'Pick one of your cards, then a pawn. Or tap a pawn first.';
    }
    $('status').textContent = status;
    $('sub').textContent = sub;
    $('sub').hidden = !sub;
    $('actions').innerHTML = actions;
  }

  function renderLast(s) {
    const L = s.last;
    if (!L) return ($('lastTurn').textContent = '');
    const who = L.who === app.seat ? 'You' : s.players[L.who].name;
    if (L.kind === 'pass') $('lastTurn').textContent = `Last move: ${who} had no move and swapped the ${cardName(L.card)}.`;
    else $('lastTurn').textContent = `Last move: ${who} moved a ${L.master ? 'master' : 'student'} with the ${cardName(L.card)}${L.capture ? `, capturing a ${L.capture}` : ''}.`;
  }

  function renderNet(s) {
    $('roomLabel').textContent = app.solo ? 'Solo ·' : 'Room';
    $('roomCode').textContent = app.solo ? (app.session.level || 'normal') : app.session.code;
    $('netDot').classList.toggle('off', !app.connected);
    const banner = $('netBanner');
    banner.hidden = app.connected;
    if (!app.connected) {
      banner.textContent = app.role === 'host'
        ? `${s.players[1].name} is disconnected. Waiting for them to rejoin…`
        : 'Connection lost. Reconnecting…';
    }
  }

  function render() {
    const s = view();
    if (!s || $('game').hidden) return;
    const me = app.seat;
    if (!myTurn(s)) clearPicks();
    const moves = myTurn(s) ? G.legalMoves(s, me) : [];
    // drop picks that no longer make sense
    if (app.card && !s.hands[me].includes(app.card)) app.card = null;
    renderScoreboard(s);
    renderCards(s, moves);
    renderBoard(s, moves);
    renderBar(s, moves);
    renderLast(s);
    renderNet(s);

    const needsMe = myTurn(s);
    document.title = needsMe ? '🥋 Your move · Onitama' : 'Onitama Online';
    if (hub) hub.sync({ needsMe, over: s.phase === 'over', solo: app.solo, opponent: s.players[1 - me].name, level: app.session && app.session.level, code: app.session && app.session.code });

    if (s.phase === 'over' && !app.overShown) {
      app.overShown = true;
      if (hub && app.session && !app.session.recorded) {
        app.session.recorded = true;
        store.set(SESSION_KEY, app.session);
        hub.finish({ mode: app.solo ? 'solo' : 'online', level: app.solo ? app.session.level : '', opponent: app.solo ? 'Computer' : s.players[1 - me].name, outcome: s.end.winner === me ? 'win' : 'loss', detail: s.end.reason === 'stone' ? 'master captured' : 'temple reached' });
      }
      setTimeout(openOver, 900);
    } else if (s.phase !== 'over') {
      app.overShown = false;
      if (app.session) app.session.recorded = false;
      if ($('overDialog').open) $('overDialog').close();
    }
  }

  function openOver() {
    const s = view();
    if (!s || s.phase !== 'over') return;
    const me = app.seat;
    const winner = s.end.winner;
    const oppName = s.players[1 - me].name;
    $('overTitle').textContent = winner === me ? 'You win! 🎉' : `${oppName} wins`;
    const who = winner === me ? 'You' : oppName;
    $('overWhy').textContent = s.end.reason === 'stone'
      ? `${who} captured the other master (the Way of the Stone).`
      : `${who} moved the master onto the temple (the Way of the Stream).`;
    if (!$('overDialog').open) $('overDialog').showModal();
  }

  // ---------- events ----------
  function requireName() {
    const name = $('nameInput').value.trim().slice(0, 16);
    if (!name) {
      toast('Enter your name first');
      $('nameInput').focus();
      return null;
    }
    store.set('onitama.name', name);
    return name;
  }

  function onlineReady() {
    if (typeof Peer !== 'undefined') return true;
    toast('Online play needs an internet connection');
    return false;
  }

  function initHome() {
    $('nameInput').value = store.get('onitama.name') || store.get('jaipur.name') || store.get('lostcities.name') || store.get('agentavenue.name') || store.get('qwinto.name') || '';
    const join = Net.normalizeCode(new URLSearchParams(location.search).get('join'));
    if (join) $('codeInput').value = join;
    const saved = store.get(SESSION_KEY);
    $('resumeBtn').hidden = !saved;
    if (saved) $('resumeBtn').textContent = saved.role === 'solo' ? 'Resume your solo game' : `Resume game in room ${saved.code}`;
  }

  $('createBtn').addEventListener('click', () => {
    const name = requireName();
    if (!name || !onlineReady()) return;
    startHost({ role: 'host', code: Net.makeCode(), name, guestToken: null, state: null });
  });

  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = requireName();
    const code = Net.normalizeCode($('codeInput').value);
    if (!name) return;
    if (code.length < 4) return toast('Enter the room code from your friend');
    if (!onlineReady()) return;
    startGuest({ role: 'guest', code, name, token: myToken() });
  });

  $('soloBtn').addEventListener('click', () => {
    const name = requireName();
    if (!name) return;
    startSolo({ role: 'solo', code: 'SOLO', name, level: chosenLevel(), state: null });
  });

  $('resumeBtn').addEventListener('click', () => {
    const saved = store.get(SESSION_KEY);
    if (saved && saved.role === 'solo') return startSolo(saved);
    if (!saved || !onlineReady()) return;
    if (saved.role === 'host') startHost(saved);
    else startGuest(saved);
  });

  $('shareBtn').addEventListener('click', shareInvite);
  $('copyBtn').addEventListener('click', copyInvite);
  $('cancelBtn').addEventListener('click', () => leave(true));
  $('leaveBtn').addEventListener('click', () => leave(false));

  // Picking a card: tap it again to put it down.
  $('myCards').addEventListener('click', (e) => {
    const card = e.target.closest('.ocard.pickable');
    const s = view();
    if (!card || !s || !myTurn(s)) return;
    app.card = app.card === card.dataset.card ? null : card.dataset.card;
    app.pending = null;
    if (app.from && app.card) {
      // keep the pawn only if this card can still move it
      const ok = G.legalMoves(s, app.seat).some((m) => m.card === app.card && m.from[0] === app.from[0] && m.from[1] === app.from[1]);
      if (!ok) app.from = null;
    }
    render();
  });

  $('board').addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    const s = view();
    if (!cell || !s || !myTurn(s) || app.busy) return;
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    const piece = s.board[G.at(x, y)];
    const moves = G.legalMoves(s, app.seat);
    const usable = app.card ? moves.filter((m) => m.card === app.card) : moves;

    if (piece && piece.p === app.seat) {
      if (app.from && app.from[0] === x && app.from[1] === y) app.from = null;
      else if (usable.some((m) => m.from[0] === x && m.from[1] === y)) app.from = [x, y];
      else toast(app.card ? `The ${cardName(app.card)} can't move that pawn` : 'That pawn has no move');
      app.pending = null;
      return render();
    }
    if (!app.from) return;
    const options = usable.filter((m) => m.from[0] === app.from[0] && m.from[1] === app.from[1] && m.to[0] === x && m.to[1] === y);
    if (!options.length) return;
    if (options.length === 1) return act({ type: 'move', card: options[0].card, from: options[0].from, to: options[0].to });
    app.pending = options; // either card gets there: ask which
    render();
  });

  $('bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const s = view();
    if (!b || !s) return;
    const a = b.dataset.act;
    if (a === 'clear') {
      clearPicks();
      render();
    } else if (a === 'use' && app.pending) {
      const m = app.pending.find((x) => x.card === b.dataset.card);
      if (m) act({ type: 'move', card: m.card, from: m.from, to: m.to });
    } else if (a === 'pass') {
      act({ type: 'pass', card: b.dataset.card });
    } else if (a === 'results') {
      openOver();
    }
  });

  $('rematchBtn').addEventListener('click', () => {
    $('overDialog').close();
    const s = view();
    if (s && s.phase === 'over') act({ type: 'rematch' });
  });
  $('closeOverBtn').addEventListener('click', () => $('overDialog').close());

  initLevels();
  initHome();
  // The Game Night page links here with ?resume to pick up a saved game without pressing the button.
  if (/[?&]resume\b/.test(location.search) && !$('resumeBtn').hidden) $('resumeBtn').click();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
  }
})();
