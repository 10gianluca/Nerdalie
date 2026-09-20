/* UI controller: screens, rendering, and wiring game actions to the network. */
(function () {
  'use strict';

  const G = window.LostCities;
  const Net = window.LostNet;
  const { RULES, COLORS } = G;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SESSION_KEY = 'lostcities.session';

  const app = {
    role: null, // 'host' | 'guest'
    seat: 0,
    session: null, // persisted: { role, code, name, token | guestToken, state }
    state: null, // host: full state; guest: masked view from host
    net: null,
    connected: false,
    guestLink: null,
    sel: null, // the hand card currently tapped
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
    let t = store.get('lostcities.token');
    if (!t) {
      t = (crypto.randomUUID && crypto.randomUUID()) || Net.makeCode(16);
      store.set('lostcities.token', t);
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
    Object.assign(app, { role: null, session: null, state: null, net: null, connected: false, guestLink: null, sel: null, busy: false });
    store.del(SESSION_KEY);
    if ($('overDialog').open) $('overDialog').close();
    history.replaceState(null, '', location.pathname);
    document.title = 'Lost Cities Online';
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
      await navigator.share({ title: 'Lost Cities', text: `Play Lost Cities with me! Room code: ${code}`, url: inviteUrl(code) });
    } catch (_) { /* user closed the share sheet */ }
  }

  // ---------- rendering: cards ----------
  const colorName = (id) => COLORS.find((c) => c.id === id).name;
  const cardLabel = (id) => {
    const p = G.parse(id);
    return `${colorName(p.color)} ${p.wager ? 'wager' : p.value}`;
  };
  const scoreText = (n) => (n < 0 ? '−' : n > 0 ? '+' : '') + Math.abs(n);
  const num = (n) => (n < 0 ? '−' : '') + Math.abs(n); // a plain number with a proper minus sign
  const symbol = (id) => {
    const p = G.parse(id);
    return p.wager ? '🤝' : String(p.value);
  };
  // Hand order: by colour, wagers first, then numbers rising.
  const handOrder = (id) => {
    const p = G.parse(id);
    return G.COLOR_IDS.indexOf(p.color) * 100 + (p.wager ? Number(id.split('-')[1].slice(1)) : p.value + 10);
  };

  function cardHtml(id, o = {}) {
    const p = G.parse(id);
    const tag = o.pickable ? 'button' : o.tag || 'div';
    const cls = ['lcard', 'c-' + p.color, p.wager && 'wager', o.pickable && 'pickable', o.sel && 'sel'].filter(Boolean).join(' ');
    return `<${tag} class="${cls}"${o.pickable ? ` data-id="${id}"` : ''} aria-label="${cardLabel(id)}">` +
      `<span class="v">${symbol(id)}</span><small>${p.wager ? 'Wager' : colorName(p.color)}</small></${tag}>`;
  }

  function expHtml(s, seat, target) {
    return COLORS.map(({ id, name }) => {
      const cards = s.players[seat].exp[id];
      const head = `<div class="chead"><span>${name}</span>${cards.length ? `<b>${scoreText(G.expeditionScore(cards))}</b>` : ''}</div>`;
      const chips = cards.map((c) => `<span class="chip">${symbol(c)}</span>`).join('');
      return `<div class="col c-${id}${target === id ? ' target' : ''}">${head}<div class="stack">${chips}</div></div>`;
    }).join('');
  }

  // ---------- rendering: board ----------
  function renderScoreboard(s) {
    const me = app.seat;
    const opp = 1 - me;
    const sc = [0, 1].map((i) => G.score(s, i).total);
    const who = (i, label) =>
      `<div class="who${s.active === i && s.phase !== 'over' ? ' turn' : ''}"><span>${esc(label)}</span><b class="${sc[i] < 0 ? 'neg' : ''}">${num(sc[i])}</b></div>`;
    // While a round is running the totals hold the finished rounds; once it is over they include it too.
    const earlier = s.round > 1 ? `${s.phase === 'over' ? 'Match total' : 'Earlier rounds'}<b>${num(s.totals[me])} – ${num(s.totals[opp])}</b>` : '';
    $('scoreboard').innerHTML =
      who(me, 'You') +
      `<div class="mid">Round<b>${s.round} of ${RULES.rounds}</b>${earlier}</div>` +
      who(opp, s.players[opp].name);
  }

  function renderPiles(s) {
    const drawing = s.phase === 'draw' && s.active === app.seat;
    const draws = drawing ? G.legalDraws(s) : [];
    let html = COLORS.map(({ id, name }) => {
      const pile = s.discards[id];
      const top = pile[pile.length - 1];
      const can = draws.includes(id);
      const blocked = drawing && pile.length > 0 && id === s.justDiscarded;
      const face = top ? cardHtml(top, { tag: 'span' }) : `<span class="lcard empty c-${id}"><small>${name}</small></span>`;
      const tag = can ? 'button' : 'div';
      const label = top ? `${name} discard pile, top card ${cardLabel(top)}` : `${name} discard pile, empty`;
      return `<${tag} class="pile${can ? ' pickable' : ''}${blocked ? ' blocked' : ''}"${can ? ` data-draw="${id}"` : ''} aria-label="${label}">` +
        `${face}<small>${pile.length ? pile.length + (pile.length === 1 ? ' card' : ' cards') : 'empty'}</small></${tag}>`;
    }).join('');
    const canDeck = draws.includes('deck');
    const dtag = canDeck ? 'button' : 'div';
    html += `<${dtag} class="pile${canDeck ? ' pickable' : ''}"${canDeck ? ' data-draw="deck"' : ''} aria-label="Draw pile, ${s.deckCount} cards left">` +
      `<span class="lcard back">Draw<br>pile</span><small>${s.deckCount} left</small></${dtag}>`;
    $('piles').innerHTML = html;
    $('deckInfo').textContent = s.phase === 'draw' && s.active === app.seat ? 'tap one to draw' : `${s.deckCount} cards left to draw`;
  }

  function renderHand(s) {
    const me = app.seat;
    const myTurn = s.phase === 'play' && s.active === me;
    const hand = s.players[me].hand.slice().sort((a, b) => handOrder(a) - handOrder(b));
    if (!myTurn || !hand.includes(app.sel)) app.sel = null;
    $('hand').innerHTML = hand.map((id) => cardHtml(id, { pickable: myTurn && !app.busy, sel: id === app.sel })).join('') || '<span class="hint">No cards</span>';
  }

  function drawButtons(s) {
    const draws = G.legalDraws(s);
    let html = `<button class="btn primary small" data-draw="deck"${draws.includes('deck') ? '' : ' disabled'}>Draw pile (${s.deckCount})</button>`;
    for (const { id, name } of COLORS) {
      const pile = s.discards[id];
      if (!pile.length) continue;
      html += `<button class="btn small drawbtn c-${id}" data-draw="${id}"${draws.includes(id) ? '' : ' disabled'}>` +
        `<span class="sw">${symbol(pile[pile.length - 1])}</span>${name}</button>`;
    }
    return html;
  }

  function renderBar(s) {
    const me = app.seat;
    const active = s.active === me;
    const other = esc(s.players[s.active].name);
    const btn = (a, label, cls = '', off = false) => `<button class="btn small ${cls}" data-act="${a}"${off || app.busy ? ' disabled' : ''}>${label}</button>`;
    let status = '';
    let actions = '';
    let target = null;

    if (s.phase === 'play') {
      if (!active) {
        status = `${other} is playing…`;
      } else if (!app.sel) {
        status = 'Your turn: tap a card to play or discard it';
      } else {
        const p = G.parse(app.sel);
        const check = G.canPlay(s.players[me].exp[p.color], app.sel);
        if (check.ok) target = p.color;
        status = check.ok
          ? `${cardLabel(app.sel)}: play it or discard it?`
          : `${cardLabel(app.sel)} can't be played: ${check.reason.charAt(0).toLowerCase()}${check.reason.slice(1)}. You can discard it.`;
        actions = btn('play', `Play to ${colorName(p.color)}`, 'primary', !check.ok) + btn('discard', 'Discard') + btn('clear', 'Cancel', 'ghost');
      }
    } else if (s.phase === 'draw') {
      if (active) {
        status = 'Now draw a card';
        actions = drawButtons(s);
      } else {
        status = `${other} is drawing…`;
      }
    } else {
      status = 'Round over';
      actions = btn('results', 'See results', 'primary');
    }
    $('status').textContent = status;
    $('actions').innerHTML = actions;
    return target;
  }

  function renderLast(s) {
    const L = s.last;
    if (!L) return ($('lastTurn').textContent = '');
    const who = L.who === app.seat ? 'You' : s.players[L.who].name;
    const did = L.kind === 'play' ? `played the ${cardLabel(L.card)}` : `discarded the ${cardLabel(L.card)}`;
    let drew;
    if (L.drew.from === 'deck') drew = 'drew from the draw pile' + (L.drew.card && L.who === app.seat ? ` (${cardLabel(L.drew.card)})` : '');
    else drew = `took the ${cardLabel(L.drew.card)} from the ${colorName(L.drew.from)} discards`;
    $('lastTurn').textContent = `Last turn: ${who} ${did} and ${drew}.`;
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
    renderHand(s);
    const target = renderBar(s);
    renderScoreboard(s);
    $('oppExp').innerHTML = expHtml(s, opp);
    $('myExp').innerHTML = expHtml(s, me, target);
    renderPiles(s);
    renderLast(s);
    renderNet(s);

    const needsMe = (s.phase === 'play' || s.phase === 'draw') && s.active === me;
    document.title = needsMe ? '🧭 Your move · Lost Cities' : 'Lost Cities Online';

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
    const opp = 1 - me;
    const oppName = s.players[opp].name;
    const sc = [0, 1].map((i) => G.score(s, i));
    const win = s.end.winner;
    const final = s.round >= RULES.rounds;
    if (final) {
      const t = s.totals;
      const mw = t[me] > t[opp] ? me : t[opp] > t[me] ? opp : null;
      $('overTitle').textContent = mw === me ? 'You win the match! 🎉' : mw === null ? 'The match is tied' : `${oppName} wins the match`;
      $('overWhy').textContent = `Final score after ${RULES.rounds} rounds: ${num(t[me])} to ${num(t[opp])}.`;
    } else {
      $('overTitle').textContent = win === me ? 'You win the round! 🎉' : win === null ? 'The round is tied' : `${oppName} wins the round`;
      $('overWhy').textContent = `Round ${s.round} of ${RULES.rounds}: ${num(sc[me].total)} to ${num(sc[opp].total)}.`;
    }
    const cell = (i, id) => (s.players[i].exp[id].length ? scoreText(sc[i].byColor[id]) : '–');
    $('overTable').innerHTML =
      `<tr><th></th><th>You</th><th>${esc(oppName)}</th></tr>` +
      COLORS.map(({ id, name }) => `<tr><td>${name}</td><td>${cell(me, id)}</td><td>${cell(opp, id)}</td></tr>`).join('') +
      `<tr class="total"><td>This round</td><td>${num(sc[me].total)}</td><td>${num(sc[opp].total)}</td></tr>` +
      (s.round > 1 || final ? `<tr class="match"><td>Match total</td><td>${num(s.totals[me])}</td><td>${num(s.totals[opp])}</td></tr>` : '');
    $('rematchBtn').textContent = final ? 'New match' : `Round ${s.round + 1}`;
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
    store.set('lostcities.name', name);
    return name;
  }

  function onlineReady() {
    if (typeof Peer !== 'undefined') return true;
    toast('Online play needs an internet connection');
    return false;
  }

  function initHome() {
    $('nameInput').value = store.get('lostcities.name') || store.get('agentavenue.name') || store.get('qwinto.name') || '';
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
    const card = e.target.closest('.lcard.pickable');
    if (!card) return;
    app.sel = app.sel === card.dataset.id ? null : card.dataset.id;
    render();
  });

  // Drawing works from the bar buttons and from tapping the piles themselves.
  const onDraw = (e) => {
    const t = e.target.closest('[data-draw]');
    if (t && !t.disabled && !app.busy) act({ type: 'draw', from: t.dataset.draw });
  };
  $('piles').addEventListener('click', onDraw);

  $('bar').addEventListener('click', (e) => {
    onDraw(e);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if ((a === 'play' || a === 'discard') && app.sel) {
      const card = app.sel;
      app.sel = null;
      act({ type: a, card });
    } else if (a === 'clear') {
      app.sel = null;
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

  initHome();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
  }
})();
