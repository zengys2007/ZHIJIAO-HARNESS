import { useMemo } from "react";
import { useAppearance } from "../lib/appearance";
import type { TeachingPointSummary } from "../types/api";

const NODE_W = 96;
const NODE_H = 34;
const GAP_X = 28;
const GAP_Y = 64;
const PADDING = 16;
const MAX_NODES = 60;

type Layered = {
  point: TeachingPointSummary;
  layer: number;
  index: number;
  cyclic: boolean;
};

type Position = { x: number; y: number; layered: Layered };

/** 拓扑分层：无先修（或先修都不可达）为第 0 层；层级 = 1 + 最深先修层级。成环点聚到最后一层标红。 */
function layout(points: TeachingPointSummary[]): { rows: Layered[][]; byId: Map<string, Position> } {
  const usable = points.slice(0, MAX_NODES);
  const byName = new Map(usable.map((p) => [p.name, p]));
  const layerOf = new Map<string, number>();
  const cyclicNames = new Set<string>();

  function resolve(name: string, visiting: Set<string>): number {
    if (layerOf.has(name)) return layerOf.get(name)!;
    const point = byName.get(name);
    if (!point) return -1;
    if (visiting.has(name)) {
      for (const item of visiting) cyclicNames.add(item);
      return 0;
    }
    visiting.add(name);
    let depth = 0;
    for (const prereq of point.prerequisites) {
      if (byName.has(prereq)) depth = Math.max(depth, resolve(prereq, visiting) + 1);
    }
    visiting.delete(name);
    // 成环点不缓存层级（渲染时统一放到最后一层），避免把依赖它的点推到溢出层级
    if (!cyclicNames.has(name)) layerOf.set(name, depth);
    return depth;
  }

  for (const point of usable) resolve(point.name, new Set());

  const maxNormalLayer = Math.max(
    0,
    ...usable.filter((p) => !cyclicNames.has(p.name)).map((p) => layerOf.get(p.name) ?? 0),
  );
  const cyclicLayer = maxNormalLayer + 1;
  const layerOfRendered = (point: TeachingPointSummary) =>
    cyclicNames.has(point.name) ? cyclicLayer : layerOf.get(point.name) ?? 0;
  // 出现过的层号压缩成连续索引，避免稀疏行把 SVG 尺寸算成 NaN
  const layerOrder = [...new Set(usable.map(layerOfRendered))].sort((a, b) => a - b);
  const rowIndex = new Map(layerOrder.map((layer, index) => [layer, index]));
  const rows: Layered[][] = layerOrder.map(() => []);
  for (const point of usable) {
    const layer = rowIndex.get(layerOfRendered(point))!;
    const row = rows[layer];
    row.push({ point, layer, index: row.length, cyclic: cyclicNames.has(point.name) });
  }

  const positions = new Map<string, Position>();
  rows.forEach((row, layer) => {
    row.forEach((layered) => {
      positions.set(layered.point.point_id, {
        x: PADDING + layered.index * (NODE_W + GAP_X),
        y: PADDING + layer * (NODE_H + GAP_Y),
        layered,
      });
    });
  });
  return { rows, byId: positions };
}

export function PointGraph({ points, onSelect }: { points: TeachingPointSummary[]; onSelect: (pointId: string) => void }) {
  const { t } = useAppearance();
  const { rows, byId } = useMemo(() => layout(points), [points]);
  const truncated = points.length > MAX_NODES;
  const width = Math.max(200, ...rows.map((row) => PADDING * 2 + row.length * (NODE_W + GAP_X) - GAP_X));
  const height = PADDING * 2 + rows.length * (NODE_H + GAP_Y) - GAP_Y;

  const posByName = new Map([...byId.values()].map((pos) => [pos.layered.point.name, pos] as const));
  const edges = points.slice(0, MAX_NODES).flatMap((point) =>
    point.prerequisites.flatMap((prereqName) => {
      const from = posByName.get(prereqName);
      const to = byId.get(point.point_id);
      return from && to ? [{ from, to }] : [];
    }),
  );

  return (
    <div className="point-graph-wrap">
      {truncated ? <p className="teaching-notice">{t("graphTooMany")}</p> : null}
      <svg className="point-graph" width={width} height={Math.max(height, 120)} role="img" aria-label="知识点先修图谱">
        {edges.map((edge, i) => (
          <line
            key={i}
            className="point-edge"
            x1={edge.from.x + NODE_W / 2}
            y1={edge.from.y + NODE_H}
            x2={edge.to.x + NODE_W / 2}
            y2={edge.to.y}
          />
        ))}
        {rows.flatMap((row) =>
          row.map((layered) => {
            const pos = byId.get(layered.point.point_id)!;
            return (
              <g
                key={layered.point.point_id}
                className={"point-node" + (layered.cyclic ? " is-cyclic" : "")}
                transform={`translate(${pos.x}, ${pos.y})`}
                onClick={() => onSelect(layered.point.point_id)}
              >
                <rect className="point-node-box" width={NODE_W} height={NODE_H} rx={8} />
                <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle">
                  {layered.point.name}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}
