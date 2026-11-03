import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../api/http";
import type { StreamEvent, TaskSnapshot } from "../types/api";
import { followTask } from "./stream";

const running: TaskSnapshot = {
  task_id: "task",
  conversation_id: "conversation",
  status: "running",
  step_count: 1,
  last_event_type: "user_message",
  reply: null,
  error: null,
};

const succeeded: TaskSnapshot = { ...running, status: "succeeded", reply: "完整回复" };

describe("followTask", () => {
  it("没有 streamTask 时继续轮询", async () => {
    const task = await followTask({ getTask: async () => succeeded }, "task", () => {});
    expect(task.reply).toBe("完整回复");
  });

  it("done 之后读取已保存的任务", async () => {
    const seen: string[] = [];
    async function* streamTask(): AsyncGenerator<StreamEvent> {
      yield { event: "delta", text: "完" };
      yield { event: "delta", text: "整" };
      yield { event: "done" };
    }
    const task = await followTask({ streamTask, getTask: async () => succeeded }, "task", (text) => seen.push(text));
    expect(seen).toEqual(["完", "完整"]);
    expect(task).toBe(succeeded);
  });

  it("error 之后读取失败任务，不再往下轮询", async () => {
    const failed: TaskSnapshot = {
      ...running,
      status: "failed",
      reply: null,
      error: { code: "model_timeout", message: "模型响应超时，可以再发一次。", retryable: true },
    };
    let polls = 0;
    async function* streamTask(): AsyncGenerator<StreamEvent> {
      yield { event: "delta", text: "半段" };
      yield { event: "reset" };
      yield {
        event: "error",
        code: "model_timeout",
        message: "模型响应超时，可以再发一次。",
        retryable: true,
      };
    }
    const task = await followTask(
      {
        streamTask,
        getTask: async () => {
          polls += 1;
          return failed;
        },
      },
      "task",
      () => {},
    );
    expect(task.status).toBe("failed");
    expect(polls).toBe(1);
  });

  it("流断开两次后改回轮询", async () => {
    let opens = 0;
    const seen: string[] = [];
    const task = await followTask(
      {
        async *streamTask() {
          opens += 1;
          if (opens === 1) yield { event: "delta", text: "半" };
        },
        getTask: async () => (opens >= 2 ? succeeded : running),
      },
      "task",
      (text) => seen.push(text),
    );
    expect(opens).toBe(2);
    expect(seen).toEqual(["半"]);
    expect(task.reply).toBe("完整回复");
  });

  it("登录失败直接抛出", async () => {
    await expect(
      followTask(
        {
          async *streamTask() {
            throw new ApiRequestError("unauthenticated", "请先登录。", false, 401);
          },
          getTask: async () => succeeded,
        },
        "task",
        () => {},
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
