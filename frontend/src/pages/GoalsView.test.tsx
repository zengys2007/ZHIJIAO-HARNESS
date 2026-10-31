import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalsView } from "./GoalsView";
import type { GoalNode, GoalTree, GoalsApi } from "../types/goals";

const TREE: GoalTree = {
  tree_id: "a".repeat(32), subject: "数学", grade: 7, term: "上",
  title: "七上数学", created_at: "t1", updated_at: "t2",
};

const SEMESTER: GoalNode = {
  node_id: "b".repeat(32), tree_id: TREE.tree_id, parent_id: null, level: "semester",
  title: "数与代数：学期总目标", description: "d", standard_refs: [], verify_criteria: "c",
  sort_order: 1, created_at: "t1", updated_at: "t1",
};

const UNIT: GoalNode = {
  node_id: "c".repeat(32), tree_id: TREE.tree_id, parent_id: null, level: "unit",
  title: "第一单元 有理数", description: "", standard_refs: ["数与代数"], verify_criteria: "",
  sort_order: 2, created_at: "t1", updated_at: "t1",
};

const LESSON: GoalNode = {
  node_id: "d".repeat(32), tree_id: TREE.tree_id, parent_id: UNIT.node_id, level: "lesson",
  title: "第 1 课时 正数与负数", description: "", standard_refs: [], verify_criteria: "",
  sort_order: 1, created_at: "t1", updated_at: "t1",
};

function makeApi(overrides: Partial<GoalsApi> = {}): GoalsApi {
  return {
    listGoalTrees: vi.fn().mockResolvedValue([TREE]),
    createGoalTree: vi.fn(),
    getGoalTree: vi.fn().mockResolvedValue({ tree: TREE, nodes: [SEMESTER, UNIT, LESSON] }),
    renameGoalTree: vi.fn(),
    deleteGoalTree: vi.fn().mockResolvedValue(undefined),
    createGoalNode: vi.fn(),
    updateGoalNode: vi.fn(),
    deleteGoalNode: vi.fn().mockResolvedValue(undefined),
    reorderGoalNode: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("GoalsView", () => {
  it("列出目标树，打开后按「学期总目标/单元」分组展示三级", async () => {
    const api = makeApi();
    render(<GoalsView api={api} onBack={() => {}} />);
    expect(await screen.findByText("七上数学")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "打开" }));
    expect(await screen.findByText("数与代数：学期总目标")).toBeTruthy();
    expect(screen.getByText("第一单元 有理数")).toBeTruthy();
    expect(screen.getByText("第 1 课时 正数与负数")).toBeTruthy();
  });

  it("选中节点后可编辑保存", async () => {
    const updateGoalNode = vi.fn().mockResolvedValue({ ...UNIT, title: "第一单元（改）" });
    const api = makeApi({ updateGoalNode });
    render(<GoalsView api={api} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "打开" }));
    await userEvent.click(await screen.findByText("第一单元 有理数"));
    const title = screen.getByLabelText("标题") as HTMLInputElement;
    await userEvent.clear(title);
    await userEvent.type(title, "第一单元（改）");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateGoalNode).toHaveBeenCalledWith(UNIT.node_id, {
      title: "第一单元（改）", description: "", verify_criteria: "", standard_refs: ["数与代数"],
    }));
  });

  it("删除被引用节点时展示后端冲突信息", async () => {
    const api = makeApi({
      deleteGoalNode: vi.fn().mockRejectedValue(
        Object.assign(new Error(), { code: "conflict", message: "先删除或移走这条目标下的子目标。", retryable: false, status: 409 }),
      ),
    });
    render(<GoalsView api={api} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "打开" }));
    await userEvent.click(await screen.findByText("第一单元 有理数"));
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByText("先删除或移走这条目标下的子目标。")).toBeTruthy();
  });

  it("在单元下创建课时目标", async () => {
    const createGoalNode = vi.fn().mockResolvedValue(LESSON);
    const api = makeApi({ createGoalNode });
    render(<GoalsView api={api} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "打开" }));
    await userEvent.click(await screen.findByText("第一单元 有理数"));
    await userEvent.click(screen.getByRole("button", { name: "加课时目标" }));
    const title = screen.getByLabelText("标题") as HTMLInputElement;
    await userEvent.type(title, "第 2 课时 数轴");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(createGoalNode).toHaveBeenCalledWith(TREE.tree_id, {
      parent_id: UNIT.node_id, level: "lesson", title: "第 2 课时 数轴",
      description: "", verify_criteria: "", standard_refs: [],
    }));
  });
});
