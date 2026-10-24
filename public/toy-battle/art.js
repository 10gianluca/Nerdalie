/* Original artwork for the troops: small inline SVGs, my own drawings (not the game's illustrations). Shapes use the
   tile's text colour and cut-outs use the tile's own colour (--c), so each icon follows whichever team it belongs to. */
(function (root) {
  'use strict';

  const W = 'currentColor';
  const cut = 'var(--c, #335)';
  const svg = (body) => `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">${body}</svg>`;

  const ICONS = {
    // Kwak, a duck in a horned viking helmet
    kwak: svg(
      `<path d="M10 24C10 13 16 8 24 8s14 5 14 16v5c0 6-6 10-14 10S10 35 10 29z" fill="${W}"/>` +
      `<path d="M10 20C3 19 2 12 5 6c1 5 4 7 7 8zM38 20c7-1 8-8 5-14-1 5-4 7-7 8z" fill="${W}"/>` +
      `<path d="M10 21h28" stroke="${cut}" stroke-width="2.200"/>` +
      `<circle cx="18" cy="27" r="2.300" fill="${cut}"/><circle cx="30" cy="27" r="2.300" fill="${cut}"/>` +
      `<path d="M15 33q9-5 18 0-2 7-9 7t-9-7z" fill="${cut}"/>`
    ),
    // Skully, a skull
    skully: svg(
      `<path d="M24 5C14 5 8 12 8 20c0 5 3 8 6 10v8h5v-3h3v3h4v-3h3v3h5v-8c3-2 6-5 6-10C40 12 34 5 24 5z" fill="${W}"/>` +
      `<circle cx="17" cy="21" r="4.500" fill="${cut}"/><circle cx="31" cy="21" r="4.500" fill="${cut}"/>` +
      `<path d="M24 26.500l-3.200 5.500h6.400z" fill="${cut}"/>`
    ),
    // Cap'n, a pirate in a tricorn hat with an eye patch
    capn: svg(
      `<circle cx="24" cy="31" r="11" fill="${W}"/>` +
      `<path d="M3 22c6-4 12-5 21-5s15 1 21 5c-5 1-7 4-10 4H13c-3 0-5-3-10-4z" fill="${W}"/>` +
      `<path d="M13 21l11-15 11 15z" fill="${W}"/>` +
      `<circle cx="24" cy="15" r="2.200" fill="${cut}"/><path d="M22.500 18h3" stroke="${cut}" stroke-width="1.300"/>` +
      `<rect x="25" y="26" width="9" height="7" rx="3" fill="${cut}"/><path d="M17 27l16 4" stroke="${cut}" stroke-width="1.200"/>` +
      `<circle cx="18" cy="30" r="2" fill="${cut}"/><path d="M18 38q6 4 12 0" stroke="${cut}" stroke-width="2" fill="none" stroke-linecap="round"/>`
    ),
    // Jumbo, an elephant
    jumbo: svg(
      `<circle cx="9.500" cy="22" r="8.500" fill="${W}"/><circle cx="38.500" cy="22" r="8.500" fill="${W}"/>` +
      `<circle cx="24" cy="22" r="12" fill="${W}"/>` +
      `<path d="M19 30c-3 9 0 15 5 15s5-4 3-5-1-3 0-10z" fill="${W}"/>` +
      `<circle cx="19" cy="20" r="2" fill="${cut}"/><circle cx="29" cy="20" r="2" fill="${cut}"/>` +
      `<circle cx="9.500" cy="22" r="4" fill="${cut}" opacity=".35"/><circle cx="38.500" cy="22" r="4" fill="${cut}" opacity=".35"/>`
    ),
    // Hook, a big grappling hook
    hook: svg(
      `<path d="M24 11v24c0 5-3.500 8-8 8s-8-3-8-8" stroke="${W}" stroke-width="5" stroke-linecap="round" fill="none"/>` +
      `<circle cx="24" cy="7" r="4" fill="none" stroke="${W}" stroke-width="3"/>` +
      `<path d="M8 35l-5-5M8 35l5-5" stroke="${W}" stroke-width="3.200" stroke-linecap="round"/>` +
      `<path d="M16 15h16" stroke="${W}" stroke-width="3.500" stroke-linecap="round"/>`
    ),
    // XB-42, a robot
    xb42: svg(
      `<rect x="9" y="14" width="30" height="25" rx="6" fill="${W}"/><rect x="4" y="22" width="5" height="9" rx="2" fill="${W}"/><rect x="39" y="22" width="5" height="9" rx="2" fill="${W}"/>` +
      `<path d="M24 14V8" stroke="${W}" stroke-width="3"/><circle cx="24" cy="6" r="3.200" fill="${W}"/>` +
      `<rect x="14.500" y="21" width="7.500" height="7.500" rx="2" fill="${cut}"/><rect x="26" y="21" width="7.500" height="7.500" rx="2" fill="${cut}"/>` +
      `<path d="M16 34h16M16 37h16" stroke="${cut}" stroke-width="1.500" stroke-linecap="round"/>`
    ),
    // Star, a five-point star
    star: svg(
      `<path d="M24 3l6.300 13.600 14.700 1.700-10.900 10.100 3 14.600L24 35.900 10.900 43l3-14.600L3 18.300l14.700-1.700z" fill="${W}"/>` +
      `<path d="M24 14l2.500 5.500 6 .7-4.400 4 1.200 5.900L24 27l-5.300 3.100 1.200-5.900-4.400-4 6-.7z" fill="${cut}" opacity=".45"/>`
    ),
    // Roxy, a crown
    roxy: svg(
      `<path d="M5 36L3 14l11 9 10-16 10 16 11-9-2 22z" fill="${W}"/><rect x="5" y="38" width="38" height="6" rx="2.500" fill="${W}"/>` +
      `<circle cx="24" cy="29" r="2.800" fill="${cut}"/><circle cx="13" cy="31" r="2.200" fill="${cut}"/><circle cx="35" cy="31" r="2.200" fill="${cut}"/>`
    ),
  };

  const api = { icon: (type) => ICONS[type] || '' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ToyArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
