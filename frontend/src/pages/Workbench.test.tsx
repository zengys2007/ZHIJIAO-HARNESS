import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthUser, ConversationApi, ConversationMessage, PlanStatus, StreamEvent, TaskSnapshot } from "../types/api";
import type { GoalsApi } from "../types/goals";
import { ApiRequestError, DisconnectError, type ProbeRequest } from "../api/http";
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
  goalsApi?: GoalsApi;
  loadSources?: () => Promise<{ environment: { base_url: string; model: string; has_api_key: boolean }; dotenv: { base_url: string; model: string; has_api_key: boolean } }>;
  probe?: (body: ProbeRequest, signal?: AbortSignal) => Promise<{ reachable: boolean }>;
  logout?: () => Promise<void>;
  loginFn?: (username: string, password: string) => Promise<AuthUser>;
} = {}) {
  return render(
    <Workbench
      api={opts.api ?? immediateApi()}
      goalsApi={opts.goalsApi}
      loadSources={opts.loadSources}
      probe={opts.probe}
      getCurrentUser={noopUser}
      listConversationsAuth={noopList}
      loginFn={opts.loginFn}
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

  it("外观可以切换浅色、深色、跟随系统，以及中英文和字号", async () => {
    const user = userEvent.setup();
    const previous = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("dark"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      renderLoggedOut();
      await user.click(await screen.findByRole("button", { name: "未登录" }));
      await user.click(screen.getByRole("button", { name: "外观" }));

      expect(screen.getByRole("radio", { name: "浅色" }).getAttribute("aria-checked")).toBe("true");
      await user.click(screen.getByRole("radio", { name: "深色" }));
      expect(document.documentElement.dataset.theme).toBe("dark");

      await user.click(screen.getByRole("radio", { name: "跟随系统" }));
      expect(document.documentElement.dataset.themeChoice).toBe("system");
      expect(document.documentElement.dataset.theme).toBe("dark");

      await user.click(screen.getByRole("radio", { name: "English" }));
      expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Appearance" }).getAttribute("aria-current")).toBe("page");

      fireEvent.change(screen.getByRole("slider", { name: "Font size" }), { target: { value: "1.25" } });
      expect(document.documentElement.dataset.fontScale).toBe("1.25");
      const stored = JSON.parse(localStorage.getItem("zhijiao.appearance:v1") ?? "{}") as {
        theme: string;
        locale: string;
        fontScale: number;
      };
      expect(stored).toMatchObject({ theme: "system", locale: "en", fontScale: 1.25 });
    } finally {
      window.matchMedia = previous;
    }
  });

  it("API 配置去掉自行填写，可添加编辑删除本地提供商", async () => {
    const user = userEvent.setup();
    const calls: ProbeRequest[] = [];
    renderLoggedOut({
      loadSources: async () => ({
        environment: { base_url: "http://env.test/v1", model: "env-model", has_api_key: true },
        dotenv: { base_url: "", model: "", has_api_key: false },
      }),
      probe: async (body) => {
        calls.push(body);
        return { reachable: body.source === "local" };
      },
    });

    await user.click(await screen.findByRole("button", { name: "未登录" }));
    await user.click(screen.getByRole("button", { name: "API/MCPs配置" }));

    expect(screen.getByRole("heading", { name: "API/MCPs配置" })).toBeTruthy();
    expect(screen.getByText("本机环境")).toBeTruthy();
    expect(screen.queryByText("自行填写")).toBeNull();
    expect(screen.getByRole("button", { name: "添加模型提供商" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "编辑本机环境" }));
    expect(screen.getByRole("button", { name: "自定义设置" }).getAttribute("aria-expanded")).toBe("false");
    await user.click(screen.getByRole("button", { name: "自定义设置" }));
    expect(screen.getByRole("textbox", { name: "API 地址" })).toHaveProperty("disabled", true);
    expect(calls.some((c) => c.source === "local")).toBe(true);
    await user.click(screen.getByRole("button", { name: "取消" }));

    await user.click(screen.getByRole("button", { name: "添加模型提供商" }));
    await user.type(screen.getByRole("textbox", { name: "名称" }), "amazon-bedrock");
    await user.type(screen.getByRole("textbox", { name: "API 地址" }), "https://bedrock.example/v1");
    await user.type(screen.getByRole("textbox", { name: "模型" }), "bedrock-model");
    await user.click(screen.getByRole("button", { name: "添加" }));

    expect(screen.getByText("amazon-bedrock")).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑amazon-bedrock" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除amazon-bedrock" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "编辑amazon-bedrock" }));
    expect(screen.getByRole("button", { name: "自定义设置" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox", { name: "API 地址" })).toBeNull();
    const nameInput = screen.getByRole("textbox", { name: "名称" });
    await user.clear(nameInput);
    await user.type(nameInput, "bedrock-renamed");
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    const aliases = screen.getAllByRole("textbox", { name: "模型别名" });
    const labels = screen.getAllByRole("textbox", { name: "显示名称" });
    expect(aliases.length).toBeGreaterThan(1);
    await user.clear(aliases[1]);
    await user.type(aliases[1], "flash");
    await user.clear(labels[1]);
    await user.type(labels[1], "Flash");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("bedrock-renamed")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "编辑bedrock-renamed" }));
    expect(screen.getByDisplayValue("flash")).toBeTruthy();
    expect(screen.getByDisplayValue("Flash")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "取消" }));

    await user.click(screen.getByRole("button", { name: "删除bedrock-renamed" }));
    expect(screen.queryByText("bedrock-renamed")).toBeNull();
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

  it("流式回复逐段出现，结束后改成已保存的整段", async () => {
    const user = userEvent.setup();
    const taskId = "fedcba9876543210fedcba9876543210";
    let release: () => void = () => {};
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = streamingApi(taskId, async function* () {
      yield { event: "delta", text: "可以" };
      await opened;
      yield { event: "reset" };
      yield { event: "delta", text: "可以先举一个例子。" };
      yield { event: "done" };
    }, "可以先举一个例子。");
    renderLoggedIn({ api });

    await screen.findByRole("button", { name: "发送" });
    await user.type(screen.getByRole("textbox", { name: "消息" }), "这节课怎么讲通分");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("可以")).toBeTruthy();
    expect(screen.getByRole("button", { name: "正在回复" })).toHaveProperty("disabled", true);
    release();
    expect(await screen.findByText("可以先举一个例子。")).toBeTruthy();
    expect(screen.queryByText("可以")).toBeNull();
  });

  it("流式失败时去掉草稿并显示错误", async () => {
    const user = userEvent.setup();
    const taskId = "fedcba9876543210fedcba9876543211";
    const api = streamingApi(taskId, async function* () {
      yield { event: "delta", text: "半段" };
      yield {
        event: "error",
        code: "model_timeout",
        message: "模型响应超时，可以再发一次。",
        retryable: true,
      };
    }, null);
    renderLoggedIn({ api });

    await screen.findByRole("button", { name: "发送" });
    await user.type(screen.getByRole("textbox", { name: "消息" }), "再具体一点");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect((await screen.findByRole("alert")).textContent).toContain("模型响应超时，可以再发一次。");
    expect(screen.queryByText("半段")).toBeNull();
  });

  it("文字流中断后改回轮询并显示已保存回复", async () => {
    const user = userEvent.setup();
    const taskId = "fedcba9876543210fedcba9876543210";
    let opens = 0;
    const api = streamingApi(taskId, async function* () {
      opens += 1;
      if (opens === 1) yield { event: "delta", text: "半" };
    }, "完整回复");
    api.getTask = async () => (opens >= 2 ? succeeded("完整回复") : { ...succeeded("完整回复"), status: "running", reply: null });
    renderLoggedIn({ api });

    await screen.findByRole("button", { name: "发送" });
    await user.type(screen.getByRole("textbox", { name: "消息" }), "这节课怎么讲通分");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("完整回复")).toBeTruthy();
    expect(screen.queryByText("半")).toBeNull();
    expect(opens).toBe(2);
  });

  it("超过 4000 字仍会发送", async () => {
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

    expect(sent).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("加号菜单：计划在原输入框里显示灰色 plan，再点一次退出", async () => {
    const user = userEvent.setup();
    const modes: boolean[] = [];
    const api = scriptedApi([Promise.resolve(succeeded("预览回复"))]);
    const baseSetPlan = api.setPlanMode.bind(api);
    api.setPlanMode = async (id, enabled) => {
      modes.push(enabled);
      return baseSetPlan(id, enabled);
    };
    renderLoggedIn({ api });
    await screen.findByRole("button", { name: "发送" });

    expect(document.querySelector(".composer-plan")).toBeNull();
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /计划/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    const mark = document.querySelector(".composer .composer-plan");
    expect(mark?.textContent).toBe("plan");
    expect(document.querySelector(".composer-footer .composer-plan")).toBeNull();
    expect(document.querySelector(".composer-ask")).toBeNull();
    expect(modes).toEqual([true]);
    expect(screen.queryByRole("button", { name: "计划" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "新对话" }).length).toBeGreaterThan(1);

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /计划/ }));
    expect(document.querySelector(".composer-plan")).toBeNull();
    expect(modes).toEqual([true, false]);

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /计划/ }));
    expect(document.querySelector(".composer-plan")).toBeTruthy();
    await user.click(screen.getByRole("textbox", { name: "消息" }));
    await user.keyboard("{Backspace}");
    expect(document.querySelector(".composer-plan")).toBeNull();
    expect(document.querySelector(".plan-card")).toBeNull();
    expect(modes).toEqual([true, false, true, false]);
  });

  it("计划留在原输入框里，有正文后可在底栏按此生成", async () => {
    const user = userEvent.setup();
    const api = scriptedApi([Promise.resolve(succeeded("三道练习"))]);
    const sent: string[] = [];
    const modes: boolean[] = [];
    const baseSend = api.sendMessage.bind(api);
    api.sendMessage = async (id, content) => {
      sent.push(content);
      return baseSend(id, content);
    };
    const basePlan = api.setPlanMode.bind(api);
    api.setPlanMode = async (id, enabled) => {
      modes.push(enabled);
      return basePlan(id, enabled);
    };
    renderLoggedIn({ api });
    await screen.findByRole("button", { name: "发送" });

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /计划/ }));
    expect(document.querySelector(".plan-card")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "计划正文" })).toBeNull();
    expect(document.querySelector(".composer .composer-plan")?.textContent).toBe("plan");
    expect(screen.queryByRole("button", { name: "先写计划" })).toBeNull();

    const box = screen.getByRole("textbox", { name: "消息" });
    await user.type(box, "先写计划");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("三道练习")).toBeTruthy();
    expect(screen.getByRole("button", { name: "先写计划" })).toBeTruthy();

    const generate = screen.getByRole("button", { name: "按此生成" });
    expect(generate.closest(".bubble.assistant")).toBeTruthy();
    expect(generate.closest(".composer-footer")).toBeNull();
    expect(screen.getByText("点选一套方案，再生成成品。")).toBeTruthy();
    await user.click(generate);
    expect(sent).toEqual(["先写计划", "请按已确认的计划生成成品。"]);
    expect(screen.getByRole("button", { name: "先写计划" })).toBeTruthy();
    expect(document.querySelector(".plan-card")).toBeNull();
  });

  it("计划里的每套方案可以单独选中再生成", async () => {
    const user = userEvent.setup();
    const reply = ["先看班级。", "", "方案 A：活动导入", "适合时间充裕。", "", "方案 B：精讲", "适合课时紧。", "", "推荐：方案 B"].join("\n");
    const api = scriptedApi([
      Promise.resolve(succeeded(reply)),
      Promise.resolve({ ...succeeded("已按方案 A 生成。"), task_id: "fedcba9876543210fedcba9876543211" }),
    ]);
    const sent: string[] = [];
    const saved: string[] = [];
    const baseSend = api.sendMessage.bind(api);
    api.sendMessage = async (id, content) => {
      sent.push(content);
      return baseSend(id, content);
    };
    const baseSave = api.savePlanBody.bind(api);
    api.savePlanBody = async (id, body) => {
      saved.push(body);
      return baseSave(id, body);
    };
    renderLoggedIn({ api });
    await screen.findByRole("button", { name: "发送" });

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /计划/ }));
    await user.type(screen.getByRole("textbox", { name: "消息" }), "设计这节课");
    await user.click(screen.getByRole("button", { name: "发送" }));

    const second = await screen.findByRole("radio", { name: /方案 B/ });
    expect((second as HTMLInputElement).checked).toBe(true);

    const opener = screen
      .getAllByRole("button", { name: "新对话" })
      .find((button) => button.classList.contains("new-chat"));
    await user.click(opener!);
    expect(screen.queryByRole("radiogroup", { name: "方案" })).toBeNull();
    expect(screen.getByRole("heading", { name: "智教harness" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "设计这节课" }));
    expect(await screen.findByRole("radio", { name: /方案 A/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /方案 B/ })).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: /方案 A/ }));
    expect((screen.getByRole("radio", { name: /方案 A/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "按此生成" }));

    expect(saved[0]).toContain("方案 A：活动导入");
    expect(saved[0]).not.toContain("方案 B");
    expect(sent[1]).toContain("选用：方案 A：活动导入");
  });

  it("加号菜单：提问在原输入框里显示灰色 ask，再点一次或空退格退出，并退出计划", async () => {
    const user = userEvent.setup();
    const asked: boolean[] = [];
    const api = scriptedApi([Promise.resolve(succeeded("预览回复"))]);
    const baseAsk = api.setAskMode.bind(api);
    api.setAskMode = async (id, enabled) => {
      asked.push(enabled);
      return baseAsk(id, enabled);
    };
    renderLoggedIn({ api });
    await screen.findByRole("button", { name: "发送" });

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /计划/ }));
    expect(document.querySelector(".composer-plan")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /提问/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".composer .composer-ask")?.textContent).toBe("ask");
    expect(document.querySelector(".composer-plan")).toBeNull();
    expect(screen.getByRole("textbox", { name: "消息" })).toBeTruthy();
    expect(asked).toEqual([true]);

    const box = screen.getByRole("textbox", { name: "消息" });
    await user.type(box, "异分母怎么讲");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("预览回复")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menuitem", { name: /提问/ }).textContent).toContain("当前：提问");
    await user.click(screen.getByRole("menuitem", { name: /提问/ }));
    expect(document.querySelector(".composer-ask")).toBeNull();
    expect(asked).toEqual([true, false]);

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /提问/ }));
    await user.click(screen.getByRole("textbox", { name: "消息" }));
    await user.keyboard("{Backspace}");
    expect(document.querySelector(".composer-ask")).toBeNull();
    expect(asked).toEqual([true, false, true, false]);
  });

  it("加号菜单：未实现项点击后弹出尚未开放提示", async () => {
    const user = userEvent.setup();
    renderLoggedIn();
    await screen.findByRole("button", { name: "发送" });

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.queryByRole("menuitem", { name: /反馈/ })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: /压缩/ }));

    // 菜单关闭，出现 toast
    expect(screen.queryByRole("menu")).toBeNull();
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("该功能尚未开放");
  });

  it("可把文件拖入整个工作台加入附件条，并拒绝不支持类型", async () => {
    renderLoggedIn();
    await screen.findByRole("button", { name: "发送" });

    const surface = screen.getByTestId("workbench-drop");
    const doc = new File(["hello"], "教案.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const bad = new File(["x"], "病毒.exe", { type: "application/octet-stream" });

    fireEvent.dragEnter(surface, { dataTransfer: { types: ["Files"] } });
    expect(surface.className).toContain("is-drop-target");

    fireEvent.drop(surface, { dataTransfer: { files: [doc, bad], types: ["Files"] } });
    expect(screen.getByRole("list", { name: "附件" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "附件名称" })).toHaveProperty("value", "教案.docx");
    expect(screen.getByRole("status").textContent).toContain("只支持 Excel、Word、PDF 和图片。");
    expect(surface.className).not.toContain("is-drop-target");
  });

  it("加号菜单：文件项可选 Word/图片，文档可改名与移除，拒绝不支持类型", async () => {
    const user = userEvent.setup();
    renderLoggedIn();
    await screen.findByRole("button", { name: "发送" });

    const input = screen.getByLabelText("选择文件") as HTMLInputElement;
    const doc = new File(["hello"], "教案.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const image = new File(["img"], "板书.png", { type: "image/png" });
    const bad = new File(["x"], "病毒.exe", { type: "application/octet-stream" });

    await user.upload(input, [doc, image]);

    expect(screen.getByRole("list", { name: "附件" })).toBeTruthy();
    const nameInput = screen.getByRole("textbox", { name: "附件名称" }) as HTMLInputElement;
    expect(nameInput.value).toBe("教案.docx");
    expect(screen.getByText("板书.png")).toBeTruthy();

    // userEvent.upload 会按 accept 过滤；用不支持类型直接触发 change 测 toast
    fireEvent.change(input, { target: { files: [bad] } });
    expect(screen.getByRole("status").textContent).toContain("只支持 Excel、Word、PDF 和图片。");

    await user.clear(nameInput);
    await user.type(nameInput, "新教案.docx");
    expect(nameInput.value).toBe("新教案.docx");

    const removeButtons = screen.getAllByRole("button", { name: "移除附件" });
    expect(removeButtons).toHaveLength(2);
    await user.click(removeButtons[0]);
    expect(screen.queryByRole("textbox", { name: "附件名称" })).toBeNull();
    expect(screen.getByText("板书.png")).toBeTruthy();
  });

  it("加号菜单：模型项打开模型浮层，勾选后发送带 llm_source", async () => {
    const user = userEvent.setup();
    const sent: Array<{ content: string; options?: { llmSource?: "local" | "dotenv" } }> = [];
    const api = immediateApi();
    const originalSend = api.sendMessage.bind(api);
    api.sendMessage = async (conversationId, content, options) => {
      sent.push({ content, options });
      return originalSend(conversationId, content, options);
    };
    renderLoggedIn({
      api,
      loadSources: async () => ({
        environment: { base_url: "http://env.test/v1", model: "env-model", has_api_key: true },
        dotenv: { base_url: "", model: "", has_api_key: false },
      }),
      probe: async () => ({ reachable: true }),
    });
    await screen.findByRole("button", { name: "发送" });

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /模型/ }));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "模型" })).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索模型...")).toBeTruthy();
    expect(await screen.findByRole("option", { name: /env-model/ })).toBeTruthy();

    await user.click(screen.getByRole("option", { name: /env-model/ }));
    expect(screen.queryByRole("dialog", { name: "模型" })).toBeNull();

    await user.type(screen.getByLabelText("消息"), "用本机模型");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(sent.some((item) => item.content === "用本机模型" && item.options?.llmSource === "local")).toBe(
      true,
    );
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

  it("头像菜单：点击头像显示设置、切换账号与退出登录三个选项", async () => {
    const user = userEvent.setup();
    renderLoggedIn({ logout: async () => {} });
    const accountBtn = await screen.findByRole("button", { name: /王老师/ });

    // 点击头像弹出菜单，包含三个选项
    await user.click(accountBtn);
    expect(screen.getByRole("menuitem", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "切换账号" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeTruthy();

    // 设置项 → 进入设置导航
    await user.click(screen.getByRole("menuitem", { name: "设置" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "用户设置" })).toBeTruthy();

    // 重新打开菜单 → 退出登录 → 进入账号切换面板，记住的账号仍在
    await user.click(accountBtn);
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(await screen.findByRole("heading", { name: "切换账号" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /王老师/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加新账号" })).toBeTruthy();
  });

  it("头像菜单：切换账号 → 显示本机登录过的账号和添加新账号选项", async () => {
    const user = userEvent.setup();
    renderLoggedIn({ logout: async () => {} });
    const accountBtn = await screen.findByRole("button", { name: /王老师/ });

    await user.click(accountBtn);
    await user.click(screen.getByRole("menuitem", { name: "切换账号" }));

    // 账号切换面板：当前登录过的账号 + 添加新账号，侧栏变为未登录
    expect(await screen.findByRole("heading", { name: "切换账号" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /王老师/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加新账号" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "未登录" })).toBeTruthy();
  });

  it("切换账号：选账号输入密码登录，回到工作台", async () => {
    const user = userEvent.setup();
    const logins: Array<[string, string]> = [];
    renderLoggedIn({
      logout: async () => {},
      loginFn: async (username, password) => {
        logins.push([username, password]);
        return defaultUser;
      },
    });
    const accountBtn = await screen.findByRole("button", { name: /王老师/ });

    await user.click(accountBtn);
    await user.click(screen.getByRole("menuitem", { name: "切换账号" }));
    await user.click(await screen.findByRole("button", { name: /王老师/ }));

    await user.type(screen.getByLabelText("密码"), "teacher-pass-123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(logins).toEqual([["teacher", "teacher-pass-123"]]);
    // 登录成功回到工作台
    expect(await screen.findByRole("button", { name: "发送" })).toBeTruthy();
  });

  it("切换账号：已记住的账号点击后免密进入工作台", async () => {
    const user = userEvent.setup();
    const resumes: string[] = [];
    render(
      <Workbench
        api={immediateApi()}
        getCurrentUser={async () => null}
        listConversationsAuth={noopList}
        loginFn={async () => ({ user: defaultUser, remember_token: "token-1" })}
        logoutFn={async () => {}}
        resumeFn={async (token) => {
          resumes.push(token);
          return { user: defaultUser, remember_token: "token-2" };
        }}
      />,
    );

    await user.type(await screen.findByRole("textbox", { name: "用户名" }), "teacher");
    await user.type(screen.getByLabelText("密码"), "teacher-pass-123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    const accountBtn = await screen.findByRole("button", { name: /王老师/ });
    await user.click(accountBtn);
    await user.click(screen.getByRole("menuitem", { name: "切换账号" }));
    await user.click(await screen.findByRole("button", { name: /王老师/ }));

    expect(await screen.findByRole("button", { name: "发送" })).toBeTruthy();
    expect(screen.queryByLabelText("密码")).toBeNull();
    expect(resumes).toEqual(["token-1"]);
    const stored = JSON.parse(localStorage.getItem("zhijiao.remembered-accounts") ?? "[]") as Array<{
      token: string;
    }>;
    expect(stored[0]?.token).toBe("token-2");
  });

  it("切换账号：免密令牌失效时改为输入密码", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "zhijiao.remembered-accounts",
      JSON.stringify([{ username: "teacher", display_name: "王老师", token: "stale-token" }]),
    );
    const logins: Array<[string, string]> = [];
    render(
      <Workbench
        api={immediateApi()}
        getCurrentUser={async () => defaultUser}
        listConversationsAuth={noopList}
        logoutFn={async () => {}}
        loginFn={async (username, password) => {
          logins.push([username, password]);
          return { user: defaultUser, remember_token: "fresh-token" };
        }}
        resumeFn={async () => {
          throw new ApiRequestError("unauthenticated", "请先登录。", false, 401);
        }}
      />,
    );

    const accountBtn = await screen.findByRole("button", { name: /王老师/ });
    await user.click(accountBtn);
    await user.click(screen.getByRole("menuitem", { name: "切换账号" }));
    await user.click(await screen.findByRole("button", { name: /王老师/ }));

    expect(await screen.findByText("这个账号需要重新输入密码。")).toBeTruthy();
    await user.type(screen.getByLabelText("密码"), "teacher-pass-123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(logins).toEqual([["teacher", "teacher-pass-123"]]);
    expect(await screen.findByRole("button", { name: "发送" })).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem("zhijiao.remembered-accounts") ?? "[]") as Array<{
      token: string;
    }>;
    expect(stored[0]?.token).toBe("fresh-token");
  });

  it("切换账号：添加新账号 → 完整的登录/注册表单", async () => {
    const user = userEvent.setup();
    renderLoggedIn({ logout: async () => {} });
    const accountBtn = await screen.findByRole("button", { name: /王老师/ });

    await user.click(accountBtn);
    await user.click(screen.getByRole("menuitem", { name: "切换账号" }));
    await user.click(await screen.findByRole("button", { name: "添加新账号" }));

    // 回到常规登录表单：有用户名输入和去注册入口
    expect(await screen.findByRole("heading", { name: "登录" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "用户名" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "去注册" })).toBeTruthy();
  });

  it("置顶排到前面，删除当前会话后回到空白", async () => {
    const user = userEvent.setup();
    const older = "0123456789abcdef0123456789abcdef";
    const newer = "fedcba9876543210fedcba9876543210";
    let conversations: import("../types/api").ConversationSummary[] = [
      { conversation_id: newer, title: "新的课", created_at: "2026-11-03T02:00:00Z", pinned: false },
      { conversation_id: older, title: "通分", created_at: "2026-11-03T01:00:00Z", pinned: false },
    ];
    const pins: Array<[string, boolean]> = [];
    const deleted: string[] = [];
    const api = immediateApi();
    api.getConversation = async (id) => ({
      conversation_id: id,
      messages:
        id === older
          ? [
              {
                task_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                role: "user",
                content: "怎么讲通分",
                status: "succeeded",
                created_at: "2026-11-03T01:00:01Z",
              },
            ]
          : [],
      ask_mode: false,
      plan_mode: false,
      plan_status: "off",
      plan_body: "",
    });
    render(
      <Workbench
        api={api}
        getCurrentUser={noopUser}
        listConversationsAuth={async () => conversations.map((item) => ({ ...item }))}
        pinConversation={async (id, pinned) => {
          pins.push([id, pinned]);
          conversations = conversations.map((item) => (item.conversation_id === id ? { ...item, pinned } : item));
          conversations = [
            ...conversations.filter((item) => item.pinned),
            ...conversations.filter((item) => !item.pinned),
          ];
        }}
        deleteConversation={async (id) => {
          deleted.push(id);
          conversations = conversations.filter((item) => item.conversation_id !== id);
        }}
      />,
    );

    expect(await screen.findByRole("button", { name: "新的课" })).toBeTruthy();
    const olderRow = screen.getByRole("button", { name: "通分" }).closest("li");
    if (!olderRow) throw new Error("missing conversation row");
    await user.click(within(olderRow).getByRole("button", { name: "会话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "置顶" }));

    await waitFor(() => expect(pins).toEqual([[older, true]]));
    await waitFor(() => {
      const titles = screen.getAllByRole("button", { name: /通分|新的课/ }).map((node) => node.textContent);
      expect(titles[0]).toContain("通分");
    });
    expect(screen.getByRole("button", { name: "通分" }).querySelector(".session-pin")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "通分" }));
    expect(await screen.findByText("怎么讲通分")).toBeTruthy();
    const pinnedRow = screen.getByRole("button", { name: "通分" }).closest("li");
    if (!pinnedRow) throw new Error("missing pinned row");
    await user.click(within(pinnedRow).getByRole("button", { name: "会话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("heading", { name: "删除这个会话？" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("heading", { name: "删除这个会话？" })).toBeNull();
    expect(screen.getByText("怎么讲通分")).toBeTruthy();

    await user.click(within(pinnedRow).getByRole("button", { name: "会话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleted).toEqual([older]));
    expect(screen.queryByText("怎么讲通分")).toBeNull();
    expect(screen.queryByRole("button", { name: "通分" })).toBeNull();
    expect(screen.getByRole("button", { name: "新的课" })).toBeTruthy();
    expect(await screen.findByText("用一句话说说这节课。回复会出现在这里。")).toBeTruthy();
  });

  it("删除失败时留在确认框里，回复进行中不能删除当前会话", async () => {
    const user = userEvent.setup();
    const current = "0123456789abcdef0123456789abcdef";
    const api = immediateApi();
    api.sendMessage = () => new Promise(() => undefined);
    api.getConversation = async (id) => ({
      conversation_id: id,
      messages: [],
      ask_mode: false,
      plan_mode: false,
      plan_status: "off",
      plan_body: "",
    });
    render(
      <Workbench
        api={api}
        getCurrentUser={noopUser}
        listConversationsAuth={async () => [
          { conversation_id: current, title: "通分", created_at: "2026-11-03T01:00:00Z", pinned: false },
        ]}
        deleteConversation={async () => {
          throw new ApiRequestError("conflict", "这条会话还在回复，等它结束再删除。", false, 409);
        }}
      />,
    );

    const row = (await screen.findByRole("button", { name: "通分" })).closest("li");
    if (!row) throw new Error("missing conversation row");
    await user.click(within(row).getByRole("button", { name: "会话操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByText("这条会话还在回复，等它结束再删除。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "删除这个会话？" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "取消" }));

    await user.click(screen.getByRole("button", { name: "通分" }));
    await user.type(screen.getByRole("textbox", { name: "消息" }), "还在讲");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await user.click(within(row).getByRole("button", { name: "会话操作" }));
    const remove = screen.getByRole("menuitem", { name: "删除" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.getAttribute("title")).toBe("这条会话还在回复，等它结束再删除。");
    expect((screen.getByRole("menuitem", { name: "置顶" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("连不上后端时进入界面预览，发送后看到本地回复", async () => {
    const user = userEvent.setup();
    render(
      <Workbench
        getCurrentUser={async () => {
          throw new DisconnectError();
        }}
        listConversationsAuth={async () => {
          throw new Error("不应请求会话列表");
        }}
      />,
    );

    expect(await screen.findByText("本机服务未连接，当前只预览界面。")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "登录" })).toBeNull();

    await user.type(screen.getByRole("textbox", { name: "消息" }), "今天讲什么");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(
      await screen.findByText("本机服务还没接上。这是界面预览，正式回复会出现在这里。"),
    ).toBeTruthy();
  });

  it("点「＋」菜单的「目标」进入目标管理视图", async () => {
    const user = userEvent.setup();
    const goalsApi: GoalsApi = {
      listGoalTrees: async () => [],
      createGoalTree: async () => {
        throw new Error("不应调用");
      },
      getGoalTree: async () => {
        throw new Error("不应调用");
      },
      renameGoalTree: async () => {
        throw new Error("不应调用");
      },
      deleteGoalTree: async () => {},
      createGoalNode: async () => {
        throw new Error("不应调用");
      },
      updateGoalNode: async () => {
        throw new Error("不应调用");
      },
      deleteGoalNode: async () => {},
      reorderGoalNode: async () => {},
    };
    renderLoggedIn({ goalsApi });
    await screen.findByRole("button", { name: "发送" });

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: /目标管理/ }));
    expect(await screen.findByRole("region", { name: "目标管理" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "返回对话" }));
    expect(screen.queryByRole("region", { name: "目标管理" })).toBeNull();
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

function streamingApi(
  taskId: string,
  source: () => AsyncIterable<StreamEvent>,
  reply: string | null,
): ConversationApi {
  const api = immediateApi();
  let content = "";
  let settled = false;
  api.sendMessage = async (_conversationId, text) => {
    content = text;
    return { conversation_id: conversationId, task_id: taskId, status: "pending" };
  };
  api.streamTask = async function* () {
    for await (const event of source()) {
      if (event.event === "done" || event.event === "error") settled = true;
      yield event;
    }
    settled = true;
  };
  api.getTask = async () => {
    if (reply === null) return { ...failed("模型响应超时，可以再发一次。"), task_id: taskId };
    if (!settled) return { ...succeeded(reply), task_id: taskId, status: "running", reply: null };
    return { ...succeeded(reply), task_id: taskId };
  };
  api.getConversation = async () => {
    const user: ConversationMessage = {
      task_id: taskId,
      role: "user",
      content,
      status: settled ? (reply === null ? "failed" : "succeeded") : "running",
      created_at: "2026-10-21T10:00:00Z",
      ...(settled && reply === null
        ? { error: { code: "model_timeout", message: "模型响应超时，可以再发一次。", retryable: true } }
        : {}),
    };
    const messages: ConversationMessage[] = [user];
    if (settled && reply) {
      messages.push({
        task_id: taskId,
        role: "assistant",
        content: reply,
        status: "succeeded",
        created_at: "2026-10-21T10:00:01Z",
      });
    }
    return {
      conversation_id: conversationId,
      messages,
      ask_mode: false,
      plan_mode: false,
      plan_status: "off",
      plan_body: "",
    };
  };
  return api;
}

function scriptedApi(results: Array<Promise<TaskSnapshot>>): ConversationApi {
  const messages: ConversationMessage[] = [];
  let cursor = 0;
  let askMode = false;
  let planMode = false;
  let planStatus: PlanStatus = "off";
  let planBody = "";
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
        if (planStatus === "draft") planBody = task.reply;
        if (planStatus === "approved") {
          planStatus = "off";
          planMode = false;
        }
      }
      return { conversation_id: conversationId, task_id: task.task_id, status: "pending" };
    },
    async getConversation() {
      return {
        conversation_id: conversationId,
        messages: messages.slice(),
        ask_mode: askMode,
        plan_mode: planMode,
        plan_status: planStatus,
        plan_body: planBody,
      };
    },
    async getTask() {
      return results[Math.min(cursor - 1, results.length - 1)];
    },
    async approveCall() {},
    async rejectCall() {},
    async setAskMode(_conversationId, enabled) {
      askMode = enabled;
      if (enabled) {
        planMode = false;
        planStatus = "off";
      }
      return {
        conversation_id: conversationId,
        ask_mode: askMode,
        plan_mode: planMode,
        plan_status: planStatus,
        plan_body: planBody,
      };
    },
    async setPlanMode(_conversationId, enabled) {
      planMode = enabled;
      planStatus = enabled ? "draft" : "off";
      if (enabled) askMode = false;
      return {
        conversation_id: conversationId,
        ask_mode: askMode,
        plan_mode: planMode,
        plan_status: planStatus,
        plan_body: planBody,
      };
    },
    async savePlanBody(_conversationId, body) {
      planBody = body.trim();
      return { conversation_id: conversationId, plan_mode: planStatus === "draft", plan_status: planStatus, plan_body: planBody };
    },
    async generatePlan() {
      planStatus = "approved";
      planMode = false;
      return { conversation_id: conversationId, plan_mode: false, plan_status: planStatus, plan_body: planBody };
    },
  };
}
