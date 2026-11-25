// ==========================================
// EXACT FORTNITE TREASURE HUNT CHEST ODDS
// ==========================================
const OUTCOMES = [
  { id: "token", label: "Pirate Token (Target)", baseDenom: 137500, th15: 1.5, th20: 2.0, color: "#67d7b8", isTarget: true },
  { id: "gold", label: "Weekly Gold Outfit", baseDenom: 1562500, th15: 7.5, th20: 10, color: "#e889b8", isTarget: false },
  { id: "vehicle", label: "Weekly Vehicle & Decal", baseDenom: 7813, th15: 10, th20: 10, color: "#f3c76b", isTarget: false },
  { id: "pickaxe", label: "Weekly Pickaxe / Back Bling", baseDenom: 568, th15: 1, th20: 1, color: "#a59cf5", isTarget: false },
  { id: "jam", label: "Weekly Jam Track", baseDenom: 391, th15: 1, th20: 1, color: "#79e29c", isTarget: false },
  { id: "loading", label: "Weekly Loading Screen", baseDenom: 272, th15: 1, th20: 1, color: "#c9e87a", isTarget: false },
  { id: "gizmo", label: "Any Gizmo", baseDenom: 127, th15: 1, th20: 1, color: "#78b8f5", isTarget: false },
  { id: "none", label: "No Special Reward", baseDenom: null, th15: 1, th20: 1, color: "#9ec5f8", isTarget: false }
];

let currentMode = "regular";
let batchSpeed = 50;
let chestsOpened = 0;
let rejectedSpecials = 0;
let countsById = Object.fromEntries(OUTCOMES.map((o) => [o.id, 0]));
let isHunting = false;
let isPaused = false;
let wheelAngle = 0;
let animFrameId = null;

function getProb(item, mode = currentMode) {
  if (!item.baseDenom) {
    const specialSum = OUTCOMES
      .filter((o) => o.baseDenom !== null)
      .reduce((sum, o) => sum + getProb(o, mode), 0);
    return Math.max(0, 1 - specialSum);
  }
  const mult = mode === "th15" ? item.th15 : mode === "th20" ? item.th20 : 1;
  return (1 / item.baseDenom) * mult;
}

function getEffectiveTokenDenom(mode = currentMode) {
  return Math.round(1 / getProb(OUTCOMES[0], mode));
}

function formatItemOdds(item, mode = currentMode) {
  const p = getProb(item, mode);
  if (item.id === "none") return `${(p * 100).toFixed(2)}%`;
  return `1 / ${Math.round(1 / p).toLocaleString()}`;
}

function rollChest(mode = currentMode) {
  const r = Math.random();
  let cum = 0;
  for (const item of OUTCOMES) {
    if (!item.baseDenom) continue;
    cum += getProb(item, mode);
    if (r < cum) return item;
  }
  return OUTCOMES.find((o) => o.id === "none");
}

// ==========================================
// LOG-SCALED WHEEL
// ==========================================
const wheelCanvas = document.getElementById("wheelCanvas");
const wCtx = wheelCanvas.getContext("2d");

function computeLogSegments(mode = currentMode) {
  const weights = OUTCOMES.map((item) => {
    const p = Math.max(getProb(item, mode), 1e-7);
    return Math.pow(Math.log10(p * 1e7 + 1), 1.25);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return OUTCOMES.map((item, idx) => {
    const sweep = (weights[idx] / total) * Math.PI * 2;
    const seg = { item, start: cursor, end: cursor + sweep, mid: cursor + sweep / 2 };
    cursor += sweep;
    return seg;
  });
}

function drawWheel(angle = wheelAngle) {
  const cx = wheelCanvas.width / 2;
  const cy = wheelCanvas.height / 2;
  const r = cx - 6;
  const segs = computeLogSegments(currentMode);

  wCtx.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);

  segs.forEach((seg) => {
    const s = angle + seg.start;
    const e = angle + seg.end;
    const m = angle + seg.mid;

    wCtx.beginPath();
    wCtx.moveTo(cx, cy);
    wCtx.arc(cx, cy, r, s, e);
    wCtx.closePath();
    wCtx.fillStyle = seg.item.color;
    wCtx.fill();
    wCtx.strokeStyle = "#0c0e12";
    wCtx.lineWidth = 2;
    wCtx.stroke();

    const deg = ((seg.end - seg.start) * 180) / Math.PI;
    wCtx.save();
    wCtx.translate(cx, cy);
    wCtx.rotate(m);
    wCtx.textAlign = "right";
    wCtx.fillStyle = "#0b0e14";

    if (deg >= 18) {
      wCtx.font = "600 10px sans-serif";
      wCtx.fillText(seg.item.label.replace("Weekly ", ""), r - 12, -2);
      wCtx.font = "700 9px monospace";
      wCtx.fillText(formatItemOdds(seg.item, currentMode), r - 12, 10);
    } else {
      wCtx.font = "700 8.5px monospace";
      wCtx.fillText(`${seg.item.id === "token" ? "Token" : "Gold"} ${formatItemOdds(seg.item, currentMode)}`, r - 8, 3);
    }
    wCtx.restore();
  });

  // Center "CDF" hub
  wCtx.beginPath();
  wCtx.arc(cx, cy, 24, 0, Math.PI * 2);
  wCtx.fillStyle = "#0c0e12";
  wCtx.fill();
  wCtx.fillStyle = "#e5e7eb";
  wCtx.font = "600 11px sans-serif";
  wCtx.textAlign = "center";
  wCtx.textBaseline = "middle";
  wCtx.fillText("CDF", cx, cy);
}

function getAngleForTokenTop() {
  const segs = computeLogSegments(currentMode);
  const tokenSeg = segs.find((s) => s.item.isTarget) || segs[0];
  return (Math.PI * 1.5) - tokenSeg.mid;
}

// ==========================================
// KPI CARDS & DROP LOG RENDERING
// ==========================================
const chestsCountEl = document.getElementById("chestsCount");
const expectedSubEl = document.getElementById("expectedSub");
const oddsRatioMainEl = document.getElementById("oddsRatioMain");
const oddsPctSubEl = document.getElementById("oddsPctSub");
const rejectedDropsEl = document.getElementById("rejectedDrops");
const emptyChestsSubEl = document.getElementById("emptyChestsSub");
const dropLogListEl = document.getElementById("dropLogList");
const hitBannerEl = document.getElementById("hitBanner");

function renderDropLog() {
  dropLogListEl.innerHTML = OUTCOMES.map((item) => {
    const count = countsById[item.id] || 0;
    const rowCls = item.isTarget ? "drop-row target-row" : "drop-row";
    return `
      <div class="${rowCls}">
        <div class="drop-left">
          <span class="dot" style="background:${item.color}"></span>
          <div>
            <div class="drop-name">${item.label}</div>
            <div class="drop-odds">${formatItemOdds(item, currentMode)}</div>
          </div>
        </div>
        <div class="drop-count">${count.toLocaleString()}</div>
      </div>
    `;
  }).join("");
}

function updateKPIs() {
  const denom = getEffectiveTokenDenom(currentMode);
  const tokenPct = (getProb(OUTCOMES[0], currentMode) * 100).toFixed(6);
  const emptyCount = countsById.none || 0;
  const emptyPct = chestsOpened > 0 ? ((emptyCount / chestsOpened) * 100).toFixed(2) : "98.40";

  chestsCountEl.textContent = chestsOpened.toLocaleString();
  expectedSubEl.textContent = `Expected: ${denom.toLocaleString()}`;
  oddsRatioMainEl.textContent = `1 / ${denom.toLocaleString()}`;
  oddsPctSubEl.textContent = `${tokenPct}% per chest`;
  rejectedDropsEl.textContent = rejectedSpecials.toLocaleString();
  emptyChestsSubEl.textContent = `${emptyCount.toLocaleString()} empty chests (${emptyPct}%)`;
}

function syncUI() {
  updateKPIs();
  renderDropLog();
  drawWheel(wheelAngle);
}

// ==========================================
// HUNT LOOP, SINGLE ROLL & RESET
// ==========================================
const huntBtn = document.getElementById("huntBtn");
const rollOneBtn = document.getElementById("rollOneBtn");
const resetBtn = document.getElementById("resetBtn");

function applySingleOutcome(outcome) {
  chestsOpened++;
  countsById[outcome.id] = (countsById[outcome.id] || 0) + 1;
  if (!outcome.isTarget && outcome.id !== "none") {
    rejectedSpecials++;
  }
  if (outcome.isTarget) {
    wheelAngle = getAngleForTokenTop();
    hitBannerEl.textContent = `HIT! Pirate Token landed on chest #${chestsOpened.toLocaleString()}`;
    hitBannerEl.classList.remove("hidden");
  }
}

function setHuntButtonLabel() {
  if (isHunting) {
    huntBtn.textContent = "⏸ Pause Hunt";
    huntBtn.classList.add("active-hunt");
  } else if (isPaused) {
    huntBtn.textContent = "▶ Resume Hunt";
    huntBtn.classList.remove("active-hunt");
  } else {
    huntBtn.textContent = "↻ Auto-Spin Until Pirate Token";
    huntBtn.classList.remove("active-hunt");
  }
}

function toggleAutoHunt() {
  if (isHunting) {
    isHunting = false;
    isPaused = true;
    cancelAnimationFrame(animFrameId);
    setHuntButtonLabel();
    return;
  }

  hitBannerEl.classList.add("hidden");
  isHunting = true;
  isPaused = false;
  setHuntButtonLabel();

  function step() {
    if (!isHunting) return;

    const stepAngle = batchSpeed === 1 ? 0.14 : batchSpeed === 50 ? 0.28 : 0.5;
    wheelAngle = (wheelAngle + stepAngle) % (Math.PI * 2);

    for (let i = 0; i < batchSpeed; i++) {
      const drop = rollChest(currentMode);
      applySingleOutcome(drop);
      if (drop.isTarget) {
        isHunting = false;
        isPaused = false;
        setHuntButtonLabel();
        syncUI();
        return;
      }
    }

    syncUI();
    animFrameId = requestAnimationFrame(step);
  }

  animFrameId = requestAnimationFrame(step);
}

rollOneBtn.addEventListener("click", () => {
  if (isHunting) return;
  hitBannerEl.classList.add("hidden");
  const drop = rollChest(currentMode);
  wheelAngle = (wheelAngle + 0.45) % (Math.PI * 2);
  applySingleOutcome(drop);
  syncUI();
});

resetBtn.addEventListener("click", () => {
  isHunting = false;
  isPaused = false;
  cancelAnimationFrame(animFrameId);
  chestsOpened = 0;
  rejectedSpecials = 0;
  countsById = Object.fromEntries(OUTCOMES.map((o) => [o.id, 0]));
  wheelAngle = 0;
  hitBannerEl.classList.add("hidden");
  setHuntButtonLabel();
  syncUI();
});

huntBtn.addEventListener("click", toggleAutoHunt);

// Pill toggles
document.querySelectorAll("#modePills .pill-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#modePills .pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    syncUI();
  });
});

document.querySelectorAll("#speedPills .pill-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#speedPills .pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    batchSpeed = parseInt(btn.dataset.speed, 10);
  });
});

// ==========================================
// TEST RUN: 1,000 CHANCES + HISTOGRAM
// ==========================================
const histCanvas = document.getElementById("histogramCanvas");
const hCtx = histCanvas.getContext("2d");

const RANGE_BINS = [
  { label: "< 25k", min: 0, max: 24999, color: "#67d7b8" },
  { label: "25k–75k", min: 25000, max: 74999, color: "#78b8f5" },
  { label: "75k–150k", min: 75000, max: 149999, color: "#a59cf5" },
  { label: "150k–300k", min: 150000, max: 299999, color: "#f3c76b" },
  { label: "300k+", min: 300000, max: Infinity, color: "#e889b8" }
];

function drawRangeHistogram(binCounts, total = 1000) {
  const w = histCanvas.width;
  const h = histCanvas.height;
  hCtx.clearRect(0, 0, w, h);

  const padL = 20;
  const padR = 20;
  const padT = 28;
  const padB = 34;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const pcts = binCounts.map((c) => (total > 0 ? (c / total) * 100 : 0));
  const maxPct = Math.max(40, Math.ceil(Math.max(...pcts, 1) / 10) * 10);
  const gap = 18;
  const barW = (plotW - gap * (RANGE_BINS.length - 1)) / RANGE_BINS.length;

  hCtx.strokeStyle = "#222834";
  hCtx.lineWidth = 1;
  hCtx.beginPath();
  hCtx.moveTo(padL, padT + plotH);
  hCtx.lineTo(w - padR, padT + plotH);
  hCtx.stroke();

  RANGE_BINS.forEach((bin, i) => {
    const pct = pcts[i];
    const barH = (pct / maxPct) * plotH;
    const x = padL + i * (barW + gap);
    const y = padT + plotH - barH;

    hCtx.fillStyle = bin.color;
    hCtx.beginPath();
    hCtx.roundRect(x, y, barW, barH, [6, 6, 0, 0]);
    hCtx.fill();

    hCtx.fillStyle = "#f3f4f6";
    hCtx.font = "600 11px monospace";
    hCtx.textAlign = "center";
    hCtx.fillText(`${pct.toFixed(1)}% (${binCounts[i]})`, x + barW / 2, Math.max(14, y - 7));

    hCtx.fillStyle = "#9ca3af";
    hCtx.font = "11px sans-serif";
    hCtx.fillText(bin.label, x + barW / 2, padT + plotH + 19);
  });
}

document.getElementById("run1000Btn").addEventListener("click", () => {
  const trials = 1000;
  const chestsPerMatch = Math.max(1, parseInt(document.getElementById("chestsPerMatchInput").value, 10) || 20);
  const benchmark = Math.max(1, parseInt(document.getElementById("benchmarkInput").value, 10) || 13000);
  const minutesPerMatch = 20;

  const runs = [];
  const binCounts = new Array(RANGE_BINS.length).fill(0);
  let underBench = 0;

  for (let t = 0; t < trials; t++) {
    let c = 0;
    while (true) {
      c++;
      if (rollChest(currentMode).isTarget) {
        runs.push(c);
        if (c < benchmark) underBench++;
        const idx = RANGE_BINS.findIndex((b) => c >= b.min && c <= b.max);
        if (idx !== -1) binCounts[idx]++;
        break;
      }
    }
  }

  runs.sort((a, b) => a - b);
  const minVal = runs[0];
  const maxVal = runs[trials - 1];
  const meanVal = Math.round(runs.reduce((a, b) => a + b, 0) / trials);
  const medianVal = runs[Math.floor(trials / 2)];
  const benchPct = ((underBench / trials) * 100).toFixed(1);

  const estMatches = Math.round(meanVal / chestsPerMatch);
  const estHours = Math.round((estMatches * minutesPerMatch) / 60);

  document.getElementById("mcSummaryGrid").innerHTML = `
    <div class="mc-stat">
      <div class="mc-stat-label">Luckiest / Unluckiest Run</div>
      <div class="mc-stat-val">${minVal.toLocaleString()} — ${maxVal.toLocaleString()}</div>
      <div class="mc-stat-sub">Full spread across 1,000 hunts</div>
    </div>
    <div class="mc-stat">
      <div class="mc-stat-label">Mean vs. Median Chests</div>
      <div class="mc-stat-val">${meanVal.toLocaleString()} / ${medianVal.toLocaleString()}</div>
      <div class="mc-stat-sub">~${estMatches.toLocaleString()} matches (~${estHours.toLocaleString()} hrs @ 20m/match)</div>
    </div>
    <div class="mc-stat" style="grid-column: span 2;">
      <div class="mc-stat-label">Under ${benchmark.toLocaleString()} Chests (Benchmark)</div>
      <div class="mc-stat-val">${benchPct}% (${underBench} of ${trials} runs)</div>
      <div class="mc-stat-sub">Shows how rarely players hit early relative to the ${benchmark.toLocaleString()}-chest benchmark</div>
    </div>
  `;

  drawRangeHistogram(binCounts, trials);
});

// Initial render
syncUI();
drawRangeHistogram([0, 0, 0, 0, 0], 1000);