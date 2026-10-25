/* The common frame of the newer online games: the home, lobby and game screens, playing a friend over PeerJS (the host's
   browser is the referee) or the computer, saved games, reconnecting, the "your move" title and the results the Game
   Night page collects. A game gives it the rules, the computer player and how to draw the table:

     NerdalieShell.start({
       id: 'santorini', title: 'Santorini', icon: '🏛️',
       G, Bot,                                  // rules: newGame(names, starter), apply(state, seat, action), viewFor(state, seat)
       needsMe: (s, seat) => boolean,           // is it this player's move
       result: (s, seat) => null | { final, outcome: 'win'|'loss'|'draw', detail, coop },   // once the game (or a round) is over
       over: (s, seat) => { title, why, html, button },                                    // fills the end-of-game dialog
       render: (ctx) => {},                     // draw the table; ctx = { s, seat, myTurn, solo, act, toast, bar, rerender, app }
       bind: (getCtx) => {},                    // once: attach clicks on the table using getCtx() for fresh state
       otherNames: ['jaipur.name'], botDelay: 850,
     });

   The page has the standard element ids (home, lobby, game, nameInput, createBtn, ...). */
(function (root) {
  'use strict';

  function start(cfg) {
    const { G, Bot } = cfg;
    const Net = root.NerdalieNet.create(`${cfg.id}-v1-`);
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    const store = {
      get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
      del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
    };
    const SESSION_KEY = `${cfg.id}.session`;
    const hub = root.NerdalieHub ? root.NerdalieHub.game(cfg.id, cfg.title) : null;
    const botDelay = cfg.botDelay || 850;

    const app = {
      role: null, // 'host' | 'guest'
      solo: false, // against the computer: this browser is the host, with no network
      seat: 0,
      session: null, // saved: { role, code, name, token | guestToken, level, state, recorded }
      state: null, // host: the full state; guest: what the host sends
      net: null,
      connected: false,
      guestLink: null,
      busy: false,
      overShown: false,
      hostRetries: 0,
    };

    // ---------- small helpers ----------
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
      let t = store.get(`${cfg.id}.token`);
      if (!t) {
        t = (crypto.randomUUID && crypto.randomUUID()) || Net.makeCode(16);
        store.set(`${cfg.id}.token`, t);
      }
      return t;
    }

    function saveSession() {
      if (app.role === 'host') app.session.state = app.state;
      store.set(SESSION_KEY, app.session);
    }

    const view = () => (app.state && app.role === 'host' ? G.viewFor(app.state, 0) : app.state);
    const myTurn = (s) => !!s && s.phase !== 'over' && cfg.needsMe(s, app.seat); // 'over' is the only phase the shell knows about

    function inviteUrl(code) {
      const url = new URL(location.href);
      url.search = '?join=' + code;
      url.hash = '';
      return url.toString();
    }

    // The status line, the small print under it and the buttons of the bar at the bottom. Buttons carry data-act and are
    // handed to cfg.onAction(name, dataset, ctx) when pressed.
    function bar(status, sub = '', buttons = '') {
      $('status').textContent = status;
      $('sub').textContent = sub;
      $('sub').hidden = !sub;
      $('actions').innerHTML = buttons;
    }

    function getCtx() {
      const s = view();
      return { s, seat: app.seat, myTurn: myTurn(s), solo: app.solo, busy: app.busy, connected: app.connected, session: app.session, act, toast, bar, rerender: render, app, esc };
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

    // ---------- solo ----------
    const LEVEL_KEY = `${cfg.id}.level`;
    const LEVELS = ['easy', 'normal', 'hard'];
    let botTimer = null;

    // The computer is player 1. After every action it looks at what it could do and answers after a pause.
    function scheduleBot() {
      clearTimeout(botTimer);
      if (!app.solo || !app.state) return;
      const level = app.session.level || 'normal';
      const next = () => Bot.choose(G.viewFor(app.state, 1), 1, Math.random, level);
      if (app.state.phase === 'over' || !cfg.needsMe(app.state, 1)) return;
      botTimer = setTimeout(() => {
        if (!app.solo || !app.state) return;
        const action = next();
        if (action) applyAction(1, action);
      }, botDelay);
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
      store.del(SESSION_KEY);
      if (hub) hub.leave();
      if ($('overDialog').open) $('overDialog').close();
      history.replaceState(null, '', location.pathname);
      document.title = `${cfg.title} Online`;
      if (cfg.onLeave) cfg.onLeave();
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
        await navigator.share({ title: cfg.title, text: `Play ${cfg.title} with me! Room code: ${code}`, url: inviteUrl(code) });
      } catch (_) { /* user closed the share sheet */ }
    }

    // ---------- the game screen ----------
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
      const ctx = getCtx();
      cfg.render(ctx);
      renderNet(s);

      const needsMe = myTurn(s);
      document.title = needsMe ? `${cfg.icon} Your move · ${cfg.title}` : `${cfg.title} Online`;
      const result = s.phase === 'over' ? cfg.result(s, app.seat) : null;
      const opponent = s.players[1 - app.seat].name;
      if (hub) hub.sync({ needsMe, over: !!(result && result.final), solo: app.solo, opponent, level: app.session && app.session.level, code: app.session && app.session.code });

      if (s.phase === 'over' && !app.overShown) {
        app.overShown = true;
        if (hub && result && result.final && app.session && !app.session.recorded) {
          app.session.recorded = true;
          store.set(SESSION_KEY, app.session);
          hub.finish({ mode: app.solo ? 'solo' : 'online', level: app.solo ? app.session.level : '', opponent: app.solo ? 'Computer' : opponent, outcome: result.outcome, detail: result.detail || '', coop: !!result.coop });
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
      const o = cfg.over(s, app.seat);
      $('overTitle').textContent = o.title;
      $('overWhy').textContent = o.why || '';
      if ($('overTable')) $('overTable').innerHTML = o.html || '';
      $('rematchBtn').textContent = o.button || 'Play again';
      if (!$('overDialog').open) $('overDialog').showModal();
    }

    // ---------- home screen & wiring ----------
    function requireName() {
      const name = $('nameInput').value.trim().slice(0, 16);
      if (!name) {
        toast('Enter your name first');
        $('nameInput').focus();
        return null;
      }
      store.set(`${cfg.id}.name`, name);
      return name;
    }

    function onlineReady() {
      if (typeof Peer !== 'undefined') return true;
      toast('Online play needs an internet connection');
      return false;
    }

    function initHome() {
      const known = [`${cfg.id}.name`, ...(cfg.otherNames || []), 'lostcities.name', 'agentavenue.name', 'qwinto.name'];
      $('nameInput').value = known.map((k) => store.get(k)).find(Boolean) || '';
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

    $('bar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'results') return openOver();
      if (cfg.onAction) cfg.onAction(b.dataset.act, b.dataset, getCtx());
    });

    $('rematchBtn').addEventListener('click', () => {
      $('overDialog').close();
      const s = view();
      if (s && s.phase === 'over') act({ type: 'rematch' });
    });
    $('closeOverBtn').addEventListener('click', () => $('overDialog').close());

    if (cfg.bind) cfg.bind(getCtx);
    initLevels();
    initHome();
    // The Game Night page links here with ?resume to pick up a saved game without pressing the button.
    if (/[?&]resume\b/.test(location.search) && !$('resumeBtn').hidden) $('resumeBtn').click();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline install is optional */ });
    }
    return { app, act, render };
  }

  root.NerdalieShell = { start };
})(window);
