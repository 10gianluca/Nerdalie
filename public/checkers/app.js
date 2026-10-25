/* Checkers: draws the board and turns taps into moves (a jump can take several taps: one for each landing square). The frame
   (lobby, network, solo, saved games) is ../shared/shell.js. */
(function () {
  'use strict';

  const G = window.Checkers;
  const { SIZE, N, owner, isKing } = G;
  const $ = (id) => document.getElementById(id);

  let path = []; // the squares tapped so far for the move being made: the piece first, then each landing square

  const squareName = (i) => `${'abcdefgh'[i % SIZE]}${SIZE - Math.floor(i / SIZE)}`;

  function render(ctx) {
    const { s, seat, myTurn } = ctx;
    const me = seat;
    const opp = 1 - seat;
    if (!myTurn) path = [];

    const moves = myTurn ? G.movesOn(s.board, me) : [];
    const starts = new Set(moves.map((m) => m.path[0]));
    const alive = moves.filter((m) => path.every((sq, i) => m.path[i] === sq));
    if (path.length && !alive.length) path = [];
    const next = new Set(path.length ? alive.filter((m) => m.path.length > path.length).map((m) => m.path[path.length]) : []);
    const mustJump = moves.length > 0 && moves[0].captures.length > 0;
    const trail = s.last ? s.last.path : [];
    const counts = G.count(s.board);

    const who = (i, name, cls) => `<div class="who${s.active === i && s.phase !== 'over' ? ' turn' : ''}"><span><i class="swatch ${cls}"></i>${ctx.esc(name)}</span><b>${counts[i]}</b><small>pieces · ${s.wins[i]} ${s.wins[i] === 1 ? 'game' : 'games'} won</small></div>`;
    $('scoreboard').innerHTML = who(me, 'You', 'mine') + `<div class="mid">Move<b>${s.turn}</b></div>` + who(opp, s.players[opp].name, 'theirs');

    // your side is always at the bottom, so seat 1 sees the board turned round
    const cells = Array(N);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        const p = s.board[i];
        const row = me === 0 ? y : SIZE - 1 - y;
        const col = me === 0 ? x : SIZE - 1 - x;
        const dark = (x + y) % 2 === 1;
        const go = next.has(i);
        const sel = path[0] === i;
        const startable = myTurn && path.length < 2 && starts.has(i); // before a jump is under way you can change your mind
        const can = startable && !path.length;
        const pick = go || startable || sel;
        const cls = ['sq', dark && 'dark', pick && 'pick', go && 'go', sel && 'sel', can && 'can', trail.includes(i) && 'last'].filter(Boolean).join(' ');
        const pawn = p >= 0 ? `<span class="pawn ${owner(p) === me ? 'mine' : 'theirs'}${isKing(p) ? ' king' : ''}"></span>` : '';
        const label = `${squareName(i)}: ${p >= 0 ? `${owner(p) === me ? 'your' : 'their'} ${isKing(p) ? 'king' : 'man'}` : 'empty'}${go ? ', you can move here' : ''}`;
        cells[row * SIZE + col] = `<button class="${cls}" data-i="${i}" role="gridcell" aria-label="${label}"${dark ? '' : ' tabindex="-1"'}>${pawn}</button>`;
      }
    }
    $('board').innerHTML = cells.join('');
    $('legend').textContent = s.phase === 'play' ? 'Jumping is compulsory. Reach the far row to be crowned.' : '';

    const L = s.last;
    if (L) {
      const who2 = L.who === me ? 'You' : s.players[L.who].name;
      const jumped = L.captured ? ` and captured ${L.captured}` : '';
      $('lastTurn').textContent = `Last move: ${who2} went ${squareName(L.path[0])} to ${squareName(L.path[L.path.length - 1])}${jumped}${L.crowned ? ', and was crowned' : ''}.`;
    } else $('lastTurn').textContent = '';

    const btn = (a, text, cls = '') => `<button class="btn small ${cls}" data-act="${a}">${text}</button>`;
    if (s.phase === 'over') ctx.bar('Game over', '', btn('results', 'See result', 'primary'));
    else if (!myTurn) ctx.bar(`${ctx.esc(s.players[s.active].name)} is playing…`);
    else if (path.length) ctx.bar(path.length > 1 ? 'Keep jumping' : 'Tap where it goes', path.length > 1 ? 'This jump has to carry on. The green dots are where it can land.' : 'The green dots are where this piece can go.', btn('clear', 'Cancel', 'ghost'));
    else ctx.bar(mustJump ? 'You have to jump' : 'Your move', mustJump ? 'Pick a glowing piece that can capture.' : 'Pick a glowing piece, then where it goes.');
  }

  function bind(getCtx) {
    $('board').addEventListener('click', (e) => {
      const cell = e.target.closest('.sq.pick');
      const ctx = getCtx();
      if (!cell || !ctx.myTurn || ctx.busy) return;
      const i = Number(cell.dataset.i);
      const moves = G.movesOn(ctx.s.board, ctx.seat);
      if (!path.length || (!moves.some((m) => m.path[0] === path[0] && m.path.length > path.length && m.path[path.length] === i) && moves.some((m) => m.path[0] === i))) {
        path = path[0] === i ? [] : [i]; // pick (or switch to) a piece
        return ctx.rerender();
      }
      const stepped = path.concat(i);
      const done = moves.find((m) => m.path.length === stepped.length && m.path.every((sq, k) => sq === stepped[k]));
      if (done) {
        path = [];
        ctx.act({ type: 'move', path: done.path });
      } else {
        path = stepped; // a jump with more to come
        ctx.rerender();
      }
    });
  }

  function onAction(name, data, ctx) {
    if (name === 'clear') {
      path = [];
      ctx.rerender();
    }
  }

  window.NerdalieShell.start({
    id: 'checkers',
    title: 'Checkers',
    icon: '🔴',
    G,
    Bot: window.CheckersBot,
    needsMe: (s, seat) => s.active === seat,
    result: (s, seat) => (s.end ? { final: true, outcome: s.end.winner == null ? 'draw' : s.end.winner === seat ? 'win' : 'loss', detail: ({ captured: 'took every piece', blocked: 'no move left', quiet: 'forty quiet moves' })[s.end.reason] || '' } : null),
    over: (s, seat) => {
      const opp = 1 - seat;
      const oppName = s.players[opp].name;
      const won = s.end.winner === seat;
      const draw = s.end.winner == null;
      const who = won ? 'You' : oppName;
      const why = { captured: `${who} captured every piece.`, blocked: `${won ? oppName : 'You'} had no move left.`, quiet: 'Forty moves each went by with no capture and no man moving.' }[s.end.reason];
      return {
        title: draw ? 'A draw' : won ? 'You win! 🎉' : `${oppName} wins`,
        why,
        html: `<tr><th></th><th>You</th><th>${oppName.replace(/[<>&]/g, '')}</th></tr><tr class="total"><td>Pieces left</td><td>${G.count(s.board)[seat]}</td><td>${G.count(s.board)[opp]}</td></tr><tr class="match"><td>Games won</td><td>${s.wins[seat]}</td><td>${s.wins[opp]}</td></tr>`,
        button: 'Play again',
      };
    },
    render,
    bind,
    onAction,
    otherNames: ['quarto.name', 'mancala.name'],
  });
})();
