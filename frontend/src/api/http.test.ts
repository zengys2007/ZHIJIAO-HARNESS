import { afterEach, describe, expect, it, vi } from "vitest";
import { teachingApi } from "./http";

/** 构造只含 request() 所需字段（ok/status/text）的 Response 桩，不依赖运行环境提供 Response */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("teachingApi.batchImportPoints", () => {
  it("把文本原样发给批量导入端点，并解析新建数、跳过明细与自动补建的先修", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method, body: String(init?.body) });
        return jsonResponse({
          created: 3,
          skipped: [
            { line: 2, name: "通分", reason: "名称已存在" },
            { line: 5, name: "", reason: "名称为空" },
          ],
          ensured_prereqs: ["约分", "分数加减"],
        });
      }),
    );

    const text = "通分 | 化成同分母 | 约分\n分数乘除 | 乘除运算";
    const result = await teachingApi.batchImportPoints(text);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: "/api/teaching/points/batch",
      method: "POST",
      body: JSON.stringify({ text }),
    });
    expect(result).toEqual({
      created: 3,
      skipped: [
        { line: 2, name: "通分", reason: "名称已存在" },
        { line: 5, name: "", reason: "名称为空" },
      ],
      ensured_prereqs: ["约分", "分数加减"],
    });
  });

  it("skipped 或 ensured_prereqs 缺失时解析成空数组", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ created: 1 })));

    const result = await teachingApi.batchImportPoints("通分");

    expect(result).toEqual({ created: 1, skipped: [], ensured_prereqs: [] });
  });

  it("字段类型不对时落到防御性默认值，不抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ created: "3", skipped: [{ line: "x", name: 1 }], ensured_prereqs: [42, "约分"] })),
    );

    const result = await teachingApi.batchImportPoints("通分");

    expect(result).toEqual({
      created: 0,
      skipped: [{ line: 0, name: "", reason: "" }],
      ensured_prereqs: ["约分"],
    });
  });
});
