import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../api/http";
import { AppearanceProvider } from "../lib/appearance";
import type { TeachingApi, TeachingPointSummary } from "../types/api";
import { TeachingPanel } from "./TeachingPanel";

const POINT_ADD = "0123456789abcdef0123456789abcdef";
const POINT_REDUCE = "fedcba9876543210fedcba9876543210";

const points: TeachingPointSummary[] = [
  { point_id: POINT_ADD, name: "分数加减", description: "同分母分数的加减运算", prerequisites: [] },
  { point_id: POINT_REDUCE, name: "约分", description: "", prerequisites: ["分数加减"] },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

function makeApi(overrides: Partial<TeachingApi> = {}): TeachingApi {
  return {
    loadOverview: async () => ({ classes: [], knowledge_points: points, assignments: [], documents: [] }),
    loadInsights: async () => ({ classes: [] }),
    createClass: async () => ({ class_id: "c1" }),
    createPoint: async () => ({ point_id: "p3" }),
    createAssignment: async () => ({ assignment_id: "a1" }),
    createDocument: async () => ({ document_id: "d1" }),
    updatePoint: async () => {},
    deletePoint: async () => {},
    batchImportPoints: async () => ({ created: 0, skipped: [], ensured_prereqs: [] }),
    ...overrides,
  };
}

function renderPanel(api: TeachingApi) {
  return render(
    <AppearanceProvider>
      <TeachingPanel api={api} onDraft={() => {}} />
    </AppearanceProvider>,
  );
}

/** 切到「知识点」标签，等数据加载完成后返回「约分」所在的列表项 */
async function openPointsTab() {
  const user = userEvent.setup();
  await screen.findByRole("tab", { name: "知识点" });
  await user.click(screen.getByRole("tab", { name: "知识点" }));
  const article = (await screen.findByText("约分")).closest("article")!;
  return { user, article };
}

describe("教学面板·知识点", () => {
  it("点编辑展开内联表单，改名保存后带先修调用 updatePoint", async () => {
    const updatePoint = vi.fn(async () => {});
    renderPanel(makeApi({ updatePoint }));
    const { user, article } = await openPointsTab();

    await user.click(within(article).getByRole("button", { name: "编辑" }));

    const nameInput = within(article).getByLabelText("名称") as HTMLInputElement;
    expect(nameInput.value).toBe("约分");
    expect((within(article).getByLabelText(/先修知识点/) as HTMLInputElement).value).toBe("分数加减");

    await user.clear(nameInput);
    await user.type(nameInput, "最简分数");
    await user.click(within(article).getByRole("button", { name: "保存修改" }));

    expect(updatePoint).toHaveBeenCalledWith(POINT_REDUCE, "最简分数", "", ["分数加减"]);
    expect(await screen.findByText("知识点已更新。")).toBeTruthy();
  });

  it("保存失败时编辑表单保持展开，并在表单下方显示错误行", async () => {
    const updatePoint = vi.fn(async () => {
      throw new ApiRequestError("conflict", "这个知识点名称已经存在。", false, 409);
    });
    renderPanel(makeApi({ updatePoint }));
    const { user, article } = await openPointsTab();

    await user.click(within(article).getByRole("button", { name: "编辑" }));
    await user.click(within(article).getByRole("button", { name: "保存修改" }));

    expect(await within(article).findByText("这个知识点名称已经存在。")).toBeTruthy();
    // 表单未收起，可改完再存
    expect(within(article).getByRole("button", { name: "保存修改" })).toBeTruthy();
  });

  it("删除先弹确认，取消则不调用接口", async () => {
    const deletePoint = vi.fn(async () => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel(makeApi({ deletePoint }));
    const { user, article } = await openPointsTab();

    await user.click(within(article).getByRole("button", { name: "删除" }));

    expect(confirmSpy).toHaveBeenCalledWith("删除这个知识点？没有成绩记录才能删除。");
    expect(deletePoint).not.toHaveBeenCalled();
  });

  it("已有成绩记录的知识点删除被 409 拦截，显示拦截提示", async () => {
    const deletePoint = vi.fn(async () => {
      throw new ApiRequestError("conflict", "该知识点已有成绩记录，不能删除。", false, 409);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel(makeApi({ deletePoint }));
    const { user, article } = await openPointsTab();

    await user.click(within(article).getByRole("button", { name: "删除" }));

    expect(deletePoint).toHaveBeenCalledWith(POINT_REDUCE);
    expect(await screen.findByText("该知识点已有成绩记录，不能删除。")).toBeTruthy();
  });

  it("批量导入：先解析预览，确认后提交整段文本并显示结果摘要", async () => {
    const batchImportPoints = vi.fn(async () => ({
      created: 2,
      skipped: [{ line: 3, name: "通分", reason: "名称已存在" }],
      ensured_prereqs: ["约分"],
    }));
    renderPanel(makeApi({ batchImportPoints }));
    const { user } = await openPointsTab();

    await user.click(screen.getByText("批量导入"));
    const textarea = screen.getByPlaceholderText(/每行一个知识点/) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "通分 | 化成同分母 | 约分,分数加减\n分数乘除 | 乘除运算\n通分 | 重复" },
    });

    await user.click(screen.getByRole("button", { name: "解析预览" }));
    expect(screen.getByText(/第 1 行：通分（先修：约分、分数加减）/)).toBeTruthy();
    expect(screen.getByText(/第 2 行：分数乘除/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "确认导入" }));
    expect(batchImportPoints).toHaveBeenCalledWith("通分 | 化成同分母 | 约分,分数加减\n分数乘除 | 乘除运算\n通分 | 重复");
    expect(await screen.findByText(/导入完成：新建 2，跳过 1，自动补建先修 1/)).toBeTruthy();
    expect(screen.getByText(/第 3 行 通分：名称已存在/)).toBeTruthy();
    // 导入完成后清空输入与预览
    expect(textarea.value).toBe("");
    expect(screen.queryByText(/第 1 行：通分/)).toBeNull();
  });

  it("视图切换到图谱显示分层图，点节点回到列表并展开编辑", async () => {
    renderPanel(makeApi());
    const { user } = await openPointsTab();

    await user.click(screen.getByRole("button", { name: "图谱" }));
    expect(document.querySelector("svg.point-graph")).not.toBeNull();
    // 图谱视图里没有列表项的编辑/删除入口，节点以图谱文本呈现
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.getByText("约分").closest("g.point-node")).not.toBeNull();

    fireEvent.click(screen.getByText("约分").closest("g.point-node")!);
    const article = (await screen.findByText("约分")).closest("article")!;
    expect(within(article).getByRole("button", { name: "保存修改" })).toBeTruthy();
    expect((within(article).getByLabelText("名称") as HTMLInputElement).value).toBe("约分");
  });
});
