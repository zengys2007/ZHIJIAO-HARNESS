import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationApi, ConversationMessage, TaskSnapshot } from "../types/api";
import { Workbench } from "./Workbench";

const conversationId = "0123456789abcdef0123456789abcdef";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("工作台", () => {
  it("空会话显示名称和引导", () => {
    render(<Workbench api={immediateApi()} />);

    expect(screen.getByRole("heading", { name: "智教harness" })).toBeTruthy();
    expect(screen.getByText("用一句话说说这节课。回复会出现在这里。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送" })).toHaveProperty("disabled", true);
  });

  it("进行中不能再次发送，结束后能看到回复", async () => {
    const user = userEvent.setup();
    let release: (task: TaskSnapshot) => void = () => {};
    const gate = new Promise<TaskSnapshot>((resolve) => {
      release = resolve;
    });
    const api = scriptedApi([gate]);
    render(<Workbench api={api} />);

    await user.type(screen.getByRole("textbox", { name: "消息" }), "这节课怎么讲通分");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getAllByText("这节课怎么讲通分").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "正在回复" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("status").textContent).toContain("正在回复");

    release(succeeded("可以先用同一块饼分成不同份数。"));
    expect(await screen.findByText("可以先用同一块饼分成不同份数。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送" })).toHaveProperty("disabled", true);
  });

  it("失败时保留已成功的回复，并给出可重试说明", async () => {
    const user = userEvent.setup();
    const api = scriptedApi([
      Promise.resolve(succeeded("可以先用同一块饼分成不同份数。")),
      Promise.resolve(failed("模型响应超时，可以再发一次。")),
    ]);
    render(<Workbench api={api} />);

    await user.type(screen.getByRole("textbox", { name: "消息" }), "这节课怎么讲通分");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("可以先用同一块饼分成不同份数。")).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "消息" }), "再具体一点");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect((await screen.findByRole("alert")).textContent).toContain("模型响应超时，可以再发一次。");
    expect(screen.getByText("可以先用同一块饼分成不同份数。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送" })).toHaveProperty("disabled", true);
  });

  it("超过 4000 字时不发送", async () => {
    const user = userEvent.setup();
    let sent = 0;
    const api = immediateApi();
    const original = api.sendMessage.bind(api);
    api.sendMessage = async (...args) => {
      sent += 1;
      return original(...args);
    };
    render(<Workbench api={api} />);

    await user.click(screen.getByRole("textbox", { name: "消息" }));
    await user.paste("课".repeat(4001));
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByRole("alert").textContent).toContain("请把这句话写成 1 到 4000 字后再发送。");
    expect(sent).toBe(0);
  });
});

function succeeded(reply: string): TaskSnapshot {
  return {
    task_id: "fedcba9876543210fedcba9876543210",
    conversation_id: conversationId,
    status: "succeeded",
    step_count: 1,
    last_event_type: "assistant_message",
    reply,
    error: null,
  };
}

function failed(message: string): TaskSnapshot {
  return {
    task_id: "fedcba9876543210fedcba9876543211",
    conversation_id: conversationId,
    status: "failed",
    step_count: 1,
    last_event_type: "assistant_message",
    reply: null,
    error: { code: "model_timeout", message, retryable: true },
  };
}

function immediateApi(): ConversationApi {
  return scriptedApi([Promise.resolve(succeeded("预览回复"))]);
}

function scriptedApi(results: Array<Promise<TaskSnapshot>>): ConversationApi {
  const messages: ConversationMessage[] = [];
  let cursor = 0;
  return {
    async createConversation() {
      return { conversation_id: conversationId };
    },
    async sendMessage(_conversationId, content) {
      const task = await results[Math.min(cursor, results.length - 1)];
      cursor += 1;
      const createdAt = `2026-10-21T10:00:0${messages.length}Z`;
      messages.push({
        task_id: task.task_id,
        role: "user",
        content,
        status: task.status,
        created_at: createdAt,
        ...(task.error ? { error: task.error } : {}),
      });
      if (task.status === "succeeded" && task.reply) {
        messages.push({
          task_id: task.task_id,
          role: "assistant",
          content: task.reply,
          status: "succeeded",
          created_at: createdAt,
        });
      }
      return { conversation_id: conversationId, task_id: task.task_id, status: "pending" };
    },
    async getConversation() {
      return { conversation_id: conversationId, messages: messages.slice() };
    },
    async getTask() {
      return results[Math.min(cursor - 1, results.length - 1)];
    },
  };
}
