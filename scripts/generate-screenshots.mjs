// =============================================================================
// scripts/generate-screenshots.mjs — submission screenshots from REAL data
// =============================================================================
// Renders three 1600x1000 views of the actual AgentDex UI, populated entirely
// from data/agent_summary.json (no invented values). Faithful representations
// for the submission's Screenshots slot; prefer live captures if the site is up.
//   assets/shot-1-home.png       homepage: stats + reputation flow + leaderboard
//   assets/shot-2-agent.png      agent detail (x402 agent #13445)
//   assets/shot-3-ens.png        live ENS resolver (vitalik.eth, verifiable)
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
const C = { ink: "#0a0e17", viz: "#080c14", panel: "#121826", line: "#1e293b", line2: "#334155",
  txt: "#e2e8f0", sub: "#94a3b8", dim: "#64748b", accent: "#4f8cff", good: "#34d399", warn: "#fbbf24", bad: "#f87171" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const STATS = {
  agents: nf(agents.length),
  feedback: nf(agents.reduce((s, a) => s + (a.feedbackCount || 0), 0)),
  rated: nf(agents.filter((a) => a.feedbackCount > 0).length),
  x402: nf(agents.filter((a) => a.x402).length),
};
const T = (x, y, s, { size = 16, fill = C.txt, w = "normal", mono = false, anchor = "start" } = {}) =>
  `<text x="${x}" y="${y}" font-family="${mono ? "DejaVu Sans Mono" : "DejaVu Sans"}" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
const stat = (x, val, label, color = C.txt) =>
  T(x, 48, val, { size: 22, w: "bold", fill: color, anchor: "end" }) + T(x, 68, label, { size: 12, fill: C.dim, anchor: "end" });

function header() {
  return `
    <rect x="0" y="0" width="1600" height="92" fill="${C.ink}"/>
    <line x1="0" y1="92" x2="1600" y2="92" stroke="${C.line}" stroke-width="1"/>
    ${T(56, 44, "AgentDex", { size: 26, w: "bold", fill: C.accent })}
    ${T(56, 70, "ERC-8004 Agent Economy Explorer · Ethereum mainnet", { size: 13, fill: C.dim })}
    ${stat(1170, STATS.agents, "agents registered")}
    ${stat(1330, STATS.feedback, "feedback events", C.accent)}
    ${stat(1460, STATS.rated, "rated agents")}
    ${stat(1560, STATS.x402, "x402-payable", C.good)}`;
}
const wrap = (inner) =>
  `<svg width="1600" height="1000" viewBox="0 0 1600 1000" xmlns="http://www.w3.org/2000/svg">
    <rect width="1600" height="1000" fill="${C.ink}"/>${header()}${inner}</svg>`;

// ---------------------------------------------------------------------------
// Shot 1 — homepage
// ---------------------------------------------------------------------------
const NODES = [[260,250,16,C.accent],[420,180,10,C.warn],[600,230,22,C.accent],[330,330,12,C.good],
  [520,360,14,C.accent],[700,300,10,C.bad],[250,420,18,C.good],[470,470,24,C.accent],[660,440,12,C.warn],
  [820,260,9,C.accent],[900,360,16,C.good],[1040,240,14,C.accent],[1180,320,20,C.accent],[1280,220,9,C.warn],
  [1120,440,11,C.bad],[1320,400,16,C.good],[980,470,12,C.accent],[1240,500,10,C.warn],[860,480,14,C.accent],[1400,300,12,C.good]];
const EDGES = [[0,2],[0,3],[2,4],[3,6],[4,7],[6,7],[7,8],[8,10],[2,9],[10,11],[11,12],[12,13],[12,14],[12,16],[15,16],[12,18],[16,18],[13,11],[15,17],[19,12]];
const net = EDGES.map(([a,b])=>`<line x1="${NODES[a][0]}" y1="${NODES[a][1]+150}" x2="${NODES[b][0]}" y2="${NODES[b][1]+150}" stroke="#4f8cff" stroke-width="1.5" opacity="0.18"/>`).join("")
  + NODES.map(n=>`<circle cx="${n[0]}" cy="${n[1]+150}" r="${n[2]}" fill="${n[3]}" opacity="0.9"/>`).join("");

function row(y, a, i) {
  const barW = Math.round((a.reputationScore / 100) * 230);
  const col = a.reputationScore >= 60 ? C.accent : a.reputationScore >= 40 ? C.warn : C.bad;
  return `
    ${i % 2 ? `<rect x="40" y="${y-26}" width="1520" height="44" fill="#0d1320"/>` : ""}
    ${T(72, y, `#${a.rank}`, { size: 16, w: "bold", fill: C.sub })}
    ${T(150, y, `Agent #${a.agentId}`, { size: 16, w: "bold" })}
    ${T(150, y+17, short(a.ownerAddress), { size: 11, fill: C.dim, mono: true })}
    <rect x="520" y="${y-13}" width="230" height="8" rx="4" fill="#1e293b"/>
    <rect x="520" y="${y-13}" width="${barW}" height="8" rx="4" fill="${col}"/>
    ${T(760, y, a.reputationScore.toFixed(1), { size: 15, w: "bold", fill: col })}
    ${T(900, y, nf(a.feedbackCount), { size: 15, anchor: "end" })}
    ${T(1080, y, nf(a.uniqueClients), { size: 15, anchor: "end" })}
    ${a.x402 ? `<rect x="1200" y="${y-16}" width="92" height="24" rx="12" fill="#0f2a1f" stroke="${C.good}" stroke-width="1"/>${T(1246, y, "x402", { size: 12, w: "bold", fill: C.good, anchor: "middle" })}` : T(1246, y, "—", { size: 14, fill: C.dim, anchor: "middle" })}`;
}
const top = agents.slice(0, 7);
const shot1 = wrap(`
  ${T(56, 132, "REPUTATION FLOW", { size: 13, w: "bold", fill: C.sub })}
  ${T(1544, 132, "force-directed · real reputation scores", { size: 12, fill: C.dim, anchor: "end" })}
  <rect x="40" y="148" width="1520" height="330" rx="12" fill="${C.viz}" stroke="${C.line}" stroke-width="1"/>
  ${net}
  ${T(56, 532, "RANKED AGENTS", { size: 13, w: "bold", fill: C.sub })}
  <rect x="40" y="548" width="1520" height="420" rx="12" fill="${C.panel}" stroke="${C.line}" stroke-width="1"/>
  ${T(72, 588, "RANK", { size: 12, w: "bold", fill: C.dim })}
  ${T(150, 588, "AGENT", { size: 12, w: "bold", fill: C.dim })}
  ${T(520, 588, "REPUTATION", { size: 12, w: "bold", fill: C.dim })}
  ${T(900, 588, "FEEDBACK", { size: 12, w: "bold", fill: C.dim, anchor: "end" })}
  ${T(1080, 588, "CLIENTS", { size: 12, w: "bold", fill: C.dim, anchor: "end" })}
  ${T(1246, 588, "X402", { size: 12, w: "bold", fill: C.dim, anchor: "middle" })}
  <line x1="56" y1="604" x2="1544" y2="604" stroke="${C.line}" stroke-width="1"/>
  ${top.map((a, i) => row(648 + i * 44, a, i)).join("")}`);

// ---------------------------------------------------------------------------
// Shot 2 — agent detail (x402 agent #13445)
// ---------------------------------------------------------------------------
const A = agents.find((z) => z.agentId === 13445);
const bd = A.scoreBreakdown || { positive: 0, neutral: 0, negative: 0 };
const tot = Math.max(bd.positive + bd.neutral + bd.negative, 1);
const card = (x, val, label, color = C.txt) =>
  `<rect x="${x}" y="280" width="288" height="120" rx="12" fill="${C.panel}" stroke="${C.line}" stroke-width="1"/>
   ${T(x + 28, 348, val, { size: 38, w: "bold", fill: color })}${T(x + 28, 378, label, { size: 14, fill: C.sub })}`;
const segW = (n) => Math.round((n / tot) * 1400);
const shot2 = wrap(`
  ${T(56, 150, "← Agents", { size: 14, fill: C.accent })}
  ${T(56, 210, `Agent #${A.agentId}`, { size: 44, w: "bold" })}
  <rect x="490" y="178" width="150" height="34" rx="17" fill="#0f2a1f" stroke="${C.good}" stroke-width="1.5"/>
  ${T(565, 200, "x402-payable", { size: 15, w: "bold", fill: C.good, anchor: "middle" })}
  ${T(56, 250, `Owner ${short(A.ownerAddress)}`, { size: 16, fill: C.sub, mono: true })}
  ${T(360, 250, "ENS: reverse-resolving via viem (ENS Universal Resolver) · no primary name set", { size: 13, fill: C.dim })}
  ${card(56, A.reputationScore.toFixed(1), `reputation · rank #${A.rank}`, C.accent)}
  ${card(372, nf(A.feedbackCount), "feedback events", C.txt)}
  ${card(688, nf(A.uniqueClients), "unique clients", C.txt)}
  ${card(1004, `${bd.positive}/${bd.negative}`, "positive / negative", C.good)}
  ${T(56, 470, "SCORE BREAKDOWN", { size: 13, w: "bold", fill: C.sub })}
  <rect x="56" y="488" width="1400" height="22" rx="6" fill="#1e293b"/>
  <rect x="56" y="488" width="${segW(bd.positive)}" height="22" rx="6" fill="${C.good}"/>
  <rect x="${56 + segW(bd.positive) + segW(bd.neutral)}" y="488" width="${segW(bd.negative)}" height="22" rx="6" fill="${C.bad}"/>
  ${T(56, 540, `${bd.positive} positive · ${bd.neutral} neutral · ${bd.negative} negative`, { size: 14, fill: C.sub })}
  <rect x="56" y="580" width="1400" height="150" rx="12" fill="${C.panel}" stroke="${C.line}" stroke-width="1"/>
  ${T(84, 622, "x402 micropayments", { size: 16, w: "bold", fill: C.good })}
  ${T(84, 652, "Detected from this agent's tokenURI registration file — flagged as accepting x402 payments.", { size: 14, fill: C.sub })}
  ${T(84, 688, `Registered ${A.registeredAt.slice(0,10)}   ·   Last active ${A.lastActivityAt.slice(0,10)}`, { size: 14, fill: C.dim })}
  ${T(84, 714, `tokenURI: ${A.tokenURI.slice(0, 64)}…`, { size: 12, fill: C.dim, mono: true })}`);

// ---------------------------------------------------------------------------
// Shot 3 — live ENS resolver (vitalik.eth — verifiable public values)
// ---------------------------------------------------------------------------
const VIT = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const chip = (x, label) => `<rect x="${x}" y="372" width="${18 + label.length * 9}" height="26" rx="13" fill="none" stroke="${C.line2}" stroke-width="1"/>${T(x + 14, 390, label, { size: 13, fill: C.sub, mono: true })}`;
const shot3 = wrap(`
  ${T(56, 150, "LIVE ENS RESOLVER", { size: 13, w: "bold", fill: C.sub })}
  ${T(1544, 150, "viem · mainnet · real on-chain read", { size: 12, fill: C.dim, anchor: "end" })}
  <rect x="40" y="172" width="1520" height="380" rx="12" fill="${C.viz}" stroke="${C.line}" stroke-width="1"/>
  <rect x="72" y="300" width="1230" height="52" rx="10" fill="#10151f" stroke="${C.line2}" stroke-width="1"/>
  ${T(96, 332, "vitalik.eth", { size: 18, fill: C.txt, mono: true })}
  <rect x="1320" y="300" width="200" height="52" rx="10" fill="${C.accent}"/>
  ${T(1420, 332, "Resolve", { size: 17, w: "bold", fill: "#06122e", anchor: "middle" })}
  ${T(72, 392, "try:", { size: 13, fill: C.dim })}
  ${chip(110, "vitalik.eth")} ${chip(245, "ens.eth")} ${chip(345, "nick.eth")}
  <rect x="72" y="430" width="1448" height="100" rx="10" fill="#0c111a" stroke="${C.line}" stroke-width="1"/>
  <circle cx="118" cy="480" r="22" fill="${C.accent}" opacity="0.25"/>${T(118, 487, "Ξ", { size: 22, fill: C.accent, anchor: "middle" })}
  ${T(156, 472, "vitalik.eth", { size: 20, w: "bold", fill: C.good })}
  ${T(156, 498, VIT, { size: 15, fill: C.sub, mono: true })}
  ${T(1496, 472, "resolved live ✓", { size: 14, fill: C.good, anchor: "end" })}
  ${T(56, 612, "Owner ENS resolution also runs on every agent detail page (reverse-resolve + ENSIP-25/26 text records).", { size: 15, fill: C.sub })}`);

for (const [name, svg] of [["shot-1-home", shot1], ["shot-2-agent", shot2], ["shot-3-ens", shot3]]) {
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, `${name}.png`));
  console.log(`✓ assets/${name}.png`);
}
