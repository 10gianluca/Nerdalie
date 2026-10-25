/* Schotten Totten: draws the table and turns taps into plays. The frame (lobby, network, solo, saved games) is
   ../shared/shell.js. */
(function () {
  'use strict';

  const G = window.Schotten;
  const { STONES, COLOR_NAMES, ALL } = G;
  const $ = (id) => document.getElementById(id);

  const FORMATION = { 5: 'Colour run', 4: '3 of a kind', 3: 'Colour', 2: 'Run', 1: 'Sum' };
  const label = (id) => `${COLOR_NAMES[id[0]]} ${id.slice(1)}`;
  const order = (id) => G.COLORS.indexOf(id[0]) * 10 + Number(id.slice(1));

  let picked = null; // the card chosen from your hand
  let chosen = null; // the stone chosen for it, waiting to be confirmed

  function cardHtml(id, o = {}) {
    const tag = o.pickable ? 'button' : 'div';
    const cls = ['tcard', 'c-' + id[0], o.pickable && 'pickable', o.sel && 'sel', o.ghost && 'preview', o.last && 'last'].filter(Boolean).join(' ');
    return `<${tag} class="${cls}"${o.pickable ? ` data-card="${id}"` : ''} aria-label="${label(id)}">${id.slice(1)}${o.name ? `<small>${COLOR_NAMES[id[0]]}</small>` : ''}</${tag}>`;
  }

  const slot = '<div class="slot"></div>';

  function formationLabel(cards) {
    if (cards.length < 3) return '';
    const r = G.rankOf(cards);
    return `${FORMATION[r.type]} ${r.sum}`;
  }

  function render(ctx) {
    const { s, seat, myTurn } = ctx;
    const me = seat;
    const opp = 1 - seat;
    if (!myTurn) { picked = null; chosen = null; }
    if (picked && !s.hands[me].includes(picked)) { picked = null; chosen = null; }

    const mineCount = s.stones.filter((st) => st.owner === me).length;
    const theirCount = s.stones.filter((st) => st.owner === opp).length;
    const who = (i, name, n) => `<div class="who${s.active === i && s.phase !== 'over' ? ' turn' : ''}"><span>${ctx.esc(name)}</span><b>${n}</b><small>${n === 1 ? 'stone' : 'stones'} · ${s.wins[i]} ${s.wins[i] === 1 ? 'game' : 'games'} won</small></div>`;
    $('scoreboard').innerHTML = who(me, 'You', mineCount) + '<div class="mid">First to<b>5 stones</b>or 3 in a row</div>' + who(opp, s.players[opp].name, theirCount);
    $('oppName').textContent = s.players[opp].name;
    $('oppHint').textContent = `${s.handCounts ? s.handCounts[opp] : s.hands[opp].length} cards in hand`;
    $('myName').textContent = `${s.players[me].name} (you)`;
    $('deckHint').textContent = `${s.deckCount != null ? s.deckCount : s.deck.length} cards left to draw`;

    const lastCard = s.last && s.last.card;
    const lastStone = s.last && s.last.stone;
    const html = s.stones.map((st, k) => {
      const targetable = myTurn && picked && st.owner == null && st.sides[me].length < 3 && !ctx.busy;
      const cls = ['stone', st.owner === me && 'mine', st.owner === opp && 'theirs', targetable && 'target', chosen === k && 'chosen'].filter(Boolean).join(' ');
      const oppCards = st.sides[opp];
      const mineCards = st.sides[me];
      const oppSide = Array(3 - oppCards.length).fill(slot).join('') + oppCards.slice().reverse().map((c) => cardHtml(c, { last: lastCard === c && lastStone === k })).join('');
      let mineSide = mineCards.map((c) => cardHtml(c, { last: lastCard === c && lastStone === k })).join('');
      if (chosen === k && picked) mineSide += cardHtml(picked, { ghost: true });
      const used = mineCards.length + (chosen === k && picked ? 1 : 0);
      mineSide += Array(3 - used).fill(slot).join('');
      const owner = st.owner == null ? `${k + 1}` : '✓';
      const tag = targetable ? 'button' : 'div';
      return `<${tag} class="${cls}"${targetable ? ` data-stone="${k}"` : ''} aria-label="Stone ${k + 1}${st.owner != null ? `, won by ${st.owner === me ? 'you' : s.players[opp].name}` : ''}">` +
        `<div class="side opp">${oppSide}</div><div class="fm">${formationLabel(oppCards)}</div><div class="rock">${owner}</div><div class="fm">${formationLabel(mineCards)}</div><div class="side">${mineSide}</div></${tag}>`;
    }).join('');
    $('stones').innerHTML = html;

    const hand = s.hands[me].slice().sort((a, b) => order(a) - order(b));
    $('hand').innerHTML = hand.map((c) => cardHtml(c, { pickable: myTurn && !ctx.busy, sel: picked === c, name: true })).join('') || '<span class="hint">No cards</span>';

    const btn = (a, text, cls = '') => `<button class="btn small ${cls}" data-act="${a}">${text}</button>`;
    const L = s.last;
    if (L && L.card) {
      const who2 = L.who === me ? 'You' : s.players[L.who].name;
      const claimed = (L.claimed || []).length ? ` and won stone${L.claimed.length > 1 ? 's' : ''} ${L.claimed.map((k) => k + 1).join(', ')}` : '';
      const start = L.startClaims && L.startClaims.stones.length ? `. ${L.startClaims.who === me ? 'You' : s.players[L.startClaims.who].name} won stone${L.startClaims.stones.length > 1 ? 's' : ''} ${L.startClaims.stones.map((k) => k + 1).join(', ')}` : '';
      $('lastTurn').textContent = `Last turn: ${who2} played ${label(L.card)} on stone ${L.stone + 1}${claimed}${start}.`;
    } else $('lastTurn').textContent = '';

    if (s.phase === 'over') ctx.bar('Game over', '', btn('results', 'See result', 'primary'));
    else if (!myTurn) ctx.bar(`${ctx.esc(s.players[s.active].name)} is playing…`);
    else if (!picked) ctx.bar('Your turn: pick a card', 'Then tap the stone to play it on.');
    else if (chosen == null) ctx.bar(`${label(picked)}: tap a stone`, 'Stones you can play on are outlined.', btn('clear', 'Cancel', 'ghost'));
    else ctx.bar(`Play ${label(picked)} on stone ${chosen + 1}?`, '', btn('play', 'Play it', 'primary') + btn('clear', 'Cancel', 'ghost'));
  }

  function bind(getCtx) {
    $('hand').addEventListener('click', (e) => {
      const card = e.target.closest('.tcard.pickable');
      const ctx = getCtx();
      if (!card || !ctx.myTurn) return;
      picked = picked === card.dataset.card ? null : card.dataset.card;
      chosen = null;
      ctx.rerender();
    });
    $('stones').addEventListener('click', (e) => {
      const el = e.target.closest('.stone[data-stone]');
      const ctx = getCtx();
      if (!el || !ctx.myTurn || !picked) return;
      chosen = chosen === Number(el.dataset.stone) ? null : Number(el.dataset.stone);
      ctx.rerender();
    });
  }

  function onAction(name, data, ctx) {
    if (name === 'clear') {
      picked = null;
      chosen = null;
      ctx.rerender();
    } else if (name === 'play' && picked != null && chosen != null) {
      const action = { type: 'play', card: picked, stone: chosen };
      picked = null;
      chosen = null;
      ctx.act(action);
    }
  }

  window.NerdalieShell.start({
    id: 'schotten-totten',
    title: 'Schotten Totten',
    icon: '🏰',
    G,
    Bot: window.SchottenBot,
    needsMe: (s, seat) => s.active === seat,
    result: (s, seat) => (s.end ? { final: true, outcome: s.end.winner === seat ? 'win' : 'loss', detail: s.end.reason === 'five' ? 'five stones' : 'three in a row' } : null),
    over: (s, seat) => {
      const opp = 1 - seat;
      const oppName = s.players[opp].name;
      const won = s.end.winner === seat;
      const who = won ? 'You' : oppName;
      const own = (i) => s.stones.filter((st) => st.owner === i).length;
      return {
        title: won ? 'You win! 🎉' : `${oppName} wins`,
        why: s.end.reason === 'five' ? `${who} won five stones.` : `${who} won three stones side by side.`,
        html: `<tr><th></th><th>You</th><th>${oppName.replace(/[<>&]/g, '')}</th></tr><tr class="total"><td>Stones</td><td>${own(seat)}</td><td>${own(opp)}</td></tr><tr class="match"><td>Games won</td><td>${s.wins[seat]}</td><td>${s.wins[opp]}</td></tr>`,
        button: 'Play again',
      };
    },
    render,
    bind,
    onAction,
    otherNames: ['jaipur.name', 'onitama.name'],
  });
})();
