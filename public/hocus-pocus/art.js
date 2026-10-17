/* Original, deliberately creepy artwork for the cards, drawn as small inline SVGs. Shapes use the card's text
   colour, and "cut-outs" use the card's own colour (--c) so every icon follows whatever colour its card is. */
(function (root) {
  'use strict';

  const svg = (body, view = '0 0 48 48') => `<svg viewBox="${view}" aria-hidden="true" focusable="false">${body}</svg>`;
  const cut = 'var(--c, #444)';
  const W = 'currentColor';

  const ICONS = {
    // a newt: slit eye, fangs, spiny back, stubby legs, curled tail and a string of drool
    newtsaliva: svg(
      `<ellipse cx="26" cy="27" rx="13" ry="6.500" fill="${W}"/>` +
      `<path d="M1 25c0-4 5-7 11-5l4 4-1 6H5c-3 0-4-2-4-5z" fill="${W}"/>` +
      `<path d="M19 22l2.200-5 2.200 5zM25.500 21l2.200-5.500L30 21zM32 22l2-4.500 2 5z" fill="${W}"/>` +
      `<path d="M38 27C46 27 48 18 43 11" stroke="${W}" stroke-width="5.200" stroke-linecap="round" fill="none"/>` +
      `<path d="M18 31l-3 9M25 32v9M32 32l1 9M37 30l4 8" stroke="${W}" stroke-width="4" stroke-linecap="round"/>` +
      `<ellipse cx="8" cy="22.500" rx="1.200" ry="2.800" fill="${cut}"/>` +
      `<path d="M3.500 29.500l2 4.500 2-4.500zM9 29.500l2 4.500 2-4.500z" fill="${W}"/>` +
      `<path d="M7 34q-2 5-1 9" stroke="${W}" stroke-width="1.500" fill="none"/><circle cx="6" cy="44" r="1.700" fill="${W}"/>`
    ),
    // a flask of bubbling oil with a tiny skull drowning in it
    oilofboil: svg(
      `<path d="M19 4h10v3h-2v12l11 19c2 3.600-.4 7-4.200 7H14.200C10.400 45 8 41.600 10 38L21 19V7h-2z" fill="${W}"/>` +
      `<path d="M12.500 32q5-3 11 0t11 0" stroke="${cut}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
      `<circle cx="24" cy="37" r="5" fill="${cut}"/><rect x="21" y="40" width="6" height="4" rx="1" fill="${cut}"/>` +
      `<circle cx="22" cy="36.500" r="1.500" fill="${W}"/><circle cx="26" cy="36.500" r="1.500" fill="${W}"/><path d="M24 38.500l-1 1.800h2z" fill="${W}"/>` +
      `<path d="M22.500 42v2M24 42v2M25.500 42v2" stroke="${W}" stroke-width=".8"/>` +
      `<circle cx="33" cy="9" r="2.800" fill="${W}"/><circle cx="38" cy="14" r="1.800" fill="${W}"/><circle cx="28.500" cy="2.800" r="1.400" fill="${W}"/><circle cx="19" cy="25" r="1.600" fill="${cut}"/>`
    ),
    // a severed toe: broad toenail, creases, rough stitches, a jagged cut with the bone showing, and drips
    deadmanstoe: svg(
      `<path d="M10 32L13 16C13 2 35 2 35 16L38 32l-4.500 4.500-4-4.500-4.500 7-4.500-7-4 4.500z" fill="${W}"/>` +
      `<path d="M16.500 9.500c2-4.500 13-4.500 15 0V17c-2 3.600-13 3.600-15 0z" fill="${cut}"/>` +
      `<path d="M13 24.500H35M15.500 22v5M20.500 22v5M26 22v5M31.500 22v5" stroke="${cut}" stroke-width="1.600" stroke-linecap="round"/>` +
      `<circle cx="24" cy="30.500" r="3" fill="none" stroke="${cut}" stroke-width="1.600"/><circle cx="24" cy="30.500" r="1" fill="${cut}"/>` +
      `<path d="M17.500 39c-2 3-2 5 0 7 2-2 2-4 0-7zM30 40.500c-1.600 2.400-1.600 4 0 5.500 1.600-1.500 1.600-3.100 0-5.500z" fill="${W}"/>`
    ),
    // a grinning mouth of needle teeth and a long forked tongue
    thineowntongue: svg(
      `<path d="M2 16Q24 0 46 16Q24 24 2 16z" fill="${W}"/>` +
      `<path d="M6 18.500l2.400 6 2.400-6.500zM12 20l2.400 7 2.400-6.800zM18 21l2.200 6 2.200-5.800zM25.500 21.500l2.200 5.800 2.200-6zM31.500 20.500l2.400 6.800 2.400-7zM37.500 19l2.400 6 2.400-6.500z" fill="${W}"/>` +
      `<path d="M15 24Q24 28 33 24V36Q33 46 28.500 46L24 39.500 19.500 46Q15 46 15 36z" fill="${W}"/>` +
      `<path d="M24 28v10" stroke="${cut}" stroke-width="1.800" stroke-linecap="round"/>` +
      `<path d="M3 11l5 5M8 11l-5 5M40 11l5 5M45 11l-5 5" stroke="${cut}" stroke-width="1.400" stroke-linecap="round"/>` +
      `<path d="M17 32l5 0M26 32l5 0M18 36h4M26 36h4" stroke="${cut}" stroke-width="1" stroke-linecap="round" opacity=".7"/>`
    ),
    // a diseased, bloodshot eyeball covered in pustules and oozing
    dashofpox: svg(
      `<path d="M24 4c9 0 18 7 18 19 0 12-8 19-18 19S6 35 6 23 15 4 24 4z" fill="${W}"/>` +
      `<path d="M11 23Q24 10 37 23Q24 36 11 23z" fill="${cut}"/><circle cx="24" cy="23" r="6" fill="${W}"/><ellipse cx="24" cy="23" rx="1.700" ry="4.800" fill="${cut}"/>` +
      `<path d="M13 22l-5-3M14 26l-6 3M35 22l5-3M34 26l6 3M24 14v-5" stroke="${cut}" stroke-width="1.100" stroke-linecap="round" opacity=".8"/>` +
      `<circle cx="14" cy="12.500" r="2.600" fill="${cut}"/><circle cx="34" cy="12" r="3" fill="${cut}"/><circle cx="37.500" cy="33" r="3.200" fill="${cut}"/>` +
      `<circle cx="11" cy="32" r="2.800" fill="${cut}"/><circle cx="24" cy="37" r="2" fill="${cut}"/><circle cx="19.500" cy="8" r="1.300" fill="${cut}"/>` +
      `<path d="M16 41c-2 3-2 5 0 7 2-2 2-4 0-7zM30 41c-1.600 3-1.600 5 0 6.500 1.600-1.500 1.600-3.500 0-6.500z" fill="${W}"/>`
    ),
  };

  // corner badges for the two special symbols: a slit-pupilled cat's eye and a grimoire with an eye on its cover
  const BADGES = {
    binx: svg(`<path d="M2 24Q24 3 46 24Q24 45 2 24z" fill="${W}"/><ellipse cx="24" cy="24" rx="4" ry="10.500" fill="${cut}"/><circle cx="20.500" cy="18.500" r="1.800" fill="${W}"/>`),
    book: svg(`<path d="M9 3h28a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4H9z" fill="${W}"/><path d="M13 3v42" stroke="${cut}" stroke-width="2.400"/><path d="M19 24Q28 15 37 24Q28 33 19 24z" fill="${cut}"/><circle cx="28" cy="24" r="3.200" fill="${W}"/><ellipse cx="28" cy="24" rx="1" ry="2.800" fill="${cut}"/><circle cx="36" cy="9" r="1.400" fill="${cut}"/><circle cx="36" cy="39" r="1.400" fill="${cut}"/>`),
  };

  // a witch's hat in each witch's own colour, with a tattered brim and a buckle
  const HAT_COLOURS = { sarah: '#ff8fb8', mary: '#ffb347', winifred: '#b995ff' };
  const hat = (witch) => svg(
    `<path d="M2 38l5-2 4 3 5-3 6 3 6-3 6 3 5-3 4 2 4-1c-5-3-9-4-13-5L30 9q-2-6-6-3l2 6-9 22c-7 1-14 3-15 5z" fill="${HAT_COLOURS[witch] || '#bbb'}"/>` +
    `<path d="M14 31q10 4 21 0" stroke="#1d1030" stroke-width="3.200" fill="none"/><rect x="21" y="29" width="7" height="6" rx="1" fill="none" stroke="#e8c14a" stroke-width="1.500"/>`
  );

  const api = { icon: (type) => ICONS[type] || '', badge: (kind) => BADGES[kind] || '', hat };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HocusArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
