import { describe, expect, it } from "vitest";
import { codePointLength, conversationTitle } from "./text";

describe("教师原文", () => {
  it("按码位计数，并去掉首尾空白", () => {
    expect(codePointLength("  通分  ")).toBe(2);
    expect(codePointLength("a👍b")).toBe(3);
  });

  it("会话标题取第一行，超长时截断", () => {
    expect(conversationTitle("  这节课怎么讲通分\n第二行")).toBe("这节课怎么讲通分");
    expect(conversationTitle("一二三四五六七八九十一二三四五六七八九十")).toBe(
      "一二三四五六七八九十一二三四五六七八…",
    );
  });
});
