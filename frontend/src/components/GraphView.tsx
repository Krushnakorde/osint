import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useI18n } from '../I18n.tsx';
import { ASSET_TYPES, LEVEL_STYLE, TYPE_COLORS } from '../style.ts';
import { esc, shorten } from '../explain.ts';
import type { AssetView, GraphLink, GraphNode, Level, NodeType } from '../types.ts';

interface Props {
  graph: { nodes: GraphNode[]; links: GraphLink[] };
  assets: AssetView[];
  truncated: boolean;
  onSelect: (n: GraphNode) => void;
}
type Pos = GraphNode & { x?: number; y?: number };

export default function GraphView({ graph, assets, truncated, onSelect }: Props) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => { const r = entries[0]?.contentRect; if (r) setSize({ width: r.width, height: r.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const levels = useMemo(() => new Map<string, Level>(assets.map((a) => [a.id, a.assessment.level])), [assets]);
  // the library mutates its data, so hand it fresh copies
  const data = useMemo(() => ({ nodes: graph.nodes.map((n) => ({ ...n })), links: graph.links.map((l) => ({ ...l })) }), [graph]);
  const typesPresent = useMemo(() => [...new Set(graph.nodes.map((n) => n.type))], [graph]);

  const radius = (n: GraphNode): number => (ASSET_TYPES.has(n.type) ? 8 : 4) + (n.isQuery ? 3 : 0);

  return (
    <div ref={box} className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <ForceGraph2D
        graphData={data}
        width={size.width}
        height={size.height}
        backgroundColor="#020617"
        nodeId="id"
        nodeLabel={(n) => `<b>${esc(t(`type.${String(n.type)}`))}</b><br/>${esc(String(n.value))}`}
        linkLabel={(l) => esc(t(`rel.${String(l.rel)}`))}
        linkColor={() => 'rgba(148,163,184,0.45)'}
        linkWidth={1.2}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node: object, ctx: CanvasRenderingContext2D, scale: number) => {
          const n = node as Pos;
          if (n.x === undefined || n.y === undefined) return;
          const r = radius(n);
          ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = TYPE_COLORS[n.type as NodeType] ?? '#cbd5e1'; ctx.fill();
          const level = levels.get(n.id);
          if (level && level !== 'none') { ctx.lineWidth = 2.5 / scale; ctx.strokeStyle = LEVEL_STYLE[level].ring; ctx.stroke(); }
          if (n.isQuery) { ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / scale, 0, 2 * Math.PI); ctx.stroke(); }
          if (ASSET_TYPES.has(n.type) || n.isQuery || hover === n.id) {
            ctx.font = `${Math.max(3, 11 / scale)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#e2e8f0';
            ctx.fillText(shorten(n.value, 24), n.x, n.y + r + 2 / scale);
          }
        }}
        nodePointerAreaPaint={(node: object, color: string, ctx: CanvasRenderingContext2D) => {
          const n = node as Pos;
          if (n.x === undefined || n.y === undefined) return;
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 3, 0, 2 * Math.PI); ctx.fill();
        }}
        onNodeHover={(n) => setHover(n ? String((n as unknown as GraphNode).id) : null)}
        onNodeClick={(n) => onSelect(n as unknown as GraphNode)}
        cooldownTicks={120}
      />
      <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg bg-slate-900/85 p-2 text-[11px] text-slate-300">
        <p className="font-semibold text-slate-100">{t('map.title')}</p>
        <p>{t('map.help')}</p>
        {truncated && <p className="mt-1 text-amber-300">{t('map.truncated')}</p>}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 max-w-xs rounded-lg bg-slate-900/85 p-2 text-[11px] text-slate-300">
        <p className="mb-1 font-semibold text-slate-100">{t('map.legend')}</p>
        <ul className="mb-1 space-y-0.5">
          {typesPresent.map((type) => (
            <li key={type} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[type] }} />{t(`type.${type}`)}
            </li>
          ))}
        </ul>
        <p>{t('map.big')}</p><p>{t('map.small')}</p><p>{t('map.ring')}</p>
        <p className="mt-0.5 flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-white" />{t('map.you')}</p>
      </div>
    </div>
  );
}
