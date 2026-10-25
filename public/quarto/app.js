/* Quarto: draws the board, the piece in hand and the pieces left, and turns taps into placing and giving. The frame
   (lobby, network, solo, saved games) is ../shared/shell.js. */
(function () {
  'use strict';

  const G = window.Quarto;
  const { N } = G;
  const $ = (id) => document.getElementById(id);

  let chosen = null; // a piece picked from the pool, waiting to be confirmed

  // a piece drawn from its four features
  const pieceHtml = (p) => `<span class="pc ${p & 1 ? 'tall' : 'short'} ${p & 2 ? 'dark' : 'light'} ${p & 4 ? 'round' : 'square'} ${p & 8 ? 'hollow' : 'solid'}" aria-hidden="true"></span>`;

  function render(ctx) {
    const { s, seat, myTurn } = ctx;
    const me = seat;
    const opp = 1 - seat;
    if (!myTurn || s.phase !== 'give') chosen = null;
    if (chosen != null && !s.pool.includes(chosen)) chosen = null;

    const placing = myTurn && s.phase === 'place';
    const giving = myTurn && s.phase === 'give';
    const danger = (piece) => G.winningSquares(s.board, piece).length > 0;

    const who = (i, name) => `<div class="who${s.active === i && s.phase !== 'over' ? ' turn' : ''}"><span>${ctx.esc(name)}</span><b>${s.wins[i]}</b><small>${s.wins[i] === 1 ? 'game won' : 'games won'}</small></div>`;
    $('scoreboard').innerHTML = who(me, 'You') + `<div class="mid">Pieces left<b>${s.pool.length + (s.hand >= 0 ? 1 : 0)}</b></div>` + who(opp, s.players[opp].name);

    // the piece in hand
    if (s.phase === 'place') {
      $('handTitle').textContent = placing ? 'Place this piece' : `${s.players[s.active].name} places this piece`;
      $('handHint').textContent = placing ? 'tap a square' : '';
      $('handBox').innerHTML = `${pieceHtml(s.hand)}<div class="what"><b>${G.name(s.hand)}</b><small>${placing ? 'You were given this piece.' : 'You gave them this piece.'}</small></div>`;
    } else if (s.phase === 'give') {
      $('handTitle').textContent = giving ? 'Choose a piece to give' : `${s.players[s.active].name} is choosing a piece`;
      $('handHint').textContent = '';
      $('handBox').innerHTML = chosen != null
        ? `${pieceHtml(chosen)}<div class="what"><b>${G.name(chosen)}</b><small>${danger(chosen) ? '⚠ They could win with this one!' : 'Give it to them?'}</small></div>`
        : `<div class="what"><b>${giving ? 'Pick one from the pieces below' : 'Waiting…'}</b><small>${giving ? 'They will have to place it.' : ''}</small></div>`;
    } else {
      $('handTitle').textContent = 'Game over';
      $('handHint').textContent = '';
      $('handBox').innerHTML = '';
    }

    // the board
    const line = s.end && s.end.line ? s.end.line : [];
    const lastAt = s.last && s.last.kind === 'place' ? s.last.at : null;
    let html = '';
    for (let i = 0; i < N; i++) {
      const p = s.board[i];
      const pick = placing && p < 0 && !ctx.busy;
      const cls = ['sq', pick && 'pick', lastAt === i && 'last', line.includes(i) && 'win'].filter(Boolean).join(' ');
      const label = `Square ${i + 1}: ${p >= 0 ? G.name(p) : pick ? 'empty, you can place here' : 'empty'}`;
      html += `<button class="${cls}" data-i="${i}" role="gridcell" aria-label="${label}">${p >= 0 ? pieceHtml(p) : ''}</button>`;
    }
    $('board').innerHTML = html;

    // the pool: the pieces nobody has been given yet
    let pool = '';
    for (let p = 0; p < N; p++) {
      const here = s.pool.includes(p);
      const pick = giving && here && !ctx.busy;
      const cls = ['slot', !here && 'gone', pick && 'pick', chosen === p && 'sel', pick && danger(p) && 'risky'].filter(Boolean).join(' ');
      pool += here ? `<button class="${cls}" data-p="${p}" aria-label="${G.name(p)}">${pieceHtml(p)}</button>` : `<span class="${cls}"></span>`;
    }
    $('pool').innerHTML = pool;
    $('poolHint').textContent = giving ? 'tap one to give' : '';
    $('legend').textContent = s.phase === 'over' ? '' : 'A line of four that shares a feature wins: tall, dark, round or hollow (or the opposite of any of them).';

    const L = s.last;
    if (L) {
      const who2 = L.who === me ? 'You' : s.players[L.who].name;
      $('lastTurn').textContent = L.kind === 'give' ? `Last move: ${who2} gave the ${G.name(L.piece)} piece.` : `Last move: ${who2} placed the ${G.name(L.piece)} piece on square ${L.at + 1}.`;
    } else $('lastTurn').textContent = '';

    const btn = (a, text, cls = '') => `<button class="btn small ${cls}" data-act="${a}">${text}</button>`;
    if (s.phase === 'over') ctx.bar('Game over', '', btn('results', 'See result', 'primary'));
    else if (!myTurn) ctx.bar(s.phase === 'give' ? `${ctx.esc(s.players[s.active].name)} is choosing your piece…` : `${ctx.esc(s.players[s.active].name)} is placing…`);
    else if (placing) ctx.bar('Place the piece on the board', 'Make a line of four that share a feature. If you can, win now.');
    else if (chosen == null) ctx.bar(s.last ? 'Now choose a piece for them' : 'You start: choose a piece for them', 'Don’t give them one that finishes a line. ⚠ marks the risky ones.');
    else ctx.bar(`Give them the ${G.name(chosen)} piece?`, danger(chosen) ? 'Careful: they could win straight away with it.' : '', btn('give', 'Give it', 'primary') + btn('clear', 'Choose another', 'ghost'));
  }

  function bind(getCtx) {
    $('board').addEventListener('click', (e) => {
      const sq = e.target.closest('.sq.pick');
      const ctx = getCtx();
      if (!sq || !ctx.myTurn || ctx.busy) return;
      ctx.act({ type: 'place', at: Number(sq.dataset.i) });
    });
    $('pool').addEventListener('click', (e) => {
      const slot = e.target.closest('.slot.pick');
      const ctx = getCtx();
      if (!slot || !ctx.myTurn) return;
      const p = Number(slot.dataset.p);
      chosen = chosen === p ? null : p;
      ctx.rerender();
    });
  }

  function onAction(name, data, ctx) {
    if (name === 'clear') {
      chosen = null;
      ctx.rerender();
    } else if (name === 'give' && chosen != null) {
      const piece = chosen;
      chosen = null;
      ctx.act({ type: 'give', piece });
    }
  }

  window.NerdalieShell.start({
    id: 'quarto',
    title: 'Quarto',
    icon: '🧩',
    G,
    Bot: window.QuartoBot,
    needsMe: (s, seat) => s.active === seat,
    result: (s, seat) => (s.end ? { final: true, outcome: s.end.winner == null ? 'draw' : s.end.winner === seat ? 'win' : 'loss', detail: s.end.shared ? `four ${s.end.shared.join(' and ')}` : 'board full' } : null),
    over: (s, seat) => {
      const opp = 1 - seat;
      const oppName = s.players[opp].name;
      const won = s.end.winner === seat;
      const draw = s.end.winner == null;
      return {
        title: draw ? 'A draw' : won ? 'You win! 🎉' : `${oppName} wins`,
        why: draw ? 'The board filled up with no line.' : `${won ? 'You made' : `${oppName} made`} a line of four that are all ${s.end.shared.join(' and ')}.`,
        html: `<tr><th></th><th>You</th><th>${oppName.replace(/[<>&]/g, '')}</th></tr><tr class="match"><td>Games won</td><td>${s.wins[seat]}</td><td>${s.wins[opp]}</td></tr>`,
        button: 'Play again',
      };
    },
    render,
    bind,
    onAction,
    otherNames: ['mancala.name', 'reversi.name'],
  });
})();
