/* UI controller: screens, rendering, and wiring game actions to the network. */
(function () {
  'use strict';

  const G = window.Jaipur;
  const Bot = window.JaipurBot;
  const Net = window.JaipurNet;
  const { GOODS, PREMIUM, RULES } = G;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SESSION_KEY = 'jaipur.session';
  const hub = window.NerdalieHub ? window.NerdalieHub.game('jaipur', 'Jaipur') : null;

  const app = {
    role: null, // 'host' | 'guest'
    solo: false, // playing against the computer: this browser is the host, with no network
    seat: 0,
    session: null, // persisted: { role, code, name, token | guestToken, state }
    state: null, // host: full state; guest: masked view from host
    net: null,
    connected: false,
    guestLink: null,
    take: [], // market positions picked to take
    give: {}, // kind -> how many of that kind from your hand (or herd, for camels) are picked
    busy: false,
    overShown: false,
    hostRetries: 0,
  };

  const KINDS = {
    diamond: { name: 'Diamond', plural: 'diamonds', icon: '💎' },
    gold: { name: 'Gold', plural: 'gold', icon: '🪙' },
    silver: { name: 'Silver', plural: 'silver', icon: '🥈' },
    cloth: { name: 'Cloth', plural: 'cloth', icon: '🧵' },
    spice: { name: 'Spice', plural: 'spice', icon: '🌶️' },
    leather: { name: 'Leather', plural: 'leather', icon: '👜' },
    camel: { name: 'Camel', plural: 'camels', icon: '🐪' },
  };
  const kindName = (k, n = 1) => (n === 1 ? KINDS[k].name.toLowerCase() : KINDS[k].plural);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
    let t = store.get('jaipur.token');
    if (!t) {
      t = (crypto.randomUUID && crypto.randomUUID()) || Net.makeCode(16);
      store.set('jaipur.token', t);
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

  function clearPicks() {
    app.take = [];
    app.give = {};
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
  const LEVEL_KEY = 'jaipur.level';
  const LEVELS = ['easy', 'normal', 'hard'];
  let botTimer = null;

  // The computer is player 1. After every action it checks whether it has something to do and answers after a pause.
  function scheduleBot() {
    clearTimeout(botTimer);
    if (!app.solo || !app.state) return;
    const level = app.session.level || 'normal';
    const next = () => Bot.choose(G.viewFor(app.state, 1), 1, Math.random, level);
    if (!next()) return;
    botTimer = setTimeout(() => {
      if (!app.solo || !app.state) return;
      const action = next();
      if (action) applyAction(1, action);
    }, 950);
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
    document.title = 'Jaipur Online';
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
      await navigator.share({ title: 'Jaipur', text: `Play Jaipur with me! Room code: ${code}`, url: inviteUrl(code) });
    } catch (_) { /* user closed the share sheet */ }
  }

  // ---------- rendering: pieces ----------
  function cardHtml(kind, o = {}) {
    const tag = o.pickable ? 'button' : 'div';
    const cls = ['jcard', 't-' + kind, o.pickable && 'pickable', o.sel && 'sel'].filter(Boolean).join(' ');
    const data = o.pickable ? ` data-${o.attr}="${o.value}"` : '';
    return `<${tag} class="${cls}"${data} aria-label="${KINDS[kind].name}${o.label ? ', ' + o.label : ''}">` +
      (o.count != null ? `<span class="n">${o.count}</span>` : '') +
      `<span class="ico" aria-hidden="true">${KINDS[kind].icon}</span><small>${KINDS[kind].name}</small>` +
      (o.pick ? `<span class="pick">${o.pick}</span>` : '') + `</${tag}>`;
  }

  const handCounts = (hand) => Object.fromEntries(GOODS.map((g) => [g, hand.filter((c) => c === g).length]));
  const giveList = () => Object.entries(app.give).flatMap(([k, n]) => Array(n).fill(k));

  function myTurn(s) {
    return s.phase === 'play' && s.active === app.seat;
  }

  // ---------- rendering: board ----------
  function seals(n) {
    return n ? '⭐'.repeat(n) : '';
  }

  function renderScoreboard(s) {
    const me = app.seat;
    const opp = 1 - me;
    const who = (i, label) => {
      const p = s.players[i];
      const own = i === me;
      // the round total (with the camel bonus) once it is over; before that the tokens banked so far, with only your own bonus tokens counted
      const pts = s.phase === 'over' ? s.end.scores[i] : G.goodsPoints(p) + (own ? p.bonus.reduce((t, v) => t + v, 0) : 0);
      const extra = own || s.phase === 'over' ? `${plural(p.bonusCount, 'bonus token', 'bonus tokens')}` : `+ ${plural(p.bonusCount, 'hidden bonus', 'hidden bonuses')}`;
      return `<div class="who${s.active === i && s.phase !== 'over' ? ' turn' : ''}"><span>${esc(label)}</span><b>${pts}</b><small>${extra}</small><div class="seals" aria-label="${plural(s.seals[i], 'seal', 'seals')}">${seals(s.seals[i])}</div></div>`;
    };
    $('scoreboard').innerHTML =
      who(me, 'You') +
      `<div class="mid">Round<b>${s.round}</b>first to ${RULES.sealsToWin} ⭐</div>` +
      who(opp, s.players[opp].name);
  }

  function renderOpponent(s) {
    const opp = s.players[1 - app.seat];
    $('oppName').textContent = opp.name;
    $('oppHint').textContent = `${plural(opp.handCount, 'card', 'cards')} in hand`;
    const backs = Array.from({ length: Math.min(opp.handCount, RULES.handLimit) }, () => '<div class="jcard back"></div>').join('');
    $('oppRow').innerHTML =
      `<div class="backs" aria-hidden="true">${backs}</div>` +
      `<div class="chips"><span class="pill">🐪 ${opp.herd}</span><span class="pill">🪙 ${G.goodsTokens(opp)} tokens</span></div>`;
  }

  function renderMarket(s) {
    const mine = myTurn(s) && !app.busy;
    app.take = app.take.filter((i) => i < s.market.length);
    $('market').innerHTML = s.market.map((k, i) => cardHtml(k, { pickable: mine, attr: 'i', value: i, sel: app.take.includes(i) })).join('');
    $('marketHint').textContent = mine ? 'tap to take' : `${G.deckLeft(s)} cards in the deck`;
  }

  function renderPiles(s) {
    $('piles').innerHTML = '<div class="pileGrid">' + GOODS.map((g) => {
      const pile = s.piles[g];
      const coin = pile.length ? `<div class="coin t-${g}">${pile[0]}</div>` : '<div class="coin none">out</div>';
      return `<div class="tpile"><span class="gl" aria-hidden="true">${KINDS[g].icon}</span>${coin}<small>${pile.length} left</small></div>`;
    }).join('') +
      `</div><div class="bonusLine" aria-label="Bonus tokens left"><span>3 cards: ${s.bonusLeft[3]}</span><span>4 cards: ${s.bonusLeft[4]}</span><span>5+: ${s.bonusLeft[5]}</span></div>` +
      (s.phase === 'play' && G.emptyPiles(s) === RULES.emptyPilesToEnd - 1 ? '<div class="endWarn">One more empty pile ends the round</div>' : '') +
      (s.phase === 'play' && G.deckLeft(s) <= 4 ? `<div class="endWarn">${plural(G.deckLeft(s), 'card', 'cards')} left in the deck</div>` : '');
    $('tokenHint').textContent = `${G.deckLeft(s)} in deck`;
  }

  function renderHand(s) {
    const me = s.players[app.seat];
    $('myName').textContent = `${me.name} (you)`;
    $('myHint').textContent = `${me.hand.length} of ${RULES.handLimit} in hand`;
    const mine = myTurn(s) && !app.busy;
    const counts = handCounts(me.hand);
    // drop picks that no longer make sense
    for (const k of Object.keys(app.give)) {
      const have = k === 'camel' ? me.herd : counts[k] || 0;
      if (!app.give[k] || app.give[k] > have || !mine) delete app.give[k];
    }
    let html = GOODS.filter((g) => counts[g]).map((g) =>
      cardHtml(g, { pickable: mine, attr: 'give', value: g, count: counts[g], pick: app.give[g] ? `give ${app.give[g]}` : '', sel: !!app.give[g], label: `${counts[g]} in hand` })).join('');
    if (me.herd) {
      html += cardHtml('camel', { pickable: mine, attr: 'give', value: 'camel', count: me.herd, pick: app.give.camel ? `give ${app.give.camel}` : '', sel: !!app.give.camel, label: `${me.herd} in your herd` });
    }
    $('hand').innerHTML = html || '<span class="empty">No cards in hand</span>';

    const tokens = GOODS.filter((g) => me.tokens[g].length).map((g) =>
      `<span class="mt t-${g}"><i>${KINDS[g].icon}</i>${me.tokens[g].reduce((t, v) => t + v, 0)}</span>`).join('');
    const bonus = me.bonus.length ? `<span class="mt"><i style="background:var(--gold)">⭐</i>${me.bonus.reduce((t, v) => t + v, 0)} bonus</span>` : '';
    $('myTokens').innerHTML = tokens + bonus;
  }

  // What the cards picked right now would do: { action, label, sub } when it is a real move, { hint } when it is not yet.
  function plan(s) {
    const me = s.players[app.seat];
    const takeTypes = app.take.map((i) => s.market[i]).filter(Boolean);
    const give = giveList();
    if (!takeTypes.length && !give.length) return { none: true };

    if (takeTypes.includes('camel')) {
      const n = takeTypes.length;
      return { action: { type: 'camels' }, label: `Take ${plural(n, 'camel', 'camels')}`, sub: 'Camels go to your herd and the market is refilled.' };
    }

    if (!takeTypes.length) { // selling
      const kinds = [...new Set(give)];
      if (kinds.includes('camel')) return { hint: 'Camels can only be swapped for goods. Pick market cards to swap them for.' };
      if (kinds.length > 1) return { hint: 'Sell one kind of goods at a time.' };
      const good = kinds[0];
      const n = give.length;
      if (PREMIUM.includes(good) && n < RULES.premiumMin) return { hint: `${KINDS[good].name} has to be sold ${RULES.premiumMin} or more at a time.` };
      const prev = G.sellPreview(s, good, n);
      const got = prev.tokens.length ? `+${prev.points} points` : 'no tokens left to earn';
      return { action: { type: 'sell', good, count: n }, label: `Sell ${n} ${kindName(good, n)}`, sub: `${got}${prev.bonusSize ? ' and a bonus token' : ''}` };
    }

    if (!give.length && takeTypes.length === 1) {
      if (me.hand.length >= RULES.handLimit) return { hint: `Your hand is full (${RULES.handLimit} cards). Sell something or swap instead.` };
      return { action: { type: 'take', card: takeTypes[0] }, label: `Take ${kindName(takeTypes[0])}`, sub: 'One card from the market to your hand.' };
    }

    if (takeTypes.length < 2) return { hint: 'To swap, pick at least two market cards.' };
    if (give.length !== takeTypes.length) return { hint: `Swap ${takeTypes.length} for ${takeTypes.length}: you've picked ${give.length} to give.` };
    const kinds = new Set(takeTypes);
    if (give.some((c) => kinds.has(c))) return { hint: "You can't give a kind of card you're taking." };
    const action = { type: 'exchange', take: takeTypes.slice().sort(), give: give.slice().sort() };
    const ok = G.legalActions(s, app.seat).some((a) => a.type === 'exchange' && JSON.stringify([a.take.slice().sort(), a.give.slice().sort()]) === JSON.stringify([action.take, action.give]));
    if (!ok) return { hint: `That swap would leave you with more than ${RULES.handLimit} cards.` };
    return { action, label: `Swap ${takeTypes.length} for ${takeTypes.length}`, sub: 'Cards you give go to the market.' };
  }

  function renderBar(s) {
    const active = myTurn(s);
    const other = esc(s.players[s.active].name);
    const btn = (a, label, cls = '', off = false) => `<button class="btn small ${cls}" data-act="${a}"${off || app.busy ? ' disabled' : ''}>${label}</button>`;
    let status = '';
    let sub = '';
    let actions = '';
    if (s.phase === 'over') {
      status = s.end.matchWinner != null ? 'Match over' : 'Round over';
      actions = btn('results', 'See results', 'primary');
    } else if (!active) {
      status = `${other} is playing…`;
    } else {
      const p = plan(s);
      if (p.none) {
        status = 'Your turn';
        sub = 'Tap a market card to take it. Tap your goods to sell them, or to swap them for market cards.';
      } else if (p.hint) {
        status = p.hint;
        actions = btn('clear', 'Clear picks', 'ghost');
      } else {
        status = p.label;
        sub = p.sub;
        actions = btn('go', p.label, 'primary') + btn('clear', 'Clear', 'ghost');
      }
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
    let did;
    if (L.kind === 'take') did = `took a ${kindName(L.card)}`;
    else if (L.kind === 'camels') did = `took ${plural(L.n, 'camel', 'camels')}`;
    else if (L.kind === 'exchange') {
      const list = (a) => a.map((k) => kindName(k)).join(', ');
      did = `swapped ${list(L.give)} for ${list(L.take)}`;
    } else {
      const pts = L.tokens.reduce((t, v) => t + v, 0);
      did = `sold ${L.n} ${kindName(L.good, L.n)} for ${pts} point${pts === 1 ? '' : 's'}${L.bonus ? ' and a bonus token' : ''}`;
    }
    $('lastTurn').textContent = `Last turn: ${who} ${did}.`;
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
    renderScoreboard(s);
    renderOpponent(s);
    renderMarket(s);
    renderPiles(s);
    renderHand(s);
    renderBar(s);
    renderLast(s);
    renderNet(s);

    const needsMe = myTurn(s);
    document.title = needsMe ? '🐪 Your move · Jaipur' : 'Jaipur Online';
    if (hub) hub.sync({ needsMe, over: s.phase === 'over' && s.end.matchWinner != null, solo: app.solo, opponent: s.players[1 - me].name, level: app.session && app.session.level, code: app.session && app.session.code });

    if (s.phase === 'over' && !app.overShown) {
      app.overShown = true;
      if (hub && app.session && !app.session.recorded && s.end.matchWinner != null) {
        app.session.recorded = true;
        store.set(SESSION_KEY, app.session);
        hub.finish({ mode: app.solo ? 'solo' : 'online', level: app.solo ? app.session.level : '', opponent: app.solo ? 'Computer' : s.players[1 - me].name, outcome: s.end.matchWinner === me ? 'win' : 'loss', detail: `${s.seals[me]} vs ${s.seals[1 - me]} seals` });
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
    const opp = 1 - me;
    const oppName = s.players[opp].name;
    const E = s.end;
    const matchOver = E.matchWinner != null;
    if (matchOver) $('overTitle').textContent = E.matchWinner === me ? 'You win the match! 🎉' : `${oppName} wins the match`;
    else $('overTitle').textContent = E.winner === me ? 'You win the round! 🎉' : E.winner === opp ? `${oppName} wins the round` : 'The round is tied';
    const reason = E.reason === 'piles' ? 'Three kinds of goods ran out.' : "The market couldn't be refilled.";
    const camel = E.camelWinner == null ? 'The herds were level, so nobody got the camel bonus.' : `${E.camelWinner === me ? 'You' : oppName} took the camel bonus (+${RULES.camelBonus}).`;
    $('overWhy').textContent = `${reason} ${camel}`;
    const b = E.breakdown;
    const row = (label, f, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${f(me)}</td><td>${f(opp)}</td></tr>`;
    $('overTable').innerHTML =
      `<tr><th></th><th>You</th><th>${esc(oppName)}</th></tr>` +
      row('Goods tokens', (i) => b[i].goods) +
      row('Bonus tokens', (i) => b[i].bonus) +
      row('Camel bonus', (i) => b[i].camel) +
      row('Round total', (i) => b[i].total, 'total') +
      row('Seals', (i) => (seals(E.seals[i]) || '–'), 'match');
    $('rematchBtn').textContent = matchOver ? 'New match' : `Round ${s.round + 1}`;
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
    store.set('jaipur.name', name);
    return name;
  }

  function onlineReady() {
    if (typeof Peer !== 'undefined') return true;
    toast('Online play needs an internet connection');
    return false;
  }

  function initHome() {
    $('nameInput').value = store.get('jaipur.name') || store.get('lostcities.name') || store.get('agentavenue.name') || store.get('qwinto.name') || '';
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

  // Market: tapping a camel picks all the camels (you always take them together); tapping goods picks them one by one.
  $('market').addEventListener('click', (e) => {
    const card = e.target.closest('.jcard.pickable');
    const s = view();
    if (!card || !s) return;
    const i = Number(card.dataset.i);
    const kind = s.market[i];
    if (kind === 'camel') {
      const all = s.market.map((k, at) => (k === 'camel' ? at : -1)).filter((at) => at >= 0);
      const already = all.every((at) => app.take.includes(at));
      app.take = already ? [] : all;
      app.give = {};
    } else {
      app.take = app.take.filter((at) => s.market[at] !== 'camel');
      app.take = app.take.includes(i) ? app.take.filter((at) => at !== i) : [...app.take, i];
    }
    render();
  });

  // Hand: tapping a kind cycles how many of it are picked, 0, 1, 2 ... all, back to 0.
  $('hand').addEventListener('click', (e) => {
    const card = e.target.closest('.jcard.pickable');
    const s = view();
    if (!card || !s) return;
    const kind = card.dataset.give;
    const me = s.players[app.seat];
    const have = kind === 'camel' ? me.herd : me.hand.filter((c) => c === kind).length;
    app.give[kind] = ((app.give[kind] || 0) + 1) % (have + 1);
    if (!app.give[kind]) delete app.give[kind];
    app.take = app.take.filter((at) => s.market[at] !== 'camel');
    render();
  });

  $('bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const s = view();
    if (!b || !s) return;
    const a = b.dataset.act;
    if (a === 'go') {
      const p = plan(s);
      if (p.action) act(p.action);
    } else if (a === 'clear') {
      clearPicks();
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

  initLevels();
  initHome();
  // The Game Night page links here with ?resume to pick up a saved game without pressing the button.
  if (/[?&]resume\b/.test(location.search) && !$('resumeBtn').hidden) $('resumeBtn').click();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
  }
})();
