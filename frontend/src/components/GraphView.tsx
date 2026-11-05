/**
 * ============================================================================
 * COMPONENT: Force-Directed Threat Intelligence Graph Canvas
 * FILE: frontend/src/components/GraphView.tsx
 * ============================================================================
 *
 * WHAT THIS COMPONENT DOES:
 * -------------------------
 * This React component renders an interactive, physics-driven 2D force graph
 * visualizing relationships between threat assets and shared infrastructure
 * using HTML5 Canvas (`react-force-graph-2d`).
 *
 * VISUAL ENCODING & FORENSIC CONVENTIONS:
 * ---------------------------------------
 * 1. Node Radii (Hierarchy):
 *    - Primary Threat Assets (domain, email, phone, wallet, apk): Radius 8px.
 *    - Infrastructure Nodes (IP, nameserver, registrar, ASN, SSL cert): Radius 4px.
 *    - Current Search Target: Extra +3px highlight radius.
 *
 * 2. Visual Encodings (Colors & Halos):
 *    - Fill Color: Mapped by Entity Type (domains = cyan, IPs = purple, wallets = orange, etc.).
 *    - Outer Threat Halo / Ring:
 *        * Red ring: High-risk confirmed threat.
 *        * Amber ring: Suspicious look-alike or connected entity.
 *        * White concentric circle: Active search query indicator.
 *
 * 3. Physics Simulation (Force-Directed Layout):
 *    - Repulsion forces push distinct nodes apart to avoid visual overlap.
 *    - Edge spring forces pull connected entities (e.g. domain -> nameserver) together.
 *    - High-degree infrastructure nodes (like shared bulletproof DNS) naturally
 *      gravitate to the center as "syndicate hubs".
 *
 * 4. Interactivity:
 *    - Click any node to open the forensic inspector drawer.
 *    - Hover over nodes to inspect values and zoom smoothly.
 *    - Auto-scales dynamically to the parent container using `ResizeObserver`.
 * ============================================================================
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useI18n } from '../I18n.tsx';
import { ASSET_TYPES, LEVEL_STYLE, TYPE_COLORS } from '../style.ts';
import { esc, shorten } from '../explain.ts';
import type { AssetView, GraphLink, GraphNode, Level, NodeType } from '../types.ts';

/** Component properties */
interface Props {
  graph: { nodes: GraphNode[]; links: GraphLink[] };
  assets: AssetView[];
  truncated: boolean;
  onSelect: (n: GraphNode) => void;
}

/** Extended node type incorporating physics coordinates calculated by D3 */
type Pos = GraphNode & { x?: number; y?: number };

export default function GraphView({ graph, assets, truncated, onSelect }: Props) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<string | null>(null);

  /** Responsive resize observer: adjusts canvas dimensions on window/panel resize */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Lookup map linking each asset ID to its calculated threat level */
  const levels = useMemo(
    () => new Map<string, Level>(assets.map((a) => [a.id, a.assessment.level])),
    [assets]
  );

  /**
   * Clone graph data to avoid mutating upstream state during D3 simulation.
   */
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({ ...l })),
    }),
    [graph]
  );

  /** Unique node types present in the current view for dynamic legend generation */
  const typesPresent = useMemo(
    () => [...new Set(graph.nodes.map((n) => n.type))],
    [graph]
  );

  /** Computes node radius based on whether it is an asset or infrastructure */
  const radius = (n: GraphNode): number =>
    (ASSET_TYPES.has(n.type) ? 8 : 4) + (n.isQuery ? 3 : 0);

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  return (
    <div
      ref={box}
      className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
    >
      <ForceGraph2D
        graphData={data}
        width={size.width}
        height={size.height}
        backgroundColor={isDark ? '#020617' : '#f8fafc'}
        nodeId="id"
        // HTML Tooltip on hover
        nodeLabel={(n) =>
          `<b>${esc(t(`type.${String(n.type)}`))}</b><br/>${esc(String(n.value))}`
        }
        linkLabel={(l) => esc(t(`rel.${String(l.rel)}`))}
        linkColor={() => isDark ? 'rgba(148,163,184,0.45)' : 'rgba(100,116,139,0.35)'}
        linkWidth={1.2}
        nodeCanvasObjectMode={() => 'replace'}
        // Custom Canvas Renderer for Nodes, Threat Halos, and Typography
        nodeCanvasObject={(node: object, ctx: CanvasRenderingContext2D, scale: number) => {
          const n = node as Pos;
          if (n.x === undefined || n.y === undefined) return;
          const r = radius(n);

          // 1. Draw base filled circle with vector-specific color
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = TYPE_COLORS[n.type as NodeType] ?? '#cbd5e1';
          ctx.fill();

          // 2. Draw outer threat ring (red for high risk, amber for suspicious)
          const level = levels.get(n.id);
          if (level && level !== 'none') {
            ctx.lineWidth = 2.5 / scale;
            ctx.strokeStyle = LEVEL_STYLE[level].ring;
            ctx.stroke();
          }

          // 3. Draw target concentric ring if this is the actively searched query
          if (n.isQuery) {
            ctx.lineWidth = 1.5 / scale;
            ctx.strokeStyle = isDark ? '#ffffff' : '#0284c7';
            ctx.beginPath();
            ctx.arc(n.x, n.y, r + 3 / scale, 0, 2 * Math.PI);
            ctx.stroke();
          }

          // 4. Render text label for primary assets, queried node, or hovered node
          if (ASSET_TYPES.has(n.type) || n.isQuery || hover === n.id) {
            ctx.font = `${Math.max(3, 11 / scale)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = isDark ? '#e2e8f0' : '#0f172a';
            ctx.fillText(shorten(n.value, 24), n.x, n.y + r + 2 / scale);
          }
        }}
        // Custom hitbox painter ensuring accurate click and hover detection
        nodePointerAreaPaint={(
          node: object,
          color: string,
          ctx: CanvasRenderingContext2D
        ) => {
          const n = node as Pos;
          if (n.x === undefined || n.y === undefined) return;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius(n) + 3, 0, 2 * Math.PI);
          ctx.fill();
        }}
        onNodeHover={(n) => setHover(n ? String((n as unknown as GraphNode).id) : null)}
        onNodeClick={(n) => onSelect(n as unknown as GraphNode)}
        cooldownTicks={120}
      />

      {/* Floating Header Card */}
      <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg bg-slate-900/85 p-2 text-[11px] text-slate-300">
        <p className="font-semibold text-slate-100">{t('map.title')}</p>
        <p>{t('map.help')}</p>
        {truncated && <p className="mt-1 text-amber-300">{t('map.truncated')}</p>}
      </div>

      {/* Floating Canvas Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 max-w-xs rounded-lg bg-slate-900/85 p-2 text-[11px] text-slate-300">
        <p className="mb-1 font-semibold text-slate-100">{t('map.legend')}</p>
        <ul className="mb-1 space-y-0.5">
          {typesPresent.map((type) => (
            <li key={type} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: TYPE_COLORS[type] }}
              />
              {t(`type.${type}`)}
            </li>
          ))}
        </ul>
        <p>{t('map.big')}</p>
        <p>{t('map.small')}</p>
        <p>{t('map.ring')}</p>
        <p className="mt-0.5 flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-white" />
          {t('map.you')}
        </p>
      </div>
    </div>
  );
}
