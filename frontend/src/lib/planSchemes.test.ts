import { describe, expect, it } from "vitest";
import { splitPlanSchemes } from "./planSchemes";

describe("splitPlanSchemes", () => {
  it("把方案标题拆成可单独选择的几套", () => {
    const text = [
      "先看班级情况。",
      "",
      "## 方案 A：活动导入",
      "适合：时间充裕。",
      "",
      "方案 B：精讲",
      "适合：课时紧。",
      "",
      "推荐：方案 B",
    ].join("\n");
    const split = splitPlanSchemes(text);
    expect(split.preface).toBe("先看班级情况。");
    expect(split.schemes.map((scheme) => scheme.title)).toEqual(["方案 A：活动导入", "方案 B：精讲"]);
    expect(split.schemes[1].recommended).toBe(true);
    expect(split.schemes[0].body).toBe("适合：时间充裕。");
    expect(split.schemes[0].recommended).toBe(false);
    expect(split.footer).toBe("推荐：方案 B");
  });

  it("方案正文里的推荐字段不会吞掉后面的方案", () => {
    const text = [
      "先按薄弱点给两套。",
      "",
      "**方案 A：一课时纠错**",
      "- 适合：课时紧。",
      "- 主要步骤：先批改再练。",
      "- **推荐**：人数少，一课时够用。",
      "",
      "**方案 B：两课时巩固**",
      "- 适合：还不稳定时。",
      "- 主要步骤：先约分再加减。",
      "- 不推荐：还不必拆成两课时。",
    ].join("\n");
    const split = splitPlanSchemes(text);
    expect(split.schemes.map((scheme) => scheme.title)).toEqual(["方案 A：一课时纠错", "方案 B：两课时巩固"]);
    expect(split.schemes[0].recommended).toBe(true);
    expect(split.schemes[1].recommended).toBe(false);
    expect(split.schemes[1].body).toContain("不推荐");
  });

  it("把表格里的每一行方案拆成可选项", () => {
    const text = [
      "两套方案的定位如下",
      "",
      "| 方案 | 名称 | 适合的情况 | 主线 |",
      "|---|---|---|---|",
      "| A | 先补约分 | 基础不牢 | 先练约分 |",
      "| B | 通分主线 | 保持原教案 | 先讲通分 |",
      "",
      "**可选第三套**：按评分标准反向自查。",
      "",
      "**推荐 A**：约分在通分之前。",
    ].join("\n");
    const split = splitPlanSchemes(text);
    expect(split.schemes.map((scheme) => scheme.title)).toEqual([
      "方案 A：先补约分",
      "方案 B：通分主线",
      "方案 C：可选第三套",
    ]);
    expect(split.schemes[0].recommended).toBe(true);
    expect(split.schemes[0].body).toContain("适合的情况：基础不牢");
    expect(split.preface).toContain("推荐 A");
    expect(split.preface).not.toContain("| A |");
  });

  it("加粗的方案一、方案二也能拆开，并按推荐选中", () => {
    const text = [
      "先看班级。",
      "",
      "**方案一：微调版**",
      "适合：课时紧。",
      "",
      "**方案二：重构版**",
      "适合：要重排。",
      "",
      "**推荐：方案一。**",
      "理由：先改检查步骤。",
    ].join("\n");
    const split = splitPlanSchemes(text);
    expect(split.schemes.map((scheme) => scheme.title)).toEqual(["方案一：微调版", "方案二：重构版"]);
    expect(split.schemes[0].recommended).toBe(true);
    expect(split.schemes[1].recommended).toBe(false);
    expect(split.schemes[0].body).toBe("适合：课时紧。");
    expect(split.schemes[1].body).toBe("适合：要重排。");
    expect(split.preface).toBe("先看班级。");
    expect(split.footer).toContain("推荐：方案一。");
    expect(split.footer).toContain("理由：先改检查步骤。");
  });

  it("没有两套方案时不拆", () => {
    expect(splitPlanSchemes("只写一段说明。").schemes).toEqual([]);
  });
});
