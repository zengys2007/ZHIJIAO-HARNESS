import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, DisconnectError } from "./http";
import { defaultGoalsApi } from "./goals";

function mockFetch(payload: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("goals api", () => {
  it("列出目标树并透传过滤参数", async () => {
    const fetchMock = mockFetch({
      trees: [{ tree_id: "a".repeat(32), subject: "数学", grade: 7, term: "上", title: "七上数学", created_at: "t", updated_at: "t" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const trees = await defaultGoalsApi.listGoalTrees({ subject: "数学" });
    expect(trees).toHaveLength(1);
    expect(trees[0].title).toBe("七上数学");
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://local");
    expect(url.searchParams.get("subject")).toBe("数学");
  });

  it("创建目标树（含 template_init）", async () => {
    const fetchMock = mockFetch({ tree_id: "b".repeat(32), subject: "语文", grade: 8, term: "下", title: "八下语文", created_at: "t", updated_at: "t" }, 201);
    vi.stubGlobal("fetch", fetchMock);
    const tree = await defaultGoalsApi.createGoalTree({ subject: "语文", grade: 8, term: "下", title: "八下语文", template_init: true });
    expect(tree.tree_id).toBe("b".repeat(32));
    const init = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(init.template_init).toBe(true);
  });

  it("读取整树（节点 + 树）", async () => {
    vi.stubGlobal("fetch", mockFetch({
      tree: { tree_id: "c".repeat(32), subject: "数学", grade: 7, term: "上", title: "t", created_at: "t", updated_at: "t" },
      nodes: [{
        node_id: "d".repeat(32), tree_id: "c".repeat(32), parent_id: null, level: "unit",
        title: "第一单元", description: "", standard_refs: [], verify_criteria: "",
        sort_order: 1, created_at: "t", updated_at: "t",
      }],
    }));
    const detail = await defaultGoalsApi.getGoalTree("c".repeat(32));
    expect(detail.nodes[0].level).toBe("unit");
  });

  it("错误正文转 ApiRequestError", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: { code: "invalid_input", message: "请选择初中九科之一。", retryable: false } }, 400));
    await expect(defaultGoalsApi.createGoalTree({ subject: "书法", grade: 7, term: "上", title: "x" }))
      .rejects.toBeInstanceOf(ApiRequestError);
  });

  it("后端未启动时抛 DisconnectError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    await expect(defaultGoalsApi.listGoalTrees({})).rejects.toBeInstanceOf(DisconnectError);
  });
});
