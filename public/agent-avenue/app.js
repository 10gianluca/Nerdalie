/* UI controller: screens, rendering, and wiring game actions to the network. */
(function () {
  'use strict';

  const G = window.AgentAvenue;
  const Net = window.AgentNet;
  const { TYPES, RULES } = G;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SESSION_KEY = 'agentavenue.session';

  const app = {
    role: null, // 'host' | 'guest'
    seat: 0,
    session: null, // persisted: { role, code, name, token | guestToken, state }
    state: null, // host: full state; guest: masked view from host
    net: null,
    connected: false,
    guestLink: null,
    sel: [], // hand cards tapped for the offer: first = face-up, second = face-down
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
    let t = store.get('agentavenue.token');
    if (!t) {
      t = (crypto.randomUUID && crypto.randomUUID()) || Net.makeCode(16);
      store.set('agentavenue.token', t);
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
    Object.assign(app, { role: null, session: null, state: null, net: null, connected: false, guestLink: null, sel: [], busy: false });
    store.del(SESSION_KEY);
    if ($('overDialog').open) $('overDialog').close();
    history.replaceState(null, '', location.pathname);
    document.title = 'Agent Avenue Online';
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
      await navigator.share({ title: 'Agent Avenue', text: `Play Agent Avenue with me! Room code: ${code}`, url: inviteUrl(code) });
    } catch (_) { /* user closed the share sheet */ }
  }

  // ---------- rendering: cards ----------
  const iconClass = (ic) => (ic === 'win' ? 'win' : ic === 'lose' ? 'lose' : ic > 0 ? 'pos' : ic < 0 ? 'neg' : 'zero');
  const iconText = (ic) => (ic === 'win' ? '✓' : ic === 'lose' ? '✗' : ic < 0 ? `−${Math.abs(ic)}` : String(ic));
  const cardName = (id) => TYPES[G.typeOf(id)].name;

  // tier = which of the three numbers would apply to you if you got one more of this agent
  function tierFor(s, seat, id) {
    const key = G.typeOf(id);
    return Math.min(G.countOf(s, seat, key) + 1, TYPES[key].icons.length) - 1;
  }

  function cardHtml(id, o = {}) {
    const tag = o.pickable ? 'button' : 'div';
    const attrs = `${o.id ? ` data-id="${o.id}"` : ''}${o.pick ? ` data-pick="${o.pick}"` : ''}`;
    if (!id) return `<${tag} class="acard back${o.pickable ? ' pickable' : ''}"${attrs} aria-label="Face-down card"><span>Agent<br>Avenue</span></${tag}>`;
    const key = G.typeOf(id);
    const t = TYPES[key];
    const labels = ['1st', '2nd', '3+'];
    const rows = t.icons.map((ic, i) =>
      `<span class="arow${o.tier === i ? ' now' : ''}">${t.icons.length > 1 ? `<i>${labels[i]}</i>` : ''}<b class="ic ${iconClass(ic)}">${iconText(ic)}</b></span>`).join('');
    const cls = ['acard', 't-' + key, o.pickable && 'pickable', o.sel && 'sel'].filter(Boolean).join(' ');
    const label = `${t.name}: ${t.icons.map(iconText).join(', ')}`;
    return `<${tag} class="${cls}"${attrs} aria-label="${label}"><span class="ahead">${t.name}</span><span class="rows">${rows}</span>${o.badge ? `<span class="badge">${o.badge}</span>` : ''}</${tag}>`;
  }

  // ---------- rendering: track ----------
  const N = RULES.board;
  const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / N;
  const pt = (i) => [120 + 92 * Math.cos(ang(i)), 120 + 92 * Math.sin(ang(i))];

  function buildTrack() {
    let svg = '';
    for (let i = 0; i < N; i++) {
      const [x, y] = pt(i);
      const home = i === 0 || i === RULES.startGap;
      svg += `<circle class="space${home ? ' home' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${home ? 11 : 8}"/>`;
    }
    svg += `<text class="center" x="120" y="114">↻ clockwise</text><text class="center" x="120" y="130">${N} spaces</text>`;
    for (const i of [0, 1]) svg += `<g class="meeple" id="meeple${i}"><circle r="13"/><text></text></g>`;
    $('track').innerHTML = svg;
  }

  function updateTrack(s) {
    const spot = [0, 1].map((i) => ((s.pos[i] % N) + N) % N);
    [0, 1].forEach((i) => {
      let [x, y] = pt(spot[i]);
      if (spot[0] === spot[1]) x += i === 0 ? -8 : 8; // only happens at the very end of a game
      const g = $('meeple' + i);
      g.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      g.querySelector('circle').style.fill = i === app.seat ? 'var(--me)' : 'var(--them)';
      g.querySelector('text').textContent = (s.players[i].name[0] || '?').toUpperCase();
    });
    const me = app.seat;
    const opp = 1 - me;
    const mine = Math.max(0, G.distanceToCatch(s, me));
    const theirs = Math.max(0, G.distanceToCatch(s, opp));
    $('gapInfo').innerHTML =
      `<span class="me">You are <b>${mine}</b> from catching ${esc(s.players[opp].name)}</span>` +
      `<span class="them">${esc(s.players[opp].name)} is <b>${theirs}</b> from catching you</span>`;
  }

  // ---------- rendering: table, play areas, hand ----------
  function renderPlay(el, s, seat) {
    const play = s.players[seat].play;
    if (!play.length) return ($(el).innerHTML = '<span class="empty">Nothing yet</span>');
    $(el).innerHTML = Object.keys(TYPES)
      .filter((key) => G.countOf(s, seat, key) > 0)
      .map((key) => {
        const n = G.countOf(s, seat, key);
        const icons = TYPES[key].icons;
        let next = '';
        let flag = '';
        if (icons.length > 1) {
          const nx = icons[Math.min(n + 1, icons.length) - 1];
          next = nx === 'win' ? 'next: wins!' : nx === 'lose' ? 'next: loses!' : `next ${iconText(nx)}`;
          flag = nx === 'win' ? ' hot' : nx === 'lose' ? ' danger' : '';
        }
        return `<span class="chip t-${key}${flag}"><span class="n">×${n}</span>${TYPES[key].name}${next ? `<span class="next">${next}</span>` : ''}</span>`;
      })
      .join('');
  }

  function renderHand(s) {
    const me = app.seat;
    const hand = s.players[me].hand;
    const myTurn = s.phase === 'offer' && s.active === me;
    app.sel = myTurn ? app.sel.filter((id) => hand.includes(id)) : [];
    $('hand').innerHTML = hand.map((id) => {
      const at = app.sel.indexOf(id);
      return cardHtml(id, { id, tier: tierFor(s, me, id), pickable: myTurn && !app.busy, sel: at >= 0, badge: at === 0 ? 'UP' : at === 1 ? 'DOWN' : '' });
    }).join('') || '<span class="empty">No cards left</span>';
    $('deckInfo').textContent = `Deck ${s.deckCount} · ${RULES.swaps - s.players[me].swaps} redraws left`;
  }

  function renderTable(s) {
    const me = app.seat;
    const active = s.active === me;
    const activeName = s.players[s.active].name;
    const btn = (a, label, cls = '', extra = '') => `<button class="btn ${cls}" data-act="${a}"${app.busy || extra ? ' disabled' : ''}>${label}</button>`;
    const hand = s.players[me].hand;
    let status = '';
    let sub = '';
    let offer = '';
    let actions = '';

    if (s.phase === 'offer') {
      if (active) {
        const legal = app.sel.length === 2 && G.legalPair(hand, app.sel[0], app.sel[1]);
        const swapsLeft = RULES.swaps - s.players[me].swaps;
        status = 'Your turn: split two cards';
        sub = 'Tap two cards. The first goes face-up, the second face-down.';
        if (app.sel.length === 2) {
          if (!legal) sub = 'The two cards need different names.';
          actions = btn('offer', 'Play these two', 'primary', legal ? '' : 'x') + btn('flip', 'Flip up/down') + btn('clear', 'Clear', 'ghost');
        } else if (app.sel.length === 1) {
          sub = 'Pick a second card, or discard this one and redraw.';
          actions = btn('swap', `Discard & redraw (${swapsLeft} left)`, '', swapsLeft > 0 && s.deckCount > 0 ? '' : 'x') + btn('clear', 'Clear', 'ghost');
        }
      } else {
        status = `${activeName} is choosing two cards…`;
      }
    } else if (s.phase === 'choose') {
      const up = s.offer.up;
      if (active) {
        status = `Waiting for ${s.players[1 - me].name} to choose…`;
        sub = 'They see your face-up card, but not your face-down one.';
        offer = `<div class="slot"><small>Face-up</small>${cardHtml(up)}</div><div class="slot"><small>Face-down</small>${cardHtml(s.offer.down)}</div>`;
      } else {
        status = `Pick a card from ${activeName}`;
        sub = `You take the one you pick. ${activeName} keeps the other.`;
        offer = `<div class="slot"><small>Face-up</small>${cardHtml(up, { pickable: !app.busy, pick: 'up', tier: tierFor(s, me, up) })}</div>` +
          `<div class="slot"><small>Face-down</small>${cardHtml(null, { pickable: !app.busy, pick: 'down' })}</div>`;
      }
    } else if (s.phase === 'over') {
      status = 'Game over';
      actions = btn('results', 'See results', 'primary');
    }

    $('status').textContent = status;
    $('substatus').textContent = sub;
    $('offer').innerHTML = offer;
    $('actions').innerHTML = actions;
  }

  function renderLast(s) {
    const L = s.last;
    if (!L) return ($('lastTurn').textContent = '');
    const who = (i) => (i === app.seat ? 'You' : s.players[i].name);
    const mv = (i) => {
      const you = i === app.seat;
      const m = L.info[i].move;
      if (m === 0) return you ? 'stay put' : 'stays put';
      return `${you ? 'move' : 'moves'} ${m > 0 ? '+' : '−'}${Math.abs(m)}`;
    };
    const a = L.active;
    const c = L.chooser;
    $('lastTurn').textContent =
      `Last turn: ${who(a)} offered ${cardName(L.up)} (up) and ${cardName(L.down)} (down). ` +
      `${who(c)} took the ${cardName(L.info[c].card)} and ${mv(c)}; ${who(a)} kept the ${cardName(L.info[a].card)} and ${mv(a)}.`;
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
    const opp = 1 - me;
    $('myName').textContent = `${s.players[me].name} (you)`;
    $('oppName').textContent = s.players[opp].name;
    updateTrack(s);
    renderPlay('oppPlay', s, opp);
    renderPlay('myPlay', s, me);
    renderHand(s);
    renderTable(s);
    renderLast(s);
    renderNet(s);

    const needsMe = (s.phase === 'offer' && s.active === me) || (s.phase === 'choose' && s.active !== me);
    document.title = needsMe ? '🕵️ Your move · Agent Avenue' : 'Agent Avenue Online';

    if (s.phase === 'over' && !app.overShown) {
      app.overShown = true;
      setTimeout(openOver, 900);
    } else if (s.phase !== 'over') {
      app.overShown = false;
      if ($('overDialog').open) $('overDialog').close();
    }
  }

  function openOver() {
    const s = view();
    if (!s || s.phase !== 'over') return;
    const me = app.seat;
    const win = s.end.winner;
    const lose = 1 - win;
    const who = (i) => (i === me ? 'You' : s.players[i].name);
    const whom = (i) => (i === me ? 'you' : s.players[i].name);
    $('overTitle').textContent = win === me ? 'You win! 🎉' : `${s.players[win].name} wins`;
    const why = {
      catch: `${who(win)} caught ${whom(lose)}!`,
      'win-set': `${who(win)} collected 3 Codebreakers.`,
      'lose-set': `${who(lose)} collected 3 Daredevils and lost.`,
      deck: `The deck ran out. ${who(win)} ${win === me ? 'were' : 'was'} closer to catching the other.`,
    };
    $('overWhy').textContent = why[s.end.reason];
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
    store.set('agentavenue.name', name);
    return name;
  }

  function onlineReady() {
    if (typeof Peer !== 'undefined') return true;
    toast('Online play needs an internet connection');
    return false;
  }

  function initHome() {
    $('nameInput').value = store.get('agentavenue.name') || store.get('qwinto.name') || '';
    const join = Net.normalizeCode(new URLSearchParams(location.search).get('join'));
    if (join) $('codeInput').value = join;
    const saved = store.get(SESSION_KEY);
    $('resumeBtn').hidden = !saved;
    if (saved) $('resumeBtn').textContent = `Resume game in room ${saved.code}`;
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
    const card = e.target.closest('.acard.pickable');
    if (!card) return;
    const id = card.dataset.id;
    if (app.sel.includes(id)) app.sel = app.sel.filter((x) => x !== id);
    else if (app.sel.length < 2) app.sel.push(id);
    else return toast('Deselect a card first: you play two');
    render();
  });

  $('offer').addEventListener('click', (e) => {
    const card = e.target.closest('[data-pick]');
    if (card && !app.busy) act({ type: 'choose', pick: card.dataset.pick });
  });

  $('actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'offer' && app.sel.length === 2) {
      const [up, down] = app.sel;
      app.sel = [];
      act({ type: 'offer', up, down });
    } else if (a === 'swap' && app.sel.length === 1) {
      const card = app.sel[0];
      app.sel = [];
      act({ type: 'swap', card });
    } else if (a === 'flip') {
      app.sel.reverse();
      render();
    } else if (a === 'clear') {
      app.sel = [];
      render();
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

  buildTrack();
  initHome();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
  }
})();
