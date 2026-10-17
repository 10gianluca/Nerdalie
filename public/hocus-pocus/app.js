/* UI controller: screens, rendering, and wiring game actions to the network. */
(function () {
  'use strict';

  const G = window.HocusPocus;
  const C = window.HocusCards;
  const Net = window.HocusNet;
  const { RULES } = G;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const Art = window.HocusArt;
  const COLOR_CLASS = { orange: 'c-orange', purple: 'c-purple', yellow: 'c-yellow', green: 'c-green', blue: 'c-blue' };

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SESSION_KEY = 'hocuspocus.session';

  const app = {
    role: null, // 'host' | 'guest'
    solo: false, // playing against the computer: this browser is the host, with no network
    seat: 0,
    session: null, // persisted: { role, code, name, token | guestToken, state }
    state: null, // host: full state; guest: masked view from host
    net: null,
    connected: false,
    guestLink: null,
    busy: false,
    overKey: null,
    hostRetries: 0,
    renderKey: null,
    selCard: null, // a hand card chosen to play, awaiting a cauldron pile tap
    pendingBinx: null, // { cardId, pile } — a Binx card was aimed at a pile, awaiting whose hand to reveal
    trickMode: null, // null | 'daylight' | 'burning' — mid-selection for a Trick that needs cards picked
    selMulti: [], // cards picked so far for Burning Rain of Death or a forced discard
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
    let t = store.get('hocuspocus.token');
    if (!t) {
      t = (crypto.randomUUID && crypto.randomUUID()) || Net.makeCode(16);
      store.set('hocuspocus.token', t);
    }
    return t;
  }

  function saveSession() {
    if (app.role === 'host') app.session.state = app.state;
    store.set(SESSION_KEY, app.session);
  }

  const view = () => (app.state && app.role === 'host' ? G.viewFor(app.state, 0) : app.state);
  const deckCount = (s) => (s.deckCount != null ? s.deckCount : s.deck.length);

  function inviteUrl(code) {
    const url = new URL(location.href);
    url.search = '?join=' + code;
    url.hash = '';
    return url.toString();
  }

  function resetSelection() {
    app.selCard = null;
    app.pendingBinx = null;
    app.trickMode = null;
    app.selMulti = [];
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
      else if (app.solo) console.warn("The computer's move was rejected:", e.message);
      else app.net.send({ t: 'error', message: e.message });
      return;
    }
    resetSelection();
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
  const Bot = window.HocusBot;
  const LEVEL_KEY = 'hocuspocus.level';
  const LEVELS = ['easy', 'normal', 'hard'];
  let botTimer = null;

  // The computer is player 1. After every action it checks whether it has something to do and answers after a short pause.
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
    }, 750);
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
    if (!skipConfirm && running && !confirm(app.solo ? 'Leave this game? It will not be saved.' : 'Leave this game? Your friend will be left waiting.')) return;
    if (app.net) app.net.destroy();
    clearTimeout(botTimer);
    Object.assign(app, { solo: false, role: null, session: null, state: null, net: null, connected: false, guestLink: null, busy: false, overKey: null, renderKey: null });
    resetSelection();
    store.del(SESSION_KEY);
    if ($('overDialog').open) $('overDialog').close();
    history.replaceState(null, '', location.pathname);
    document.title = 'Hocus Pocus Online';
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
      await navigator.share({ title: 'Hocus Pocus', text: `Play Hocus Pocus with me! Room code: ${code}`, url: inviteUrl(code) });
    } catch (_) { /* user closed the share sheet */ }
  }

  // ---------- rendering: cards ----------
  function cardHtml(s, cardId, o = {}) {
    const card = s.index[cardId];
    if (!card) return '';
    const tag = o.pickable ? 'button' : 'div';
    const cls = ['icard', COLOR_CLASS[card.color], o.mini && 'mini', o.pickable && 'pickable', o.sel && 'sel', o.dim && 'dim'].filter(Boolean).join(' ');
    const badge = card.special ? Art.badge(card.special) : '';
    return `<${tag} class="${cls}" data-id="${esc(cardId)}" aria-label="${esc(C.TYPE_NAMES[card.type])}, ${esc(C.COLOR_NAMES[card.color])}${badge ? ', special' : ''}">` +
      `<span class="art">${Art.icon(card.type)}</span><span class="label">${esc(C.TYPE_NAMES[card.type])}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</${tag}>`;
  }

  const RING_RADIUS = 34; // % of the cauldron box, measured from its centre
  const CAULDRON_ART = '<svg class="pot" viewBox="0 0 120 120" aria-hidden="true">' +
    '<rect x="34" y="92" width="9" height="14" rx="3" fill="#2b2631"/><rect x="77" y="92" width="9" height="14" rx="3" fill="#2b2631"/>' +
    '<path d="M16 52 Q16 98 60 98 Q104 98 104 52 Z" fill="#2b2631"/><ellipse cx="60" cy="52" rx="44" ry="11" fill="#2b2631"/>' +
    '<ellipse cx="60" cy="48" rx="35" ry="7" fill="#5a9a5a"/>' +
    '<circle cx="46" cy="40" r="3" fill="#7ad06a"/><circle cx="73" cy="38" r="2.200" fill="#7ad06a"/><circle cx="60" cy="33" r="1.600" fill="#7ad06a"/>' +
    '<circle cx="60" cy="74" r="10" fill="#b8f0a8"/><rect x="55" y="80" width="10" height="7" rx="2" fill="#b8f0a8"/>' +
    '<circle cx="56" cy="73" r="2.800" fill="#2b2631"/><circle cx="64" cy="73" r="2.800" fill="#2b2631"/><path d="M60 77l-1.500 3h3z" fill="#2b2631"/>' +
    '<path d="M57.500 83v4M60 83v4M62.500 83v4" stroke="#2b2631" stroke-width=".9"/></svg>';

  function topCardHtml(s, pile) {
    const top = G.pileTop(s, pile);
    const empty = s.cauldron[pile].length === 0;
    const cls = ['icard', COLOR_CLASS[top.color], empty && 'start'].filter(Boolean).join(' ');
    return `<div class="${cls}"><span class="art">${Art.icon(top.type)}</span><span class="label">${esc(C.TYPE_NAMES[top.type])}</span></div>`;
  }

  // ---------- rendering: board ----------
  function renderSuns(s) {
    let html = '';
    for (let i = 0; i < RULES.stunsToWin; i++) html += `<i class="${i < s.sun ? 'lit' : ''}" title="${i < s.sun ? 'stunned' : 'not yet'}"></i>`;
    $('suns').innerHTML = html;
  }

  function renderWitches(s) {
    $('witches').innerHTML = C.WITCHES.map((w) => `<span class="w${s.stunnedWitch === w ? ' stunned' : ''}"><span class="hat">${Art.hat(w)}</span>${esc(C.WITCH_NAMES[w])}${s.stunnedWitch === w ? ' 💫' : ''}</span>`).join('');
  }

  function renderScoreboard(s) {
    const me = app.seat;
    const opp = 1 - me;
    const who = (i, cls, label) => {
      const p = s.players[i];
      const turn = s.active === i && s.phase !== 'over' ? ' turn' : '';
      const revealed = i === opp && s.binxHolder === opp ? ' revealed' : '';
      return `<div class="who ${cls}"><span class="nm${turn}${revealed}">${esc(label)}</span><span class="meta">${p.hand.length} card${p.hand.length === 1 ? '' : 's'}</span></div>`;
    };
    $('scoreboard').innerHTML =
      who(me, 'me', 'You') +
      `<div class="mid">Round<b>${s.round}</b>Deck ${deckCount(s)} · Pile ${s.discard.length}</div>` +
      who(opp, 'opp', s.players[opp].name);
    const revealed = s.binxHolder === opp;
    const oppHand = $('oppHand');
    oppHand.classList.toggle('revealed', revealed);
    oppHand.innerHTML = revealed
      ? s.players[opp].hand.map((id) => cardHtml(s, id, { mini: true })).join('')
      : s.players[opp].hand.map(() => '<span></span>').join('');
  }

  function renderCauldron(s) {
    const me = app.seat;
    const myTurn = s.active === me;
    const canPick = myTurn && s.phase === 'play' && app.selCard && !app.pendingBinx && !app.busy;
    let hint = '';
    if (canPick) hint = 'tap a pile to play it there';
    $('cauldronInfo').textContent = hint;
    // The five piles sit evenly around a ring, starting at the top and going clockwise.
    let html = CAULDRON_ART;
    for (let pile = 0; pile < 5; pile++) {
      const pickable = canPick && G.canPlayOn(s, app.selCard, pile);
      const top = G.pileTop(s, pile);
      const angle = ((-90 + pile * 72) * Math.PI) / 180;
      const left = 50 + RING_RADIUS * Math.cos(angle);
      const topPct = 50 + RING_RADIUS * Math.sin(angle);
      html += `<div class="cpile${pickable ? ' pickable' : ''}" data-pile="${pile}" style="left:${left.toFixed(2)}%;top:${topPct.toFixed(2)}%">` +
        topCardHtml(s, pile) +
        `<small>${esc(C.COLOR_NAMES[top.color])}</small></div>`;
    }
    $('cauldron').innerHTML = html;
  }

  function renderHand(s) {
    const me = app.seat;
    const myTurn = s.active === me && s.phase !== 'over';
    const hand = s.players[me].hand;
    if (app.selCard && !hand.includes(app.selCard)) app.selCard = null;
    app.selMulti = app.selMulti.filter((id) => hand.includes(id));

    const discarding = myTurn && s.phase === 'spell' && s.pendingDiscard && !s.pendingSpell;
    const burning = app.trickMode === 'burning';
    const daylight = app.trickMode === 'daylight';
    const choosingPile = myTurn && s.phase === 'play' && app.selCard && !app.pendingBinx;

    let hint = '';
    if (discarding) hint = `pick ${s.pendingDiscard.min} to discard (${app.selMulti.length}/${s.pendingDiscard.min})`;
    else if (burning) hint = `pick 3 to discard (${app.selMulti.length}/3)`;
    else if (daylight) hint = 'tap a card to offer';
    else if (choosingPile) hint = 'tap a matching pile below, or tap the card again to cancel';
    else if (myTurn && s.phase === 'play') hint = 'tap a card to play';
    $('handInfo').textContent = hint;

    let html = '';
    for (const id of hand) {
      const sel = id === app.selCard || app.selMulti.includes(id);
      let pickable = false;
      if (!app.busy && (discarding || burning || daylight)) pickable = true;
      else if (myTurn && s.phase === 'play' && !app.pendingBinx && !app.busy) pickable = true;
      html += cardHtml(s, id, { pickable, sel });
    }
    $('hand').innerHTML = html || '<span class="empty">No cards left</span>';
  }

  function renderTricks(s) {
    const me = app.seat;
    const myTurn = s.active === me;
    const inTrickPhase = myTurn && s.phase === 'trick' && !app.trickMode;
    const inSpellChoice = myTurn && s.phase === 'spell' && s.pendingSpell;
    const defs = [
      { key: 'salt', enabled: inSpellChoice && !s.tricksUsed.salt },
      { key: 'daylight', enabled: inTrickPhase && !s.tricksUsed.daylight },
      { key: 'billy', enabled: inTrickPhase && !s.tricksUsed.billy },
      { key: 'burning', enabled: inTrickPhase && !s.tricksUsed.burning },
    ];
    $('tricks').innerHTML = defs.map(({ key, enabled }) => {
      const t = C.TRICKS[key];
      const used = s.tricksUsed[key];
      const active = app.trickMode === key;
      const cls = ['trick', used && 'used', active && 'active'].filter(Boolean).join(' ');
      return `<button class="${cls}" data-trick="${key}" ${enabled || active ? '' : 'disabled'}>` +
        `<span class="tname">${esc(t.name)}${used ? ' ✓' : ''}</span><span class="ttext">${esc(t.text)}</span></button>`;
    }).join('');
  }

  function recentLog(s, n = 3) {
    return s.log.slice(-n).map((e) => e.text).join(' ');
  }

  function renderBar(s) {
    const me = app.seat;
    const opp = 1 - me;
    const oppName = esc(s.players[opp].name);
    const myTurn = s.active === me;
    const btn = (a, label, cls = '', off = false) => `<button class="btn small ${cls}" data-act="${a}"${off || app.busy ? ' disabled' : ''}>${label}</button>`;
    let status = '';
    let spellcard = '';
    let actions = '';

    if (s.phase === 'over') {
      status = 'Game over';
      actions = btn('results', 'See results', 'primary');
    } else if (!myTurn) {
      const verbs = { trick: 'deciding on a Trick', play: 'playing a card', spell: 'dealing with a Spell' };
      status = `${oppName} is ${verbs[s.phase] || 'playing'}…`;
    } else if (s.phase === 'trick') {
      if (app.trickMode === 'burning') {
        status = `Pick exactly 3 cards to discard (${app.selMulti.length}/3), then confirm.`;
        actions = btn('confirmBurning', 'Discard & draw 3', 'primary', app.selMulti.length !== 3) + btn('cancelTrick', 'Cancel', 'ghost');
      } else if (app.trickMode === 'daylight') {
        status = 'Tap a card from your hand to offer in the blind swap.';
        actions = btn('cancelTrick', 'Cancel', 'ghost');
      } else {
        status = 'Use a one-time Trick, or skip ahead to playing a card.';
        actions = btn('skipTrick', 'Skip', 'primary');
      }
    } else if (s.phase === 'play') {
      if (app.pendingBinx) {
        status = 'Binx is played! Whose hand should it reveal until the next stun?';
        actions = btn('binxMe', 'Mine', 'primary') + btn('binxOpp', `${oppName}'s`, 'primary');
      } else if (app.selCard) {
        status = 'Tap a matching pile in the cauldron above.';
        actions = btn('cancelPlay', 'Cancel', 'ghost');
      } else {
        const legal = G.legalPlays(s, me);
        if (!legal.length) {
          status = "You have no legal play. You'll have to draw a Spell instead.";
          actions = btn('cannotPlay', "I can't play a card", 'primary');
        } else {
          status = 'Tap a card in your hand, then a cauldron pile it matches.';
        }
      }
    } else if (s.phase === 'spell') {
      if (s.pendingSpell) {
        const sp = s.pendingSpell;
        status = 'A Spell was drawn!';
        spellcard = `<div class="spellcard"><span class="sname">${esc(sp.name)}</span><span class="stext">${esc(sp.text)}</span></div>`;
        actions = (!s.tricksUsed.salt ? btn('useSalt', 'Use Circle of Salt', 'primary') : '') + btn('continueSpell', 'Let it happen', s.tricksUsed.salt ? 'primary' : '');
      } else if (s.pendingDiscard) {
        const { min } = s.pendingDiscard;
        status = `Discard exactly ${min} card${min === 1 ? '' : 's'}, then draw ${min} back (${app.selMulti.length}/${min}).`;
        actions = btn('confirmDiscard', `Discard ${min}`, 'primary', app.selMulti.length !== min);
      }
    }

    $('status').textContent = status;
    $('spellcard').innerHTML = spellcard;
    $('actions').innerHTML = actions;
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

    const key = `${s.turn}-${s.phase}-${!!s.pendingSpell}-${!!s.pendingDiscard}`;
    if (key !== app.renderKey) {
      app.renderKey = key;
      resetSelection();
    }

    renderSuns(s);
    renderWitches(s);
    renderScoreboard(s);
    renderCauldron(s);
    renderHand(s);
    renderTricks(s);
    renderBar(s);
    $('lastTurn').textContent = recentLog(s);
    renderNet(s);

    const needsMe = s.phase !== 'over' && s.active === me;
    document.title = needsMe ? '🔮 Your move · Hocus Pocus' : 'Hocus Pocus Online';

    const overKey = s.phase === 'over' ? `${s.turn}-over` : null;
    if (overKey && overKey !== app.overKey) {
      app.overKey = overKey;
      setTimeout(openOver, 900);
    } else if (!overKey) {
      app.overKey = null;
      if ($('overDialog').open) $('overDialog').close();
    }
  }

  function openOver() {
    const s = view();
    if (!s || s.phase !== 'over') return;
    const win = s.end && s.end.result === 'win';
    $('overTitle').textContent = win ? 'You win! 🎉' : 'You lose…';
    $('overWhy').textContent = win
      ? 'Three stuns and the sun has risen — the Sanderson sisters are defeated together.'
      : s.end.reason === 'stalled'
        ? 'Nobody could play a card for too long, so the potion was finished.'
        : 'The Ingredient deck ran out with a Spell still demanding more cards.';
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
    store.set('hocuspocus.name', name);
    return name;
  }

  function onlineReady() {
    if (typeof Peer !== 'undefined') return true;
    toast('Online play needs an internet connection');
    return false;
  }

  function initHome() {
    $('nameInput').value = store.get('hocuspocus.name') || store.get('scout.name') || store.get('lostcities.name') || store.get('agentavenue.name') || store.get('qwinto.name') || '';
    const join = Net.normalizeCode(new URLSearchParams(location.search).get('join'));
    if (join) $('codeInput').value = join;
    const saved = store.get(SESSION_KEY);
    $('resumeBtn').hidden = !saved;
    if (saved) $('resumeBtn').textContent = saved.role === 'solo' ? 'Resume your solo game' : `Resume game in room ${saved.code}`;
  }

  function tapHandCard(id) {
    const s = view();
    if (!s) return;
    const me = app.seat;
    const myTurn = s.active === me;
    if (!myTurn) return;

    if (s.phase === 'spell' && s.pendingDiscard && !s.pendingSpell) {
      const { min } = s.pendingDiscard;
      const i = app.selMulti.indexOf(id);
      if (i >= 0) app.selMulti.splice(i, 1);
      else if (app.selMulti.length < min) app.selMulti.push(id);
      render();
      return;
    }
    if (app.trickMode === 'burning') {
      const i = app.selMulti.indexOf(id);
      if (i >= 0) app.selMulti.splice(i, 1);
      else if (app.selMulti.length < 3) app.selMulti.push(id);
      render();
      return;
    }
    if (app.trickMode === 'daylight') {
      app.trickMode = null;
      act({ type: 'useTrick', trick: 'daylight', give: id });
      return;
    }
    if (s.phase === 'play' && !app.pendingBinx) {
      app.selCard = app.selCard === id ? null : id;
      render();
    }
  }

  function tapPile(pile) {
    const s = view();
    if (!s || !app.selCard || app.pendingBinx) return;
    const me = app.seat;
    if (s.active !== me || s.phase !== 'play') return;
    if (!G.canPlayOn(s, app.selCard, pile)) return;
    const card = s.index[app.selCard];
    if (card.special === 'binx') {
      app.pendingBinx = { cardId: app.selCard, pile };
      render();
    } else {
      const cardId = app.selCard;
      app.selCard = null;
      act({ type: 'play', cardId, pile });
    }
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

  $('hand').addEventListener('click', (e) => {
    const card = e.target.closest('.icard.pickable');
    if (card) tapHandCard(card.dataset.id);
  });

  $('cauldron').addEventListener('click', (e) => {
    const pile = e.target.closest('.cpile.pickable');
    if (pile) tapPile(Number(pile.dataset.pile));
  });

  $('tricks').addEventListener('click', (e) => {
    const b = e.target.closest('.trick');
    if (!b || b.disabled) return;
    const key = b.dataset.trick;
    if (key === 'salt') { act({ type: 'useTrick', trick: 'salt' }); return; }
    if (key === 'billy') { act({ type: 'useTrick', trick: 'billy' }); return; }
    app.trickMode = app.trickMode === key ? null : key;
    app.selMulti = [];
    render();
  });

  $('bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'skipTrick') act({ type: 'skipTrick' });
    else if (a === 'cannotPlay') act({ type: 'cannotPlay' });
    else if (a === 'cancelPlay') { app.selCard = null; render(); }
    else if (a === 'binxMe') { const { cardId, pile } = app.pendingBinx; app.pendingBinx = null; app.selCard = null; act({ type: 'play', cardId, pile, binxTo: app.seat }); }
    else if (a === 'binxOpp') { const { cardId, pile } = app.pendingBinx; app.pendingBinx = null; app.selCard = null; act({ type: 'play', cardId, pile, binxTo: 1 - app.seat }); }
    else if (a === 'cancelTrick') { app.trickMode = null; app.selMulti = []; render(); }
    else if (a === 'confirmBurning') { const discard = app.selMulti.slice(); app.trickMode = null; app.selMulti = []; act({ type: 'useTrick', trick: 'burning', discard }); }
    else if (a === 'useSalt') act({ type: 'useTrick', trick: 'salt' });
    else if (a === 'continueSpell') act({ type: 'continueFromSpell' });
    else if (a === 'confirmDiscard') { const cardIds = app.selMulti.slice(); app.selMulti = []; act({ type: 'discard', cardIds }); }
    else if (a === 'results') openOver();
  });

  $('nextBtn').addEventListener('click', () => {
    $('overDialog').close();
    act({ type: 'rematch' });
  });
  $('closeOverBtn').addEventListener('click', () => $('overDialog').close());

  initLevels();
  initHome();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
  }
})();
