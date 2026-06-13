// =============================================================================
// components/ReputationFlow.tsx — p5.js signature visualization
// =============================================================================
// "Reputation Flow" — a living force-directed particle field where each agent
// is a node. Nodes glow and pulse in proportion to their reputationScore, drift
// toward high-scoring peers, and emit brief sparks on recent feedback. Color
// encodes reputation: electric-blue (high) → amber (neutral) → red (low).
// Powered by REAL agent data sampled down to ≤500 nodes for performance.
// Synthetic positions only — reputation values are 100% real chain data.
// =============================================================================
"use client";

import { useEffect, useRef } from "react";
import type { AgentSummary } from "@/shared/schema";

interface Props {
  agents: AgentSummary[];
  width?: number;
  height?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rep: number;         // 0..100 reputationScore
  feedback: number;    // feedbackCount
  recency: number;     // days since last activity (0 = today)
  sparkLife: number;   // frames remaining for spark effect
}

export default function ReputationFlow({ agents, width = 900, height = 420 }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (typeof window === "undefined") return;

    let p5Instance: import("p5") | null = null;

    // Sample down to 500 nodes max for perf
    const SAMPLE = 500;
    const now = Date.now();
    const sample: AgentSummary[] =
      agents.length <= SAMPLE
        ? agents
        : (() => {
            // Include all rated agents first, then fill with unrated
            const rated = agents.filter((a) => a.feedbackCount > 0);
            const unrated = agents.filter((a) => a.feedbackCount === 0);
            const need = Math.min(SAMPLE - rated.length, unrated.length);
            return [...rated, ...unrated.slice(0, Math.max(need, 0))].slice(
              0,
              SAMPLE
            );
          })();

    import("p5").then(({ default: P5 }) => {
      if (!canvasRef.current) return;

      p5Instance = new P5((p: import("p5")) => {
        const particles: Particle[] = [];

        p.setup = () => {
          p.createCanvas(width, height);
          p.colorMode(p.HSB, 360, 100, 100, 100);
          p.noStroke();

          for (const a of sample) {
            const daysAgo =
              (now - new Date(a.lastActivityAt).getTime()) /
              (1000 * 60 * 60 * 24);
            particles.push({
              x: p.random(width),
              y: p.random(height),
              vx: p.random(-0.4, 0.4),
              vy: p.random(-0.4, 0.4),
              rep: a.reputationScore,
              feedback: a.feedbackCount,
              recency: daysAgo,
              sparkLife: a.feedbackCount > 0 && daysAgo < 7 ? 60 : 0,
            });
          }
        };

        p.draw = () => {
          // Dark translucent overlay for motion trails
          p.background(220, 30, 7, 88);

          for (let i = 0; i < particles.length; i++) {
            const pt = particles[i];

            // Gentle drift toward centre-of-mass of high-rep particles
            // (avoids clustering while keeping the field cohesive)
            if (i % 5 === p.frameCount % 5) {
              let cx = 0,
                cy = 0,
                cnt = 0;
              for (const other of particles) {
                if (other.rep > 70) {
                  cx += other.x;
                  cy += other.y;
                  cnt++;
                }
              }
              if (cnt > 0) {
                const attractX = cx / cnt - pt.x;
                const attractY = cy / cnt - pt.y;
                const d = Math.sqrt(attractX * attractX + attractY * attractY);
                if (d > 50) {
                  pt.vx += (attractX / d) * 0.015;
                  pt.vy += (attractY / d) * 0.015;
                }
              }
            }

            // Boundary repulsion
            if (pt.x < 20) pt.vx += 0.1;
            if (pt.x > width - 20) pt.vx -= 0.1;
            if (pt.y < 20) pt.vy += 0.1;
            if (pt.y > height - 20) pt.vy -= 0.1;

            // Dampen velocity
            pt.vx *= 0.97;
            pt.vy *= 0.97;
            pt.x += pt.vx;
            pt.y += pt.vy;

            // Map reputation to hue: 210 (blue) → 45 (amber) → 0/360 (red)
            // high rep (80-100) = blue/cyan, mid (40-80) = amber, low (0-40) = red
            let hue: number;
            if (pt.rep >= 70) {
              hue = p.map(pt.rep, 70, 100, 45, 210);
            } else if (pt.rep >= 40) {
              hue = p.map(pt.rep, 40, 70, 10, 45);
            } else {
              hue = p.map(pt.rep, 0, 40, 350, 10); // red range
            }

            const sat = pt.feedback > 0 ? 90 : 45;
            const brightness = pt.feedback > 0 ? 95 : 60;

            // Size: log-scaled by feedback + base
            const baseR = pt.feedback > 0 ? Math.min(2 + Math.log10(pt.feedback + 1) * 4, 12) : 1.5;

            // Spark effect for recently-active agents
            if (pt.sparkLife > 0) {
              const alpha = (pt.sparkLife / 60) * 80;
              p.fill(hue, 60, 100, alpha);
              p.ellipse(pt.x, pt.y, baseR * 4);
              pt.sparkLife--;
            }

            // Core glow
            p.fill(hue, sat, brightness, 25);
            p.ellipse(pt.x, pt.y, baseR * 2.5);

            p.fill(hue, sat, brightness, 80);
            p.ellipse(pt.x, pt.y, baseR);
          }

          // Legend overlay (bottom-left, stays fixed)
          drawLegend(p);
        };

        function drawLegend(p: import("p5")) {
          p.push();
          p.fill(0, 0, 15, 80);
          p.noStroke();
          p.rect(10, height - 74, 220, 64, 6);

          p.textSize(9);
          p.textFont("monospace");

          const items = [
            { hue: 210, label: "high reputation (≥70)" },
            { hue: 45,  label: "neutral (40–70)" },
            { hue: 0,   label: "low reputation (<40)" },
          ];
          items.forEach(({ hue, label }, i) => {
            p.fill(hue, 85, 95, 100);
            p.ellipse(24, height - 56 + i * 18, 8);
            p.fill(0, 0, 80, 100);
            p.text(label, 34, height - 51 + i * 18);
          });

          p.fill(0, 0, 55, 100);
          p.textSize(8);
          p.text(
            `${sample.length} nodes · real chain data · positions synthetic`,
            12,
            height - 4
          );
          p.pop();
        }
      }, canvasRef.current);
    });

    return () => {
      p5Instance?.remove();
    };
  }, [agents, width, height]);

  return (
    <div
      ref={canvasRef}
      style={{ width, height, borderRadius: 8, overflow: "hidden" }}
      aria-label="Reputation Flow — live force-directed visualization of ERC-8004 agent reputation scores"
    />
  );
}
