import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthUser, ConversationApi, ConversationMessage, TaskSnapshot } from "../types/api";
import type { ProbeRequest } from "../api/http";
import { Workbench } from "./Workbench";

const conversationId = "0123456789abcdef0123456789abcdef";
const defaultUser: AuthUser = {
  user_id: "fedcba9876543210fedcba9876543210",
  username: "teacher",
  display_name: "王老师",
};
const noopUser = async () => defaultUser;
const noopList = async () => [];

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

/** 已登录的 Workbench 渲染辅助 */
function renderLoggedIn(opts: {
  api?: ConversationApi;
  loadSources?: () => Promise<{ environment: { base_url: string; model: string; has_api_key: boolean }; dotenv: { base_url: string; model: string; has_api_key: boolean } }>;
  probe?: (body: ProbeRequest, signal?: AbortSignal) => Promise<{ reachable: boolean }>;
  logout?: () => Promise<void>;
} = {}) {
  return render(
    <Workbench
      api={opts.api ?? immediateApi()}
      loadSources={opts.loadSources}
      probe={opts.probe}
      getCurrentUser={noopUser}
      listConversationsAuth={noopList}
      logoutFn={opts.logout}
    />,
  );
}

/** 未登录的 Workbench 渲染辅助 */
function renderLoggedOut(opts: {
  loadSources?: () => Promise<{ environment: { base_url: string; model: string; has_api_key: boolean }; dotenv: { base_url: string; model: string; has_api_key: boolean } }>;
  probe?: (body: ProbeRequest, signal?: AbortSignal) => Promise<{ reachable: boolean }>;
} = {}) {
  return render(
    <Workbench
      getCurrentUser={async () => null}
      listConversationsAuth={noopList}
      loadSources={opts.loadSources}
      probe={opts.probe}
    />,
  );
}

describe("工作台", () => {
  it("左下角显示未登录，点击后左侧变成设置导航", async () => {
    const user = userEvent.setup();
    renderLoggedOut();

    const accountBtn = await screen.findByRole("button", { name: "未登录" });
    expect(accountBtn.textContent).toContain("未登录");
    await user.click(accountBtn);

    expect(screen.queryByRole("button", { name: "新对话" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "用户设置" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { name: "用户设置" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "外观" }));
    expect(screen.getByRole("heading", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "用户设置" }).getAttribute("aria-current")).toBeNull();

    await user.click(screen.getByRole("button", { name: "API/MCPs配置" }));
    expect(screen.getByRole("heading", { name: "API/MCPs配置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "外观" }).getAttribute("aria-current")).toBeNull();

    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("heading", { name: "登录" })).toBeTruthy();
  });

  it("API 配置的本机环境读环境变量，自行填写读 .env", async () => {
    const user = userEvent.setup();
    const calls: ProbeRequest[] = [];
    renderLoggedOut({
      loadSources: async () => ({
        environment: { base_url: "http://env.test/v1", model: "env-model", has_api_key: true },
        dotenv: { base_url: "http://file.test/v1", model: "file-model", has_api_key: true },
      }),
      probe: async (body) => {
        calls.push(body);
        return { reachable: body.source === "local" };
      },
    });

    await user.click(await screen.findByRole("button", { name: "未登录" }));
    await user.click(screen.getByRole("button", { name: "API/MCPs配置" }));

    expect(screen.getByRole("radio", { name: "本机环境" })).toHaveProperty("checked", true);
    expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveProperty("value", "http://env.test/v1");
    expect((await screen.findByRole("status")).textContent).toContain("已联通");
    expect(calls[0]).toEqual({ source: "local" });

    await user.click(screen.getByRole("radio", { name: "自行填写" }));
    expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveProperty("value", "http://file.test/v1");
    expect(screen.getByRole("textbox", { name: "模型" })).toHaveProperty("value", "file-model");
    expect(await screen.findByText("连不上这个模型服务。")).toBeTruthy();
    expect(calls.at(-1)).toEqual({
      source: "dotenv",
      base_url: "http://file.test/v1",
      model: "file-model",
    });
  });

  it("空会话显示名称和引导", async () => {
    renderLoggedIn();

    expect(await screen.findByRole("heading", { name: "智教harness" })).toBeTruthy();
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
    renderLoggedIn({ api });

    await screen.findByRole("button", { name: "发送" });
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
    renderLoggedIn({ api });

    await screen.findByRole("button", { name: "发送" });
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
    renderLoggedIn({ api });

    await screen.findByRole("button", { name: "发送" });
    await user.click(screen.getByRole("textbox", { name: "消息" }));
    await user.paste("课".repeat(4001));
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByRole("alert").textContent).toContain("请把这句话写成 1 到 4000 字后再发送。");
    expect(sent).toBe(0);
  });

  it("加号菜单：权限项与左下角审批控制器同步切换", async () => {
    const user = userEvent.setup();
    renderLoggedIn();
    await screen.findByRole("button", { name: "发送" });

    // 初始为手动审批
    expect(screen.getByRole("button", { name: "审批模式" }).textContent).toContain("手动审批");

    // 打开加号菜单，点权限项切换
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menuitem", { name: /权限/ }).textContent).toContain("当前：手动审批");
    await user.click(screen.getByRole("menuitem", { name: /权限/ }));

    // 左下角审批控制器同步变为自动执行
    expect(screen.getByRole("button", { name: "审批模式" }).textContent).toContain("自动执行");
    // 菜单项描述同步更新
    expect(screen.getByRole("menuitem", { name: /权限/ }).textContent).toContain("当前：自动执行");
  });

  it("加号菜单：未实现项点击后弹出尚未开放提示", async () => {
    const user = userEvent.setup();
    renderLoggedIn();
    await screen.findByRole("button", { name: "发送" });

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /模型/ }));

    // 菜单关闭，出现 toast
    expect(screen.queryByRole("menu")).toBeNull();
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("该功能尚未开放");
  });

  it("登录界面：一键填充演示账号（只填充不登录）", async () => {
    const user = userEvent.setup();
    renderLoggedOut();
    const usernameInput = (await screen.findByLabelText(/用户名/)) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/密码/) as HTMLInputElement;

    await user.click(screen.getByRole("button", { name: "填充演示账号" }));

    expect(usernameInput.value).toBe("smoketest");
    expect(passwordInput.value).toBe("smoke-test-123");
    // 不自动提交：仍停留在登录表单
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
  });

  it("头像菜单：点击头像显示设置与退出登录两个选项", async () => {
    const user = userEvent.setup();
    renderLoggedIn({ logout: async () => {} });
    const accountBtn = await screen.findByRole("button", { name: /王老师/ });

    // 点击头像弹出菜单，包含两个选项
    await user.click(accountBtn);
    expect(screen.getByRole("menuitem", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeTruthy();

    // 设置项 → 进入设置导航
    await user.click(screen.getByRole("menuitem", { name: "设置" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "用户设置" })).toBeTruthy();

    // 重新打开菜单 → 退出登录 → 回到登录表单
    await user.click(accountBtn);
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
    await screen.findByRole("button", { name: "登录" });
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
    async approveCall() {},
    async rejectCall() {},
  };
}
