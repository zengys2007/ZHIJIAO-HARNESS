import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type Locale = "zh" | "en";

export type Appearance = {
  theme: ThemeChoice;
  locale: Locale;
  fontScale: number;
};

const STORAGE_KEY = "zhijiao.appearance:v1";
export const FONT_MIN = 0.875;
export const FONT_MAX = 1.25;
const FONT_DEFAULT = 1;

const zh = {
  confirmingLogin: "正在确认登录…",
  signedOut: "未登录",
  settings: "设置",
  switchAccount: "切换账号",
  logOut: "退出登录",
  accountMenu: "账号操作",
  newChat: "新对话",
  signInFirst: "请先登录。",
  previewOffline: "本机服务未连接，当前只预览界面。",
  noSessions: "还没有会话",
  sessionActions: "会话操作",
  pin: "置顶",
  unpin: "取消置顶",
  deleteSession: "删除",
  deleteSessionTitle: "删除这个会话？",
  deleteSessionBody: "会话和其中的消息会永久删除，不能恢复。",
  cancel: "取消",
  deletingSession: "正在删除…",
  deleteBusy: "这条会话还在回复，等它结束再删除。",
  back: "返回",
  userSettings: "用户设置",
  appearance: "外观",
  connections: "API/MCPs配置",
  theme: "主题",
  themeLight: "浅色",
  themeDark: "深色",
  themeSystem: "跟随系统",
  language: "语言",
  fontSize: "字体大小",
  fontSmall: "小",
  fontLarge: "大",
  displayName: "显示名",
  username: "用户名",
  password: "密码",
  signIn: "登录",
  register: "注册",
  signingIn: "正在登录",
  signingUp: "正在注册",
  noAccount: "没有账号？",
  goRegister: "去注册",
  hasAccount: "已有账号？",
  goLogin: "去登录",
  fillDemo: "填充演示账号",
  displayNameOptional: "（可空，留空则使用用户名）",
  usernameError: "用户名写成 1 到 32 个字，中间不要有空格。",
  passwordError: "密码写成 8 到 128 个字。",
  displayNameError: "显示名写成 1 到 32 个字。",
  message: "消息",
  draftPlaceholder: "写下这节课想解决的问题",
  send: "发送",
  replying: "正在回复",
  enterHint: "Enter 发送，Shift+Enter 换行",
  contextUsage: "上下文用量",
  contextUsed: "已用",
  contextRemaining: "剩余",
  contextLimit: "上限",
  contextOutput: "输出上限",
  contextProvider: "上限来自模型供应商",
  contextFallback: "供应商未返回上限，按 1M 计算",
  contextCompressed: "较早的对话已压成摘要",
  contextPartSystem: "系统",
  contextPartTools: "工具",
  contextPartContext: "资料",
  contextPartSummary: "摘要",
  contextPartConversation: "对话",
  contextPartAsk: "提问",
  contextPartPlan: "计划",
  contextPartDraft: "草稿",
  conversation: "对话",
  reading: "正在读取这段对话。",
  emptyHint: "用一句话说说这节课。回复会出现在这里。",
  me: "我",
  noRemembered: "本机还没有登录过的账号。",
  addAccount: "添加新账号",
  otherAccount: "选择其他账号",
  resumeExpired: "这个账号需要重新输入密码。",
  systemError: "系统出错了，可以再发一次。",
  more: "更多操作",
  unavailable: "该功能尚未开放",
  add: "添加",
  file: "文件",
  attachments: "附件",
  renameAttachment: "附件名称",
  removeAttachment: "移除附件",
  unsupportedFile: "只支持 Excel、Word、PDF 和图片。",
  chooseFile: "选择文件",
  ask: "提问",
  askDesc: "只回答问题，不生成成品",
  askPlaceholder: "直接提问，不生成试题、评语或课件",
  goalManage: "目标管理",
  goalManageDesc: "编辑学期、单元与课时目标",
  save: "保存",
  plan: "计划",
  planDesc: "进入或退出计划模式",
  planBody: "计划正文",
  planPlaceholder: "写出可审阅的计划，确认后再生成成品",
  planSave: "保存修改",
  planGenerate: "按此生成",
  planGenerateNote: "点选一套方案，再生成成品。",
  planExit: "退出计划",
  planEmpty: "还没有可确认的计划，先写出计划再生成。",
  planGenerateMessage: "请按已确认的计划生成成品。",
  commands: "指令",
  compact: "压缩",
  compactDesc: "压缩以上对话内容",
  permission: "权限",
  model: "模型",
  modelDesc: "选择本会话使用的模型",
  searchModels: "搜索模型...",
  noModels: "暂无可用模型，请先在设置中配置",
  modelListFailed: "加载模型列表失败",
  exportLogs: "下载日志",
  exportDesc: "将当前会话内容导出为 ZIP",
  manual: "手动审批",
  automatic: "自动执行",
  manualHint: "每次工具调用都要确认",
  automaticHint: "直接执行所有工具调用",
  approvalMode: "审批模式",
  chooseApproval: "选择审批模式",
  currentPrefix: "当前：",
  apiLead: "填入各提供商的 API 密钥即可使用其模型。",
  providerName: "名称",
  providerNameMissing: "提供商名称",
  confirmAdd: "添加",
  deleteProvider: "删除",
  addProviderTitle: "添加模型提供商",
  source: "接口来源",
  localEnv: "本机环境",
  customEnv: "自行填写",
  edit: "编辑",
  collapse: "收起",
  addProvider: "添加模型提供商",
  unsetShort: "未配置",
  serviceUrl: "服务地址",
  apiAddress: "API 地址",
  apiKeyLabel: "API 密钥",
  customSettings: "自定义设置",
  apiAddressHint: "请填写兼容 OpenAI Chat Completions 的 API 地址。",
  modelCatalog: "模型目录",
  modelCatalogHint: "正在使用适配器默认模型",
  modelAlias: "模型别名",
  modelLabel: "显示名称",
  addModel: "添加模型",
  cancel: "取消",
  save: "保存",
  keyWarnMissing: "未检测到环境变量。请填写 API 密钥，或设置环境变量。",
  keyLeaveBlank: "留空使用环境认证",
  removeModel: "移除模型",
  modelName: "模型",
  secret: "密钥",
  connected: "联通",
  checking: "正在检测",
  reachable: "已联通",
  unreachable: "连不上这个模型服务。",
  offlineService: "暂时连不上本机服务。",
  unsetEnv: "未配置环境变量",
  notChecked: "未检测",
  keyKeep: "留空则使用 .env 里的密钥",
  keyEnter: "填写密钥",
  keyFromEnv: "来自环境变量",
  keyMissing: "未设置环境变量",
  mcpNote: "MCP 还没有接入。页面不显示密钥。",
  urlMissing: "未设置环境变量",
  modelMissing: "模型名称",
  toolCalls: "工具调用列表",
};

const en: Record<keyof typeof zh, string> = {
  confirmingLogin: "Checking sign-in…",
  signedOut: "Signed out",
  settings: "Settings",
  switchAccount: "Switch account",
  logOut: "Log out",
  accountMenu: "Account",
  newChat: "New chat",
  signInFirst: "Sign in first.",
  previewOffline: "The local service is offline. This is only a preview.",
  noSessions: "No conversations yet",
  sessionActions: "Conversation actions",
  pin: "Pin",
  unpin: "Unpin",
  deleteSession: "Delete",
  deleteSessionTitle: "Delete this conversation?",
  deleteSessionBody: "The conversation and its messages are deleted permanently.",
  cancel: "Cancel",
  deletingSession: "Deleting…",
  deleteBusy: "This conversation is still replying. Wait, then delete it.",
  back: "Back",
  userSettings: "User",
  appearance: "Appearance",
  connections: "API / MCPs",
  theme: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
  language: "Language",
  fontSize: "Font size",
  fontSmall: "Small",
  fontLarge: "Large",
  displayName: "Display name",
  username: "Username",
  password: "Password",
  signIn: "Sign in",
  register: "Create account",
  signingIn: "Signing in",
  signingUp: "Creating account",
  noAccount: "No account?",
  goRegister: "Create one",
  hasAccount: "Already have an account?",
  goLogin: "Sign in",
  fillDemo: "Fill demo account",
  displayNameOptional: "(optional; defaults to the username)",
  usernameError: "Use 1 to 32 characters, with no spaces.",
  passwordError: "Use 8 to 128 characters.",
  displayNameError: "Use 1 to 32 characters.",
  message: "Message",
  draftPlaceholder: "What should this lesson solve?",
  send: "Send",
  replying: "Replying",
  enterHint: "Enter to send, Shift+Enter for a new line",
  contextUsage: "Context usage",
  contextUsed: "Used",
  contextRemaining: "Remaining",
  contextLimit: "Limit",
  contextOutput: "Output limit",
  contextProvider: "Limit reported by the model provider",
  contextFallback: "Provider omitted the limit; using 1M",
  contextCompressed: "Earlier turns were compacted into a summary",
  contextPartSystem: "System",
  contextPartTools: "Tools",
  contextPartContext: "Context",
  contextPartSummary: "Summary",
  contextPartConversation: "Conversation",
  contextPartAsk: "Ask",
  contextPartPlan: "Plan",
  contextPartDraft: "Draft",
  conversation: "Conversation",
  reading: "Loading this conversation.",
  emptyHint: "Say what this lesson is about. The reply shows up here.",
  me: "Me",
  noRemembered: "No accounts have signed in on this device.",
  addAccount: "Add account",
  otherAccount: "Choose another account",
  resumeExpired: "This account needs a password again.",
  systemError: "Something went wrong. Try again.",
  more: "More",
  unavailable: "This is not available yet",
  add: "Add",
  file: "File",
  attachments: "Attachments",
  renameAttachment: "Attachment name",
  removeAttachment: "Remove attachment",
  unsupportedFile: "Only Excel, Word, PDF, and images are supported.",
  chooseFile: "Choose file",
  ask: "Ask",
  askDesc: "Answer the question without producing materials",
  askPlaceholder: "Ask a question. No quiz, comment, or slides.",
  goalManage: "Goal library",
  goalManageDesc: "Edit term, unit, and lesson goals",
  save: "Save",
  plan: "Plan",
  planDesc: "Enter or leave plan mode",
  planBody: "Plan",
  planPlaceholder: "Write a plan to review, then generate from it",
  planSave: "Save changes",
  planGenerate: "Generate",
  planGenerateNote: "Choose one approach, then generate.",
  planExit: "Leave plan",
  planEmpty: "Write a plan before generating.",
  planGenerateMessage: "Generate the finished material from the confirmed plan.",
  commands: "Commands",
  compact: "Compact",
  compactDesc: "Compact the conversation above",
  permission: "Permission",
  model: "Model",
  modelDesc: "Choose the model for this conversation",
  searchModels: "Search models...",
  noModels: "No models yet. Configure one in Settings first.",
  modelListFailed: "Could not load the model list",
  exportLogs: "Download log",
  exportDesc: "Export this conversation as a ZIP",
  manual: "Manual",
  automatic: "Automatic",
  manualHint: "Confirm every tool call",
  automaticHint: "Run every tool call",
  approvalMode: "Approval",
  chooseApproval: "Choose approval mode",
  currentPrefix: "Now: ",
  apiLead: "Enter each provider’s API key to use its models.",
  providerName: "Name",
  providerNameMissing: "Provider name",
  confirmAdd: "Add",
  deleteProvider: "Delete",
  addProviderTitle: "Add model provider",
  source: "Source",
  localEnv: "This device",
  customEnv: "Custom",
  edit: "Edit",
  collapse: "Collapse",
  addProvider: "Add model provider",
  unsetShort: "Not set",
  serviceUrl: "Address",
  apiAddress: "API address",
  apiKeyLabel: "API key",
  customSettings: "Custom settings",
  apiAddressHint: "Use an OpenAI-compatible Chat Completions API address.",
  modelCatalog: "Model catalog",
  modelCatalogHint: "Using adapter default models",
  modelAlias: "Model alias",
  modelLabel: "Display name",
  addModel: "Add model",
  cancel: "Cancel",
  save: "Save",
  keyWarnMissing: "No environment variable detected. Enter an API key, or set the environment variable.",
  keyLeaveBlank: "Leave blank to use environment auth",
  removeModel: "Remove model",
  modelName: "Model",
  secret: "Secret",
  connected: "Status",
  checking: "Checking",
  reachable: "Connected",
  unreachable: "Cannot reach this model service.",
  offlineService: "Cannot reach the local service.",
  unsetEnv: "Environment variables are not set",
  notChecked: "Not checked",
  keyKeep: "Leave blank to use the secret in .env",
  keyEnter: "Enter a secret",
  keyFromEnv: "From the environment",
  keyMissing: "Environment variable is not set",
  mcpNote: "MCP is not connected. Secrets stay off this page.",
  urlMissing: "Environment variable is not set",
  modelMissing: "Model name",
  toolCalls: "Tool calls",
};

export type MessageKey = keyof typeof zh;

const fallback: Appearance = { theme: "light", locale: "zh", fontScale: FONT_DEFAULT };

export function loadAppearance(): Appearance {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object") return fallback;
  const record = parsed as Record<string, unknown>;
  const theme: ThemeChoice =
    record.theme === "dark" || record.theme === "system" || record.theme === "light" ? record.theme : "light";
  const locale: Locale = record.locale === "en" ? "en" : "zh";
  const fontScale =
    typeof record.fontScale === "number" && record.fontScale >= FONT_MIN && record.fontScale <= FONT_MAX
      ? record.fontScale
      : FONT_DEFAULT;
  return { theme, locale, fontScale };
}

export function saveAppearance(value: Appearance): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // localStorage 不可用时仍保留这一页里的选择
  }
}

export function resolvedTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  if (typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyAppearance(value: Appearance): void {
  const root = document.documentElement;
  const theme = resolvedTheme(value.theme);
  root.dataset.theme = theme;
  root.dataset.themeChoice = value.theme;
  root.dataset.fontScale = String(value.fontScale);
  root.lang = value.locale === "en" ? "en" : "zh-CN";
  root.style.setProperty("--font-scale", String(value.fontScale));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101614" : "#f4f7f5");
}

export function clearAppearance(): void {
  const root = document.documentElement;
  delete root.dataset.theme;
  delete root.dataset.themeChoice;
  delete root.dataset.fontScale;
  root.lang = "zh-CN";
  root.style.removeProperty("--font-scale");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f4f7f5");
}

type AppearanceApi = Appearance & {
  t: (key: MessageKey) => string;
  setTheme: (theme: ThemeChoice) => void;
  setLocale: (locale: Locale) => void;
  setFontScale: (fontScale: number) => void;
};

const AppearanceContext = createContext<AppearanceApi | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState(loadAppearance);

  useEffect(() => {
    applyAppearance(value);
    saveAppearance(value);
    if (value.theme !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance(value);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [value]);

  useEffect(() => () => clearAppearance(), []);

  const api = useMemo<AppearanceApi>(
    () => ({
      ...value,
      t: (key) => (value.locale === "en" ? en[key] : zh[key]),
      setTheme: (theme) => setValue((current) => ({ ...current, theme })),
      setLocale: (locale) => setValue((current) => ({ ...current, locale })),
      setFontScale: (fontScale) =>
        setValue((current) => ({
          ...current,
          fontScale: Math.min(FONT_MAX, Math.max(FONT_MIN, fontScale)),
        })),
    }),
    [value],
  );

  return <AppearanceContext.Provider value={api}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceApi {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("外观设置尚未就绪");
  return value;
}
