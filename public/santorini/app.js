/* Santorini: draws the island and turns taps into placements, moves and builds. The frame (lobby, network, solo, saved
   games) is ../shared/shell.js. */
(function () {
  'use strict';

  const G = window.Santorini;
  const { SIZE } = G;
  const $ = (id) => document.getElementById(id);

  let from = null; // the builder picked to move, as a square number

  const squareName = (i) => `${'ABCDE'[i % SIZE]}${Math.floor(i / SIZE) + 1}`;

  function render(ctx) {
    const { s, seat, myTurn } = ctx;
    const me = seat;
    const opp = 1 - seat;
    if (!myTurn || s.pending) from = null;
    if (from != null && !s.builders[me].includes(from)) from = null;

    const placing = s.phase === 'place';
    const moves = myTurn && s.phase === 'play' && !s.pending ? G.legalMoves(s, me) : [];
    const movable = new Set(moves.map((m) => m.from));
    const goTo = new Set(moves.filter((m) => m.from === from).map((m) => m.to));
    const buildAt = new Set(myTurn && s.pending ? G.legalBuilds(s, me) : []);
    const placeAt = new Set(myTurn && placing ? G.legalPlacements(s, me) : []);
    const last = s.last ? [s.last.from, s.last.to, s.last.build, s.last.at].filter((x) => x != null) : [];

    const who = (i, name, cls) => `<div class="who${s.active === i && s.phase !== 'over' ? ' turn' : ''}"><span><i class="swatch ${cls}"></i>${ctx.esc(name)}</span><b>${s.wins[i]}</b><small>${s.wins[i] === 1 ? 'game won' : 'games won'}</small></div>`;
    $('scoreboard').innerHTML = who(me, 'You', 'mine') + `<div class="mid">Turn<b>${placing ? 'setup' : s.turn}</b></div>` + who(opp, s.players[opp].name, 'theirs');

    let html = '';
    for (let i = 0; i < G.N; i++) {
      const q = s.board[i];
      const go = goTo.has(i);
      const build = buildAt.has(i);
      const place = placeAt.has(i);
      const can = !from && movable.has(i);
      const sel = from === i;
      const clickable = go || build || place || movable.has(i);
      const cls = ['sq', clickable && 'pick', go && 'go', build && 'build', place && 'go', can && 'can', sel && 'sel', last.includes(i) && 'last'].filter(Boolean).join(' ');
      const layers = [1, 2, 3].filter((l) => q.h >= l).map((l) => `<span class="lv l${l}"></span>`).join('');
      const dome = q.dome ? '<span class="dome"></span>' : '';
      const level = q.h && !q.dome ? `<span class="hn">${q.h}</span>` : '';
      const builder = q.w >= 0 ? `<span class="bld ${q.w === me ? 'mine' : 'theirs'}"></span>` : '';
      const label = `${squareName(i)}: ${q.dome ? 'dome' : q.h ? `level ${q.h}` : 'ground'}${q.w >= 0 ? `, ${q.w === me ? 'your' : 'their'} builder` : ''}`;
      html += `<button class="${cls}" data-i="${i}" role="gridcell" aria-label="${label}">${layers}${dome}${level}${builder}</button>`;
    }
    $('board').innerHTML = html;
    $('legend').textContent = s.phase === 'play' ? 'Tap a number to see how high a tower is. Level 3 + a dome closes a square.' : '';

    const L = s.last;
    if (L) {
      const who2 = L.who === me ? 'You' : s.players[L.who].name;
      if (L.kind === 'place') $('lastTurn').textContent = `Last turn: ${who2} placed a builder on ${squareName(L.at)}.`;
      else if (L.kind === 'move') {
        $('lastTurn').textContent = `Last turn: ${who2} moved ${squareName(L.from)} to ${squareName(L.to)}${L.up ? ' (up)' : ''}${L.build != null ? ` and ${L.dome ? 'domed' : 'built on'} ${squareName(L.build)}` : ''}.`;
      }
    } else $('lastTurn').textContent = '';

    const mine = s.builders[me].length;
    const btn = (a, text, cls = '') => `<button class="btn small ${cls}" data-act="${a}">${text}</button>`;
    if (s.phase === 'over') ctx.bar('Game over', '', btn('results', 'See result', 'primary'));
    else if (!myTurn) ctx.bar(placing ? `${ctx.esc(s.players[s.active].name)} is placing a builder…` : `${ctx.esc(s.players[s.active].name)} is playing…`);
    else if (placing) ctx.bar(`Place your builders (${mine} of 2 down)`, 'Tap an empty square. The middle gives you the most room.');
    else if (s.pending) ctx.bar('Now build next to your builder', 'Tap a highlighted square: one more level, or a dome on a level 3.');
    else if (from == null) ctx.bar('Your move: pick a builder', 'Glowing builders can move.');
    else ctx.bar('Where to?', 'Climb one level at most. Green squares are open.', btn('clear', 'Pick another', 'ghost'));
  }

  function bind(getCtx) {
    $('board').addEventListener('click', (e) => {
      const cell = e.target.closest('.sq');
      const ctx = getCtx();
      if (!cell || !ctx.myTurn || ctx.busy) return;
      const { s, seat } = ctx;
      const i = Number(cell.dataset.i);
      if (s.phase === 'place') {
        if (G.legalPlacements(s, seat).includes(i)) ctx.act({ type: 'place', at: i });
        return;
      }
      if (s.pending) {
        if (G.legalBuilds(s, seat).includes(i)) ctx.act({ type: 'build', at: i });
        return;
      }
      const moves = G.legalMoves(s, seat);
      if (s.builders[seat].includes(i)) {
        from = from === i ? null : moves.some((m) => m.from === i) ? i : (ctx.toast('That builder is stuck'), from);
        return ctx.rerender();
      }
      if (from != null && moves.some((m) => m.from === from && m.to === i)) {
        const move = { type: 'move', from, to: i };
        from = null;
        ctx.act(move);
      }
    });
  }

  function onAction(name, data, ctx) {
    if (name === 'clear') {
      from = null;
      ctx.rerender();
    }
  }

  window.NerdalieShell.start({
    id: 'santorini',
    title: 'Santorini',
    icon: '🏛️',
    G,
    Bot: window.SantoriniBot,
    needsMe: (s, seat) => s.active === seat,
    result: (s, seat) => (s.end ? { final: true, outcome: s.end.winner === seat ? 'win' : 'loss', detail: s.end.reason === 'summit' ? 'reached the top' : 'opponent had no move' } : null),
    over: (s, seat) => {
      const opp = 1 - seat;
      const oppName = s.players[opp].name;
      const won = s.end.winner === seat;
      const who = won ? 'You' : oppName;
      return {
        title: won ? 'You win! 🎉' : `${oppName} wins`,
        why: s.end.reason === 'summit' ? `${who} climbed up onto a level 3 tower.` : `${won ? oppName : 'You'} couldn't make a move.`,
        html: `<tr><th></th><th>You</th><th>${oppName.replace(/[<>&]/g, '')}</th></tr><tr class="match"><td>Games won</td><td>${s.wins[seat]}</td><td>${s.wins[opp]}</td></tr>`,
        button: 'Play again',
      };
    },
    render,
    bind,
    onAction,
    otherNames: ['onitama.name', 'jaipur.name'],
  });
})();
