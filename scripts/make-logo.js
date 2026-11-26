'use strict';
// Builds the site logos from the original designs in design/:
//   public/brand/logo-mark.svg      ring + equalizer only (header, footer, record label)
//   public/brand/logo-animated.svg  full logo with the SURGTHFLUR / MUSIC wordmark (loading screen)
//   public/brand/wordmark-animated.svg  SURGTHFLUR MUSIC wordmark (top of the homepage)
//   public/icons/icon.svg           static mark for the browser tab
// Run with: npm run logo

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'design', 'system-album-animated.svg'), 'utf8');

const ring = source.match(/<g class="ring"[\s\S]*?\n  <\/g>/)[0];
const eq = source.match(/<g class="eqGroup"[\s\S]*?\n  <\/g>/)[0];
const halo = source.match(/<defs>[\s\S]*?<\/defs>/)[0];

// Play the boot sequence about twice as fast so it fits a short loading screen.
const faster = (svg) => svg.replace(/animation-delay:([\d.]+)s/g, (_, s) => `animation-delay:${(Number(s) * 0.5).toFixed(3)}s`);

const baseStyle = `
    .halo { transform-origin: 400px 340px; animation: fadeIn .4s ease-out both, breathe 5s ease-in-out .4s infinite alternate; }
    .ring { transform-origin: 400px 340px; animation: spin 90s linear infinite; filter: drop-shadow(0 0 10px rgba(46, 91, 255, 0.45)); }
    .obBoot { animation: fadeIn .3s ease-out both; }
    .ob { transform-box: fill-box; transform-origin: 50% 100%; animation: wave 2.4s cubic-bezier(.45,0,.55,1) infinite; }
    .eqBoot { animation: fadeIn .25s ease-out both; }
    .eq { transform-box: fill-box; transform-origin: center; animation: pulse 1.1s ease-in-out infinite alternate; }
    .eqGroup { filter: drop-shadow(0 0 6px rgba(92, 134, 255, 0.5)); }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes breathe { from { opacity: .55; transform: scale(.98); } to { opacity: 1; transform: scale(1.03); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes wave { 0%, 100% { transform: scaleY(.3); opacity: .35; } 50% { transform: scaleY(1); opacity: 1; } }
    @keyframes pulse { from { transform: scaleY(.35); opacity: .7; } to { transform: scaleY(1); opacity: 1; } }`;

const reducedStyle = (extra = '') => `
    @media (prefers-reduced-motion: reduce) {
      .ring, .ob, .eq, .halo, .obBoot, .eqBoot${extra} { animation: none !important; opacity: 1 !important; }
    }`;

// ------------------------------------------------------------- logo mark
// Cropped square around the disc, transparent background, no boot delay.
const noBoot = (svg) => svg.replace(/<g class="(obBoot|eqBoot)" style="animation-delay:[\d.]+s">/g, '<g>');
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="150 90 500 500" role="img" aria-label="Surgthflur - Music logo">
  ${halo}
  <style>${baseStyle}${reducedStyle()}
  </style>
  <circle class="halo" cx="400" cy="340" r="230" fill="url(#halo)"/>
  ${noBoot(ring)}
  ${noBoot(eq)}
</svg>
`;

// --------------------------------------------------------- animated logo
function letters(word, cls, start, step, waveStep) {
  return [...word].map((ch, i) => `<tspan class="${cls}" style="animation-delay:${(start + i * step).toFixed(2)}s,${(i * waveStep).toFixed(2)}s">${ch}</tspan>`).join('');
}

const animated = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="Surgthflur - Music">
  ${halo}
  <style>${baseStyle}
    .ltS, .ltA { animation: fadeIn .3s ease-out both, refreshS 4s linear infinite; }
    .ltS { fill: #FFFFFF; }
    .ltA { fill: #7E97E8; animation-name: fadeIn, refreshA; }
    .cursor { fill: #5C86FF; animation: fadeIn .01s linear 1.95s both, blink 1.05s steps(1) 1.96s infinite; }
    @keyframes refreshS { 0%, 22%, 100% { fill: #FFFFFF; } 11% { fill: #A9BBFF; } }
    @keyframes refreshA { 0%, 22%, 100% { fill: #7E97E8; } 11% { fill: #C7D2FF; } }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }${reducedStyle(', .ltS, .ltA, .cursor')}
  </style>
  <circle class="halo" cx="400" cy="340" r="230" fill="url(#halo)"/>
  ${faster(ring)}
  ${faster(eq)}
  <text x="400" y="620" text-anchor="middle" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="56" font-weight="700" letter-spacing="10">${letters('SURGTHFLUR', 'ltS', 1.0, 0.06, 0.12)}</text>
  <text x="400" y="688" text-anchor="middle" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="34" font-weight="400" letter-spacing="26">${letters('MUSIC', 'ltA', 1.6, 0.07, 0.16)}<tspan class="cursor" dx="10">&#9646;</tspan></text>
</svg>
`;

// ------------------------------------------------------------ static icon
const staticIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="150 90 500 500">
  <rect x="150" y="90" width="500" height="500" rx="110" fill="#050510"/>
  ${noBoot(ring).replace(' class="ring"', '').replace(/ class="ob"/g, '').replace(/ style="animation-delay:[\d.]+s"/g, '')}
  ${noBoot(eq).replace(' class="eqGroup"', '').replace(/ class="eq"/g, '').replace(/ style="animation-delay:[\d.]+s"/g, '')}
</svg>
`;

// ------------------------------------------------------- homepage wordmark
// design/surgthflur-music-animated.svg with a transparent background, cropped tight.
const wordmark = fs.readFileSync(path.join(root, 'design', 'surgthflur-music-animated.svg'), 'utf8')
  .replace('viewBox="0 0 900 300"', 'viewBox="150 88 600 190"')
  .replace(/\s*<rect width="900" height="300" fill="#050510"\/>/, '')
  .replace('aria-label="Surgthflur Music animated wordmark"', 'aria-label="Surgthflur - Music"');

fs.mkdirSync(path.join(root, 'public', 'brand'), { recursive: true });
fs.writeFileSync(path.join(root, 'public', 'brand', 'logo-mark.svg'), mark);
fs.writeFileSync(path.join(root, 'public', 'brand', 'logo-animated.svg'), animated);
fs.writeFileSync(path.join(root, 'public', 'icons', 'icon.svg'), staticIcon);
fs.writeFileSync(path.join(root, 'public', 'brand', 'wordmark-animated.svg'), wordmark);
console.log('wrote public/brand/logo-mark.svg, logo-animated.svg, wordmark-animated.svg and public/icons/icon.svg');
