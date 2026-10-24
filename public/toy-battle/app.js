/* UI controller: screens, drawing the board, and wiring game actions to the network or the computer player. */
(function () {
  'use strict';

  const G = window.ToyBattle;
  const T = window.ToyTroops;
  const B = window.ToyBoards;
  const Net = window.ToyNet;
  const Bot = window.ToyBot;
  const Art = window.ToyArt;
  const { RULES, TROOPS, TROOP_ORDER, TERRAIN_RULES } = T;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SESSION_KEY = 'toybattle.session';
  const TEAM = ['#2f6fe4', '#e5483f'];
  const TEAM_NAME = ['Blue', 'Red'];
  const GLYPH = { castle: '🏰', cloud: '☁️', volcano: '🌋', cemetery: '🪦', battlefield: '🎯' };

  const app = {
    role: null, // 'host' | 'guest'
    solo: false, // playing against the computer: this browser is the host, with no network
    seat: 0,
    session: null, // persisted: { role, code, name, terrain, token | guestToken, state }
    state: null, // host: full state; guest: masked view from host
    net: null,
    connected: false,
    guestLink: null,
    busy: false,
    overKey: null,
    hostRetries: 0,
    renderKey: null,
    sel: null, // the rack troop picked for placing
    fx: null, // first tap of a two-step effect (the volcano)
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
    let t = store.get('toybattle.token');
    if (!t) {
      t = (crypto.randomUUID && crypto.randomUUID()) || Net.makeCode(16);
      store.set('toybattle.token', t);
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

  function resetSelection() {
    app.sel = null;
    app.fx = null;
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
        app.state = G.newGame([s.name, name], Math.random() < 0.5 ? 0 : 1, s.terrain || 'castle');
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
  const LEVEL_KEY = 'toybattle.level';
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
    }, 900);
  }

  function startSolo(session) {
    app.role = 'host';
    app.solo = true;
    app.seat = 0;
    app.session = session;
    app.net = null;
    app.guestLink = null;
    app.connected = true;
    app.state = session.state || G.newGame([session.name, 'Computer'], Math.random() < 0.5 ? 0 : 1, session.terrain || 'castle');
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
    document.title = 'Toy Battle Online';
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
      await navigator.share({ title: 'Toy Battle', text: `Play Toy Battle with me! Room code: ${code}`, url: inviteUrl(code) });
    } catch (_) { /* user closed the share sheet */ }
  }

  // ---------- rendering: troops ----------
  const strengthLabel = (type) => (TROOPS[type].joker ? 'X' : String(TROOPS[type].strength));

  function tileHtml(s, id, o = {}) {
    const t = s.troops[id];
    if (!t) return '';
    const tag = o.pickable ? 'button' : 'div';
    const cls = ['tile', t.owner === 0 ? 'blue' : 'red', o.mini && 'mini', o.pickable && 'pickable', o.sel && 'sel', o.dim && 'dim', o.frozen && 'frozen'].filter(Boolean).join(' ');
    return `<${tag} class="${cls}" data-id="${esc(id)}" aria-label="${esc(TROOPS[t.type].name)}, strength ${strengthLabel(t.type)}">` +
      `<span class="art">${Art.icon(t.type)}</span><b class="str">${strengthLabel(t.type)}</b><span class="nm">${esc(TROOPS[t.type].name)}</span></${tag}>`;
  }

  const orderKey = (s, id) => TROOP_ORDER.indexOf(s.troops[id].type);

  // A troop token drawn on the board: a team-coloured disc with the troop's picture and strength.
  function tokenSvg(type, owner, x, y, count) {
    const icon = Art.icon(type).replace('<svg ', `<svg x="${x - 4.4}" y="${y - 5}" width="8.800" height="8.800" style="color:#fff;--c:${TEAM[owner]}" `);
    return `<g class="tok"><circle cx="${x}" cy="${y}" r="5.600" fill="${TEAM[owner]}" stroke="#fff" stroke-width="1"/>${icon}` +
      `<text x="${x + 3.800}" y="${y + 5.200}" class="tstr">${strengthLabel(type)}</text>` +
      (count > 1 ? `<circle cx="${x - 4.600}" cy="${y - 4.600}" r="2.300" class="stackdot"/><text x="${x - 4.600}" y="${y - 3.600}" class="stacknum">${count}</text>` : '') + '</g>';
  }

  // ---------- rendering: the board ----------
  // 1,2,3 -> 1-3, otherwise 1/3/5
  const fmtOnly = (only) => (only.length > 2 && only[only.length - 1] - only[0] === only.length - 1 ? `${only[0]}-${only[only.length - 1]}` : only.join('/'));

  function targetsFor(s) {
    const me = app.seat;
    const out = { nodes: new Set(), kind: null };
    if (s.phase === 'over' || s.active !== me) return out;
    if ((s.phase === 'turn' || s.phase === 'extra') && app.sel) {
      out.kind = 'place';
      for (const id of G.legalSlots(s, me, app.sel)) out.nodes.add(id);
    } else if (s.phase === 'effect') {
      const acts = G.legalActions(s, me).filter((a) => a.type === 'effect' && a.use);
      const kind = s.pending.kind;
      if (kind === 'discardAdjacent' || kind === 'castle') {
        out.kind = 'pick';
        for (const a of acts) out.nodes.add(a.base);
      } else if (kind === 'volcano') {
        out.kind = 'pick';
        if (!app.fx) for (const a of acts) out.nodes.add(a.from);
        else for (const a of acts) if (a.from === app.fx.from) out.nodes.add(a.to);
      }
    }
    return out;
  }

  function renderBoard(s) {
    const board = G.boardOf(s);
    const flip = app.seat === 1;
    const pos = (id) => {
      const n = board.nodes[id];
      return flip ? [100 - n.x, 150 - n.y] : [n.x, n.y];
    };
    const targets = targetsFor(s);
    const lastSlot = s.last && s.last.slot;
    let svg = `<svg viewBox="-6 -6 112 162" class="map t-${board.rule}" role="img" aria-label="${esc(board.name)} board">`;
    svg += '<rect x="-6" y="-6" width="112" height="162" rx="8" class="ground"/>';

    // regions
    for (const r of board.regions) {
      const owner = s.regionTaken[r.id];
      const pts = r.bases.map((b) => pos(b).join(',')).join(' ');
      svg += `<polygon points="${pts}" class="region${owner !== undefined ? ' taken t' + owner : ''}"/>`;
    }
    // paths
    for (const [a, b] of board.edges) {
      const [x1, y1] = pos(a);
      const [x2, y2] = pos(b);
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="path-edge"/>`;
    }
    for (const [a, b] of board.edges) {
      const [x1, y1] = pos(a);
      const [x2, y2] = pos(b);
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="path"/>`;
    }
    // medals (drawn under the troops, over the regions)
    for (const r of board.regions) {
      const owner = s.regionTaken[r.id];
      const cx = r.bases.reduce((t, b) => t + pos(b)[0], 0) / r.bases.length;
      const cy = r.bases.reduce((t, b) => t + pos(b)[1], 0) / r.bases.length;
      svg += `<g class="medal${owner !== undefined ? ' got t' + owner : ''}"><circle cx="${cx}" cy="${cy}" r="3.900"/><text x="${cx}" y="${cy + 1.300}">${r.medals}</text></g>`;
    }
    // nodes
    const glyph = GLYPH[TERRAIN_RULES[board.rule].baseEffect] || (board.rule === 'pool' ? '🛟' : board.rule === 'metal' ? '🛡️' : '');
    for (const id of Object.keys(board.nodes)) {
      const n = board.nodes[id];
      const [x, y] = pos(id);
      const isTarget = targets.nodes.has(id);
      const mine = n.kind === 'hq' && n.side === app.seat;
      if (n.kind === 'hq') {
        svg += `<g class="hq side${n.side}${mine ? ' mine' : ''}"><rect x="${x - 9}" y="${y - 7.500}" width="18" height="15" rx="4"/><text x="${x}" y="${y + 3.800}" class="hqg">🏰</text></g>`;
        if (n.only) svg += `<text x="${x}" y="${y + (n.side === (flip ? 0 : 1) ? 15 : -10.500)}" class="only">${fmtOnly(n.only)}</text>`;
        const stack = s.stacks[id];
        if (stack && stack.length) {
          const t = s.troops[stack[stack.length - 1]];
          svg += tokenSvg(t.type, t.owner, x, y, 1);
        }
      } else {
        const stack = s.stacks[id];
        svg += `<circle cx="${x}" cy="${y}" r="6.800" class="base${n.special ? ' special' : ''}${id === lastSlot ? ' last' : ''}"/>`;
        if (n.special && !stack.length) svg += `<text x="${x}" y="${y + 2.600}" class="glyph">${glyph}</text>`;
        if (n.only) svg += `<text x="${x}" y="${y + 12.500}" class="only">${fmtOnly(n.only)}</text>`;
        if (stack.length) {
          const t = s.troops[stack[stack.length - 1]];
          svg += tokenSvg(t.type, t.owner, x, y, stack.length);
        }
      }
      if (isTarget) svg += `<circle cx="${x}" cy="${y}" r="9.500" class="ring ${targets.kind}"/>`;
      svg += `<circle cx="${x}" cy="${y}" r="10" class="hit" data-node="${id}"/>`;
    }
    svg += '</svg>';
    $('board').innerHTML = svg;
  }

  // ---------- rendering: the rest ----------
  function renderScoreboard(s) {
    const me = app.seat;
    const opp = 1 - me;
    const board = G.boardOf(s);
    const who = (i, cls, label) => {
      const p = s.players[i];
      const turn = s.active === i && s.phase !== 'over' ? ' turn' : '';
      const backs = i === me ? '' : `<span class="backs">${p.rack.map(() => '<i></i>').join('')}</span>`;
      const frozen = i !== me && p.frozenCount ? ' · ❄ 1 frozen' : '';
      return `<div class="who ${cls}"><span class="nm${turn}"><i class="swatch" style="background:${TEAM[i]}"></i>${esc(label)}</span>` +
        `<span class="medals">⭐ ${s.medals[i]} / ${board.targets[i]}</span>` +
        `<span class="meta">${p.rack.length} on rack · ${p.reserveCount} in reserve${frozen}</span>${backs}</div>`;
    };
    $('scoreboard').innerHTML = who(me, 'me', 'You') + `<div class="mid">Turn<b>${s.turn}</b></div>` + who(opp, 'opp', s.players[opp].name);
  }

  function renderRack(s) {
    const me = app.seat;
    const myTurn = s.active === me && s.phase !== 'over';
    const p = s.players[me];
    const ids = p.rack.slice().sort((a, b) => orderKey(s, a) - orderKey(s, b));
    if (app.sel && !p.rack.includes(app.sel)) app.sel = null;
    const placing = myTurn && (s.phase === 'turn' || s.phase === 'extra');
    $('rackHint').textContent = placing ? 'tap a troop, then a glowing spot' : `${p.rack.length} / ${RULES.rack}`;
    $('rack').innerHTML = ids.length
      ? ids.map((id) => {
        const frozen = p.frozen === id;
        const usable = placing && !frozen && G.legalSlots(s, me, id).length > 0;
        return tileHtml(s, id, { pickable: usable && !app.busy, sel: id === app.sel, dim: placing && !usable, frozen });
      }).join('')
      : '<span class="empty">Your rack is empty. Draw some troops!</span>';
  }

  function renderDiscard(s) {
    const me = app.seat;
    const picking = s.active === me && s.phase === 'effect' && s.pending.kind === 'cemetery';
    $('discardHint').textContent = picking ? 'tap one of your troops to take it back' : `${s.discard.length} troop${s.discard.length === 1 ? '' : 's'}`;
    $('discard').innerHTML = s.discard.length
      ? s.discard.map((id) => tileHtml(s, id, { mini: true, pickable: picking && s.troops[id].owner === me && !app.busy })).join('')
      : '<span class="empty">Nothing discarded yet</span>';
  }

  function renderReference(s) {
    const board = G.boardOf(s);
    const rows = TROOP_ORDER.map((type) => {
      const info = TROOPS[type];
      return `<div class="refrow"><span class="tile blue mini"><span class="art">${Art.icon(type)}</span><b class="str">${strengthLabel(type)}</b></span>` +
        `<span><b>${esc(info.name)}</b> <small>strength ${strengthLabel(type)}</small><br>${esc(info.text)}</span></div>`;
    }).join('');
    $('reference').innerHTML = rows + `<div class="refrow terrain"><span class="swatch-big">🗺️</span><span><b>${esc(board.name)}</b><br>${esc(TERRAIN_RULES[board.rule].text)}<br><small>Medals needed: ${TEAM_NAME[0]} ${board.targets[0]}, ${TEAM_NAME[1]} ${board.targets[1]}</small></span></div>`;
  }

  const EFFECT_PROMPT = {
    draw2: ['Skully calls for reinforcements: draw 2 troops?', 'Draw 2'],
    draw1: ['Star shines: draw 1 troop?', 'Draw 1'],
    cloud: ['The clouds bring a troop: draw 1?', 'Draw 1'],
    steal: ["XB-42 takes aim: discard a random troop from your opponent's rack?", 'Fire'],
    battlefield: ['A sniper takes aim: freeze a random troop on your opponent’s rack?', 'Freeze'],
    extra: ["Cap'n shouts for backup: place 1 extra troop?", 'Place one'],
  };

  function renderBar(s) {
    const me = app.seat;
    const opp = 1 - me;
    const oppName = esc(s.players[opp].name);
    const btn = (a, label, cls = '', off = false) => `<button class="btn small ${cls}" data-act="${a}"${off || app.busy ? ' disabled' : ''}>${label}</button>`;
    let status = '';
    let actions = '';

    if (s.phase === 'over') {
      status = 'Game over';
      actions = btn('results', 'See results', 'primary');
    } else if (s.active !== me) {
      const verbs = { turn: 'thinking', effect: 'using an effect', extra: 'placing an extra troop' };
      status = `${oppName} is ${verbs[s.phase] || 'playing'}…`;
    } else if (s.phase === 'turn') {
      if (app.sel) {
        status = `Place ${esc(TROOPS[s.troops[app.sel].type].name)}: tap a glowing spot on the board.`;
        actions = btn('cancel', 'Cancel', 'ghost');
      } else {
        status = 'Your turn: tap a troop to place it, or draw 2 troops.';
        actions = btn('draw', 'Draw 2 troops', 'primary', !G.canDraw(s, me));
      }
    } else if (s.phase === 'extra') {
      status = app.sel ? `Place ${esc(TROOPS[s.troops[app.sel].type].name)} as your extra troop.` : "Pick a troop for Cap'n's extra placement.";
      actions = btn('skip', 'Skip', 'ghost');
    } else if (s.phase === 'effect') {
      const kind = s.pending.kind;
      if (EFFECT_PROMPT[kind]) {
        status = EFFECT_PROMPT[kind][0];
        actions = btn('use', EFFECT_PROMPT[kind][1], 'primary') + btn('skip', 'Skip', 'ghost');
      } else if (kind === 'discardAdjacent') {
        status = 'Jumbo: tap an enemy troop next to Jumbo to discard it.';
        actions = btn('skip', 'Skip', 'ghost');
      } else if (kind === 'castle') {
        status = 'The retreat sounds: tap one of your other troops to take it back to your rack.';
        actions = btn('skip', 'Skip', 'ghost');
      } else if (kind === 'volcano') {
        status = app.fx ? 'Now tap a base next to it to move it there.' : 'The volcano erupts: tap an enemy troop next to this base.';
        actions = (app.fx ? btn('back', 'Pick another', 'ghost') : '') + btn('skip', 'Skip', 'ghost');
      } else if (kind === 'cemetery') {
        status = 'Tap one of your discarded troops to take it back to your rack.';
        actions = btn('skip', 'Skip', 'ghost');
      }
    }
    $('status').textContent = status;
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

    const key = `${s.turn}-${s.phase}-${s.pending ? s.pending.kind : ''}`;
    if (key !== app.renderKey) {
      app.renderKey = key;
      resetSelection();
    }

    const board = G.boardOf(s);
    $('terrainName').textContent = board.name;
    $('boardHint').textContent = `Medals to win: you ${board.targets[me]}, them ${board.targets[1 - me]}`;
    $('terrainRule').textContent = TERRAIN_RULES[board.rule].text;
    renderScoreboard(s);
    renderBoard(s);
    renderRack(s);
    renderDiscard(s);
    renderReference(s);
    renderBar(s);
    $('lastTurn').textContent = s.log.slice(-3).map((e) => e.text).join(' ');
    renderNet(s);

    const needsMe = s.phase !== 'over' && s.active === me;
    document.title = needsMe ? '🧸 Your move · Toy Battle' : 'Toy Battle Online';

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
    const me = app.seat;
    const { winner, reason, stuck } = s.end;
    const oppName = s.players[1 - me].name;
    $('overTitle').textContent = winner === me ? 'You win! 🎉' : `${oppName} wins`;
    const who = winner === me ? 'You' : oppName;
    if (reason === 'hq') $('overWhy').textContent = `${who} placed a troop on the enemy H.Q.`;
    else if (reason === 'medals') $('overWhy').textContent = `${who} reached the medals target.`;
    else {
      const stuckName = stuck === me ? 'You' : oppName;
      $('overWhy').textContent = `${stuckName} could not draw or place a troop. Medals: you ${s.medals[me]}, ${oppName} ${s.medals[1 - me]}${s.medals[0] === s.medals[1] ? ' (a tie, so the player who got stuck loses)' : ''}.`;
    }
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
    store.set('toybattle.name', name);
    return name;
  }

  function onlineReady() {
    if (typeof Peer !== 'undefined') return true;
    toast('Online play needs an internet connection');
    return false;
  }

  function initTerrain() {
    const select = $('terrainSelect');
    select.innerHTML = B.ORDER.map((id) => `<option value="${id}">${esc(B.get(id).name)}</option>`).join('');
    const saved = store.get('toybattle.terrain');
    select.value = B.ORDER.includes(saved) ? saved : 'castle';
    const update = () => {
      store.set('toybattle.terrain', select.value);
      $('terrainBlurb').textContent = B.get(select.value).blurb;
    };
    select.addEventListener('change', update);
    update();
  }

  function initHome() {
    $('nameInput').value = store.get('toybattle.name') || store.get('hocuspocus.name') || store.get('scout.name') || store.get('lostcities.name') || store.get('agentavenue.name') || store.get('qwinto.name') || '';
    const join = Net.normalizeCode(new URLSearchParams(location.search).get('join'));
    if (join) $('codeInput').value = join;
    const saved = store.get(SESSION_KEY);
    $('resumeBtn').hidden = !saved;
    if (saved) $('resumeBtn').textContent = saved.role === 'solo' ? 'Resume your solo game' : `Resume game in room ${saved.code}`;
  }

  function tapNode(id) {
    const s = view();
    if (!s || s.phase === 'over' || s.active !== app.seat || app.busy) return;
    const me = app.seat;
    if (s.phase === 'turn' || s.phase === 'extra') {
      if (!app.sel) return toast('Tap one of your troops first');
      const problem = G.slotProblem(s, me, app.sel, id);
      if (problem) return toast(problem);
      act({ type: 'place', troop: app.sel, slot: id });
    } else if (s.phase === 'effect') {
      const acts = G.legalActions(s, me).filter((a) => a.type === 'effect' && a.use);
      const kind = s.pending.kind;
      if (kind === 'discardAdjacent' || kind === 'castle') {
        const hit = acts.find((a) => a.base === id);
        if (hit) act(hit);
        else toast(kind === 'castle' ? 'Pick one of your other troops' : 'Pick an enemy troop next to Jumbo');
      } else if (kind === 'volcano') {
        if (!app.fx) {
          if (acts.some((a) => a.from === id)) {
            app.fx = { from: id };
            render();
          } else toast('Pick an enemy troop next to the volcano');
        } else {
          const hit = acts.find((a) => a.from === app.fx.from && a.to === id);
          if (hit) act(hit);
          else toast('Pick a base next to that troop');
        }
      }
    }
  }

  $('createBtn').addEventListener('click', () => {
    const name = requireName();
    if (!name || !onlineReady()) return;
    startHost({ role: 'host', code: Net.makeCode(), name, terrain: $('terrainSelect').value, guestToken: null, state: null });
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
    startSolo({ role: 'solo', code: 'SOLO', name, level: chosenLevel(), terrain: $('terrainSelect').value, state: null });
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

  $('board').addEventListener('click', (e) => {
    const hit = e.target.closest('[data-node]');
    if (hit) tapNode(hit.dataset.node);
  });

  $('rack').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile.pickable');
    if (!tile) return;
    app.sel = app.sel === tile.dataset.id ? null : tile.dataset.id;
    render();
  });

  $('discard').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile.pickable');
    if (tile) act({ type: 'effect', use: true, troop: tile.dataset.id });
  });

  $('bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'draw') act({ type: 'draw' });
    else if (a === 'use') act({ type: 'effect', use: true });
    else if (a === 'skip') act({ type: 'effect', use: false });
    else if (a === 'cancel') { app.sel = null; render(); }
    else if (a === 'back') { app.fx = null; render(); }
    else if (a === 'results') openOver();
  });

  $('nextBtn').addEventListener('click', () => {
    $('overDialog').close();
    act({ type: 'rematch' });
  });
  $('closeOverBtn').addEventListener('click', () => $('overDialog').close());

  initTerrain();
  initLevels();
  initHome();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
  }
})();
