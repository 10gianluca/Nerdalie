/* Reversi: draws the board and turns taps into moves. The frame (lobby, network, solo, saved games) is
   ../shared/shell.js. */
(function () {
  'use strict';

  const G = window.Reversi;
  const { SIZE } = G;
  const $ = (id) => document.getElementById(id);

  const colour = (seat) => (seat === 0 ? 'black' : 'white');
  const squareName = (i) => `${'abcdefgh'[i % SIZE]}${Math.floor(i / SIZE) + 1}`;

  function render(ctx) {
    const { s, seat, myTurn } = ctx;
    const me = seat;
    const opp = 1 - seat;
    const moves = new Set(myTurn ? G.legalMoves(s, me) : []);
    const counts = G.count(s.board);

    const who = (i, name) => `<div class="who${s.active === i && s.phase !== 'over' ? ' turn' : ''}"><span><i class="swatch ${colour(i)}"></i>${ctx.esc(name)}</span><b>${counts[i]}</b><small>${s.wins[i]} ${s.wins[i] === 1 ? 'game' : 'games'} won</small></div>`;
    $('scoreboard').innerHTML = who(me, 'You') + `<div class="mid">Discs<b>${counts[0] + counts[1]} of 64</b></div>` + who(opp, s.players[opp].name);

    let html = '';
    for (let i = 0; i < G.N; i++) {
      const v = s.board[i];
      const legal = moves.has(i) && !ctx.busy;
      const cls = ['cell', legal && 'legal', s.last && s.last.at === i && 'last'].filter(Boolean).join(' ');
      const label = `${squareName(i)}: ${v < 0 ? (legal ? 'you can play here' : 'empty') : `${colour(v)} disc`}`;
      html += `<button class="${cls}" data-i="${i}" role="gridcell" aria-label="${label}">${v >= 0 ? `<span class="disc ${colour(v)}"></span>` : ''}</button>`;
    }
    $('board').innerHTML = html;
    $('legend').textContent = s.phase === 'play' ? 'Corners can never be flipped.' : '';

    const L = s.last;
    if (L) {
      const who2 = L.who === me ? 'You' : s.players[L.who].name;
      const pass = L.passed ? ` ${L.passer === me ? 'You have' : `${s.players[L.passer].name} has`} no move and passes.` : '';
      $('lastTurn').textContent = `Last move: ${who2} played ${squareName(L.at)} and flipped ${L.flipped}.${pass}`;
    } else $('lastTurn').textContent = '';

    const btn = (a, text, cls = '') => `<button class="btn small ${cls}" data-act="${a}">${text}</button>`;
    if (s.phase === 'over') ctx.bar('Game over', '', btn('results', 'See result', 'primary'));
    else if (!myTurn) ctx.bar(`${ctx.esc(s.players[s.active].name)} is playing…`);
    else ctx.bar('Your move', `You are ${colour(me)}. Tap a square with a dot.`);
  }

  function bind(getCtx) {
    $('board').addEventListener('click', (e) => {
      const cell = e.target.closest('.cell.legal');
      const ctx = getCtx();
      if (!cell || !ctx.myTurn || ctx.busy) return;
      ctx.act({ type: 'move', at: Number(cell.dataset.i) });
    });
  }

  window.NerdalieShell.start({
    id: 'reversi',
    title: 'Reversi',
    icon: '⚫',
    G,
    Bot: window.ReversiBot,
    needsMe: (s, seat) => s.active === seat,
    result: (s, seat) => {
      if (!s.end) return null;
      const c = s.end.counts;
      return { final: true, outcome: s.end.winner == null ? 'draw' : s.end.winner === seat ? 'win' : 'loss', detail: `${c[seat]} to ${c[1 - seat]} discs` };
    },
    over: (s, seat) => {
      const opp = 1 - seat;
      const oppName = s.players[opp].name;
      const c = s.end.counts;
      const won = s.end.winner === seat;
      const draw = s.end.winner == null;
      return {
        title: draw ? 'A draw' : won ? 'You win! 🎉' : `${oppName} wins`,
        why: draw ? `Level on ${c[seat]} discs each.` : `${won ? 'You finished' : `${oppName} finished`} with ${c[s.end.winner]} discs to ${c[1 - s.end.winner]}.`,
        html: `<tr><th></th><th>You</th><th>${oppName.replace(/[<>&]/g, '')}</th></tr><tr class="total"><td>Discs</td><td>${c[seat]}</td><td>${c[opp]}</td></tr><tr class="match"><td>Games won</td><td>${s.wins[seat]}</td><td>${s.wins[opp]}</td></tr>`,
        button: 'Play again',
      };
    },
    render,
    bind,
    otherNames: ['santorini.name', 'onitama.name'],
  });
})();
