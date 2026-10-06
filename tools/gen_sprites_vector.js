'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'game');

const defs = `
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#fff4bd"/><stop offset=".35" stop-color="#f4be3f"/>
    <stop offset=".72" stop-color="#b96a18"/><stop offset="1" stop-color="#71310e"/>
  </linearGradient>
  <linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#fff"/><stop offset=".42" stop-color="#b9cce2"/>
    <stop offset=".75" stop-color="#7185a0"/><stop offset="1" stop-color="#30445f"/>
  </linearGradient>
  <linearGradient id="red" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#ffc1a6"/><stop offset=".35" stop-color="#ed684c"/>
    <stop offset=".76" stop-color="#a72b27"/><stop offset="1" stop-color="#551b20"/>
  </linearGradient>
  <linearGradient id="blue" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#d6f4ff"/><stop offset=".4" stop-color="#48b9e8"/>
    <stop offset=".78" stop-color="#17618f"/><stop offset="1" stop-color="#102d50"/>
  </linearGradient>
  <linearGradient id="green" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#c9ffd9"/><stop offset=".4" stop-color="#39c978"/>
    <stop offset=".78" stop-color="#187448"/><stop offset="1" stop-color="#103d37"/>
  </linearGradient>
  <linearGradient id="purple" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#f0d4ff"/><stop offset=".4" stop-color="#ae68e8"/>
    <stop offset=".78" stop-color="#6335a2"/><stop offset="1" stop-color="#301c5d"/>
  </linearGradient>
  <linearGradient id="bronze" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#ffe1c5"/><stop offset=".42" stop-color="#d28b5e"/>
    <stop offset=".78" stop-color="#824936"/><stop offset="1" stop-color="#462629"/>
  </linearGradient>
  <linearGradient id="darkMetal" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#7487a1"/><stop offset=".45" stop-color="#293b55"/>
    <stop offset="1" stop-color="#111a2c"/>
  </linearGradient>
  <radialGradient id="shine" cx=".28" cy=".24" r=".85">
    <stop stop-color="#fff" stop-opacity=".92"/><stop offset=".28" stop-color="#fff" stop-opacity=".38"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="shadow" x="-40%" y="-40%" width="180%" height="190%">
    <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#050914" flood-opacity=".65"/>
  </filter>`;

const sprites = {
  'bg-tile.svg': [150, 150, `
    <rect width="150" height="150" fill="#10192a"/>
    <path d="M0 0h150v150H0z" fill="url(#darkMetal)" opacity=".18"/>
    <path d="M0 0h150v150H0z" fill="#101827" opacity=".72"/>
    <path d="M0 0h150v150H0z" fill="url(#grid)"/>
    <path d="M0 149.5h150M149.5 0v150" stroke="#91a9ca" stroke-opacity=".24"/>
    <g fill="#8aa0c3" opacity=".16"><circle cx="17" cy="25" r="1"/><circle cx="76" cy="14" r="1"/><circle cx="129" cy="39" r="1"/><circle cx="36" cy="91" r="1"/><circle cx="111" cy="119" r="1"/><circle cx="69" cy="137" r="1"/><circle cx="19" cy="128" r="1"/></g>`],
  'orb-energy.svg': [24, 24, `
    <circle cx="12" cy="12" r="10.5" fill="#f5b933" opacity=".2" filter="url(#glow)"/>
    <circle cx="12" cy="12" r="8.5" fill="url(#gold)" stroke="#fff0a3" stroke-width="1.2"/>
    <path d="m12 4 5.8 5-2.1 8-6.6 2-4.1-5 1.4-7L12 4Z" fill="#ffe879" fill-opacity=".7"/>
    <path d="m12 4 1.5 7 4.3-2M12 11l-7 3m7-3 3.7 6" stroke="#fff8d4" stroke-opacity=".82" stroke-width=".8"/>
    <ellipse cx="9" cy="8" rx="3.2" ry="2" fill="url(#shine)"/>`],
  'health-kit.svg': [32, 32, `
    <path d="M5 9 8 5h16l3 4 2 17-3 3H6l-3-3 2-17Z" fill="url(#silver)" stroke="#17253c" stroke-width="1.5" filter="url(#shadow)"/>
    <path d="m5 9 3-4h16l3 4H5Z" fill="#f7fbff" stroke="#7185a0" stroke-width="1"/>
    <path d="M6 12h20v11H6z" fill="url(#red)" stroke="#63252a" stroke-width="1"/>
    <path d="M14 13h4v3h3v4h-3v3h-4v-3h-3v-4h3z" fill="#fff" stroke="#f4e8df" stroke-width=".7"/>
    <path d="m8 6 3-2h10l3 2" stroke="#fff" stroke-opacity=".8" stroke-width="1.2"/>`],
  'bullet.svg': [20, 20, `
    <path d="M10 2c-3.2 3-5.2 6.5-5.2 10.1A5.2 5.2 0 0 0 10 17.3a5.2 5.2 0 0 0 5.2-5.2C15.2 8.5 13.2 5 10 2Z" fill="url(#silver)" stroke="#e8f4ff" stroke-width="1" filter="url(#shadow)"/>
    <path d="M10 3.5v10.8M7.1 8.1l2.9-3 2.9 3" stroke="#fff" stroke-opacity=".76" stroke-width=".8"/>
    <path d="M6.3 13.5c1.1 2.4 6.3 2.7 7.4-.2" stroke="#8199b8" stroke-width="1"/>`],
  'bullet-orb.svg': [28, 28, `
    <circle cx="14" cy="14" r="12" fill="#a768e8" opacity=".24" filter="url(#glow)"/>
    <circle cx="14" cy="14" r="9.2" fill="url(#purple)" stroke="#e6c9ff" stroke-width="1.4"/>
    <path d="m14 5 6.1 5-1 7-6.3 5-5-5 .9-7L14 5Z" fill="#ce9aff" fill-opacity=".66"/>
    <path d="m14 5 1.2 8 4.9-3M15.2 13l-6.5 4m6.5-4 2.9 4" stroke="#f7eaff" stroke-opacity=".86" stroke-width="1"/>
    <ellipse cx="11" cy="9" rx="3" ry="2" fill="url(#shine)"/>`],
  'bomb.svg': [32, 32, `
    <path d="m20 8 5-4" stroke="#c8d4e4" stroke-width="2.6" stroke-linecap="round"/>
    <path d="m24 3 1-2m2 3 2-1m-1 4 2 1" stroke="#ffcf50" stroke-width="1.7" stroke-linecap="round" filter="url(#glow)"/>
    <path d="M16 8a12 12 0 1 0 0 24 12 12 0 0 0 0-24Z" transform="translate(0 -2)" fill="url(#red)" stroke="#ffb29b" stroke-width="1.3" filter="url(#shadow)"/>
    <path d="m16 8 8 4-1 9-8 7-8-6 1-9 8-5Z" fill="#dc5140" fill-opacity=".58"/>
    <ellipse cx="12" cy="12" rx="4" ry="2.6" fill="url(#shine)"/>
    <path d="m21 8 3 2-1 3-4-1" fill="url(#darkMetal)" stroke="#dae6f5" stroke-width=".8"/>`],
  'explosion.svg': [256, 64, `
    <g transform="translate(0 0)"><circle cx="32" cy="32" r="16" fill="#ffd445" opacity=".5" filter="url(#glow)"/><path d="m32 9 5 13 12-9-3 15 14 2-13 7 8 12-15-4-3 14-7-13-10 9 2-15-14-4 13-6-7-13 14 4 4-12Z" fill="url(#gold)" stroke="#fff5c8" stroke-width="1.4"/><circle cx="32" cy="32" r="8" fill="#fff"/><circle cx="32" cy="32" r="4" fill="#fff8c8"/></g>
    <g transform="translate(64 0)"><circle cx="32" cy="32" r="24" fill="#ff8d35" opacity=".36" filter="url(#glow)"/><path d="m31 5 7 14 12-7-3 14 13 5-13 7 7 13-15-4-7 13-5-15-14 6 5-15-13-7 15-5-1-15 12 9 10-13Z" fill="#f8a52d" stroke="#fff0a0" stroke-width="1.4"/><path d="m32 15 13 8 2 13-10 12-14-5-5-13 5-12 9-3Z" fill="#fff7d4"/></g>
    <g transform="translate(128 0)"><circle cx="32" cy="32" r="27" fill="#ef512d" opacity=".3" filter="url(#glow)"/><path d="m31 4 8 13 10-8 1 14 14 4-12 9 8 12-15-2-4 14-9-12-12 9 2-15-14-4 12-8-7-13 15 3 3-16Z" fill="#d95630" stroke="#ffd78b" stroke-width="1.4"/><path d="m31 15 13 4 5 11-6 12-13 4-9-9 1-13 9-9Z" fill="#ffd16c"/><circle cx="31" cy="31" r="7" fill="#fff4cd"/></g>
    <g transform="translate(192 0)"><circle cx="32" cy="32" r="28" fill="#b94e37" opacity=".25" filter="url(#glow)"/><path d="M9 32c0-13 10-23 23-23s23 10 23 23-10 23-23 23S9 45 9 32Z" fill="none" stroke="#d77c54" stroke-width="7" stroke-dasharray="3 3"/><path d="M15 32c0-9 8-17 17-17s17 8 17 17-8 17-17 17-17-8-17-17Z" fill="none" stroke="#743c36" stroke-width="4"/><path d="m7 16 4-6m46 42 5 4M13 52l-4 5" stroke="#f59e0b" stroke-width="2"/> </g>`],
  'airdrop.svg': [96, 96, `
    <path d="M13 34 48 25l35 9v43l-35 13-35-13V34Z" fill="url(#gold)" stroke="#ffe9a7" stroke-width="2.5" filter="url(#shadow)"/>
    <path d="m13 34 35 10v46L13 77V34ZM48 44l35-10v43L48 90V44Z" fill="#8f4c19" fill-opacity=".28" stroke="#704019" stroke-width="1.5"/>
    <path d="M24 31v50m12-53v57m25-57v57m12-59v55" stroke="#ffeaa6" stroke-opacity=".65" stroke-width="3"/>
    <path d="M13 47 48 57l35-10M13 66l35 11 35-11" stroke="#8c5118" stroke-width="2"/>
    <path d="m39 54 9-4 10 4v12l-10 7-9-7V54Z" fill="url(#silver)" stroke="#fff" stroke-width="1.5"/>
    <path d="M47 54h3v5h5v3h-5v5h-3v-5h-5v-3h5z" fill="#ed4c43"/>`],
  'obstacle.svg': [96, 96, `
    <path d="m11 30 16-18 19 8 15-12 23 18 2 23-9 13 4 19-22 7-18-7-21 3-9-20 6-15-6-19Z" fill="url(#darkMetal)" stroke="#b4c7df" stroke-width="2.5" filter="url(#shadow)"/>
    <path d="m11 30 16-18 19 8-4 25-22 12-9-20Zm35-10 15-12 23 18-18 17-25 2 5-25Zm-5 27 25-2 18 17 4 19-22 7-18-7-14-15 7-19Z" fill="#7790ae" fill-opacity=".42"/>
    <path d="m27 12 19 8-5 27-21 10m26-35 15-12m-20 37 25-2 18 17M41 47 27 70l-19 4" stroke="#d5e3f4" stroke-opacity=".75" stroke-width="2"/>
    <path d="m42 20 4 18-9 8 11 13-7 12M61 8l-2 20 12 8" stroke="#15243a" stroke-width="2.5"/>
    <path d="m20 77 7-7 20 8-4 10-18 3-9-5 4-9Z" fill="url(#bronze)" opacity=".72"/>`],
  'car.svg': [80, 48, `
    <path d="M9 7h7v8H9zm55 0h7v8h-7zM9 33h7v8H9zm55 0h7v8h-7z" fill="#101727" stroke="#8296b1" stroke-width="1"/>
    <path d="m7 13 5-7h56l5 7v23l-6 7H13l-6-7V13Z" fill="url(#red)" stroke="#ffd0bb" stroke-width="2" filter="url(#shadow)"/>
    <path d="m15 11 10-3h30l10 3v6H15v-6Zm0 21h50v5l-8 4H22l-7-4v-5Z" fill="#742d34" stroke="#fac2a7" stroke-width="1"/>
    <path d="m20 14 7-3h26l7 3v8H20v-8Zm0 13h40v5H20v-5Z" fill="url(#blue)" stroke="#ddf8ff" stroke-width="1.4"/>
    <path d="M35 10h10v29H35z" fill="#a83735" stroke="#ffd0bb" stroke-width="1"/>
    <path d="M21 14h11v7H21zm27 0h11v7H48z" fill="#fff" fill-opacity=".18"/>
    <path d="M8 15h5v5H8zm59 0h5v5h-5zM8 29h5v5H8zm59 0h5v5h-5z" fill="#ffe38a"/>`],
  'moto.svg': [48, 28, `
    <ellipse cx="10" cy="14" rx="5" ry="12" fill="#141b2b" stroke="#8ea0b9" stroke-width="1.4"/>
    <ellipse cx="38" cy="14" rx="5" ry="12" fill="#141b2b" stroke="#8ea0b9" stroke-width="1.4"/>
    <path d="m10 14 10-7h10l8 7-8 7H19l-9-7Z" fill="url(#purple)" stroke="#e7caff" stroke-width="1.7" filter="url(#shadow)"/>
    <path d="m20 8 7-3 7 4-4 7-10 1-4-4 4-5Z" fill="#d9a8ff" stroke="#f5e7ff" stroke-width="1"/>
    <path d="m17 17 12 2-3 5h-8l-4-4m18-8 6-4 5 1m-4 2 3 6" stroke="#d5deeb" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="10" cy="14" r="1.3" fill="#eaf2ff"/><circle cx="38" cy="14" r="1.3" fill="#eaf2ff"/>`],
  'barrel.svg': [32, 32, `
    <path d="M7 4h18l3 5v14l-3 5H7l-3-5V9l3-5Z" fill="url(#red)" stroke="#ffbea6" stroke-width="1.5" filter="url(#shadow)"/>
    <path d="M7 5h18l3 4H4l3-4Zm-3 18h24l-3 5H7l-3-5Z" fill="url(#silver)" stroke="#9bacbf" stroke-width=".8"/>
    <path d="M5 12h22v7H5z" fill="url(#gold)" stroke="#fff0a4" stroke-width=".8"/>
    <path d="m9 13 3 2-3 3m8-5 3 2-3 3m5-5 3 2-3 3" stroke="#27354a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 6v20" stroke="#ffd0bb" stroke-opacity=".6" stroke-width="1.5"/>`],
  'wall.svg': [96, 96, `
    <path d="M9 14 48 6l39 8v66l-39 10-39-10V14Z" fill="url(#darkMetal)" stroke="#d5e1f1" stroke-width="2.5" filter="url(#shadow)"/>
    <path d="m9 14 39 9 39-9M9 35l39 9 39-9M9 57l39 9 39-9M9 79l39 10 39-10" stroke="#15243a" stroke-width="3"/>
    <path d="m12 17 35 8v14l-35-8V17Zm39 8 34-8v14l-34 8V25Zm-39 14 35 8v14l-35-8V39Zm39 8 34-8v14l-34 8V47Zm-39 14 35 8v15l-35-9V61Zm39 8 34-8v15l-34 9V69Z" fill="url(#silver)" fill-opacity=".56"/>
    <g fill="#fff0ad" stroke="#24344c" stroke-width="1"><circle cx="15" cy="19" r="2"/><circle cx="81" cy="19" r="2"/><circle cx="15" cy="76" r="2"/><circle cx="81" cy="76" r="2"/></g>
    <path d="m15 19 2 1m62 54 2 1" stroke="#fff" stroke-width=".8"/>`],
  'speed-pad.svg': [96, 36, `
    <path d="m5 5 7-3h72l7 3v26l-7 3H12l-7-3V5Z" fill="url(#gold)" stroke="#fff0a4" stroke-width="2" filter="url(#shadow)"/>
    <path d="m10 8 4-2h66l5 2v20l-5 2H14l-4-2V8Z" fill="#17243b" stroke="#f7cf58" stroke-width="1.4"/>
    <path d="m24 10 10 8-10 8h-7l9-8-9-8h7Zm23 0 10 8-10 8h-7l9-8-9-8h7Zm23 0 10 8-10 8h-7l9-8-9-8h7Z" fill="url(#gold)" stroke="#fff3c2" stroke-width=".8"/>
    <path d="M14 7h67" stroke="#fff" stroke-opacity=".58" stroke-width="1"/>`],
  'shop.svg': [96, 96, `
    <path d="M19 36 24 15h48l5 21v49H19V36Z" fill="url(#blue)" stroke="#d9f5ff" stroke-width="2.5" filter="url(#shadow)"/>
    <path d="M12 31h72l-5 16H17l-5-16Z" fill="url(#red)" stroke="#ffd7c9" stroke-width="2"/>
    <path d="M17 31h11l3 16H20l-3-16Zm22 0h13v16H39V31Zm24 0h12l-3 16H63V31Z" fill="#fff" fill-opacity=".8"/>
    <path d="M23 51h18v17H23zm33 0h17v17H56z" fill="url(#silver)" stroke="#ebf5ff" stroke-width="1.8"/>
    <path d="M43 57h11v28H43z" fill="url(#bronze)" stroke="#ffe2c4" stroke-width="1.5"/>
    <circle cx="48" cy="23" r="8" fill="url(#gold)" stroke="#fff0a3" stroke-width="2"/>
    <path d="M44 23h8m-4-4v8" stroke="#fff9d7" stroke-width="1.5"/>
    <path d="M22 48h52" stroke="#fff" stroke-opacity=".6" stroke-width="1.5"/>`],
  'bank.svg': [96, 96, `
    <path d="m11 29 37-20 37 20v8H11v-8Z" fill="url(#green)" stroke="#d4ffe0" stroke-width="2.5" filter="url(#shadow)"/>
    <path d="M15 39h66v40H15z" fill="url(#darkMetal)" stroke="#b4c8df" stroke-width="2"/>
    <path d="M20 43h8v31h-8zm20 0h8v31h-8zm20 0h8v31h-8zm20 0h-5v31h5z" fill="url(#silver)" stroke="#e3efff" stroke-width="1"/>
    <path d="M12 77h72v8H12z" fill="url(#green)" stroke="#d4ffe0" stroke-width="2"/>
    <circle cx="48" cy="58" r="14" fill="url(#green)" stroke="#d6ffe2" stroke-width="2.5"/>
    <circle cx="48" cy="58" r="8" fill="url(#darkMetal)" stroke="#c8f8d8" stroke-width="1.5"/>
    <path d="M48 49v18m-8-9h16m-14-6 12 12m0-12L42 64" stroke="#e9fff0" stroke-width="1.6"/>
    <path d="m20 30 28-15 28 15" stroke="#fff" stroke-opacity=".72" stroke-width="2"/>`],
  'orb-gun.svg': [32, 32, `
    <path d="M4 10h16l4 4h5v8h-7l-5 4H9v-6H4V10Z" fill="url(#purple)" stroke="#e8d2ff" stroke-width="1.5" filter="url(#shadow)"/>
    <path d="M6 12h13l3 3h7v3H6v-6Z" fill="#d9adff" stroke="#f7edff" stroke-width="1"/>
    <path d="M9 20h6v6h-4l-2-6Zm10-6h4v7h-4z" fill="url(#darkMetal)" stroke="#e2eaf5" stroke-width=".8"/>
    <circle cx="27" cy="18.5" r="3.4" fill="#b871f4" opacity=".6" filter="url(#glow)"/>
    <circle cx="27" cy="18.5" r="2" fill="#f1d5ff" stroke="#fff" stroke-width=".7"/>
    <path d="M11 12h7" stroke="#fff" stroke-width="1" stroke-linecap="round"/>`],
  'ui-heart.svg': [24, 24, `
    <path d="M12 21 3.8 13.5C-1 8.5 6.1 2.4 11 7l1 1 1-1c4.9-4.6 12 1.5 7.2 6.5L12 21Z" fill="url(#red)" stroke="#ffd7ca" stroke-width="1.2"/>
    <path d="M5 11c0-2.8 3.2-4.2 5.4-2.4" stroke="#fff" stroke-opacity=".82" stroke-width="1.3" stroke-linecap="round"/>
    <path d="m12 12 7-5" stroke="#ff9c83" stroke-width=".8"/>`],
  'ui-shield.svg': [24, 24, `
    <path d="M12 2 21 5v6c0 5.1-3.2 8.6-9 11-5.8-2.4-9-5.9-9-11V5l9-3Z" fill="url(#blue)" stroke="#e2f8ff" stroke-width="1.2"/>
    <path d="m12 4 6.5 2.2v4.7c0 3.8-2.2 6.5-6.5 8.5V4Z" fill="#d7f5ff" fill-opacity=".25"/>
    <path d="M6 7 12 5" stroke="#fff" stroke-opacity=".85" stroke-width="1.2"/>`],
  'ui-gem.svg': [24, 24, `
    <path d="m6 3 12 0 5 6-11 13L1 9l5-6Z" fill="url(#purple)" stroke="#f2e1ff" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="m6 3 3 6h6l3-6M1 9h22m-11 13L9 9l3-6 3 6-3 13Z" stroke="#f7eaff" stroke-opacity=".8" stroke-width=".8"/>
    <path d="m6 4 3 4H4z" fill="#fff" fill-opacity=".55"/>`],
  'ui-ammo.svg': [24, 24, `
    <path d="M6 20V8l2-5h8l2 5v12l-3 2H9l-3-2Z" fill="url(#gold)" stroke="#fff0ad" stroke-width="1.2"/>
    <path d="M8 8h8v9H8z" fill="#f5d56b" stroke="#fff8da" stroke-width=".8"/>
    <path d="M8 17h8v3l-3 1h-2l-3-1v-3Z" fill="url(#bronze)"/>
    <path d="M9 6h6" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>`],
  'ui-gun.svg': [24, 24, `
    <path d="M3 7h13l3 3h3v5h-7l-3 3H8v-4H3V7Z" fill="url(#silver)" stroke="#edf5ff" stroke-width="1.1"/>
    <path d="M5 9h10l3 3H5V9Z" fill="#f6fbff" fill-opacity=".58"/>
    <path d="M8 14h4v5H9l-1-5Zm11-4h2v5h-2z" fill="url(#darkMetal)" stroke="#c4d4e8" stroke-width=".7"/>`],
  'ui-bomb.svg': [24, 24, `
    <path d="m15 6 4-4m-1 0 1-1m2 3 2-1m-1 4 2 1" stroke="#ffe188" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="11" cy="14" r="8" fill="url(#red)" stroke="#ffd5c4" stroke-width="1.1"/>
    <path d="m11 6 6 4-1 7-6 4-6-5 1-6 6-4Z" fill="#ea6851" fill-opacity=".52"/>
    <ellipse cx="8" cy="10" rx="2.7" ry="1.6" fill="url(#shine)"/>`],
  'ui-clock.svg': [24, 24, `
    <circle cx="12" cy="12" r="10" fill="url(#blue)" stroke="#e0f8ff" stroke-width="1.2"/>
    <circle cx="12" cy="12" r="7" fill="#142941" stroke="#95e4ff" stroke-width=".8"/>
    <path d="M12 7v5l4 2" stroke="#ffe89a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M7 5.5 10 4" stroke="#fff" stroke-opacity=".86" stroke-width="1.2" stroke-linecap="round"/>`],
  'ui-skull.svg': [24, 24, `
    <path d="M12 2a9 9 0 0 0-6 15.7V21h4v-2h4v2h4v-3.3A9 9 0 0 0 12 2Z" fill="url(#silver)" stroke="#fff" stroke-width="1.1"/>
    <path d="M7.5 10a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 0 0-3.6 0Zm5.4 0a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 0 0-3.6 0Z" fill="#142039"/>
    <path d="m12 12 2 3h-4l2-3ZM9 19v2m3-2v2m3-2v2" stroke="#19263c" stroke-width="1.4"/>`],
  'ui-trophy.svg': [24, 24, `
    <path d="M7 3h10v5c0 4.7-2 7-5 7S7 12.7 7 8V3Z" fill="url(#gold)" stroke="#fff0a4" stroke-width="1.1"/>
    <path d="M7 5H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4" fill="none" stroke="#f4c54c" stroke-width="2"/>
    <path d="M10 15h4v4h-4zM7 19h10v3H7z" fill="url(#bronze)" stroke="#ffe4bb" stroke-width=".8"/>
    <path d="m12 4 1 2 2 .3-1.5 1.4.4 2.1L12 9l-1.9 1 .4-2.1L9 6.3l2-.3 1-2Z" fill="#fff9dc"/>`],
  'ui-bolt.svg': [24, 24, `
    <path d="m13 1-9 13h6l-1 9 11-14h-7l2-8h-2Z" fill="url(#gold)" stroke="#fff4bd" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="m13 4-5 8h5l-1 6 6-8h-5l1-6Z" fill="#fff3ac" fill-opacity=".66"/>`],
  'ui-coin.svg': [24, 24, `
    <ellipse cx="12" cy="12" rx="9" ry="10" fill="url(#gold)" stroke="#fff1a6" stroke-width="1.2"/>
    <ellipse cx="12" cy="12" rx="6.5" ry="7.5" fill="none" stroke="#a65c18" stroke-width="1"/>
    <path d="M15.5 8.5c-.7-.8-1.6-1.2-3-1.2-1.7 0-2.8.8-2.8 2s1 1.7 2.9 2.1c1.8.4 2.7.9 2.7 2.1s-1.1 2.2-3 2.2c-1.3 0-2.5-.5-3.3-1.4m3.1-8.7v10.8" fill="none" stroke="#fff5cc" stroke-width="1.15" stroke-linecap="round"/>
    <path d="M7 6.5c1.2-1.3 2.8-2 4.8-2" stroke="#fff" stroke-opacity=".8" stroke-width="1" stroke-linecap="round"/>`]
};

function renderSvg(name, width, height, art) {
  const extraDefs = name === 'bg-tile.svg'
    ? '<pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0v30" fill="none" stroke="#879bb9" stroke-opacity=".16" stroke-width="1"/></pattern>'
    : '';
  const scale = name === 'bg-tile.svg' ? 1 : 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" fill="none" role="img"><defs>${defs}${extraDefs}</defs><title>${name.replace('.svg', '').replaceAll('-', ' ')}</title>${art}</svg>\n`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, [width, height, art]] of Object.entries(sprites)) {
  fs.writeFileSync(path.join(OUT_DIR, name), renderSvg(name, width, height, art));
  const scale = name === 'bg-tile.svg' ? 1 : 4;
  console.log(`Generated ${name} (${width * scale}x${height * scale}, viewBox ${width}x${height})`);
}
console.log(`Generated ${Object.keys(sprites).length} high-resolution vector sprites.`);
