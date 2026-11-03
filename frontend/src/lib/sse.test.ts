import { describe, expect, it } from "vitest";
import { parseSseChunk, reduceStreamText } from "./sse";
import type { StreamEvent } from "../types/api";

describe("文字流", () => {
  it("snapshot 和 reset 替换草稿，delta 接在后面", () => {
    const snapshot: StreamEvent = { event: "snapshot", text: "你好" };
    const delta: StreamEvent = { event: "delta", text: "呀" };
    const reset: StreamEvent = { event: "reset" };
    expect(reduceStreamText("旧", snapshot)).toBe("你好");
    expect(reduceStreamText("你好", delta)).toBe("你好呀");
    expect(reduceStreamText("你好呀", reset)).toBe("");
    expect(reduceStreamText("你好", { event: "done" })).toBe("你好");
  });

  it("按事件切块，半截留到下一次", () => {
    const raw = 'event: delta\ndata: {"text":"你"}\n\nevent: snapshot\ndata: {"text":"你好"}';
    const parsed = parseSseChunk(raw);
    expect(parsed.events).toEqual([{ event: "delta", text: "你" }]);
    expect(parsed.rest).toBe('event: snapshot\ndata: {"text":"你好"}');
    expect(parseSseChunk(parsed.rest + "\n\n").events).toEqual([{ event: "snapshot", text: "你好" }]);
  });

  it("读取 reset、done 和 error", () => {
    const raw = [
      "event: reset",
      "data: {}",
      "",
      "event: error",
      'data: {"code":"model_timeout","message":"模型响应超时，可以再发一次。","retryable":true}',
      "",
      "event: done",
      "data: {}",
      "",
      "",
    ].join("\n");
    expect(parseSseChunk(raw).events).toEqual([
      { event: "reset" },
      {
        event: "error",
        code: "model_timeout",
        message: "模型响应超时，可以再发一次。",
        retryable: true,
      },
      { event: "done" },
    ]);
  });
});
