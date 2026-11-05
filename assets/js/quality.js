/**
 * Rendering quality tier, decided once at load.
 *
 * "low" = phones and small touch tablets: fewer pixels, no bloom / MSAA, simpler materials
 * and no costly CSS effects (backdrop blur, big drop shadows, blend modes).
 * Force a tier for testing with ?quality=low or ?quality=high.
 */

const forced = new URLSearchParams(location.search).get('quality');
const coarse = window.matchMedia('(pointer: coarse)').matches;
const smallScreen = Math.min(screen.width, screen.height) <= 820;

const isLow = forced === 'low' || (forced !== 'high' && coarse && smallScreen);

export const QUALITY = isLow
  ? {
      tier: 'low',
      maxPixelRatio: 1.5, // phones report 2-3; 1.5 already hides most aliasing
      minPixelRatio: 1.0, // floor for the adaptive drop (see main.js)
      adaptive: true,     // lower the resolution further if the frame rate stays low
      msaa: 0,
      bloom: false,
      physicalMaterials: false, // clearcoat wood/brass -> standard
      shadowMapSize: 1024,
      headlineBlur: false,      // "Dexter Kills" entrance without the animated blur filter
      smoothTouch: false        // native touch scrolling, no smoothing lag
    }
  : {
      tier: 'high',
      maxPixelRatio: 2,
      minPixelRatio: 2,
      adaptive: false,
      msaa: 4,
      bloom: true,
      physicalMaterials: true,
      shadowMapSize: 2048,
      headlineBlur: true,
      smoothTouch: 0.15
    };

document.documentElement.classList.toggle('quality-low', isLow);
