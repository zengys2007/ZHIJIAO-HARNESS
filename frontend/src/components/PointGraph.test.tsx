import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceProvider } from "../lib/appearance";
import { PointGraph } from "./PointGraph";
import type { TeachingPointSummary } from "../types/api";

afterEach(cleanup);

const points: TeachingPointSummary[] = [
  { point_id: "p1", name: "分数加减", description: "", prerequisites: [] },
  { point_id: "p2", name: "约分", description: "", prerequisites: ["分数加减"] },
  { point_id: "p3", name: "通分", description: "", prerequisites: ["约分"] },
];

function renderGraph(pointList: TeachingPointSummary[], onSelect: (pointId: string) => void = () => {}) {
  return render(
    <AppearanceProvider>
      <PointGraph points={pointList} onSelect={onSelect} />
    </AppearanceProvider>,
  );
}

describe("PointGraph", () => {
  it("按先修分层渲染节点与连线", () => {
    renderGraph(points);

    expect(screen.getByText("分数加减")).toBeTruthy();
    expect(screen.getByText("约分")).toBeTruthy();
    expect(screen.getByText("通分")).toBeTruthy();
    // 三层各一个点：svg 里应有 3 个节点与 2 条先修连线
    const svg = document.querySelector("svg.point-graph");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("g.point-node").length).toBe(3);
    expect(svg!.querySelectorAll("line.point-edge").length).toBe(2);
  });

  it("点击节点回调 pointId", () => {
    const onSelect = vi.fn();
    renderGraph(points, onSelect);

    screen.getByText("约分").closest("g.point-node")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("成环的点标红", () => {
    const cyclic: TeachingPointSummary[] = [
      { point_id: "a", name: "甲", description: "", prerequisites: ["乙"] },
      { point_id: "b", name: "乙", description: "", prerequisites: ["甲"] },
    ];
    renderGraph(cyclic);

    const svg = document.querySelector("svg.point-graph");
    const marked = svg!.querySelectorAll("g.point-node.is-cyclic");
    expect(marked.length).toBe(2);
  });
});
