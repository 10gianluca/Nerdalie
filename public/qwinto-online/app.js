/* UI controller: screens, rendering, and wiring game actions to the network. */
(function () {
  'use strict';

  const Q = window.Qwinto;
  const Net = window.QwintoNet;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SESSION_KEY = 'qwinto.session';

  const app = {
    role: null, // 'host' | 'guest'
    seat: 0,
    session: null, // persisted: { role, code, name, token | guestToken, state }
    state: null, // host: full state; guest: masked view from host
    net: null,
    connected: false,
    guestLink: null,
    picked: null, // tentatively tapped cell { color, col }
    busy: false,
    seenRoll: 0,
    seenTurn: 0,
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
    let t = store.get('qwinto.token');
    if (!t) {
      t = (crypto.randomUUID && crypto.randomUUID()) || Net.makeCode(16);
      store.set('qwinto.token', t);
    }
    return t;
  }

  function saveSession() {
    if (app.role === 'host') app.session.state = app.state;
    store.set(SESSION_KEY, app.session);
  }

  const view = () => (app.state && app.role === 'host' ? Q.viewFor(app.state, 0) : app.state);
  const nameOf = (s, i) => (i === app.seat ? 'You' : s.players[i].name);

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
      app.state = Q.apply(app.state, player, action);
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
    if (app.state && app.guestLink) app.guestLink.send({ t: 'state', state: Q.viewFor(app.state, 1) });
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
        app.state = Q.newGame([s.name, name], Math.random() < 0.5 ? 0 : 1);
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
    Object.assign(app, { role: null, session: null, state: null, net: null, connected: false, guestLink: null, picked: null, busy: false });
    store.del(SESSION_KEY);
    if ($('overDialog').open) $('overDialog').close();
    history.replaceState(null, '', location.pathname);
    document.title = 'Qwinto Online';
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
      await navigator.share({ title: 'Qwinto', text: `Play Qwinto with me! Room code: ${code}`, url: inviteUrl(code) });
    } catch (_) { /* user closed the share sheet */ }
  }

  // ---------- rendering ----------
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  function dieHtml(color, value, { off, pick, rolling } = {}) {
    const on = PIPS[value] || [];
    const pips = Array.from({ length: 9 }, (_, i) => `<i${on.includes(i) ? ' style="visibility:visible"' : ''}></i>`).join('');
    const cls = ['die', color, off && 'off', pick && 'pick', rolling && 'rolling'].filter(Boolean).join(' ');
    const label = `${color} die${value ? ` showing ${value}` : off ? ', not rolled' : ''}`;
    return `<button class="${cls}" data-color="${color}" aria-label="${label}" ${pick ? '' : 'disabled'}>${pips}</button>`;
  }

  function sheetHtml(sheet, { legal = [], picked = null, sum = null, fresh = [], interactive = false }) {
    const tag = interactive ? 'button' : 'div';
    let html = '';
    Q.COLORS.forEach((color, r) => {
      const cells = Q.LAYOUT[color].cells;
      html += `<div class="band ${color}" style="grid-row:${r + 1};grid-column:${cells[0] + 1}/${cells[cells.length - 1] + 2}"></div>`;
      for (const col of cells) {
        const v = sheet[color][col];
        const at = (m) => m && m.color === color && m.col === col;
        const isPicked = at(picked);
        const bonusWon = Q.isPentagon(color, col) && Q.COLORS.every((c) => sheet[c][col] != null);
        const cls = ['cell', Q.isPentagon(color, col) && 'pent', v != null && 'filled', legal.some(at) && 'legal',
          isPicked && 'picked', fresh.some(at) && 'fresh', bonusWon && 'bonus-won'].filter(Boolean).join(' ');
        const text = v != null ? v : isPicked ? sum : '';
        const hint = legal.some(at) && !isPicked ? ` data-hint="${sum}"` : '';
        const label = interactive ? ` aria-label="${color} row, column ${col + 1}${v != null ? `: ${v}` : ''}"` : '';
        html += `<${tag} class="${cls}" style="grid-row:${r + 1};grid-column:${col + 1}" data-color="${color}" data-col="${col}"${hint}${label}>${text}</${tag}>`;
      }
    });
    return html;
  }

  function stripHtml(sc, fails, full) {
    const failBoxes = `<div class="fails">Failed attempts ${[0, 1, 2, 3].map((i) => `<i>${i < fails ? '✕' : ''}</i>`).join('')}</div>`;
    if (!full) return failBoxes;
    const bonus = sc.bonuses.map((b) => `<span class="b${b != null ? ' won' : ''}">${b != null ? b : ''}</span>`).join('');
    return `<div class="scoreline" aria-label="Score breakdown">
      <span class="o">${sc.rows.orange}</span><em>+</em><span class="y">${sc.rows.yellow}</span><em>+</em><span class="p">${sc.rows.purple}</span><em>+</em>${bonus}
      <em>−</em><span class="f">${sc.penalty}</span><em>=</em><span class="t">${sc.total}</span></div>${failBoxes}`;
  }

  function render() {
    const s = view();
    if (!s || $('game').hidden) return;
    const me = app.seat;
    const opp = 1 - me;
    const sum = s.dice ? Q.sumDice(s.dice) : null;
    const mine = s.pending[me];
    const legal = s.phase === 'enter' && !mine ? Q.legalMoves(s.players[me].sheet, Object.keys(s.dice), sum) : [];
    if (app.picked && !legal.some((m) => m.color === app.picked.color && m.col === app.picked.col)) app.picked = null;

    const newRoll = s.rollId !== app.seenRoll;
    app.seenRoll = s.rollId;
    const freshTurn = s.last && s.last.turn !== app.seenTurn;
    if (s.last) app.seenTurn = s.last.turn;
    const freshFor = (i) => (freshTurn && !s.last.entries[i].pass ? [s.last.entries[i]] : []);

    // players
    const scores = s.players.map((p) => Q.score(p.sheet, p.fails));
    const turnPill = (i) => (s.active === i && s.phase !== 'over' ? '<span class="turn-pill">rolling</span>' : '');
    $('myName').innerHTML = `${esc(s.players[me].name)}<span class="tag">you</span>${turnPill(me)}`;
    $('oppName').innerHTML = `${esc(s.players[opp].name)}${turnPill(opp)}`;
    $('myScore').textContent = `${scores[me].total} pts`;
    $('oppScore').textContent = `${scores[opp].total} pts`;

    const pendingCell = mine && !mine.pass ? mine : null;
    $('mySheet').classList.toggle('entering', legal.length > 0);
    $('mySheet').innerHTML = sheetHtml(s.players[me].sheet, {
      legal, picked: app.picked || pendingCell, sum, fresh: freshFor(me), interactive: true,
    });
    $('oppSheet').innerHTML = sheetHtml(s.players[opp].sheet, { fresh: freshFor(opp) });
    $('myStrip').innerHTML = stripHtml(scores[me], s.players[me].fails, true);
    $('oppStrip').innerHTML = stripHtml(scores[opp], s.players[opp].fails, false);

    renderTable(s, { sum, legal, newRoll });
    renderLast(s);
    renderNet(s);

    const needsMe = (s.phase === 'choose' && s.active === me) || (s.phase === 'rolled' && s.active === me) || (s.phase === 'enter' && !mine);
    document.title = needsMe ? '🎲 Your move · Qwinto' : 'Qwinto Online';

    if (s.phase === 'over' && !app.overShown) {
      app.overShown = true;
      setTimeout(openOver, 700);
    } else if (s.phase !== 'over') {
      app.overShown = false;
      if ($('overDialog').open) $('overDialog').close();
    }
  }

  function renderTable(s, { sum, legal, newRoll }) {
    const me = app.seat;
    const active = s.active === me;
    const roller = s.players[s.active].name;
    const mine = s.pending[me];
    const rolled = () => Object.entries(s.dice).map(([c, v]) => dieHtml(c, v, { rolling: newRoll })).join('') +
      `<div class="sum"><small>Sum</small>${sum}</div>`;
    const btn = (act, label, cls = '') => `<button class="btn ${cls}" data-act="${act}"${app.busy ? ' disabled' : ''}>${label}</button>`;
    let status = '';
    let sub = '';
    let dice = '';
    let actions = '';

    if (s.phase === 'choose') {
      dice = Q.COLORS.map((c) => dieHtml(c, 0, { off: !s.chosen.includes(c), pick: active && !app.busy })).join('');
      if (active) {
        status = 'Your turn: pick your dice';
        sub = 'Tap a die to add or remove it, then roll.';
        const n = s.chosen.length;
        actions = btn('roll', `Roll ${n} ${n === 1 ? 'die' : 'dice'}`, 'primary');
      } else {
        status = `${roller} is choosing dice…`;
      }
    } else if (s.phase === 'rolled') {
      dice = rolled();
      if (active) {
        status = `You rolled ${sum}`;
        sub = 'Keep it, or reroll the same dice once.';
        actions = btn('keep', `Keep ${sum}`, 'primary') + btn('reroll', 'Reroll');
      } else {
        status = `${roller} rolled ${sum}`;
        sub = 'Waiting to see whether they keep it…';
      }
    } else if (s.phase === 'enter') {
      dice = rolled();
      const rows = Object.keys(s.dice).join(' or ');
      if (!mine) {
        if (app.picked) {
          status = `Write ${sum} in ${app.picked.color}?`;
          actions = btn('confirm', 'Confirm', 'primary') + btn('cancel', 'Cancel');
        } else if (legal.length) {
          status = `Write ${sum} in ${rows}`;
          sub = active ? 'Tap a glowing field, or skip and take a failed attempt (−5).' : 'Tap a glowing field, or skip this roll.';
          actions = active ? btn('pass', 'Skip (−5)', 'danger') : btn('pass', 'Skip');
        } else {
          status = `${sum} doesn't fit anywhere`;
          sub = active ? 'You have to take a failed attempt.' : '';
          actions = btn('pass', active ? 'Take failed attempt (−5)' : 'OK', active ? 'danger' : '');
        }
      } else {
        status = mine.pass
          ? active ? 'Failed attempt taken' : mine.auto ? `${sum} doesn't fit on your sheet` : 'You skipped this roll'
          : `You wrote ${sum}`;
        sub = s.pending[1 - me] ? '' : `Waiting for ${s.players[1 - me].name}…`;
      }
    } else if (s.phase === 'over') {
      status = 'Game over';
      actions = btn('results', 'See results', 'primary');
    }

    $('status').textContent = status;
    $('substatus').textContent = sub;
    $('dice').innerHTML = dice;
    $('actions').innerHTML = actions;
  }

  function renderLast(s) {
    const L = s.last;
    if (!L) return ($('lastTurn').textContent = '');
    const parts = L.entries.map((e, i) => {
      const who = nameOf(s, i);
      if (e.pass) return `${who}: ${e.failed ? 'failed attempt' : 'skipped'}`;
      return `${who}: ${e.color}`;
    });
    $('lastTurn').textContent = `Last roll: ${nameOf(s, L.active)} rolled ${L.sum} · ${parts.join(' · ')}`;
  }

  function renderNet(s) {
    $('roomCode').textContent = app.session.code;
    $('netDot').classList.toggle('off', !app.connected);
    const banner = $('netBanner');
    if (app.connected) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      banner.textContent = app.role === 'host'
        ? `${s.players[1].name} is disconnected. Waiting for them to rejoin…`
        : 'Connection lost. Reconnecting…';
    }
  }

  function openOver() {
    const s = view();
    if (!s || s.phase !== 'over') return;
    const me = app.seat;
    const opp = 1 - me;
    const sc = s.players.map((p) => Q.score(p.sheet, p.fails));
    const diff = sc[me].total - sc[opp].total;
    $('overTitle').textContent = diff > 0 ? 'You win! 🎉' : diff < 0 ? `${s.players[opp].name} wins` : "It's a tie";
    const who = nameOf(s, s.end.player);
    $('overWhy').textContent = s.end.reason === 'rows'
      ? `${who} completed two rows.`
      : `${who} took a fourth failed attempt.`;
    const bonus = (x) => x.bonuses.reduce((t, b) => t + (b || 0), 0);
    const row = (label, f, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${f(sc[me])}</td><td>${f(sc[opp])}</td></tr>`;
    $('overTable').innerHTML =
      `<tr><th></th><th>You</th><th>${esc(s.players[opp].name)}</th></tr>` +
      row('Orange', (x) => x.rows.orange) + row('Yellow', (x) => x.rows.yellow) + row('Purple', (x) => x.rows.purple) +
      row('Bonus', bonus) + row('Failed attempts', (x) => (x.penalty ? `−${x.penalty}` : '0')) +
      row('Total', (x) => x.total, 'total');
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
    store.set('qwinto.name', name);
    return name;
  }

  function onlineReady() {
    if (typeof Peer !== 'undefined') return true;
    toast('Online play needs an internet connection');
    return false;
  }

  function initHome() {
    $('nameInput').value = store.get('qwinto.name') || '';
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

  $('dice').addEventListener('click', (e) => {
    const die = e.target.closest('.die.pick');
    const s = view();
    if (!die || !s) return;
    const c = die.dataset.color;
    const next = s.chosen.includes(c) ? s.chosen.filter((x) => x !== c) : s.chosen.concat(c);
    if (!next.length) return toast('Roll at least one die');
    act({ type: 'choose', colors: next });
  });

  $('actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'confirm' && app.picked) {
      const pick = app.picked;
      app.picked = null;
      act({ type: 'enter', color: pick.color, col: pick.col });
    } else if (a === 'cancel') {
      app.picked = null;
      render();
    } else if (a === 'results') {
      openOver();
    } else if (['roll', 'keep', 'reroll', 'pass'].includes(a)) {
      act({ type: a });
    }
  });

  $('mySheet').addEventListener('click', (e) => {
    const cell = e.target.closest('.cell.legal');
    if (!cell) return;
    const pick = { color: cell.dataset.color, col: Number(cell.dataset.col) };
    if (app.picked && app.picked.color === pick.color && app.picked.col === pick.col) {
      app.picked = null;
      act({ type: 'enter', color: pick.color, col: pick.col }); // second tap confirms
    } else {
      app.picked = pick;
      render();
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
