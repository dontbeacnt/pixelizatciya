const DEFAULT_PALETTE = [
  "#d8d2ad",
  "#f2f2f2",
  "#d4d4d4",
  "#a6a6a6",
  "#686868",
  "#4a4a4a",
  "#1d1d1d",
  "#000000",
  "#ffc2ba",
  "#ff8aaa",
  "#ff4bac",
  "#ff5058",
  "#f20700",
  "#d00000",
  "#ffad63",
  "#f3a300",
  "#ad7441",
  "#68452d",
  "#fff58a",
  "#f1e500",
  "#89e31a",
  "#16ce00",
  "#628d33",
  "#00611f",
  "#65f5ff",
  "#00c8da",
  "#008fcb",
  "#0700ff",
  "#09047b",
  "#bf88ff",
  "#b337d7",
  "#87008e",
];

const BAYER_8 = [
  0, 48, 12, 60, 3, 51, 15, 63,
  32, 16, 44, 28, 35, 19, 47, 31,
  8, 56, 4, 52, 11, 59, 7, 55,
  40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61,
  34, 18, 46, 30, 33, 17, 45, 29,
  10, 58, 6, 54, 9, 57, 5, 53,
  42, 26, 38, 22, 41, 25, 37, 21,
];

const state = {
  sourceBitmap: null,
  sourceName: "demo",
  palette: DEFAULT_PALETTE.map(hexToRgb),
  paletteLab: [],
  targetWidth: 96,
  sampling: "smooth",
  dither: "auto",
  keepAlpha: false,
  exportScale: 4,
  lastImageData: null,
};

const els = {
  imageInput: document.querySelector("#imageInput"),
  paletteInput: document.querySelector("#paletteInput"),
  downloadBtn: document.querySelector("#downloadBtn"),
  themeToggle: document.querySelector("#themeToggle"),
  resetBtn: document.querySelector("#resetBtn"),
  defaultPaletteBtn: document.querySelector("#defaultPaletteBtn"),
  widthSlider: document.querySelector("#widthSlider"),
  widthValue: document.querySelector("#widthValue"),
  exportScale: document.querySelector("#exportScale"),
  keepAlpha: document.querySelector("#keepAlpha"),
  paletteGrid: document.querySelector("#paletteGrid"),
  pixelSizeStat: document.querySelector("#pixelSizeStat"),
  colorCountStat: document.querySelector("#colorCountStat"),
  imageMeta: document.querySelector("#imageMeta"),
  resultCanvas: document.querySelector("#resultCanvas"),
  sourceCanvas: document.querySelector("#sourceCanvas"),
  mappedCanvas: document.querySelector("#mappedCanvas"),
  dropZone: document.querySelector("#dropZone"),
  canvasArea: document.querySelector(".canvas-area"),
};

const resultCtx = els.resultCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
const sourceCtx = els.sourceCanvas.getContext("2d", { alpha: false });
const mappedCtx = els.mappedCanvas.getContext("2d", { alpha: false });

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function srgbToLinear(value) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(value) {
  const v = Math.max(0, Math.min(1, value));
  const srgb = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(clamp255(srgb * 255));
}

function linearToRgbObject({ r, g, b }) {
  return {
    r: linearToSrgbByte(r),
    g: linearToSrgbByte(g),
    b: linearToSrgbByte(b),
  };
}

function rgbToOklab({ r, g, b }) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    L: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function clamp255(value) {
  return Math.max(0, Math.min(255, value));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clampRange(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampRange(finiteNumber(value, fallback), min, max));
}

function rebuildPaletteLab() {
  state.paletteLab = state.palette.map((color) => ({
    color,
    lab: rgbToOklab(color),
    chroma: 0,
    hue: 0,
  }));

  state.paletteLab.forEach((entry) => {
    entry.chroma = Math.hypot(entry.lab.a, entry.lab.b);
    entry.hue = Math.atan2(entry.lab.b, entry.lab.a);
  });
}

function labChroma(lab) {
  return Math.hypot(lab.a, lab.b);
}

function labHue(lab) {
  return Math.atan2(lab.b, lab.a);
}

function hueDistance(a, b) {
  const delta = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(delta, Math.PI * 2 - delta);
}

function isNeutralEntry(entry) {
  return entry.chroma < 0.018;
}

function warmHueWeight(hue) {
  const redOrange = hueDistance(hue, 0.58);
  const orange = hueDistance(hue, 0.9);
  return Math.max(1 - redOrange / 0.78, 1 - orange / 0.7, 0);
}

function goldHueWeight(hue) {
  const orangeGold = hueDistance(hue, 1.28);
  const yellow = hueDistance(hue, 1.83);
  return Math.max(1 - orangeGold / 0.55, 1 - yellow / 0.52, 0);
}

function greenHueWeight(hue) {
  return Math.max(1 - hueDistance(hue, 2.35) / 0.72, 0);
}

function hueFamilyFor(hue, chroma) {
  if (chroma < 0.045) return "neutral";
  if (hue >= -0.35 && hue < 0.28) return "pink";
  if (hue >= 0.28 && hue < 0.74) return "red";
  if (hue >= 0.74 && hue < 1.42) return "orange";
  if (hue >= 1.42 && hue < 2.08) return "gold";
  if (hue >= 2.08 && hue < 2.8) return "green";
  if (hue >= 2.8 || hue < -2.35) return "cyan";
  if (hue >= -2.35 && hue < -1.25) return "blue";
  return "purple";
}

function hueFamilyForLab(lab) {
  return hueFamilyFor(labHue(lab), labChroma(lab));
}

function hueFamilyForEntry(entry) {
  return hueFamilyFor(entry.hue, entry.chroma);
}

function areHueFamiliesCompatible(first, second) {
  if (first === second) return true;
  return (
    (first === "orange" && second === "gold") ||
    (first === "gold" && second === "orange") ||
    (first === "cyan" && second === "blue") ||
    (first === "blue" && second === "cyan") ||
    (first === "blue" && second === "purple") ||
    (first === "purple" && second === "blue")
  );
}

function hueFamilyPenalty(anchorLab, entry) {
  const anchorChroma = labChroma(anchorLab);
  if (anchorChroma < 0.065 || entry.chroma < 0.045) return 0;

  const sourceFamily = hueFamilyForLab(anchorLab);
  const entryFamily = hueFamilyForEntry(entry);
  if (sourceFamily === "neutral" || entryFamily === "neutral") return 0;

  const strength = smoothstep(0.065, 0.18, anchorChroma) * smoothstep(0.045, 0.14, entry.chroma);
  if (areHueFamiliesCompatible(sourceFamily, entryFamily)) {
    return Math.max(0, hueDistance(labHue(anchorLab), entry.hue) - 0.38) * 0.16 * strength;
  }

  return (0.09 + Math.min(1.35, hueDistance(labHue(anchorLab), entry.hue)) * 0.055) * strength;
}

function rejectsSourceHueFamily(sourceLab, replacementEntry, currentEntry = null) {
  const sourceChroma = labChroma(sourceLab);
  if (sourceChroma < 0.075 || replacementEntry.chroma < 0.045) return false;

  const sourceFamily = hueFamilyForLab(sourceLab);
  const replacementFamily = hueFamilyForEntry(replacementEntry);
  if (sourceFamily === "neutral" || replacementFamily === "neutral") return false;
  if (areHueFamiliesCompatible(sourceFamily, replacementFamily)) return false;

  if (currentEntry) {
    const currentFamily = hueFamilyForEntry(currentEntry);
    if (!areHueFamiliesCompatible(sourceFamily, currentFamily)) return false;
  }

  return true;
}

function labDistance(first, second) {
  const dL = (first.L - second.L) * 1.18;
  const da = first.a - second.a;
  const db = first.b - second.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

function labFromArray(buffer, index) {
  return {
    L: buffer[index],
    a: buffer[index + 1],
    b: buffer[index + 2],
  };
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function forceOpaque(imageData) {
  for (let i = 3; i < imageData.data.length; i += 4) {
    imageData.data[i] = 255;
  }

  return imageData;
}

function paletteDistanceForLab(lab, entry, anchorLab = null, guardStrength = 0) {
  const chroma = labChroma(lab);
  const dL = (lab.L - entry.lab.L) * 1.18;
  const da = lab.a - entry.lab.a;
  const db = lab.b - entry.lab.b;
  const dChroma = (chroma - entry.chroma) * 0.28;
  let distance = dL * dL + da * da + db * db + dChroma * dChroma;

  if (!anchorLab || guardStrength <= 0) return distance;

  const anchorChroma = labChroma(anchorLab);
  const familyPenalty = hueFamilyPenalty(anchorLab, entry);
  distance += familyPenalty * familyPenalty * guardStrength * 5.8;

  if (anchorChroma < 0.012) {
    const chromaLeak = Math.max(0, entry.chroma - 0.045);
    distance += chromaLeak * chromaLeak * guardStrength * 4.2;
    return distance;
  }

  const anchorHue = labHue(anchorLab);
  const warmWeight = warmHueWeight(anchorHue);
  const goldWeight = goldHueWeight(anchorHue);
  const greenWeight = greenHueWeight(anchorHue);

  if (entry.chroma > 0.035) {
    const allowedHueShift = anchorChroma > 0.13 ? 0.5 : 0.36;
    const hueLeak = Math.max(0, hueDistance(anchorHue, entry.hue) - allowedHueShift);
    distance += hueLeak * hueLeak * guardStrength * 3.6;
  }

  const neutralDrop = isNeutralEntry(entry) ? Math.max(0, anchorChroma - 0.006) : 0;
  distance += neutralDrop * neutralDrop * guardStrength * 12.5;

  const chromaDrop = Math.max(0, anchorChroma - entry.chroma - 0.018);
  distance += chromaDrop * chromaDrop * guardStrength * 5.4;

  const chromaSpike = Math.max(0, entry.chroma - anchorChroma - 0.07);
  distance += chromaSpike * chromaSpike * guardStrength * 2.4;

  if (anchorChroma > 0.025 && warmWeight > 0) {
    const entryWarm = warmHueWeight(entry.hue);
    const skinDrop = Math.max(0, warmWeight - entryWarm);
    distance += skinDrop * skinDrop * guardStrength * 0.018;
  }

  if (anchorChroma > 0.025 && greenWeight > 0) {
    const entryGreen = greenHueWeight(entry.hue);
    const greenDrop = Math.max(0, greenWeight - entryGreen);
    distance += greenDrop * greenDrop * guardStrength * 0.016;
  }

  if (anchorChroma > 0.045 && goldWeight > 0.28) {
    const entryGreen = greenHueWeight(entry.hue);
    const entryGold = goldHueWeight(entry.hue);
    const greenLeak = Math.max(0, entryGreen - entryGold * 0.35);
    distance += greenLeak * greenLeak * goldWeight * guardStrength * 0.12;
  }

  return distance;
}

function paletteCandidatesForLab(anchorLab, limit, guardStrength) {
  if (limit >= state.paletteLab.length) return state.paletteLab;

  return state.paletteLab
    .map((entry) => ({
      entry,
      distance: paletteDistanceForLab(anchorLab, entry, anchorLab, guardStrength * 1.35),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function bestPaletteMatchFromLab(lab, anchorLab = null, guardStrength = 0, candidateLimit = 64) {
  const candidates = paletteCandidatesForLab(anchorLab ?? lab, candidateLimit, guardStrength);
  let best = candidates[0] ?? state.paletteLab[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of candidates) {
    const distance = paletteDistanceForLab(lab, entry, anchorLab, guardStrength);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }

  return { distance: bestDistance, entry: best };
}

function nearestPaletteEntryFromLab(lab, anchorLab = null, guardStrength = 0, candidateLimit = 64) {
  return bestPaletteMatchFromLab(lab, anchorLab, guardStrength, candidateLimit).entry;
}

function weightedLabVector(from, to) {
  return {
    L: (to.L - from.L) * 1.18,
    a: to.a - from.a,
    b: to.b - from.b,
  };
}

function dotLab(first, second) {
  return first.L * second.L + first.a * second.a + first.b * second.b;
}

function mixLab(first, second, amount) {
  return {
    L: first.L + (second.L - first.L) * amount,
    a: first.a + (second.a - first.a) * amount,
    b: first.b + (second.b - first.b) * amount,
  };
}

function orderedThreshold(x, y) {
  return (BAYER_8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
}

function addLabError(buffer, width, height, x, y, error, amount, contrast, alpha = null) {
  if (x < 0 || x >= width || y < 0 || y >= height || amount <= 0) return;

  const pixel = y * width + x;
  const index = pixel * 3;
  const edgeStop = smoothstep(0.05, 0.18, contrast[pixel]);
  const alphaStop = alpha ? smoothstep(0.26, 0.94, alpha[pixel]) : 1;
  const edgeSafeAmount = amount * alphaStop * (1 - edgeStop * 0.72);
  if (edgeSafeAmount <= 0.0001) return;

  buffer[index] = clampRange(buffer[index] + error.L * edgeSafeAmount, 0, 1);
  buffer[index + 1] = clampRange(buffer[index + 1] + error.a * edgeSafeAmount, -0.45, 0.45);
  buffer[index + 2] = clampRange(buffer[index + 2] + error.b * edgeSafeAmount, -0.45, 0.45);
}

function diffusePaletteError(buffer, width, height, x, y, sourceLab, entryLab, contrast, profile, style, direction = 1, alpha = null) {
  const graphicScore = style?.graphicScore ?? 0;
  const strength =
    (profile.mode === "floyd" ? 0.68 : 0.34) *
    (1 - graphicScore * 0.5) *
    (profile.mode === "light" ? 0.78 : 1);
  if (strength <= 0.02) return;

  const anchorChroma = labChroma(sourceLab);
  const entryChroma = labChroma(entryLab);
  const chromaLimit = 0.035 + anchorChroma * 0.42;
  const sourceFamily = hueFamilyForLab(sourceLab);
  const entryFamily = hueFamilyForLab(entryLab);
  const familyCompatible =
    sourceFamily === "neutral" ||
    entryFamily === "neutral" ||
    areHueFamiliesCompatible(sourceFamily, entryFamily);
  const chromaSafety =
    anchorChroma < 0.052 || entryChroma < 0.052
      ? 0.52
      : familyCompatible
        ? 1
        : 0.18;
  const chromaStrength = Math.min(0.66, profile.chroma * 5.7) * chromaSafety * (1 - graphicScore * 0.22);
  const error = {
    L: clampRange(sourceLab.L - entryLab.L, -0.12, 0.12) * profile.lightness,
    a: clampRange(sourceLab.a - entryLab.a, -chromaLimit, chromaLimit) * chromaStrength,
    b: clampRange(sourceLab.b - entryLab.b, -chromaLimit, chromaLimit) * chromaStrength,
  };

  addLabError(buffer, width, height, x + direction, y, error, (7 / 16) * strength, contrast, alpha);
  addLabError(buffer, width, height, x - direction, y + 1, error, (3 / 16) * strength, contrast, alpha);
  addLabError(buffer, width, height, x, y + 1, error, (5 / 16) * strength, contrast, alpha);
  addLabError(buffer, width, height, x + direction, y + 1, error, (1 / 16) * strength, contrast, alpha);
}

function bestOrderedPairForLab(anchorLab, cleanMatch, profile) {
  const cleanDistance = Math.sqrt(cleanMatch.distance);
  if (cleanDistance < 0.045) return null;

  const candidates = paletteCandidatesForLab(
    anchorLab,
    Math.min(10, state.paletteLab.length),
    profile.guard * 0.85,
  );
  let best = null;
  let bestScore = cleanDistance;

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const first = candidates[i];
      const second = candidates[j];

      if (
        first.chroma > 0.05 &&
        second.chroma > 0.05 &&
        hueDistance(first.hue, second.hue) > 1.15
      ) {
        continue;
      }

      const line = weightedLabVector(first.lab, second.lab);
      const point = weightedLabVector(first.lab, anchorLab);
      const denom = dotLab(line, line);
      if (denom < 0.00001) continue;

      const amount = Math.max(0, Math.min(1, dotLab(point, line) / denom));
      if (amount < 0.04 || amount > 0.96) continue;

      const mixed = mixLab(first.lab, second.lab, amount);
      let score = labDistance(mixed, anchorLab);
      const anchorChroma = labChroma(anchorLab);
      const neutralCount = Number(isNeutralEntry(first)) + Number(isNeutralEntry(second));
      score += neutralCount * anchorChroma * anchorChroma * 0.22;
      score += Math.min(amount, 1 - amount) * 0.006;

      if (score < bestScore * 0.82) {
        bestScore = score;
        best = { amount, first, second };
      }
    }
  }

  return best;
}

function ditherProfile() {
  if (state.dither === "none") {
    return {
      edgeEnd: 0,
      edgeStart: 0,
      enabled: false,
      candidateLimit: state.paletteLab.length,
      chroma: 0,
      guard: 0.35,
      lightness: 0,
      mode: "none",
      needEnd: 1,
      needStart: 1,
    };
  }

  if (state.dither === "auto") {
    return {
      edgeEnd: 0.112,
      edgeStart: 0.038,
      enabled: true,
      candidateLimit: Math.min(8, state.paletteLab.length),
      chroma: 0.028,
      guard: 4.85,
      lightness: 0.52,
      mode: "auto",
      needEnd: 0.125,
      needStart: 0.04,
    };
  }

  if (state.dither === "edge") {
    return {
      edgeEnd: 0,
      edgeStart: 0,
      enabled: false,
      candidateLimit: Math.min(8, state.paletteLab.length),
      chroma: 0,
      guard: 5.25,
      lightness: 0,
      mode: "edge",
      needEnd: 1,
      needStart: 1,
    };
  }

  const ditherAmount = finiteNumber(state.dither, 0);

  if (ditherAmount <= 0) {
    return {
      edgeEnd: 0,
      edgeStart: 0,
      enabled: false,
      candidateLimit: state.paletteLab.length,
      chroma: 0,
      guard: 0.35,
      lightness: 0,
      mode: "none",
      needEnd: 1,
      needStart: 1,
    };
  }

  if (ditherAmount < 0.6) {
    return {
      edgeEnd: 0.128,
      edgeStart: 0.042,
      enabled: true,
      candidateLimit: Math.min(5, state.paletteLab.length),
      chroma: 0.048,
      guard: 4.15,
      lightness: 0.58,
      mode: "light",
      needEnd: 0.12,
      needStart: 0.038,
    };
  }

  return {
    edgeEnd: 0.145,
    edgeStart: 0.045,
    enabled: true,
    candidateLimit: Math.min(7, state.paletteLab.length),
    chroma: 0.074,
    guard: 3.55,
    lightness: 0.68,
    mode: "floyd",
    needEnd: 0.136,
    needStart: 0.044,
  };
}

function clampLab(lab) {
  return {
    L: Math.max(0, Math.min(1, lab.L)),
    a: Math.max(-0.45, Math.min(0.45, lab.a)),
    b: Math.max(-0.45, Math.min(0.45, lab.b)),
  };
}

function blendedSourceRgb(data, index, keepAlpha) {
  const pixelAlpha = data[index + 3] / 255;

  if (keepAlpha) {
    return {
      r: data[index],
      g: data[index + 1],
      b: data[index + 2],
    };
  }

  return linearToRgbObject({
    r: srgbToLinear(data[index]) * pixelAlpha + (1 - pixelAlpha),
    g: srgbToLinear(data[index + 1]) * pixelAlpha + (1 - pixelAlpha),
    b: srgbToLinear(data[index + 2]) * pixelAlpha + (1 - pixelAlpha),
  });
}

function paletteSourceRgb(data, index) {
  const pixelAlpha = data[index + 3] / 255;

  if (pixelAlpha <= 0.08) {
    return { r: 255, g: 255, b: 255 };
  }

  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
  };
}

function computeLocalContrast(base, width, height) {
  const contrast = new Float32Array(width * height);

  const distanceAt = (firstIndex, secondIndex) => {
    const dL = (base[firstIndex] - base[secondIndex]) * 1.18;
    const da = base[firstIndex + 1] - base[secondIndex + 1];
    const db = base[firstIndex + 2] - base[secondIndex + 2];
    return Math.sqrt(dL * dL + da * da + db * db);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 3;
      let local = 0;

      if (x > 0) local = Math.max(local, distanceAt(index, index - 3));
      if (x < width - 1) local = Math.max(local, distanceAt(index, index + 3));
      if (y > 0) local = Math.max(local, distanceAt(index, index - width * 3));
      if (y < height - 1) local = Math.max(local, distanceAt(index, index + width * 3));

      contrast[pixel] = local;
    }
  }

  return contrast;
}

function medianValue(values) {
  values.sort((first, second) => first - second);
  return values[Math.floor(values.length / 2)];
}

function labSignalWeight(lab, contrast = 0) {
  const chroma = labChroma(lab);
  const ink = Math.max(0, 0.94 - lab.L);
  const signal = Math.max(chroma * 3.2, ink * 1.35, contrast * 2.8);
  return clamp01(signal);
}

function measureVerticalSymmetry(base, width, height, contrast) {
  let weightedScore = 0;
  let totalWeight = 0;
  const halfWidth = Math.floor(width / 2);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < halfWidth; x += 1) {
      const leftPixel = y * width + x;
      const rightPixel = y * width + (width - 1 - x);
      const leftIndex = leftPixel * 3;
      const rightIndex = rightPixel * 3;
      const left = labFromArray(base, leftIndex);
      const right = labFromArray(base, rightIndex);
      const weight = Math.max(
        labSignalWeight(left, contrast[leftPixel]),
        labSignalWeight(right, contrast[rightPixel]),
      );

      if (weight < 0.035) continue;

      const distance = labDistance(left, right);
      const similarity = 1 - smoothstep(0.035, 0.19, distance);
      weightedScore += similarity * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0.001) {
    return {
      signal: 0,
      score: 0,
      strength: 0,
    };
  }

  const signal = totalWeight / Math.max(1, halfWidth * height);
  const score = clamp01(weightedScore / totalWeight);
  const strength = score * smoothstep(0.05, 0.22, signal);

  return { score, signal, strength };
}

function analyzeSourceStyle(base, width, height, contrast, data) {
  const pixels = Math.max(1, width * height);
  const sizeScale = clampRange(Math.sqrt(pixels) / 120, 0.72, 2.25);
  const buckets = new Set();
  let flatPixels = 0;
  let edgePixels = 0;
  let strongEdgePixels = 0;
  let highChromaPixels = 0;
  let chromaTotal = 0;

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const index = pixel * 3;
    const lab = labFromArray(base, index);
    const chroma = labChroma(lab);
    const localContrast = contrast[pixel];

    chromaTotal += chroma;
    if (chroma > 0.07) highChromaPixels += 1;
    if (localContrast < 0.028) flatPixels += 1;
    if (localContrast > 0.072) edgePixels += 1;
    if (localContrast > 0.135) strongEdgePixels += 1;

    if (data) {
      const dataIndex = pixel * 4;
      buckets.add(`${data[dataIndex] >> 4},${data[dataIndex + 1] >> 4},${data[dataIndex + 2] >> 4}`);
    }
  }

  const flatRatio = flatPixels / pixels;
  const edgeRatio = edgePixels / pixels;
  const strongEdgeRatio = strongEdgePixels / pixels;
  const highChromaRatio = highChromaPixels / pixels;
  const uniqueRatio = buckets.size / pixels;
  const averageChroma = chromaTotal / pixels;
  const flatSignal = smoothstep(0.42, 0.76, flatRatio);
  const edgeSignal = smoothstep(0.025, 0.14, edgeRatio);
  const colorSimplicity = 1 - smoothstep(0.09, 0.42, uniqueRatio);
  const chromaSignal = smoothstep(0.035, 0.12, averageChroma) * smoothstep(0.08, 0.28, highChromaRatio);
  const symmetry = measureVerticalSymmetry(base, width, height, contrast);
  const graphicScore = clamp01(
    flatSignal * 0.44 +
      colorSimplicity * 0.34 +
      edgeSignal * 0.18 +
      chromaSignal * 0.08 +
      smoothstep(0.55, 0.86, symmetry.strength) * 0.08 +
      smoothstep(0.012, 0.08, strongEdgeRatio) * 0.08,
  );
  const symmetryStrength = smoothstep(0.42, 0.78, symmetry.strength) * smoothstep(0.38, 0.76, graphicScore);

  return {
    averageChroma,
    colorSimplicity,
    edgeRatio,
    flatRatio,
    graphicScore,
    highChromaRatio,
    sizeScale,
    strongEdgeRatio,
    symmetryScore: symmetry.score,
    symmetrySignal: symmetry.signal,
    symmetryStrength,
    uniqueRatio,
  };
}

function deblockLabField(base, width, height, contrast, style) {
  const next = new Float32Array(base.length);
  const graphicScore = style?.graphicScore ?? 0;
  const edgeHigh = 0.155 - graphicScore * 0.025;
  const baseBlend = 0.44 + graphicScore * 0.2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 3;
      const center = labFromArray(base, index);
      const valuesL = [];
      const valuesA = [];
      const valuesB = [];

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const neighborIndex = (ny * width + nx) * 3;
          const neighbor = labFromArray(base, neighborIndex);
          const distance = labDistance(center, neighbor);
          if (distance > 0.18 && (dx !== 0 || dy !== 0)) continue;

          valuesL.push(neighbor.L);
          valuesA.push(neighbor.a);
          valuesB.push(neighbor.b);
        }
      }

      const edgeStop = smoothstep(0.045, edgeHigh, contrast[pixel]);
      const sampleCount = Math.max(1, valuesL.length);
      const support = Math.min(1, sampleCount / 7);
      const blend = baseBlend * (1 - edgeStop) * support;

      next[index] = center.L * (1 - blend) + medianValue(valuesL) * blend;
      next[index + 1] = center.a * (1 - blend) + medianValue(valuesA) * blend;
      next[index + 2] = center.b * (1 - blend) + medianValue(valuesB) * blend;
    }
  }

  return next;
}

function smoothLabField(base, width, height, contrast, style) {
  let current = base;
  const graphicScore = style?.graphicScore ?? 0;
  const spatial = [
    [0, -2, 0.34],
    [-1, -1, 0.55],
    [0, -1, 0.74],
    [1, -1, 0.55],
    [-2, 0, 0.34],
    [-1, 0, 0.74],
    [0, 0, 1],
    [1, 0, 0.74],
    [2, 0, 0.34],
    [-1, 1, 0.55],
    [0, 1, 0.74],
    [1, 1, 0.55],
    [0, 2, 0.34],
  ];

  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Float32Array(current.length);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const index = pixel * 3;
        const center = labFromArray(current, index);
        const edgeStop = smoothstep(0.052, 0.18 - graphicScore * 0.025, contrast[pixel]);
        const blend = 0.76 + graphicScore * 0.1 - edgeStop * (0.52 + graphicScore * 0.12);
        const sigma = 0.098 + (1 - edgeStop) * (0.052 - graphicScore * 0.014);
        let sumL = 0;
        let sumA = 0;
        let sumB = 0;
        let total = 0;

        for (const [dx, dy, spatialWeight] of spatial) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const neighborIndex = (ny * width + nx) * 3;
          const neighbor = labFromArray(current, neighborIndex);
          const colorDistance = labDistance(center, neighbor);
          const colorWeight = Math.exp(-(colorDistance * colorDistance) / (2 * sigma * sigma));
          const weight = spatialWeight * colorWeight;

          sumL += neighbor.L * weight;
          sumA += neighbor.a * weight;
          sumB += neighbor.b * weight;
          total += weight;
        }

        next[index] = center.L * (1 - blend) + (sumL / total) * blend;
        next[index + 1] = center.a * (1 - blend) + (sumA / total) * blend;
        next[index + 2] = center.b * (1 - blend) + (sumB / total) * blend;
      }
    }

    current = next;
  }

  return current;
}

function colorKey(entry) {
  return `${entry.color.r},${entry.color.g},${entry.color.b}`;
}

function isDarkEntry(entry) {
  return entry.lab.L < 0.36;
}

function isInkEntry(entry) {
  return entry.lab.L < 0.24 && entry.chroma < 0.055;
}

function isBrightEntry(entry) {
  return entry.lab.L > 0.84 && entry.chroma < 0.055;
}

function isDetailEntry(entry) {
  return isDarkEntry(entry) || isBrightEntry(entry) || entry.chroma > 0.105;
}

function entryDistance(first, second) {
  return labDistance(first.lab, second.lab);
}

function areRelatedEntries(first, second, tolerance = 0.135) {
  return first === second || entryDistance(first, second) < tolerance;
}

function bestInkEntryForLab(lab) {
  const inkEntries = state.paletteLab.filter(isInkEntry);
  const candidates = inkEntries.length > 0 ? inkEntries : state.paletteLab;
  let best = candidates[0] ?? state.paletteLab[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of candidates) {
    const darknessBias = entry.lab.L * 0.055 + entry.chroma * 0.08;
    const distance = labDistance(lab, entry.lab) + darknessBias;
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }

  return best;
}

function isSourceInkLab(lab, contrast = 0) {
  const chroma = labChroma(lab);
  if (lab.L < 0.28 && contrast > 0.018) return true;
  if (lab.L < 0.38 && contrast > 0.09) return true;
  return lab.L < 0.47 && chroma < 0.18 && contrast > 0.065;
}

function hasSourceInkSupport(base, contrast, width, height, x, y) {
  let support = 0;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const pixel = ny * width + nx;
      const lab = labFromArray(base, pixel * 3);
      if (isSourceInkLab(lab, contrast[pixel])) support += dx === 0 && dy === 0 ? 2 : 1;
    }
  }

  return support >= 3;
}

function chooseInkLockEntry(sourceLab, contrast, style) {
  if ((style?.graphicScore ?? 0) < 0.28) return null;
  if (!isSourceInkLab(sourceLab, contrast)) return null;
  return bestInkEntryForLab(sourceLab);
}

function getEntryAt(entries, width, height, x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  return entries[y * width + x];
}

function hasLineSupport(entries, width, height, x, y, entry) {
  const oppositeDirections = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  for (const [dx, dy] of oppositeDirections) {
    const first = getEntryAt(entries, width, height, x + dx, y + dy);
    const second = getEntryAt(entries, width, height, x - dx, y - dy);
    if (first && second && areRelatedEntries(first, entry) && areRelatedEntries(second, entry)) {
      return true;
    }
  }

  let relatedNeighbors = 0;
  let detailNeighbors = 0;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const neighbor = getEntryAt(entries, width, height, x + dx, y + dy);
      if (!neighbor) continue;
      if (areRelatedEntries(neighbor, entry)) relatedNeighbors += 1;
      if (isDetailEntry(neighbor) && areRelatedEntries(neighbor, entry, 0.16)) detailNeighbors += 1;
    }
  }

  return relatedNeighbors >= 2 || (relatedNeighbors >= 1 && detailNeighbors >= 2);
}

function isProtectedDetail(entries, width, height, x, y, contrast, entry = null) {
  const pixel = y * width + x;
  const own = entry ?? entries[pixel];
  return (
    isDetailEntry(own) &&
    contrast[pixel] > 0.035 &&
    hasLineSupport(entries, width, height, x, y, own)
  );
}

function smoothPaletteIndices(entries, width, height, base, contrast, style) {
  let current = entries;
  const graphicScore = style?.graphicScore ?? 0;
  const passes = graphicScore > 0.55 ? 4 : 3;
  const winnerThreshold = 3.05 - graphicScore * 0.12;
  const distanceSlack = 0.062 + graphicScore * 0.035;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.slice();

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const own = current[pixel];
        if (isProtectedDetail(current, width, height, x, y, contrast, own)) continue;

        const counts = new Map();

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

            const neighbor = current[ny * width + nx];
            const key = colorKey(neighbor);
            const weight = dx === 0 && dy === 0 ? 1.08 : dx === 0 || dy === 0 ? 1 : 0.6;
            const item = counts.get(key) ?? { entry: neighbor, weight: 0 };
            item.weight += weight;
            counts.set(key, item);
          }
        }

        let winner = { entry: own, weight: 0 };
        for (const item of counts.values()) {
          if (item.weight > winner.weight) winner = item;
        }

        if (winner.entry !== own && winner.weight >= winnerThreshold) {
          const sourceLab = labFromArray(base, pixel * 3);
          const ownDistance = labDistance(sourceLab, own.lab);
          const winnerDistance = labDistance(sourceLab, winner.entry.lab);
          const erasesDetailLine =
            isDetailEntry(own) &&
            !areRelatedEntries(own, winner.entry) &&
            hasLineSupport(current, width, height, x, y, own);
          const inventsDetailDot =
            !isDetailEntry(own) &&
            isDetailEntry(winner.entry) &&
            !hasLineSupport(current, width, height, x, y, winner.entry);
          const breaksHueFamily = rejectsSourceHueFamily(sourceLab, winner.entry, own);

          if (!erasesDetailLine && !inventsDetailDot && !breaksHueFamily && winnerDistance < ownDistance + distanceSlack) {
            next[pixel] = winner.entry;
          }
        }
      }
    }

    current = next;
  }

  return current;
}

function bestLineGapCandidate(entries, width, height, x, y) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  let best = null;
  let bestScore = 0;

  for (const [dx, dy] of directions) {
    const first = getEntryAt(entries, width, height, x + dx, y + dy);
    const second = getEntryAt(entries, width, height, x - dx, y - dy);
    if (!first || !second) continue;
    if (!areRelatedEntries(first, second, 0.12)) continue;

    const candidate = first.chroma + (1 - first.lab.L) > second.chroma + (1 - second.lab.L) ? first : second;
    if (!isDetailEntry(candidate)) continue;

    const score =
      1 +
      Number(isDarkEntry(candidate)) * 0.35 +
      Number(first === second) * 0.25 +
      Math.min(candidate.chroma * 1.2, 0.25);

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function repairLineGaps(entries, width, height, base, contrast, style) {
  const next = entries.slice();
  const graphicScore = style?.graphicScore ?? 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const own = entries[pixel];
      const candidate = bestLineGapCandidate(entries, width, height, x, y);

      if (!candidate || areRelatedEntries(candidate, own, 0.1)) continue;
      if (contrast[pixel] < (isDarkEntry(candidate) ? 0.036 : 0.052)) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      const ownDistance = labDistance(sourceLab, own.lab);
      const candidateDistance = labDistance(sourceLab, candidate.lab);
      const slack = (isDarkEntry(candidate) ? 0.13 : 0.075) + graphicScore * 0.035;

      if (candidateDistance < ownDistance + slack) {
        next[pixel] = candidate;
      }
    }
  }

  return next;
}

function contourNeighborStats(entries, width, height, x, y) {
  const offsets = [
    [0, -1, 1.1],
    [-1, 0, 1.1],
    [1, 0, 1.1],
    [0, 1, 1.1],
    [-1, -1, 0.68],
    [1, -1, 0.68],
    [-1, 1, 0.68],
    [1, 1, 0.68],
  ];
  const stats = {
    bright: 0,
    dark: 0,
    ink: 0,
    nonDark: 0,
  };

  for (const [dx, dy, weight] of offsets) {
    const neighbor = getEntryAt(entries, width, height, x + dx, y + dy);
    if (!neighbor) continue;

    if (isInkEntry(neighbor)) stats.ink += weight;
    if (isDarkEntry(neighbor)) {
      stats.dark += weight;
    } else {
      stats.nonDark += weight;
    }
    if (isBrightEntry(neighbor)) stats.bright += weight;
  }

  return stats;
}

function contourBridgeScore(entries, width, height, x, y) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  let best = 0;

  for (const [dx, dy] of directions) {
    const first = getEntryAt(entries, width, height, x + dx, y + dy);
    const second = getEntryAt(entries, width, height, x - dx, y - dy);
    if (!first || !second) continue;
    if (!isDarkEntry(first) || !isDarkEntry(second)) continue;

    const score =
      1 +
      Number(isInkEntry(first)) * 0.42 +
      Number(isInkEntry(second)) * 0.42 +
      Number(areRelatedEntries(first, second, 0.11)) * 0.24;

    best = Math.max(best, score);
  }

  return best;
}

function sourceContourSignal(sourceLab, contrastValue, alphaValue) {
  if (alphaValue <= 0.08) return 0;

  const chroma = labChroma(sourceLab);
  const darkSignal = 1 - smoothstep(0.3, 0.58, sourceLab.L);
  const edgeSignal = smoothstep(0.036, 0.15, contrastValue);
  const neutralSignal = 1 - smoothstep(0.09, 0.24, chroma);
  const alphaEdgeSignal =
    smoothstep(0.12, 0.78, alphaValue) *
    (1 - smoothstep(0.78, 0.98, alphaValue));

  return clamp01(
    darkSignal * 0.68 +
      darkSignal * edgeSignal * 0.34 +
      neutralSignal * edgeSignal * 0.46 +
      alphaEdgeSignal * Math.max(darkSignal, neutralSignal * edgeSignal) * 0.28,
  );
}

function reinforceArtContours(entries, width, height, alpha, base, contrast, style) {
  const graphicScore = style?.graphicScore ?? 0;
  if (graphicScore < 0.22) return entries;

  const next = entries.slice();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const alphaValue = alpha[pixel];
      if (alphaValue <= 0.08) continue;

      const current = entries[pixel];
      if (isInkEntry(current)) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      const signal = sourceContourSignal(sourceLab, contrast[pixel], alphaValue);
      const stats = contourNeighborStats(entries, width, height, x, y);
      const bridge = contourBridgeScore(entries, width, height, x, y);
      const contourNeighbors = stats.ink + stats.dark * 0.45;
      const neutralAlias =
        isNeutralEntry(current) &&
        !isBrightEntry(current) &&
        contourNeighbors > 0.85 &&
        stats.nonDark > 0.35;
      const alphaAlias =
        alphaValue < 0.96 &&
        contourNeighbors > 0.68 &&
        sourceLab.L < 0.6 &&
        labChroma(sourceLab) < 0.26;
      const brokenBridge = bridge >= 1.24 && contourNeighbors > 1.35;
      const darkColoredEdge =
        current.lab.L < 0.5 &&
        sourceLab.L < 0.46 &&
        contrast[pixel] > 0.045 &&
        contourNeighbors > 1.2;

      if (isBrightEntry(current) && sourceLab.L > 0.64 && !brokenBridge) continue;
      if (current.chroma > 0.12 && sourceLab.L > 0.46 && !brokenBridge && !alphaAlias) continue;
      if (!neutralAlias && !alphaAlias && !brokenBridge && !darkColoredEdge && signal < 0.48) continue;
      if (contourNeighbors < 0.62 && !brokenBridge) continue;

      const inkEntry = bestInkEntryForLab(sourceLab);
      const currentDistance = labDistance(sourceLab, current.lab);
      const inkDistance = labDistance(sourceLab, inkEntry.lab);
      const slack =
        0.07 +
        signal * 0.16 +
        bridge * 0.045 +
        Number(neutralAlias) * 0.075 +
        Number(alphaAlias) * 0.095 +
        graphicScore * 0.026;

      if (inkDistance <= currentDistance + slack || brokenBridge || alphaAlias) {
        next[pixel] = inkEntry;
      }
    }
  }

  return next;
}

function areEdgeToneCompatible(currentEntry, candidateEntry) {
  if (candidateEntry === currentEntry) return false;
  if (isNeutralEntry(currentEntry)) return isNeutralEntry(candidateEntry);
  if (isNeutralEntry(candidateEntry)) return false;
  return isSameHueFamily(currentEntry, candidateEntry);
}

function edgePatternThreshold(x, y, direction) {
  const shift = direction === "light" ? 3 : 0;
  const px = (x * 3 + shift) & 7;
  const py = (y * 5 + shift * 2) & 7;
  return (BAYER_8[py * 8 + px] + 0.5) / 64;
}

function surfacePatternThreshold(x, y, direction) {
  const shift = direction === "light" ? 5 : 1;
  const px = (x + y * 2 + shift) & 7;
  const py = (y * 3 + x + shift * 3) & 7;
  return (BAYER_8[py * 8 + px] + 0.5) / 64;
}

function edgeBoundaryStats(entries, width, height, x, y, currentEntry) {
  const offsets = [
    [0, -1, 1.18],
    [-1, 0, 1.18],
    [1, 0, 1.18],
    [0, 1, 1.18],
    [-1, -1, 0.72],
    [1, -1, 0.72],
    [-1, 1, 0.72],
    [1, 1, 0.72],
  ];
  const stats = {
    boundary: 0,
    dark: 0,
    light: 0,
  };

  for (const [dx, dy, weight] of offsets) {
    const neighbor = getEntryAt(entries, width, height, x + dx, y + dy);
    if (!neighbor) continue;

    const distance = entryDistance(currentEntry, neighbor);
    if (distance < 0.045) continue;

    const strength = weight * smoothstep(0.045, 0.18, distance);
    const lightnessDelta = neighbor.lab.L - currentEntry.lab.L;
    stats.boundary += strength;

    if (isInkEntry(neighbor) || lightnessDelta < -0.075) {
      stats.dark += strength;
    }

    if (isBrightEntry(neighbor) || lightnessDelta > 0.075) {
      stats.light += strength;
    }
  }

  return stats;
}

function chooseEdgeToneEntry(currentEntry, sourceLab, direction) {
  if (isInkEntry(currentEntry)) return null;

  const targetShift = direction === "light" ? 0.105 : 0.115;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const entry of state.paletteLab) {
    if (!areEdgeToneCompatible(currentEntry, entry)) continue;

    const lightnessShift = entry.lab.L - currentEntry.lab.L;
    if (direction === "light") {
      if (lightnessShift < 0.024) continue;
      if (isBrightEntry(entry) && currentEntry.lab.L > 0.82) continue;
    } else {
      if (lightnessShift > -0.024) continue;
      if (isInkEntry(entry) && !isDarkEntry(currentEntry)) continue;
    }

    if (Math.abs(lightnessShift) > 0.36) continue;
    if (rejectsSourceHueFamily(sourceLab, entry, currentEntry)) continue;

    const sourceFit = labDistance(sourceLab, entry.lab);
    const currentFit = labDistance(sourceLab, currentEntry.lab);
    const hueCost =
      isNeutralEntry(currentEntry) || isNeutralEntry(entry)
        ? 0
        : hueDistance(currentEntry.hue, entry.hue) * 0.16;
    const chromaCost = Math.abs(entry.chroma - currentEntry.chroma) * 0.28;
    const shiftCost = Math.abs(Math.abs(lightnessShift) - targetShift) * 0.74;
    const worseFitCost = Math.max(0, sourceFit - currentFit) * 0.42;
    const score = shiftCost + hueCost + chromaCost + worseFitCost;

    if (score < bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  return best;
}

function surfaceToneAmount(sourceLab, currentEntry, candidateEntry) {
  const line = weightedLabVector(currentEntry.lab, candidateEntry.lab);
  const point = weightedLabVector(currentEntry.lab, sourceLab);
  const denom = dotLab(line, line);
  if (denom < 0.00001) return 0;
  return clamp01(dotLab(point, line) / denom);
}

function surfaceSupport(entries, width, height, x, y, alpha, currentEntry) {
  let support = 0;
  let transparentRisk = 0;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;

      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        transparentRisk += 1;
        continue;
      }

      const neighborPixel = ny * width + nx;
      if (alpha[neighborPixel] < 0.86) {
        transparentRisk += 1;
        continue;
      }

      const neighbor = entries[neighborPixel];
      if (areRelatedEntries(currentEntry, neighbor, isNeutralEntry(currentEntry) ? 0.18 : 0.14)) {
        support += dx === 0 || dy === 0 ? 1.1 : 0.72;
      }
    }
  }

  return { support, transparentRisk };
}

function chooseSurfaceToneEntry(currentEntry, sourceLab, direction) {
  if (isInkEntry(currentEntry) || isBrightEntry(currentEntry)) return null;

  const targetShift = direction === "light" ? 0.09 : 0.095;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const entry of state.paletteLab) {
    if (!areEdgeToneCompatible(currentEntry, entry)) continue;
    if (isInkEntry(entry) && !isDarkEntry(currentEntry)) continue;

    const lightnessShift = entry.lab.L - currentEntry.lab.L;
    if (direction === "light" && lightnessShift < 0.018) continue;
    if (direction === "dark" && lightnessShift > -0.018) continue;
    if (Math.abs(lightnessShift) > 0.28) continue;
    if (rejectsSourceHueFamily(sourceLab, entry, currentEntry)) continue;

    const amount = surfaceToneAmount(sourceLab, currentEntry, entry);
    if (amount < 0.035 || amount > 0.86) continue;

    const sourceFit = labDistance(sourceLab, entry.lab);
    const currentFit = labDistance(sourceLab, currentEntry.lab);
    const hueCost =
      isNeutralEntry(currentEntry) || isNeutralEntry(entry)
        ? 0
        : hueDistance(currentEntry.hue, entry.hue) * 0.13;
    const chromaCost = Math.abs(entry.chroma - currentEntry.chroma) * 0.2;
    const shiftCost = Math.abs(Math.abs(lightnessShift) - targetShift) * 0.58;
    const score = shiftCost + hueCost + chromaCost + Math.max(0, sourceFit - currentFit) * 0.22;

    if (score < bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  return best;
}

function applySurfaceDitherEffects(entries, width, height, alpha, base, contrast, style, options = {}) {
  const next = entries.slice();
  const graphicScore = style?.graphicScore ?? 0;
  const intensity = options.intensity ?? 1;
  const textureScale = (0.72 + graphicScore * 0.36) * intensity;
  const minAlpha = options.minAlpha ?? 0.92;
  const minSupport = options.minSupport ?? 3.45;
  const maxAmount = options.maxAmount ?? 0.58;
  const minTexture = options.minTexture ?? 0.04;
  const minError = options.minError ?? 0.08;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (alpha[pixel] < minAlpha) continue;

      const currentEntry = entries[pixel];
      if (isInkEntry(currentEntry) || isBrightEntry(currentEntry)) continue;

      const { support, transparentRisk } = surfaceSupport(entries, width, height, x, y, alpha, currentEntry);
      if (transparentRisk > 0 || support < minSupport) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      const toneDelta = sourceLab.L - currentEntry.lab.L;
      const colorError = labDistance(sourceLab, currentEntry.lab);
      const localTexture = smoothstep(0.018, 0.095, contrast[pixel]);
      const errorNeed = smoothstep(0.032, 0.14, colorError);
      if (localTexture < minTexture && errorNeed < minError) continue;

      const direction = toneDelta >= 0 ? "light" : "dark";
      const candidate = chooseSurfaceToneEntry(currentEntry, sourceLab, direction);
      if (!candidate) continue;

      const candidateDistance = labDistance(sourceLab, candidate.lab);
      const currentDistance = labDistance(sourceLab, currentEntry.lab);
      const amountFromTone = surfaceToneAmount(sourceLab, currentEntry, candidate);
      const amount = Math.min(
        maxAmount,
        Math.max(0.07, amountFromTone * 0.86) *
          (0.72 + localTexture * 0.34 + errorNeed * 0.24) *
          textureScale,
      );
      const allowedDrift = 0.055 + localTexture * 0.09 + errorNeed * 0.075 + graphicScore * 0.025;

      if (candidateDistance > currentDistance + allowedDrift && amount < 0.18) continue;
      if (surfacePatternThreshold(x, y, direction) > amount) continue;

      next[pixel] = candidate;
    }
  }

  return next;
}

function applyEdgeDitherEffects(entries, width, height, base, contrast, style) {
  const next = entries.slice();
  const graphicScore = style?.graphicScore ?? 0;
  const minContrast = Math.max(0.028, 0.042 - graphicScore * 0.01);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const currentEntry = entries[pixel];

      if (isInkEntry(currentEntry)) continue;
      if (isNeutralEntry(currentEntry)) continue;
      if (isDarkEntry(currentEntry) && hasLineSupport(entries, width, height, x, y, currentEntry)) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      const currentDistance = labDistance(sourceLab, currentEntry.lab);
      if (contrast[pixel] < minContrast && currentDistance < 0.048) continue;

      const stats = edgeBoundaryStats(entries, width, height, x, y, currentEntry);
      if (stats.boundary < 0.88) continue;

      const toneDelta = sourceLab.L - currentEntry.lab.L;
      let direction = toneDelta > 0.032 ? "light" : toneDelta < -0.026 ? "dark" : null;

      if (!direction) {
        if (stats.dark > Math.max(0.82, stats.light * 1.05)) {
          direction = "dark";
        } else if (stats.light > 0.82) {
          direction = currentEntry.lab.L > 0.68 ? "dark" : "light";
        } else {
          continue;
        }
      }

      const candidate = chooseEdgeToneEntry(currentEntry, sourceLab, direction);
      if (!candidate) continue;

      const candidateDistance = labDistance(sourceLab, candidate.lab);
      const boundaryNeed = smoothstep(0.58, 2.25, stats.boundary) * smoothstep(minContrast, 0.14, contrast[pixel]);
      const toneNeed = smoothstep(0.014, 0.086, Math.abs(toneDelta));
      const neighborNeed = Math.max(smoothstep(0.34, 1.45, stats.dark), smoothstep(0.34, 1.45, stats.light));
      const allowedDrift = 0.052 + boundaryNeed * 0.082 + toneNeed * 0.092 + graphicScore * 0.034;

      if (candidateDistance > currentDistance + allowedDrift) continue;

      const amount = Math.min(
        0.48,
        0.08 + boundaryNeed * (0.23 + graphicScore * 0.12) + toneNeed * 0.14 + neighborNeed * 0.08,
      );

      if (edgePatternThreshold(x, y, direction) > amount) continue;

      next[pixel] = candidate;
    }
  }

  return next;
}

function surfaceTextureOptionsForMode(profile, style) {
  const graphicScore = style?.graphicScore ?? 0;

  if (profile.mode === "auto") {
    return {
      intensity: graphicScore > 0.32 ? 0.56 : 0.36,
      maxAmount: graphicScore > 0.32 ? 0.38 : 0.3,
      minError: 0.1,
      minSupport: 3.9,
      minTexture: 0.055,
    };
  }

  if (profile.mode === "light") {
    return {
      intensity: 0.54,
      maxAmount: 0.42,
      minError: 0.09,
      minSupport: 3.7,
      minTexture: 0.048,
    };
  }

  if (profile.mode === "floyd") {
    return {
      intensity: 0.22,
      maxAmount: 0.26,
      minError: 0.12,
      minSupport: 4.05,
      minTexture: 0.064,
    };
  }

  return null;
}

function isUsefulDitherTone(sourceLab, baseEntry, ditherEntry) {
  if (baseEntry === ditherEntry) return true;
  if (!areEdgeToneCompatible(baseEntry, ditherEntry)) return false;

  const amount = surfaceToneAmount(sourceLab, baseEntry, ditherEntry);
  if (amount < 0.055 || amount > 0.82) return false;

  const mixed = mixLab(baseEntry.lab, ditherEntry.lab, amount);
  const mixedDistance = labDistance(mixed, sourceLab);
  const baseDistance = labDistance(baseEntry.lab, sourceLab);
  const ditherDistance = labDistance(ditherEntry.lab, sourceLab);

  return mixedDistance <= Math.min(baseDistance, ditherDistance) + 0.028;
}

function polishDitherArtifacts(entries, width, height, alpha, base, contrast, style, profile) {
  const next = entries.slice();
  const graphicScore = style?.graphicScore ?? 0;
  const mode = profile?.mode ?? "auto";
  const cleanupStrength =
    mode === "floyd" ? 0.62 :
      mode === "light" ? 0.52 :
        mode === "auto" ? 0.5 :
          mode === "edge" ? 0.36 : 0.72;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (alpha[pixel] < 0.84) continue;

      const own = entries[pixel];
      if (isInkEntry(own) || isBrightEntry(own)) continue;
      if (isProtectedDetail(entries, width, height, x, y, contrast, own)) continue;

      const { own: ownCount, total, winner } = weightedNeighborhoodWinner(entries, width, height, x, y, 1);
      if (!winner || winner.entry === own || total <= 0) continue;

      const dominance = winner.weight / total;
      const margin = winner.weight - ownCount.weight;
      if (dominance < 0.38 + (1 - cleanupStrength) * 0.06) continue;
      if (margin < 1.58 + (1 - cleanupStrength) * 0.72) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      if (sourceContourSignal(sourceLab, contrast[pixel], alpha[pixel]) > 0.55 && isDarkEntry(own)) continue;
      if (rejectsSourceHueFamily(sourceLab, winner.entry, own)) continue;

      const usefulTone = isUsefulDitherTone(sourceLab, winner.entry, own);
      const ownDistance = labDistance(sourceLab, own.lab);
      const winnerDistance = labDistance(sourceLab, winner.entry.lab);
      const orphanHue =
        own.chroma > 0.045 &&
        winner.entry.chroma > 0.045 &&
        !isSameHueFamily(own, winner.entry);
      const dirtyNeutral =
        isNeutralEntry(own) &&
        !isBrightEntry(own) &&
        winner.entry.chroma > own.chroma + 0.055;
      const weakSourceSupport = ownDistance > winnerDistance + 0.035 + cleanupStrength * 0.035;

      if (usefulTone && !dirtyNeutral && !orphanHue && !weakSourceSupport) continue;

      const slack =
        0.036 +
        cleanupStrength * 0.07 +
        graphicScore * 0.04 +
        Number(dirtyNeutral) * 0.06 +
        Number(orphanHue) * 0.08;

      if (winnerDistance <= ownDistance + slack || dirtyNeutral || orphanHue) {
        next[pixel] = winner.entry;
      }
    }
  }

  return next;
}

function reassertTransparentFill(entries, alpha, fillEntry) {
  const next = entries.slice();

  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    if (alpha[pixel] <= 0.08) {
      next[pixel] = fillEntry;
    }
  }

  return next;
}

function cleanAlphaEdgeHalos(entries, width, height, alpha, base, contrast, style) {
  const next = entries.slice();
  const graphicScore = style?.graphicScore ?? 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const pixelAlpha = alpha[pixel];
      if (pixelAlpha <= 0.08 || pixelAlpha >= 0.94) continue;

      const current = entries[pixel];
      if (!isNeutralEntry(current) || isBrightEntry(current) || isInkEntry(current)) continue;

      const counts = new Map();
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;

          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const neighborPixel = ny * width + nx;
          if (alpha[neighborPixel] <= 0.08) continue;

          const neighbor = entries[neighborPixel];
          if (neighbor === current || isBrightEntry(neighbor)) continue;
          if (isNeutralEntry(neighbor) && !isInkEntry(neighbor)) continue;

          const key = colorKey(neighbor);
          const item = counts.get(key) ?? { entry: neighbor, weight: 0 };
          item.weight += dx === 0 || dy === 0 ? 1 : 0.58;
          counts.set(key, item);
        }
      }

      let winner = null;
      for (const item of counts.values()) {
        if (!winner || item.weight > winner.weight) winner = item;
      }

      if (!winner || winner.weight < 1.15) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      const currentDistance = labDistance(sourceLab, current.lab);
      const candidateDistance = labDistance(sourceLab, winner.entry.lab);
      const slack = 0.14 + graphicScore * 0.05 + smoothstep(0.08, 0.72, pixelAlpha) * 0.05;

      if (candidateDistance <= currentDistance + slack || isInkEntry(winner.entry)) {
        next[pixel] = winner.entry;
      }
    }
  }

  return next;
}

function strongestNeighborEntry(entries, width, height, component, componentMask) {
  const counts = new Map();
  let total = 0;

  for (const pixel of component) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const neighborPixel = ny * width + nx;
        if (componentMask.has(neighborPixel)) continue;

        const neighbor = entries[neighborPixel];
        const key = colorKey(neighbor);
        const weight = dx === 0 || dy === 0 ? 1 : 0.58;
        const item = counts.get(key) ?? { entry: neighbor, weight: 0 };
        item.weight += weight;
        counts.set(key, item);
        total += weight;
      }
    }
  }

  let winner = null;
  for (const item of counts.values()) {
    if (!winner || item.weight > winner.weight) winner = item;
  }

  return winner ? { ...winner, total } : null;
}

function cleanupTinyRegions(entries, width, height, base, contrast, style) {
  const visited = new Uint8Array(width * height);
  const next = entries.slice();
  const graphicScore = style?.graphicScore ?? 0;
  const sizeScale = style?.sizeScale ?? 1;
  const tinyLimit = Math.round((2 + graphicScore * 4) * sizeScale);
  const neighbors = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  for (let start = 0; start < entries.length; start += 1) {
    if (visited[start]) continue;

    const entry = entries[start];
    const stack = [start];
    const component = [];
    visited[start] = 1;

    while (stack.length > 0) {
      const pixel = stack.pop();
      component.push(pixel);

      const x = pixel % width;
      const y = Math.floor(pixel / width);

      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const neighborPixel = ny * width + nx;
        if (visited[neighborPixel] || entries[neighborPixel] !== entry) continue;

        visited[neighborPixel] = 1;
        stack.push(neighborPixel);
      }
    }

    if (component.length > tinyLimit) continue;

    let protectedPixels = 0;
    for (const pixel of component) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (isProtectedDetail(entries, width, height, x, y, contrast, entry)) protectedPixels += 1;
    }

    if (protectedPixels > 0) continue;

    const componentMask = new Set(component);
    const winner = strongestNeighborEntry(entries, width, height, component, componentMask);
    if (!winner || winner.entry === entry) continue;
    if (winner.weight < component.length + 1.8) continue;

    let ownTotal = 0;
    let winnerTotal = 0;

    for (const pixel of component) {
      const sourceLab = labFromArray(base, pixel * 3);
      ownTotal += labDistance(sourceLab, entry.lab);
      winnerTotal += labDistance(sourceLab, winner.entry.lab);
    }

    const slack = component.length * (0.052 + graphicScore * 0.038);
    if (winnerTotal <= ownTotal + slack) {
      for (const pixel of component) {
        next[pixel] = winner.entry;
      }
    }
  }

  return next;
}

function componentStats(component, width) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const pixel of component) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;

  return {
    boxHeight,
    boxWidth,
    density: component.length / Math.max(1, boxWidth * boxHeight),
    longSide: Math.max(boxWidth, boxHeight),
    shortSide: Math.min(boxWidth, boxHeight),
  };
}

function isFieldEntry(entry) {
  return !isDarkEntry(entry) && (entry.chroma > 0.075 || entry.lab.L > 0.82);
}

function isGoldEntry(entry) {
  return entry.chroma > 0.055 && goldHueWeight(entry.hue) > 0.34;
}

function isGreenEntry(entry) {
  return entry.chroma > 0.055 && greenHueWeight(entry.hue) > 0.36;
}

function shouldRemoveEmbeddedComponent(entry, winnerEntry, component, stats, protectedRatio, graphicScore, sizeScale = 1) {
  if (!winnerEntry || winnerEntry === entry || !isFieldEntry(winnerEntry)) return false;

  const surroundedByColor = winnerEntry.chroma > 0.08 && winnerEntry.lab.L > 0.38;
  const smallDarkLimit = Math.round((10 + graphicScore * 34) * sizeScale);
  const smallAccentLimit = Math.round((6 + graphicScore * 18) * sizeScale);
  const embeddedScratchLimit = Math.round((18 + graphicScore * 62) * sizeScale);
  const scratchShape = stats.shortSide <= 3 || stats.density < 0.55;
  const notLongContour = protectedRatio < 0.42 || stats.longSide <= Math.round(5 + graphicScore * 5) || component.length <= 7;
  const darkScratch =
    isDarkEntry(entry) &&
    surroundedByColor &&
    component.length <= smallDarkLimit &&
    scratchShape &&
    notLongContour;
  const embeddedScratch =
    isDarkEntry(entry) &&
    surroundedByColor &&
    component.length <= embeddedScratchLimit &&
    stats.shortSide <= 3 &&
    stats.longSide <= Math.round((12 + graphicScore * 34) * Math.sqrt(sizeScale)) &&
    protectedRatio < 0.78;
  const grayDirt =
    isNeutralEntry(entry) &&
    surroundedByColor &&
    component.length <= smallDarkLimit &&
    winnerEntry.chroma > entry.chroma + 0.06;
  const accentDirt =
    !isDarkEntry(entry) &&
    !isNeutralEntry(entry) &&
    surroundedByColor &&
    component.length <= smallAccentLimit &&
    areRelatedEntries(entry, winnerEntry, 0.22) &&
    protectedRatio < 0.28;

  return darkScratch || embeddedScratch || grayDirt || accentDirt;
}

function removeEmbeddedDirt(entries, width, height, base, contrast, style) {
  const graphicScore = style?.graphicScore ?? 0;
  if (graphicScore < 0.38) return entries;

  const visited = new Uint8Array(width * height);
  const next = entries.slice();
  const sizeScale = style?.sizeScale ?? 1;
  const neighbors = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  for (let start = 0; start < entries.length; start += 1) {
    if (visited[start]) continue;

    const entry = entries[start];
    const stack = [start];
    const component = [];
    visited[start] = 1;

    while (stack.length > 0) {
      const pixel = stack.pop();
      component.push(pixel);

      const x = pixel % width;
      const y = Math.floor(pixel / width);

      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const neighborPixel = ny * width + nx;
        if (visited[neighborPixel] || entries[neighborPixel] !== entry) continue;

        visited[neighborPixel] = 1;
        stack.push(neighborPixel);
      }
    }

    const stats = componentStats(component, width);
    if (component.length > Math.round((22 + graphicScore * 70) * sizeScale)) continue;

    let protectedPixels = 0;
    for (const pixel of component) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (isProtectedDetail(entries, width, height, x, y, contrast, entry)) protectedPixels += 1;
    }

    const componentMask = new Set(component);
    const winner = strongestNeighborEntry(entries, width, height, component, componentMask);
    if (!winner || winner.entry === entry || winner.total <= 0) continue;

    const protectedRatio = protectedPixels / Math.max(1, component.length);
    const dominance = winner.weight / winner.total;
    const requiredDominance = isDarkEntry(entry) ? 0.36 + (1 - graphicScore) * 0.06 : 0.43 + (1 - graphicScore) * 0.08;
    if (dominance < requiredDominance) continue;
    if (!shouldRemoveEmbeddedComponent(entry, winner.entry, component, stats, protectedRatio, graphicScore, sizeScale)) {
      continue;
    }

    let sourceAllowsField = 0;
    for (const pixel of component) {
      const sourceLab = labFromArray(base, pixel * 3);
      const entryDistanceValue = labDistance(sourceLab, entry.lab);
      const winnerDistanceValue = labDistance(sourceLab, winner.entry.lab);
      if (winnerDistanceValue <= entryDistanceValue + 0.12 + graphicScore * 0.08) sourceAllowsField += 1;
    }

    const sourceThreshold = isDarkEntry(entry) ? 0.04 : 0.34;
    if (sourceAllowsField / component.length < sourceThreshold) continue;

    for (const pixel of component) {
      next[pixel] = winner.entry;
    }
  }

  return next;
}

function weightedNeighborhoodWinner(entries, width, height, x, y, radius) {
  const counts = new Map();
  let total = 0;

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const entry = entries[ny * width + nx];
      const distance = Math.hypot(dx, dy);
      const weight = dx === 0 && dy === 0 ? 1.1 : 1 / (1 + distance * 0.72);
      const key = colorKey(entry);
      const item = counts.get(key) ?? { entry, weight: 0 };
      item.weight += weight;
      counts.set(key, item);
      total += weight;
    }
  }

  let winner = null;
  let own = null;
  const ownEntry = entries[y * width + x];
  const ownKey = colorKey(ownEntry);

  for (const [key, item] of counts) {
    if (key === ownKey) own = item;
    if (!winner || item.weight > winner.weight) winner = item;
  }

  return { own: own ?? { entry: ownEntry, weight: 0 }, total, winner };
}

function cleanFlatGraphicAreas(entries, width, height, base, contrast, style) {
  const graphicScore = style?.graphicScore ?? 0;
  if (graphicScore < 0.34) return entries;

  const next = entries.slice();
  const radius = (style?.sizeScale ?? 1) > 1.55 && graphicScore > 0.5 ? 2 : graphicScore > 0.62 ? 2 : 1;
  const dominanceThreshold = 0.43 + (1 - graphicScore) * 0.08;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const own = entries[pixel];
      const protectedDetail = isProtectedDetail(entries, width, height, x, y, contrast, own);
      if (protectedDetail) continue;

      const { own: ownCount, total, winner } = weightedNeighborhoodWinner(entries, width, height, x, y, radius);
      if (!winner || winner.entry === own) continue;
      if (winner.weight / total < dominanceThreshold) continue;
      if (winner.weight - ownCount.weight < 1.45 + (1 - graphicScore) * 0.9) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      const ownDistance = labDistance(sourceLab, own.lab);
      const winnerDistance = labDistance(sourceLab, winner.entry.lab);
      const orphanDetail = isDetailEntry(own) && !hasLineSupport(entries, width, height, x, y, own);
      const flatArea = contrast[pixel] < 0.08 + graphicScore * 0.035;
      const removesDirtyNeutral =
        orphanDetail &&
        winner.entry.chroma > own.chroma + 0.035 &&
        labSignalWeight(sourceLab, contrast[pixel]) > 0.08;
      if (rejectsSourceHueFamily(sourceLab, winner.entry, own)) continue;

      const slack =
        (flatArea ? 0.06 : 0.025) +
        graphicScore * (orphanDetail ? 0.13 : 0.07) +
        Number(removesDirtyNeutral) * 0.08;

      if (winnerDistance <= ownDistance + slack) {
        next[pixel] = winner.entry;
      }
    }
  }

  return next;
}

function cleanGoldGreenSpill(entries, width, height, base, contrast, style) {
  const graphicScore = style?.graphicScore ?? 0;
  if (graphicScore < 0.28) return entries;

  const next = entries.slice();
  const radius = (style?.sizeScale ?? 1) > 1.35 ? 3 : 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const own = entries[pixel];
      if (!isGreenEntry(own)) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      const sourceHue = labHue(sourceLab);
      const sourceGold = goldHueWeight(sourceHue);
      const sourceGreen = greenHueWeight(sourceHue);
      if (sourceGold < 0.22 || sourceGreen > sourceGold + 0.08) continue;
      if (isProtectedDetail(entries, width, height, x, y, contrast, own)) continue;

      const { total, winner } = weightedNeighborhoodWinner(entries, width, height, x, y, radius);
      if (!winner || !isGoldEntry(winner.entry)) continue;
      if (winner.weight / total < 0.24 + (1 - graphicScore) * 0.08) continue;

      const ownDistance = labDistance(sourceLab, own.lab);
      const winnerDistance = labDistance(sourceLab, winner.entry.lab);
      if (winnerDistance <= ownDistance + 0.18 + graphicScore * 0.08) {
        next[pixel] = winner.entry;
      }
    }
  }

  return next;
}

function cleanNeutralPlateaus(entries, width, height, base, contrast, style) {
  const graphicScore = style?.graphicScore ?? 0;
  if (graphicScore < 0.42) return entries;

  const next = entries.slice();
  const radius = graphicScore > 0.66 ? 2 : 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const own = entries[pixel];
      if (!isNeutralEntry(own) || isDarkEntry(own)) continue;
      if (isProtectedDetail(entries, width, height, x, y, contrast, own)) continue;

      const { own: ownCount, total, winner } = weightedNeighborhoodWinner(entries, width, height, x, y, radius);
      if (!winner || winner.entry === own || !isNeutralEntry(winner.entry)) continue;
      if (winner.weight / total < 0.42) continue;
      if (winner.weight - ownCount.weight < 1.05) continue;
      if (Math.abs(winner.entry.lab.L - own.lab.L) > 0.24) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      const ownDistance = labDistance(sourceLab, own.lab);
      const winnerDistance = labDistance(sourceLab, winner.entry.lab);

      if (winnerDistance <= ownDistance + 0.055 + graphicScore * 0.055) {
        next[pixel] = winner.entry;
      }
    }
  }

  return next;
}

function isSameHueFamily(first, second) {
  if (isNeutralEntry(first) || isNeutralEntry(second)) return false;
  const firstFamily = hueFamilyForEntry(first);
  const secondFamily = hueFamilyForEntry(second);
  return areHueFamiliesCompatible(firstFamily, secondFamily);
}

function chooseToneLockEntry(sourceLab, currentEntry, contrast, style) {
  if ((style?.graphicScore ?? 0) < 0.34) return null;
  if (contrast > 0.072) return null;
  if (isSourceInkLab(sourceLab, contrast)) return null;

  const sourceChroma = labChroma(sourceLab);
  if (sourceChroma < 0.11) return null;

  const sourceHue = labHue(sourceLab);
  if (warmHueWeight(sourceHue) < 0.42 || goldHueWeight(sourceHue) > 0.18 || greenHueWeight(sourceHue) > 0.12) {
    return null;
  }
  if (warmHueWeight(currentEntry.hue) < 0.35 || goldHueWeight(currentEntry.hue) > 0.2 || greenHueWeight(currentEntry.hue) > 0.12) {
    return null;
  }

  const candidates = state.paletteLab.filter((entry) => {
    if (entry === currentEntry || entry.chroma < 0.045 || isNeutralEntry(entry)) return false;
    if (goldHueWeight(entry.hue) > 0.2 || greenHueWeight(entry.hue) > 0.12) return false;
    return hueDistance(sourceHue, entry.hue) < 0.46 || warmHueWeight(sourceHue) * warmHueWeight(entry.hue) > 0.42;
  });

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of candidates) {
    const distance = paletteDistanceForLab(sourceLab, entry, sourceLab, 5.2);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }

  if (!best || !isSameHueFamily(best, currentEntry)) return null;

  const currentDistance = paletteDistanceForLab(sourceLab, currentEntry, sourceLab, 5.2);
  const lightnessShift = Math.abs(best.lab.L - currentEntry.lab.L);
  if (lightnessShift < 0.04) return null;

  return bestDistance <= currentDistance + 0.01 + lightnessShift * 0.028 ? best : null;
}

function reassertInkLocks(entries, width, height, base, contrast, style) {
  const next = entries.slice();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const sourceLab = labFromArray(base, pixel * 3);
      const inkEntry = chooseInkLockEntry(sourceLab, contrast[pixel], style);
      if (!inkEntry || !hasSourceInkSupport(base, contrast, width, height, x, y)) continue;

      const current = entries[pixel];
      const currentDistance = labDistance(sourceLab, current.lab);
      const inkDistance = labDistance(sourceLab, inkEntry.lab);
      if (inkDistance <= currentDistance + 0.18) {
        next[pixel] = inkEntry;
      }
    }
  }

  return next;
}

function reassertToneLocks(entries, width, height, base, contrast, style) {
  const locks = new Array(entries.length).fill(null);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (hasSourceInkSupport(base, contrast, width, height, x, y)) continue;

      const sourceLab = labFromArray(base, pixel * 3);
      locks[pixel] = chooseToneLockEntry(sourceLab, entries[pixel], contrast[pixel], style);
    }
  }

  const visited = new Uint8Array(entries.length);
  const next = entries.slice();
  const minRegionSize = Math.round((10 + (style?.graphicScore ?? 0) * 18) * (style?.sizeScale ?? 1));
  const neighbors = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  for (let start = 0; start < entries.length; start += 1) {
    if (visited[start] || !locks[start]) continue;

    const lock = locks[start];
    const stack = [start];
    const component = [];
    let contrastTotal = 0;
    visited[start] = 1;

    while (stack.length > 0) {
      const pixel = stack.pop();
      component.push(pixel);
      contrastTotal += contrast[pixel];

      const x = pixel % width;
      const y = Math.floor(pixel / width);

      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const neighborPixel = ny * width + nx;
        if (visited[neighborPixel] || locks[neighborPixel] !== lock) continue;

        visited[neighborPixel] = 1;
        stack.push(neighborPixel);
      }
    }

    if (component.length < minRegionSize) continue;

    const stats = componentStats(component, width);
    if (stats.shortSide < 3 && component.length < minRegionSize * 1.8) continue;
    if (contrastTotal / component.length > 0.054 + (style?.graphicScore ?? 0) * 0.012) continue;

    for (const pixel of component) {
      next[pixel] = lock;
    }
  }

  return next;
}

function chooseSymmetricEntry(leftEntry, rightEntry, leftLab, rightLab, guardStrength) {
  const averageLab = mixLab(leftLab, rightLab, 0.5);
  const candidates = new Set([leftEntry, rightEntry]);
  candidates.add(bestPaletteMatchFromLab(averageLab, averageLab, guardStrength, Math.min(10, state.paletteLab.length)).entry);

  let best = leftEntry;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of candidates) {
    const distance = labDistance(leftLab, entry.lab) + labDistance(rightLab, entry.lab);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }

  return { distance: bestDistance, entry: best };
}

function enforceVerticalSymmetry(entries, width, height, base, contrast, style) {
  const strength = style?.symmetryStrength ?? 0;
  if (strength < 0.16) return entries;

  const next = entries.slice();
  const halfWidth = Math.floor(width / 2);
  const guardStrength = 4.6 + (style?.graphicScore ?? 0) * 1.4;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < halfWidth; x += 1) {
      const leftPixel = y * width + x;
      const rightPixel = y * width + (width - 1 - x);
      const leftEntry = entries[leftPixel];
      const rightEntry = entries[rightPixel];
      if (leftEntry === rightEntry) continue;

      const leftLab = labFromArray(base, leftPixel * 3);
      const rightLab = labFromArray(base, rightPixel * 3);
      const pairDistance = labDistance(leftLab, rightLab);
      const pairSimilarity = 1 - smoothstep(0.055, 0.23, pairDistance);
      const pairSignal = Math.max(
        labSignalWeight(leftLab, contrast[leftPixel]),
        labSignalWeight(rightLab, contrast[rightPixel]),
      );
      const localStrength = strength * pairSimilarity * smoothstep(0.045, 0.18, pairSignal);

      if (localStrength < 0.13) continue;

      const currentDistance =
        labDistance(leftLab, leftEntry.lab) + labDistance(rightLab, rightEntry.lab);
      const candidate = chooseSymmetricEntry(leftEntry, rightEntry, leftLab, rightLab, guardStrength);
      const detailRisk =
        Number(isDetailEntry(leftEntry) && !isDetailEntry(candidate.entry)) +
        Number(isDetailEntry(rightEntry) && !isDetailEntry(candidate.entry));
      const slack = 0.045 + localStrength * 0.16 - detailRisk * 0.035;

      if (candidate.distance <= currentDistance + slack) {
        next[leftPixel] = candidate.entry;
        next[rightPixel] = candidate.entry;
      }
    }
  }

  return next;
}

function renderPalette() {
  els.paletteGrid.innerHTML = "";

  state.palette.forEach((color) => {
    const swatch = document.createElement("span");
    const hex = rgbToHex(color);
    swatch.className = "swatch";
    swatch.style.backgroundColor = hex;
    swatch.title = hex;
    els.paletteGrid.append(swatch);
  });
}

function fitCanvasCss(canvas, width, height) {
  const maxWidth = 820;
  const maxHeight = 640;
  const maxScale = Math.min(10, maxWidth / width, maxHeight / height);
  const scale = maxScale >= 1 ? Math.max(1, Math.floor(maxScale)) : Math.max(0.1, maxScale);
  canvas.style.width = `${Math.max(1, Math.round(width * scale))}px`;
  canvas.style.height = `${Math.max(1, Math.round(height * scale))}px`;
}

function drawSourcePreview(bitmap) {
  const limit = 900;
  const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  els.sourceCanvas.width = width;
  els.sourceCanvas.height = height;
  sourceCtx.imageSmoothingEnabled = true;
  sourceCtx.imageSmoothingQuality = "high";
  sourceCtx.fillStyle = "#ffffff";
  sourceCtx.fillRect(0, 0, width, height);
  sourceCtx.drawImage(bitmap, 0, 0, width, height);
}

function makeDemoBitmap() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 430;
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#66e2ff");
  sky.addColorStop(0.48, "#ffd2dd");
  sky.addColorStop(1, "#fff78a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ff4bac";
  ctx.beginPath();
  ctx.arc(488, 102, 54, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#00611f";
  ctx.beginPath();
  ctx.moveTo(0, 330);
  ctx.lineTo(120, 192);
  ctx.lineTo(238, 330);
  ctx.fill();

  ctx.fillStyle = "#628d33";
  ctx.beginPath();
  ctx.moveTo(134, 330);
  ctx.lineTo(324, 142);
  ctx.lineTo(510, 330);
  ctx.fill();

  ctx.fillStyle = "#16ce00";
  ctx.beginPath();
  ctx.moveTo(318, 330);
  ctx.lineTo(498, 210);
  ctx.lineTo(640, 330);
  ctx.fill();

  ctx.fillStyle = "#68452d";
  ctx.fillRect(0, 330, canvas.width, 100);

  for (let i = 0; i < 80; i += 1) {
    const x = (i * 71) % canvas.width;
    const y = 338 + ((i * 37) % 76);
    const radius = 8 + ((i * 11) % 18);
    ctx.fillStyle = i % 3 === 0 ? "#f1e500" : i % 3 === 1 ? "#ff5058" : "#00c8da";
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  return createImageBitmap(canvas);
}

function getTargetSize(bitmap) {
  const width = clampInteger(state.targetWidth, 16, 512, 96);
  const ratio = bitmap.height / bitmap.width;
  const height = Math.max(1, Math.round(width * ratio));
  return { width, height };
}

function drawCanvasResampled(bitmap, width, height, imageSmoothingEnabled) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: true });
  ctx.imageSmoothingEnabled = imageSmoothingEnabled;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function averageSampledPixels(sample, sampleWidth, width, height, sampleScale) {
  const output = new ImageData(width, height);
  const samplesPerPixel = sampleScale * sampleScale;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let redLinear = 0;
      let greenLinear = 0;
      let blueLinear = 0;
      let alphaSum = 0;

      for (let sy = 0; sy < sampleScale; sy += 1) {
        const sampleY = y * sampleScale + sy;
        for (let sx = 0; sx < sampleScale; sx += 1) {
          const sampleX = x * sampleScale + sx;
          const sampleIndex = (sampleY * sampleWidth + sampleX) * 4;
          const alpha = sample[sampleIndex + 3] / 255;
          redLinear += srgbToLinear(sample[sampleIndex]) * alpha;
          greenLinear += srgbToLinear(sample[sampleIndex + 1]) * alpha;
          blueLinear += srgbToLinear(sample[sampleIndex + 2]) * alpha;
          alphaSum += alpha;
        }
      }

      const outIndex = (y * width + x) * 4;
      if (alphaSum > 0.0001) {
        output.data[outIndex] = linearToSrgbByte(redLinear / alphaSum);
        output.data[outIndex + 1] = linearToSrgbByte(greenLinear / alphaSum);
        output.data[outIndex + 2] = linearToSrgbByte(blueLinear / alphaSum);
      } else {
        output.data[outIndex] = 255;
        output.data[outIndex + 1] = 255;
        output.data[outIndex + 2] = 255;
      }
      output.data[outIndex + 3] = Math.round(clamp255((alphaSum / samplesPerPixel) * 255));
    }
  }

  return output;
}

function drawSupersampled(bitmap, width, height) {
  const pixelCount = width * height;
  const maxOversamplePixels = 2200000;
  const naturalScale = Math.max(1, Math.min(bitmap.width / width, bitmap.height / height));
  const budgetScale = Math.max(1, Math.floor(Math.sqrt(maxOversamplePixels / pixelCount)));
  const naturalSampleScale = naturalScale < 1.45 ? 1 : Math.max(2, Math.round(naturalScale));
  const sampleScale = Math.max(1, Math.min(8, naturalSampleScale, budgetScale));

  if (sampleScale <= 1) {
    return drawCanvasResampled(bitmap, width, height, true);
  }

  const sampleWidth = width * sampleScale;
  const sampleHeight = height * sampleScale;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true, alpha: true });
  sampleCtx.imageSmoothingEnabled = true;
  sampleCtx.imageSmoothingQuality = "high";
  sampleCtx.clearRect(0, 0, sampleWidth, sampleHeight);
  sampleCtx.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);

  const sample = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  return averageSampledPixels(sample, sampleWidth, width, height, sampleScale);
}

function drawSharpSampled(bitmap, width, height) {
  const pixelCount = width * height;
  const maxOversamplePixels = 1800000;
  const naturalScale = Math.max(1, Math.min(bitmap.width / width, bitmap.height / height));
  const budgetScale = Math.max(1, Math.floor(Math.sqrt(maxOversamplePixels / pixelCount)));
  const naturalSampleScale =
    naturalScale < 1.18 ? 1 : Math.max(2, Math.min(6, Math.round(Math.sqrt(naturalScale) * 2)));
  const sampleScale = Math.max(1, Math.min(6, naturalSampleScale, budgetScale));

  if (sampleScale <= 1) {
    return drawCanvasResampled(bitmap, width, height, false);
  }

  const sampleWidth = width * sampleScale;
  const sampleHeight = height * sampleScale;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true, alpha: true });
  sampleCtx.imageSmoothingEnabled = false;
  sampleCtx.clearRect(0, 0, sampleWidth, sampleHeight);
  sampleCtx.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);

  const sample = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  return averageSampledPixels(sample, sampleWidth, width, height, sampleScale);
}

function drawDownsampled(bitmap, width, height) {
  if (state.sampling === "crisp") {
    return drawSharpSampled(bitmap, width, height);
  }

  return drawSupersampled(bitmap, width, height);
}

function paletteMapImage(imageData) {
  const { width, height, data } = imageData;
  const output = new ImageData(width, height);
  const base = new Float32Array(width * height * 3);
  const sourceAlpha = new Float32Array(width * height);
  const used = new Set();
  const profile = ditherProfile();
  const transparentEntry = nearestPaletteEntryFromLab(rgbToOklab({ r: 255, g: 255, b: 255 }));

  for (let i = 0, p = 0, pixel = 0; i < data.length; i += 4, p += 3, pixel += 1) {
    sourceAlpha[pixel] = data[i + 3] / 255;
    const lab = rgbToOklab(paletteSourceRgb(data, i));
    base[p] = lab.L;
    base[p + 1] = lab.a;
    base[p + 2] = lab.b;
  }

  const rawContrast = computeLocalContrast(base, width, height);
  const style = analyzeSourceStyle(base, width, height, rawContrast, data);
  const shouldDeblock = state.sampling === "smooth" || style.graphicScore > 0.42;
  const deblocked = shouldDeblock ? deblockLabField(base, width, height, rawContrast, style) : base;
  const contrast = computeLocalContrast(deblocked, width, height);
  const simplified =
    state.sampling === "smooth" ? smoothLabField(deblocked, width, height, contrast, style) : deblocked;
  const chosen = new Array(width * height);
  const diffusionBuffer =
    profile.mode === "light" || profile.mode === "floyd" ? new Float32Array(simplified) : null;
  const isGraphicAuto = profile.mode === "auto" && style.graphicScore > 0.26;
  const autoDitherScale =
    profile.mode === "auto"
      ? 1 - smoothstep(0.18, 0.42, style.graphicScore)
      : 1 - style.graphicScore * 0.18;
  const matchGuard = profile.guard + style.graphicScore * 1.25;
  const matchLimit =
    profile.mode === "auto" && style.graphicScore > 0.55
      ? Math.min(profile.candidateLimit, 6)
      : profile.candidateLimit;

  for (let y = 0; y < height; y += 1) {
    const reverseRow = Boolean(diffusionBuffer && y % 2 === 1);
    const direction = reverseRow ? -1 : 1;

    for (let step = 0; step < width; step += 1) {
      const x = reverseRow ? width - 1 - step : step;
      const pixelIndex = y * width + x;
      const workIndex = pixelIndex * 3;

      const anchorLab = labFromArray(simplified, workIndex);
      const sourceLab = labFromArray(base, workIndex);
      const workingLab = diffusionBuffer ? clampLab(labFromArray(diffusionBuffer, workIndex)) : anchorLab;
      const matchLab = diffusionBuffer ? workingLab : anchorLab;
      const baseMatch = bestPaletteMatchFromLab(
        matchLab,
        anchorLab,
        matchGuard,
        matchLimit,
      );
      const cleanNext = baseMatch.entry;
      const baseError = Math.sqrt(baseMatch.distance);
      const ditherNeed = profile.enabled
        ? smoothstep(profile.needStart, profile.needEnd, baseError)
        : 0;
      const edgeStop = profile.enabled
        ? smoothstep(profile.edgeStart, profile.edgeEnd, contrast[pixelIndex])
        : 1;
      const variationNeed =
        profile.mode === "auto"
          ? smoothstep(0.012 + style.graphicScore * 0.018, 0.052 + style.graphicScore * 0.035, contrast[pixelIndex])
          : 1;
      const ditherScale = profile.mode === "auto" ? autoDitherScale : Math.max(0.02, autoDitherScale);
      const localDither = isGraphicAuto ? 0 : ditherNeed * (1 - edgeStop) * variationNeed * ditherScale;
      let finalEntry = cleanNext;
      const inkLock = chooseInkLockEntry(sourceLab, rawContrast[pixelIndex], style);

      if (sourceAlpha[pixelIndex] <= 0.08) {
        finalEntry = transparentEntry;
      } else if (inkLock) {
        finalEntry = inkLock;
      } else if (diffusionBuffer) {
        if (localDither > 0.045) {
          diffusePaletteError(
            diffusionBuffer,
            width,
            height,
            x,
            y,
            workingLab,
            finalEntry.lab,
            contrast,
            profile,
            style,
            direction,
            sourceAlpha,
          );
        }
      } else if (profile.mode === "auto" && localDither > 0.08) {
        const pair = bestOrderedPairForLab(anchorLab, baseMatch, profile);
        if (pair) {
          finalEntry = orderedThreshold(x, y) < pair.amount ? pair.second : pair.first;
        }
      }

      chosen[pixelIndex] = finalEntry;
    }
  }

  const cleanupSource = style.graphicScore > 0.34 ? deblocked : simplified;
  const cleanupContrast = style.graphicScore > 0.34 ? rawContrast : contrast;
  let cleaned = smoothPaletteIndices(chosen, width, height, cleanupSource, cleanupContrast, style);
  cleaned = cleanFlatGraphicAreas(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = cleanGoldGreenSpill(cleaned, width, height, base, rawContrast, style);
  cleaned = cleanNeutralPlateaus(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = removeEmbeddedDirt(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = reassertToneLocks(cleaned, width, height, base, rawContrast, style);
  cleaned = reassertInkLocks(cleaned, width, height, base, rawContrast, style);
  cleaned = repairLineGaps(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = cleanupTinyRegions(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = cleanFlatGraphicAreas(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = cleanGoldGreenSpill(cleaned, width, height, base, rawContrast, style);
  cleaned = cleanNeutralPlateaus(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = removeEmbeddedDirt(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = reassertToneLocks(cleaned, width, height, base, rawContrast, style);
  cleaned = enforceVerticalSymmetry(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = cleanFlatGraphicAreas(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = cleanGoldGreenSpill(cleaned, width, height, base, rawContrast, style);
  cleaned = cleanNeutralPlateaus(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = removeEmbeddedDirt(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = reassertToneLocks(cleaned, width, height, base, rawContrast, style);
  cleaned = reassertInkLocks(cleaned, width, height, base, rawContrast, style);
  cleaned = repairLineGaps(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = cleanAlphaEdgeHalos(cleaned, width, height, sourceAlpha, cleanupSource, cleanupContrast, style);
  cleaned = reinforceArtContours(cleaned, width, height, sourceAlpha, base, rawContrast, style);
  const surfaceOptions = surfaceTextureOptionsForMode(profile, style);
  if (surfaceOptions) {
    cleaned = applySurfaceDitherEffects(cleaned, width, height, sourceAlpha, base, rawContrast, style, surfaceOptions);
    cleaned = cleanAlphaEdgeHalos(cleaned, width, height, sourceAlpha, cleanupSource, cleanupContrast, style);
    cleaned = reinforceArtContours(cleaned, width, height, sourceAlpha, base, rawContrast, style);
  }
  if (profile.mode === "edge") {
    cleaned = applySurfaceDitherEffects(cleaned, width, height, sourceAlpha, base, rawContrast, style);
    cleaned = applyEdgeDitherEffects(cleaned, width, height, cleanupSource, cleanupContrast, style);
    cleaned = cleanAlphaEdgeHalos(cleaned, width, height, sourceAlpha, cleanupSource, cleanupContrast, style);
    cleaned = reinforceArtContours(cleaned, width, height, sourceAlpha, base, rawContrast, style);
    cleaned = reassertInkLocks(cleaned, width, height, base, rawContrast, style);
    cleaned = repairLineGaps(cleaned, width, height, cleanupSource, cleanupContrast, style);
  }
  cleaned = polishDitherArtifacts(cleaned, width, height, sourceAlpha, base, rawContrast, style, profile);
  cleaned = cleanAlphaEdgeHalos(cleaned, width, height, sourceAlpha, cleanupSource, cleanupContrast, style);
  cleaned = reinforceArtContours(cleaned, width, height, sourceAlpha, base, rawContrast, style);
  cleaned = reassertInkLocks(cleaned, width, height, base, rawContrast, style);
  cleaned = repairLineGaps(cleaned, width, height, cleanupSource, cleanupContrast, style);
  cleaned = reassertTransparentFill(cleaned, sourceAlpha, transparentEntry);

  for (let pixelIndex = 0; pixelIndex < cleaned.length; pixelIndex += 1) {
    const entry = cleaned[pixelIndex];
    const srcIndex = pixelIndex * 4;
    used.add(rgbToHex(entry.color));
    output.data[srcIndex] = entry.color.r;
    output.data[srcIndex + 1] = entry.color.g;
    output.data[srcIndex + 2] = entry.color.b;
    output.data[srcIndex + 3] = 255;
  }

  return { imageData: forceOpaque(output), usedColors: used.size };
}

function render() {
  if (!state.sourceBitmap || state.palette.length === 0) return;

  const { width, height } = getTargetSize(state.sourceBitmap);
  const downsampled = drawDownsampled(state.sourceBitmap, width, height);
  const mapped = paletteMapImage(downsampled);
  forceOpaque(mapped.imageData);

  els.resultCanvas.width = width;
  els.resultCanvas.height = height;
  els.mappedCanvas.width = width;
  els.mappedCanvas.height = height;
  resultCtx.fillStyle = "#ffffff";
  resultCtx.fillRect(0, 0, width, height);
  mappedCtx.fillStyle = "#ffffff";
  mappedCtx.fillRect(0, 0, width, height);
  resultCtx.putImageData(mapped.imageData, 0, 0);
  mappedCtx.putImageData(mapped.imageData, 0, 0);
  state.lastImageData = mapped.imageData;

  fitCanvasCss(els.resultCanvas, width, height);
  fitCanvasCss(els.mappedCanvas, width, height);

  els.widthValue.value = width;
  els.pixelSizeStat.textContent = `${width} x ${height}`;
  els.colorCountStat.textContent = String(mapped.usedColors);
  els.imageMeta.textContent = `${state.sourceName} · ${width} x ${height}`;
  els.downloadBtn.disabled = false;
}

async function setSourceFromFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const bitmap = await createImageBitmap(file);
  state.sourceBitmap = bitmap;
  state.sourceName = file.name.replace(/\.[^.]+$/, "") || "image";
  drawSourcePreview(bitmap);
  render();
}

function setPalette(colors) {
  state.palette = colors;
  rebuildPaletteLab();
  renderPalette();
  render();
}

async function setPaletteFromFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const buckets = new Map();

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = Math.round(data[i] / 4) * 4;
    const g = Math.round(data[i + 1] / 4) * 4;
    const b = Math.round(data[i + 2] / 4) * 4;
    const key = `${r},${g},${b}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += data[i];
    bucket.g += data[i + 1];
    bucket.b += data[i + 2];
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const ranked = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .map((bucket) => ({
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count),
      count: bucket.count,
    }));

  const colors = [];
  for (const candidate of ranked) {
    const tooClose = colors.some((color) => {
      const dr = color.r - candidate.r;
      const dg = color.g - candidate.g;
      const db = color.b - candidate.b;
      return dr * dr + dg * dg + db * db < 144;
    });

    if (!tooClose) colors.push(candidate);
    if (colors.length >= 64) break;
  }

  if (colors.length > 0) setPalette(colors);
}

function downloadResult() {
  if (!state.lastImageData) return;

  const scale = clampInteger(state.exportScale, 1, 8, 4);
  const source = state.lastImageData;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = source.width * scale;
  exportCanvas.height = source.height * scale;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = source.width;
  tempCanvas.height = source.height;
  const safeSource = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  forceOpaque(safeSource);
  const tempCtx = tempCanvas.getContext("2d", { alpha: false });
  tempCtx.fillStyle = "#ffffff";
  tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  tempCtx.putImageData(safeSource, 0, 0);

  const ctx = exportCanvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(tempCanvas, 0, 0, exportCanvas.width, exportCanvas.height);

  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.sourceName}-palette-pixel-${source.width}x${source.height}@${scale}x.png`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }, "image/png");
}

function setViewMode(mode) {
  els.canvasArea.dataset.viewMode = mode;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === mode);
  });
}

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  try {
    localStorage.setItem("pixelizer-theme", nextTheme);
  } catch {
    // Theme still applies for the current session if storage is unavailable.
  }
  els.themeToggle.setAttribute(
    "aria-label",
    nextTheme === "dark" ? "Включить светлую тему" : "Включить темную тему",
  );
  els.themeToggle.innerHTML = `<i data-lucide="${nextTheme === "dark" ? "sun" : "moon"}" aria-hidden="true"></i>`;
  window.lucide?.createIcons();
}

function parseDitherValue(value) {
  if (value === "none" || value === "auto" || value === "edge") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? clampRange(parsed, 0, 1.2) : "auto";
}

function parseSamplingValue(value) {
  return value === "crisp" ? "crisp" : "smooth";
}

function bindEvents() {
  els.imageInput.addEventListener("change", (event) => {
    setSourceFromFile(event.target.files?.[0]);
    event.target.value = "";
  });

  els.paletteInput.addEventListener("change", (event) => {
    setPaletteFromFile(event.target.files?.[0]);
    event.target.value = "";
  });

  els.widthSlider.addEventListener("input", (event) => {
    state.targetWidth = clampInteger(
      event.target.value,
      finiteNumber(els.widthSlider.min, 16),
      finiteNumber(els.widthSlider.max, 256),
      state.targetWidth,
    );
    els.widthSlider.value = String(state.targetWidth);
    els.widthValue.value = state.targetWidth;
    render();
  });

  els.exportScale.addEventListener("change", (event) => {
    state.exportScale = clampInteger(event.target.value, 1, 8, 4);
    els.exportScale.value = String(state.exportScale);
  });

  els.themeToggle.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
  });

  els.keepAlpha.checked = true;

  document.querySelectorAll("[data-sampling]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sampling = parseSamplingValue(button.dataset.sampling);
      document.querySelectorAll("[data-sampling]").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.sampling === state.sampling);
      });
      render();
    });
  });

  document.querySelectorAll("[data-dither]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dither = parseDitherValue(button.dataset.dither);
      document.querySelectorAll("[data-dither]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      render();
    });
  });

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setViewMode(button.dataset.view));
  });

  els.downloadBtn.addEventListener("click", downloadResult);

  els.resetBtn.addEventListener("click", async () => {
    state.targetWidth = 96;
    state.sampling = "smooth";
    state.dither = "auto";
    state.keepAlpha = false;
    state.exportScale = 4;
    els.widthSlider.value = "96";
    els.widthValue.value = "96";
    els.keepAlpha.checked = true;
    els.exportScale.value = "4";
    document.querySelectorAll("[data-sampling]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.sampling === "smooth");
    });
    document.querySelectorAll("[data-dither]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.dither === "auto");
    });
    setPalette(DEFAULT_PALETTE.map(hexToRgb));
    state.sourceBitmap = await makeDemoBitmap();
    state.sourceName = "demo";
    drawSourcePreview(state.sourceBitmap);
    render();
  });

  els.defaultPaletteBtn.addEventListener("click", () => {
    setPalette(DEFAULT_PALETTE.map(hexToRgb));
  });

  ["dragenter", "dragover"].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("is-dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    setSourceFromFile(file);
  });
}

async function init() {
  bindEvents();
  applyTheme(currentTheme());
  rebuildPaletteLab();
  renderPalette();
  state.sourceBitmap = await makeDemoBitmap();
  drawSourcePreview(state.sourceBitmap);
  render();

  if (window.lucide) {
    window.lucide.createIcons();
  } else {
    window.addEventListener("load", () => window.lucide?.createIcons());
  }
}

init();
