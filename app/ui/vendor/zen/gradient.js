/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// From Zen Browser's src/zen/spaces/ZenGradientGenerator.mjs
// (https://github.com/zen-browser/desktop, commit 6609acd4cc87e8ceaecb405df335d99f6ad8b2e7).
// Modified for Hillium: the colour maths taken out of the XUL theme picker as plain
// functions (HSL conversion, blending, contrast, the space gradient, colour harmonies and
// the picker's position-to-colour mapping), with Gecko-only parts (prefs, windowUtils,
// Mica, transparency detection) replaced by parameters. This file stays under the MPL-2.0.

export const MIN_OPACITY = 0.15;
export const MAX_OPACITY = 0.9;

export function hueToRgb(p, q, t) {
  if (t < 0) {
    t += 1;
  }
  if (t > 1) {
    t -= 1;
  }
  if (t < 1 / 6) {
    return p + (q - p) * 6 * t;
  }
  if (t < 1 / 2) {
    return q;
  }
  if (t < 2 / 3) {
    return p + (q - p) * (2 / 3 - t) * 6;
  }
  return p;
}

// h, s, l in 0–1 → [r, g, b] in 0–255
export function hslToRgb(h, s, l) {
  const { round } = Math;
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return [round(r * 255), round(g * 255), round(b * 255)];
}

// [r, g, b] in 0–255 → [hue in degrees, s 0–1, l 0–1]
export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  let max = Math.max(r, g, b);
  let min = Math.min(r, g, b);
  let d = max - min;
  let h;
  if (d === 0) {
    h = 0;
  } else if (max === r) {
    h = ((g - b) / d) % 6;
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else if (max === b) {
    h = (r - g) / d + 4;
  }
  let l = (min + max) / 2;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [(h * 60 + 360) % 360, s, l];
}

export function luminance([r, g, b]) {
  // These magic numbers are extracted from the wikipedia article on relative luminance
  // https://en.wikipedia.org/wiki/Relative_luminance
  var a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

export function contrastRatio(rgb1, rgb2) {
  const lum1 = luminance(rgb1);
  const lum2 = luminance(rgb2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

export function blendColors(rgb1, rgb2, percentage) {
  const p = percentage / 100;
  return [
    Math.round(rgb1[0] * p + rgb2[0] * (1 - p)),
    Math.round(rgb1[1] * p + rgb2[1] * (1 - p)),
    Math.round(rgb1[2] * p + rgb2[2] * (1 - p)),
  ];
}

export function toolbarModifiedBaseRaw(isDarkMode, allowTransparency = false) {
  const opacity = allowTransparency ? 0.6 : 1;
  return isDarkMode ? [23, 23, 26, opacity] : [240, 240, 244, opacity];
}

// One colour of the gradient, blended with the window base as Zen does without transparency.
export function singleRGBColor(color, { isDarkMode, opacity = 0.5 }) {
  const base = toolbarModifiedBaseRaw(isDarkMode).slice(0, 3);
  const c = blendColors(color, base, opacity * 100);
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// The space background. colors: up to three [r, g, b].
export function getGradient(colors, { isDarkMode = false, opacity = 0.5, forToolbar = false } = {}) {
  const rotation = -30;
  const themed = colors.filter(Boolean);
  const one = c => singleRGBColor(c, { isDarkMode, opacity });
  if (themed.length === 0) {
    return isDarkMode ? "#131313" : "#e9e9e9";
  } else if (themed.length === 1) {
    return one(themed[0]);
  }
  if (themed.length === 2) {
    if (!forToolbar) {
      return [
        `linear-gradient(${rotation}deg, ${one(themed[1])} 30%, transparent 120%)`,
        `linear-gradient(${rotation + 180}deg, ${one(themed[0])} 30%, transparent 120%)`,
      ]
        .reverse()
        .join(", ");
    }
    return `linear-gradient(${rotation}deg, ${one(themed[1])} 0%, ${one(themed[0])} 100%)`;
  }
  let color1 = one(themed[2]);
  let color2 = one(themed[0]);
  let color3 = one(themed[1]);
  return [
    `linear-gradient(-5deg, ${color1} 10%, transparent 80%)`,
    `radial-gradient(circle at 95% 0%, ${color3} 0%, transparent 75%)`,
    `radial-gradient(circle at 0% 0%, ${color2} 10%, transparent 70%)`,
  ].join(", ");
}

export function getToolbarColor(isDarkMode = false, accentColor = undefined) {
  const opacity = 0.9;
  let baseColor = isDarkMode ? [255, 255, 255, opacity] : [0, 0, 0, opacity]; // Default toolbar
  if (accentColor) {
    // Blend a bit with the accent color to make it more visible
    baseColor = blendColors(accentColor, baseColor.slice(0, 3), 5).concat(opacity);
  }
  return baseColor;
}

// Whether light text reads better than dark text on this accent colour.
export function shouldBeDarkMode(accentColor, { isDarkMode = false, opacity = 0.5 } = {}) {
  const toolbarBg = toolbarModifiedBaseRaw(isDarkMode);
  accentColor = blendColors(toolbarBg.slice(0, 3), accentColor, (1 - opacity) * 100);

  const bg = accentColor;

  // Get text colors (with alpha)
  let darkText = getToolbarColor(true); // e.g. [r, g, b, a]
  let lightText = getToolbarColor(false); // e.g. [r, g, b, a]

  // Composite text color over background
  darkText = blendColors(bg, darkText.slice(0, 3), (1 - darkText[3]) * 100);
  lightText = blendColors(bg, lightText.slice(0, 3), (1 - lightText[3]) * 100);

  const darkContrast = contrastRatio(bg, darkText);
  const lightContrast = contrastRatio(bg, lightText);

  return darkContrast > lightContrast;
}

export function getAccentColorForUI(accentColor, isDarkMode) {
  let [r, g, b] = accentColor;
  if (isDarkMode) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  // gh-15142: Special case for grayscale colors
  if (r == g && g == b) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const [h, s, l] = rgbToHsl(...accentColor);
  const saturation = Math.min(1, s + 0.3);
  const targetLightness = isDarkMode ? 0.62 : 0.42;
  const lightness = l * 0.4 + targetLightness * 0.6;
  [r, g, b] = hslToRgb(h / 360, saturation, lightness);
  return `rgb(${r}, ${g}, ${b})`;
}

export const colorHarmonies = [
  { type: "complementary", angles: [180] },
  { type: "singleAnalogous", angles: [310] },
  { type: "splitComplementary", angles: [150, 210] },
  { type: "analogous", angles: [50, 310] },
  { type: "triadic", angles: [120, 240] },
  { type: "floating", angles: [] },
];

// The picker is a colour wheel: angle is the hue, distance from the centre the lightness.
// size: the wheel's width and height in px. Returns [r, g, b].
export function getColorFromPosition(x, y, size) {
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 2;
  const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2) - 0.2;
  let angle = Math.atan2(y - centerY, x - centerX);
  angle = (angle * 180) / Math.PI;
  if (angle < 0) {
    angle += 360;
  }
  const normalizedDistance = 1 - Math.min(distance / radius, 1);
  let hue = (angle / 360) * 360;
  const saturation = 90 + (1 - normalizedDistance) * 10;
  // Moving the dot outside will have higher lightness, while moving it inside will have lower lightness
  const lightness = Math.round((1 - normalizedDistance) * 100);
  const [r, g, b] = hslToRgb(hue / 360, saturation / 100, Math.max(12, Math.min(88, lightness)) / 100);
  return [Math.min(255, Math.max(0, r)), Math.min(255, Math.max(0, g)), Math.min(255, Math.max(0, b))];
}

// Where a colour sits on the wheel (the inverse of getColorFromPosition).
export function calculateInitialPosition([r, g, b], size) {
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 2;
  const [hue, , lightness] = rgbToHsl(r, g, b);
  const angle = (hue / 360) * 2 * Math.PI; // Convert to radians
  const distance = Math.max(0.1, Math.min(1, lightness)) * radius;
  return { x: centerX + distance * Math.cos(angle), y: centerY + distance * Math.sin(angle) };
}

// The other dots of a harmony around the primary dot, at the same distance from the centre.
export function calculateCompliments(primary, harmonyType, size) {
  const harmony = colorHarmonies.find(h => h.type === harmonyType);
  if (!harmony || harmony.angles.length === 0) {
    return [primary];
  }
  const centerPosition = { x: size / 2, y: size / 2 };
  const deltaX = primary.x - centerPosition.x;
  const deltaY = primary.y - centerPosition.y;
  const baseAngle = (Math.atan2(deltaY, deltaX) * (180 / Math.PI) + 360) % 360;
  let distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const radius = size / 2;
  if (distance > radius) {
    distance = radius;
  }
  const dots = [primary];
  harmony.angles.forEach(angleOffset => {
    let newAngle = (baseAngle + angleOffset) % 360;
    let radian = (newAngle * Math.PI) / 180;
    dots.push({
      x: centerPosition.x + distance * Math.cos(radian),
      y: centerPosition.y + distance * Math.sin(radian),
    });
  });
  return dots;
}
