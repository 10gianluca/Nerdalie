/* UI controller: screens, rendering, and wiring game actions to the network. */
(function () {
  'use strict';

  const G = window.Scout;
  const Net = window.ScoutNet;
  const { RULES } = G;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SESSION_KEY = 'scout.session';

  const app = {
    role: null, // 'host' | 'guest'
    seat: 0,
    session: null, // persisted: { role, code, name, token | guestToken, state }
    state: null, // host: full state; guest: masked view from host
    net: null,
    connected: false,
    guestLink: null,
    sel: null, // neighbouring hand cards tapped for a Show: { from, to }
    scout: null, // while placing a scouted card: { end: 'left' | 'right', flip }
    preFlip: false, // "turn hand over" preview before the round starts
    busy: false,
    overKey: null,
    hostRetries: 0,
  };

  // ---------- helpers ----------
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3200);
  }

  function show(screen) {
    for (const id of ['home', 'lobby', 'game']) $(id).hidden = id !== screen;
  }

  function myToken() {
    let t = store.get('scout.token');
    if (!t) {
      t = (crypto.randomUUID && crypto.randomUUID()) || Net.makeCode(16);
      store.set('scout.token', t);
    }
    return t;
  }

  function saveSession() {
    if (app.role === 'host') app.session.state = app.state;
    store.set(SESSION_KEY, app.session);
  }

  const view = () => (app.state && app.role === 'host' ? G.viewFor(app.state, 0) : app.state);

  function inviteUrl(code) {
    const url = new URL(location.href);
    url.search = '?join=' + code;
    url.hash = '';
    return url.toString();
  }

  // ---------- actions ----------
  function act(action) {
    if (!app.state) return;
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
      else app.net.send({ t: 'error', message: e.message });
      return;
    }
    saveSession();
    pushState();
    render();
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
    if (!skipConfirm && running && !confirm('Leave this game? Your opponent will be left waiting.')) return;
    if (app.net) app.net.destroy();
    Object.assign(app, { role: null, session: null, state: null, net: null, connected: false, guestLink: null, sel: null, scout: null, preFlip: false, busy: false, overKey: null });
    store.del(SESSION_KEY);
    if ($('overDialog').open) $('overDialog').close();
    history.replaceState(null, '', location.pathname);
    document.title = 'Scout Online';
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
      await navigator.share({ title: 'Scout', text: `Play Scout with me! Room code: ${code}`, url: inviteUrl(code) });
    } catch (_) { /* user closed the share sheet */ }
  }

  // ---------- rendering: cards ----------
  const num = (n) => (n < 0 ? '−' : '') + Math.abs(n);

  function cardHtml(c, o = {}) {
    const tag = o.pickable ? 'button' : 'div';
    const cls = ['scard', 'n' + c.up, o.big && 'big', o.pickable && 'pickable', o.sel && 'sel', o.dim && 'dim'].filter(Boolean).join(' ');
    const attrs = `${o.i != null ? ` data-i="${o.i}"` : ''}${o.scout ? ` data-scout="${o.scout}"` : ''}`;
    return `<${tag} class="${cls}"${attrs} aria-label="Card showing ${c.up}, other side ${c.down}">` +
      `<span class="up">${c.up}</span><span class="down">${c.down}</span></${tag}>`;
  }

  // "a run of 3 (4-5-6)", "a set of 2 (7s)", "a single 5"
  function describeCards(cards) {
    const cls = G.classify(cards);
    if (!cls) return `${cards.length} cards`;
    if (cls.count === 1) return `a single ${cards[0].up}`;
    if (cls.kind === 'set') return `a set of ${cls.count} (${cards[0].up}s)`;
    return `a run of ${cls.count} (${cards.map((c) => c.up).join('-')})`;
  }
  const kindText = (t) => (t.count === 1 ? 'single card' : `${t.kind} of ${t.count}`);

  // ---------- rendering: board ----------
  function renderScoreboard(s) {
    const me = app.seat;
    const opp = 1 - me;
    const chips = (p) =>
      `<span class="chips" aria-label="${p.chips} scout chips left">${Array.from({ length: RULES.chips }, (_, i) => `<i class="${i < p.chips ? '' : 'spent'}"></i>`).join('')}</span>`;
    const who = (i, cls, label) => {
      const p = s.players[i];
      const turn = s.phase === 'play' && s.active === i ? ' turn' : '';
      return `<div class="who ${cls}"><span class="nm${turn}">${esc(label)}</span>${chips(p)}<span class="meta">${p.hand.length} cards · ${p.won.length} won</span></div>`;
    };
    const match = s.history.length ? `Match<b>${num(s.totals[me])} – ${num(s.totals[opp])}</b>` : '';
    $('scoreboard').innerHTML = who(me, 'me', 'You') + `<div class="mid">Round<b>${s.round} of ${RULES.rounds}</b>${match}</div>` + who(opp, 'opp', s.players[opp].name);
    $('oppHand').innerHTML = s.players[opp].hand.map(() => '<span></span>').join('');
  }

  function renderTable(s) {
    const me = app.seat;
    const t = s.table;
    if (!t) {
      $('tableInfo').textContent = '';
      $('tableSet').innerHTML = `<span class="empty">${s.phase === 'play' ? 'Nothing on the table: the first show can be any set or run' : 'Nothing on the table yet'}</span>`;
      return;
    }
    const canScout = s.phase === 'play' && s.active === me && s.players[me].chips > 0 && !app.scout && !app.busy;
    const n = t.cards.length;
    const owner = t.owner === me ? 'Your' : `${s.players[t.owner].name}'s`;
    $('tableInfo').textContent = `${owner} ${kindText(t)}${canScout ? ' · tap an end card to scout it' : ''}`;
    $('tableSet').innerHTML = t.cards.map((c, i) => {
      const end = i === 0 ? 'left' : i === n - 1 ? 'right' : null;
      return cardHtml(c, { pickable: canScout && !!end, scout: end });
    }).join('');
  }

  // The hand as the player currently sees it (a "turn hand over" preview before the round starts).
  function shownHand(s) {
    const p = s.players[app.seat];
    if (s.phase !== 'orient' || p.ready) app.preFlip = false;
    return app.preFlip ? G.flipHand(p.hand) : p.hand;
  }

  function renderHand(s) {
    const me = app.seat;
    const hand = shownHand(s);
    const myTurn = s.phase === 'play' && s.active === me;
    if (!myTurn) { app.sel = null; app.scout = null; }
    if (app.sel && app.sel.to >= hand.length) app.sel = null;
    const inserting = !!app.scout;
    let html = '';
    for (let i = 0; i <= hand.length; i++) {
      if (inserting) html += `<button class="slot" data-slot="${i}" aria-label="Put the card here">+</button>`;
      if (i < hand.length) {
        const selected = !!app.sel && i >= app.sel.from && i <= app.sel.to;
        html += cardHtml(hand[i], { i, sel: selected, dim: inserting, pickable: myTurn && !inserting && !app.busy });
      }
    }
    $('hand').innerHTML = html || '<span class="empty">No cards left</span>';
    $('handInfo').textContent = inserting ? 'tap a gap to place the card' : myTurn ? 'tap neighbouring cards to show them' : '';
  }

  function scoutButtons(s) {
    if (!s.table) return '';
    return s.table.cards.length === 1
      ? '<button class="btn small" data-act="scoutL">Scout the card</button>'
      : '<button class="btn small" data-act="scoutL">Scout left card</button><button class="btn small" data-act="scoutR">Scout right card</button>';
  }

  function renderBar(s) {
    const me = app.seat;
    const opp = 1 - me;
    const p = s.players[me];
    const oppName = esc(s.players[opp].name);
    const btn = (a, label, cls = '', off = false) => `<button class="btn small ${cls}" data-act="${a}"${off || app.busy ? ' disabled' : ''}>${label}</button>`;
    let status = '';
    let preview = '';
    let actions = '';

    if (s.phase === 'orient') {
      if (!p.ready) {
        status = `Round ${s.round}: look at your hand. Turn it over if you prefer the other numbers.`;
        actions = btn('turn', app.preFlip ? 'Turn it back' : 'Turn hand over') + btn('ready', 'Ready', 'primary');
      } else {
        status = `Waiting for ${oppName} to get ready…`;
      }
    } else if (s.phase === 'play') {
      if (s.active !== me) {
        status = s.last && s.last.kind === 'scout' && s.last.who === s.active ? `${oppName} scouted and is still going…` : `${oppName} is playing…`;
      } else if (app.scout) {
        const t = s.table;
        const taken = app.scout.end === 'left' ? t.cards[0] : t.cards[t.cards.length - 1];
        const shown = app.scout.flip ? { up: taken.down, down: taken.up } : taken;
        status = 'Where should this card go? Tap a gap in your hand.';
        preview = cardHtml(shown, { big: true });
        actions = btn('flipcard', 'Flip the card') + btn('cancelscout', 'Cancel', 'ghost');
      } else {
        const hand = p.hand;
        const cards = app.sel ? hand.slice(app.sel.from, app.sel.to + 1) : [];
        const canScout = !!s.table && p.chips > 0;
        const chipsText = `${p.chips} chip${p.chips === 1 ? '' : 's'} left`;
        const again = s.last && s.last.kind === 'scout' && s.last.who === me ? 'You scouted, so keep going: ' : '';
        if (cards.length) {
          const problem = G.showProblem(cards, s.table);
          status = again + (problem || `Show ${describeCards(cards)}?`);
          actions = btn('show', `Show ${cards.length} card${cards.length === 1 ? '' : 's'}`, 'primary', !!problem) + (canScout ? scoutButtons(s) : '') + btn('clear', 'Clear', 'ghost');
        } else if (!s.table) {
          status = again + 'Your turn: show any set or run. Tap neighbouring cards in your hand.';
        } else {
          const owner = s.table.owner === me ? 'your' : `${oppName}'s`;
          const stuckNote = !G.canShow(hand, s.table) ? ' Nothing in your hand beats it, so you have to scout.' : '';
          status = `${again}Beat ${owner} ${kindText(s.table)}, or scout a card (${chipsText}).${stuckNote}`;
          actions = canScout ? scoutButtons(s) : '';
        }
      }
    } else {
      status = s.phase === 'over' ? 'Game over' : 'Round over';
      actions = btn('results', 'See results', 'primary');
    }
    $('status').textContent = status;
    $('preview').innerHTML = preview;
    $('actions').innerHTML = actions;
  }

  function renderLast(s) {
    const L = s.last;
    if (!L) return ($('lastTurn').textContent = '');
    const me = app.seat;
    const who = L.who === me ? 'You' : s.players[L.who].name;
    if (L.kind === 'show') {
      $('lastTurn').textContent = `Last move: ${who} showed ${describeCards(L.cards)}${L.captured ? ` and won ${L.captured} card${L.captured === 1 ? '' : 's'}` : ''}.`;
    } else {
      const from = L.who === me ? `${s.players[1 - me].name}'s` : 'your';
      $('lastTurn').textContent = `Last move: ${who} scouted the ${L.end} card (${L.card.up}) from ${from} set.`;
    }
  }

  function renderNet(s) {
    $('roomCode').textContent = app.session.code;
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
    renderHand(s);
    renderScoreboard(s);
    renderTable(s);
    renderBar(s);
    renderLast(s);
    renderNet(s);

    const needsMe = (s.phase === 'orient' && !s.players[me].ready) || (s.phase === 'play' && s.active === me);
    document.title = needsMe ? '🎪 Your move · Scout' : 'Scout Online';

    const key = s.phase === 'roundover' || s.phase === 'over' ? `${s.round}-${s.phase}` : null;
    if (key && key !== app.overKey) {
      app.overKey = key;
      setTimeout(openOver, 900);
    } else if (!key) {
      app.overKey = null;
      if ($('overDialog').open) $('overDialog').close();
    }
  }

  function openOver() {
    const s = view();
    if (!s || (s.phase !== 'roundover' && s.phase !== 'over')) return;
    const me = app.seat;
    const opp = 1 - me;
    const R = s.roundResult;
    const oppName = s.players[opp].name;
    const who = (i) => (i === me ? 'You' : s.players[i].name);
    const mine = R.players[me];
    const theirs = R.players[opp];

    if (s.phase === 'over') {
      const w = s.end.winner;
      $('overTitle').textContent = w === me ? 'You win! 🎉' : w === null ? "It's a tie: you share the win" : `${oppName} wins`;
    } else {
      $('overTitle').textContent = mine.total > theirs.total ? 'You win the round! 🎉' : mine.total < theirs.total ? `${oppName} wins the round` : 'The round is tied';
    }
    $('overWhy').textContent = R.reason === 'empty'
      ? `${who(R.owner)} went out.`
      : `${who(R.stuck)} couldn't beat the set and had no scout chips left.`;

    const row = (label, a, b, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
    $('overTable').innerHTML =
      `<tr><th></th><th>You</th><th>${esc(oppName)}</th></tr>` +
      row('Cards won', `+${mine.won}`, `+${theirs.won}`) +
      row('Scout chips left', `+${mine.chips}`, `+${theirs.chips}`) +
      row('Cards in hand', mine.penalty ? `−${mine.penalty}` : '0', theirs.penalty ? `−${theirs.penalty}` : '0') +
      row('This round', num(mine.total), num(theirs.total), 'total') +
      row('Match total', num(s.totals[me]), num(s.totals[opp]), 'match');
    $('nextBtn').textContent = s.phase === 'over' ? 'Play again' : `Start round ${s.round + 1}`;
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
    store.set('scout.name', name);
    return name;
  }

  function onlineReady() {
    if (typeof Peer !== 'undefined') return true;
    toast('Online play needs an internet connection');
    return false;
  }

  function initHome() {
    $('nameInput').value = store.get('scout.name') || store.get('lostcities.name') || store.get('agentavenue.name') || store.get('qwinto.name') || '';
    const join = Net.normalizeCode(new URLSearchParams(location.search).get('join'));
    if (join) $('codeInput').value = join;
    const saved = store.get(SESSION_KEY);
    $('resumeBtn').hidden = !saved;
    if (saved) $('resumeBtn').textContent = `Resume game in room ${saved.code}`;
  }

  // Tapping neighbouring cards builds one selection: it grows or shrinks from its ends, or restarts elsewhere.
  function tapCard(i) {
    const sel = app.sel;
    if (!sel) app.sel = { from: i, to: i };
    else if (i >= sel.from && i <= sel.to) {
      if (sel.from === sel.to) app.sel = null;
      else if (i === sel.from) app.sel = { from: i + 1, to: sel.to };
      else if (i === sel.to) app.sel = { from: sel.from, to: i - 1 };
      else app.sel = { from: i, to: i };
    } else if (i === sel.from - 1) app.sel = { from: i, to: sel.to };
    else if (i === sel.to + 1) app.sel = { from: sel.from, to: i };
    else app.sel = { from: i, to: i };
    render();
  }

  function startScout(end) {
    app.scout = { end, flip: false };
    app.sel = null;
    render();
    $('hand').scrollIntoView({ block: 'nearest' });
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

  $('resumeBtn').addEventListener('click', () => {
    const saved = store.get(SESSION_KEY);
    if (!saved || !onlineReady()) return;
    if (saved.role === 'host') startHost(saved);
    else startGuest(saved);
  });

  $('shareBtn').addEventListener('click', shareInvite);
  $('copyBtn').addEventListener('click', copyInvite);
  $('cancelBtn').addEventListener('click', () => leave(true));
  $('leaveBtn').addEventListener('click', () => leave(false));

  $('hand').addEventListener('click', (e) => {
    const slot = e.target.closest('.slot');
    if (slot && app.scout) {
      const { end, flip } = app.scout;
      app.scout = null;
      act({ type: 'scout', end, insertAt: Number(slot.dataset.slot), flip });
      return;
    }
    const card = e.target.closest('.scard.pickable');
    if (card) tapCard(Number(card.dataset.i));
  });

  $('tableSet').addEventListener('click', (e) => {
    const card = e.target.closest('[data-scout]');
    if (card && !app.busy) startScout(card.dataset.scout);
  });

  $('bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'show' && app.sel) {
      const { from, to } = app.sel;
      app.sel = null;
      act({ type: 'show', from, to });
    } else if (a === 'scoutL') {
      startScout('left');
    } else if (a === 'scoutR') {
      startScout('right');
    } else if (a === 'flipcard' && app.scout) {
      app.scout.flip = !app.scout.flip;
      render();
    } else if (a === 'cancelscout') {
      app.scout = null;
      render();
    } else if (a === 'clear') {
      app.sel = null;
      render();
    } else if (a === 'turn') {
      app.preFlip = !app.preFlip;
      render();
    } else if (a === 'ready') {
      act({ type: 'ready', flip: app.preFlip });
    } else if (a === 'results') {
      openOver();
    }
  });

  $('nextBtn').addEventListener('click', () => {
    $('overDialog').close();
    const s = view();
    if (!s) return;
    if (s.phase === 'over') act({ type: 'rematch' });
    else if (s.phase === 'roundover') act({ type: 'next' });
  });
  $('closeOverBtn').addEventListener('click', () => $('overDialog').close());

  initHome();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
  }
})();
