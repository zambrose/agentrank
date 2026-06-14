// =============================================================================
// scripts/generate-assets.mjs — AgentDex submission images (logo + cover)
// =============================================================================
// Renders brand-matched PNGs via sharp (SVG → PNG). Palette mirrors the app:
//   ink #0a0e17 · panel #121826 · accent #4f8cff · good #34d399 · warn #fbbf24
// Real numbers come from data/agent_summary.json.
//   Output: assets/logo.png (512x512), assets/cover.png (1280x720)
// =============================================================================
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "assets");
mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
const agents = require(path.join(ROOT, "data", "agent_summary.json"));
const nf = (n) => n.toLocaleString("en-US");
const STATS = {
  agents: nf(agents.length),
  feedback: nf(agents.reduce((s, a) => s + (a.feedbackCount || 0), 0)),
  x402: nf(agents.filter((a) => a.x402).length),
};

const C = { ink: "#0a0e17", panel: "#121826", accent: "#4f8cff", good: "#34d399", warn: "#fbbf24", bad: "#f87171", slate: "#94a3b8", line: "#1e293b" };

// ---------------------------------------------------------------------------
// Logo — ascending reputation bars + glowing rank node (512x512)
// ---------------------------------------------------------------------------
const logo = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#4f8cff"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.32" r="0.6">
      <stop offset="0" stop-color="#4f8cff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#4f8cff" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="${C.ink}"/>
  <rect x="8" y="8" width="496" height="496" rx="104" fill="none" stroke="${C.line}" stroke-width="2"/>
  <rect width="512" height="512" rx="112" fill="url(#glow)"/>
  <!-- ascending bars -->
  <g>
    <rect x="120" y="300" width="64" height="104" rx="20" fill="url(#bar)" opacity="0.55"/>
    <rect x="224" y="232" width="64" height="172" rx="20" fill="url(#bar)" opacity="0.8"/>
    <rect x="328" y="150" width="64" height="254" rx="20" fill="url(#bar)"/>
  </g>
  <!-- rising spark line -->
  <polyline points="152,300 256,232 360,150" fill="none" stroke="${C.good}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
  <!-- glowing rank node on the tallest bar -->
  <circle cx="360" cy="150" r="34" fill="${C.good}" filter="url(#soft)" opacity="0.7"/>
  <circle cx="360" cy="150" r="20" fill="#ffffff"/>
  <circle cx="360" cy="150" r="20" fill="${C.good}" opacity="0.25"/>
</svg>`;

// ---------------------------------------------------------------------------
// Cover — hero banner with wordmark, tagline, stats, reputation-flow net
// ---------------------------------------------------------------------------
// Deterministic node field on the right (mimics the p5 reputation-flow viz).
const NODES = [
  [920, 140, 16, C.accent], [1040, 110, 9, C.warn], [1150, 200, 22, C.accent],
  [980, 250, 12, C.good], [1090, 330, 14, C.accent], [1190, 420, 10, C.bad],
  [930, 400, 18, C.good], [1040, 470, 24, C.accent], [1150, 540, 12, C.warn],
  [960, 560, 10, C.accent], [1080, 600, 16, C.good], [1200, 320, 8, C.accent],
  [880, 300, 9, C.warn], [1240, 470, 11, C.good],
].map(([x, y, r, c]) => ({ x, y, r, c }));
const EDGES = [[0,2],[0,3],[2,4],[3,6],[4,7],[6,7],[7,8],[7,10],[8,9],[4,5],[1,0],[10,8],[12,0],[5,13]];
const edgeSvg = EDGES.map(([a,b]) => `<line x1="${NODES[a].x}" y1="${NODES[a].y}" x2="${NODES[b].x}" y2="${NODES[b].y}" stroke="#4f8cff" stroke-width="1.5" opacity="0.18"/>`).join("");
const nodeSvg = NODES.map((n) => `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.c}" opacity="0.9"/><circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.c}" opacity="0.25" filter="url(#cglow)"/>`).join("");

const chip = (x, val, label, color) => `
  <g transform="translate(${x},520)">
    <rect width="232" height="74" rx="14" fill="${C.panel}" stroke="${C.line}" stroke-width="1.5"/>
    <text x="20" y="40" font-family="DejaVu Sans" font-weight="bold" font-size="30" fill="${color}">${val}</text>
    <text x="20" y="60" font-family="DejaVu Sans" font-size="15" fill="${C.slate}">${label}</text>
  </g>`;

const cover = `
<svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="0.18" cy="0.2" r="0.9">
      <stop offset="0" stop-color="#101a2e"/><stop offset="1" stop-color="${C.ink}"/>
    </radialGradient>
    <filter id="cglow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <!-- reputation-flow network (right) -->
  <g>${edgeSvg}${nodeSvg}</g>
  <!-- wordmark -->
  <text x="96" y="250" font-family="DejaVu Sans" font-weight="bold" font-size="108" fill="#f1f5f9">Agent<tspan fill="${C.accent}">Dex</tspan></text>
  <text x="100" y="312" font-family="DejaVu Sans" font-size="30" fill="${C.slate}">ERC-8004 Agent Economy Explorer · Ethereum mainnet</text>
  <text x="100" y="356" font-family="DejaVu Sans Mono" font-size="20" fill="#64748b">BigQuery reputation ranking · x402 flags · live ENS resolution</text>
  ${chip(100, STATS.agents, "agents ranked", "#f1f5f9")}
  ${chip(352, STATS.feedback, "feedback events", C.accent)}
  ${chip(604, STATS.x402, "x402-payable", C.good)}
</svg>`;

await sharp(Buffer.from(logo)).png().toFile(path.join(OUT, "logo.png"));
await sharp(Buffer.from(cover)).png().toFile(path.join(OUT, "cover.png"));
console.log("✓ assets/logo.png (512x512)");
console.log("✓ assets/cover.png (1280x720)");
console.log("stats:", STATS);
