/* Mancala (Kalah): draws the board and turns taps into sowing. The frame (lobby, network, solo, saved games) is
   ../shared/shell.js. Your six pits are the bottom row, left to right, and your store is on the right. */
(function () {
  'use strict';

  const G = window.Mancala;
  const { PITS, first, store } = G;
  const $ = (id) => document.getElementById(id);

  const COLOURS = ['#e8c35a', '#d9533f', '#4fa3d9', '#5fbf7a', '#f2f2f2', '#b36bd6'];

  // Seeds are scattered in a little spiral so a pit with more seeds looks fuller; the number says the real count.
  function seedsHtml(n, key) {
    let out = '';
    const shown = Math.min(n, 16);
    for (let i = 0; i < shown; i++) {
      const angle = i * 2.4 + key;
      const r = Math.sqrt(i + 0.5) * 11.5;
      const x = 50 + Math.cos(angle) * r;
      const y = 50 + Math.sin(angle) * r;
      out += `<i class="seed" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--sc:${COLOURS[(i + key) % COLOURS.length]}"></i>`;
    }
    return `<span class="seeds" aria-hidden="true">${out}</span>`;
  }

  function render(ctx) {
    const { s, seat, myTurn } = ctx;
    const me = seat;
    const opp = 1 - seat;
    const options = new Set(myTurn ? G.legalPits(s, me) : []);
    const lastIdx = s.last ? s.last.pit : null;

    const who = (i, name) => `<div class="who${s.active === i && s.phase !== 'over' ? ' turn' : ''}"><span>${ctx.esc(name)}</span><b>${s.pits[store(i)]}</b><small>in store · ${s.wins[i]} ${s.wins[i] === 1 ? 'game' : 'games'} won</small></div>`;
    $('scoreboard').innerHTML = who(me, 'You') + `<div class="mid">Seeds on the board<b>${s.pits.slice(0, 6).concat(s.pits.slice(7, 13)).reduce((a, b) => a + b, 0)}</b></div>` + who(opp, s.players[opp].name);

    let html = '';
    // the other player's pits along the top: their first pit is on the right, next to nothing, and their store is on the left
    for (let j = 0; j < PITS; j++) {
      const n = s.pits[first(opp) + j];
      html += `<div class="pit theirs${s.last && s.last.who === opp && lastIdx === j ? ' last' : ''}" style="grid-row:1;grid-column:${7 - j}" aria-label="Their pit ${j + 1}: ${n} seeds">${seedsHtml(n, j + 3)}<span class="n">${n}</span></div>`;
    }
    html += `<div class="storeCell theirs" aria-label="${ctx.esc(s.players[opp].name)}'s store: ${s.pits[store(opp)]}">${seedsHtml(s.pits[store(opp)], 9)}<span class="n">${s.pits[store(opp)]}</span></div>`;
    for (let i = 0; i < PITS; i++) {
      const n = s.pits[first(me) + i];
      const pick = options.has(i) && !ctx.busy;
      const tag = pick ? 'button' : 'div';
      html += `<${tag} class="pit mine${pick ? ' pick' : ''}${s.last && s.last.who === me && lastIdx === i ? ' last' : ''}"${pick ? ` data-pit="${i}"` : ''} style="grid-row:2;grid-column:${2 + i}" aria-label="Your pit ${i + 1}: ${n} seeds">${seedsHtml(n, i + 1)}<span class="n">${n}</span></${tag}>`;
    }
    html += `<div class="storeCell mine" aria-label="Your store: ${s.pits[store(me)]}">${seedsHtml(s.pits[store(me)], 5)}<span class="n">${s.pits[store(me)]}</span></div>`;
    $('board').innerHTML = html;
    $('legend').textContent = s.phase === 'play' ? 'The last seed in your store gives you another turn.' : '';

    const L = s.last;
    if (L) {
      const who2 = L.who === me ? 'You' : s.players[L.who].name;
      $('lastTurn').textContent = `Last move: ${who2} sowed ${L.seeds} seed${L.seeds === 1 ? '' : 's'}${L.extra ? ' and finished in the store: another turn' : ''}${L.captured ? ` and captured ${L.captured}` : ''}.`;
    } else $('lastTurn').textContent = '';

    const btn = (a, text, cls = '') => `<button class="btn small ${cls}" data-act="${a}">${text}</button>`;
    if (s.phase === 'over') ctx.bar('Game over', '', btn('results', 'See result', 'primary'));
    else if (!myTurn) ctx.bar(`${ctx.esc(s.players[s.active].name)} is playing…`);
    else ctx.bar(L && L.who === me && L.extra ? 'Go again!' : 'Your move', 'Tap one of your pits, the bottom row.');
  }

  function bind(getCtx) {
    $('board').addEventListener('click', (e) => {
      const pit = e.target.closest('.pit.pick');
      const ctx = getCtx();
      if (!pit || !ctx.myTurn || ctx.busy) return;
      ctx.act({ type: 'sow', pit: Number(pit.dataset.pit) });
    });
  }

  window.NerdalieShell.start({
    id: 'mancala',
    title: 'Mancala',
    icon: '🪨',
    G,
    Bot: window.MancalaBot,
    needsMe: (s, seat) => s.active === seat,
    result: (s, seat) => (s.end ? { final: true, outcome: s.end.winner == null ? 'draw' : s.end.winner === seat ? 'win' : 'loss', detail: `${s.end.scores[seat]} to ${s.end.scores[1 - seat]}` } : null),
    over: (s, seat) => {
      const opp = 1 - seat;
      const oppName = s.players[opp].name;
      const sc = s.end.scores;
      const won = s.end.winner === seat;
      const draw = s.end.winner == null;
      return {
        title: draw ? 'A draw' : won ? 'You win! 🎉' : `${oppName} wins`,
        why: draw ? `Level on ${sc[seat]} seeds each.` : `${won ? 'You finished' : `${oppName} finished`} with ${sc[s.end.winner]} seeds to ${sc[1 - s.end.winner]}.`,
        html: `<tr><th></th><th>You</th><th>${oppName.replace(/[<>&]/g, '')}</th></tr><tr class="total"><td>Seeds</td><td>${sc[seat]}</td><td>${sc[opp]}</td></tr><tr class="match"><td>Games won</td><td>${s.wins[seat]}</td><td>${s.wins[opp]}</td></tr>`,
        button: 'Play again',
      };
    },
    render,
    bind,
    otherNames: ['reversi.name', 'santorini.name'],
  });
})();
