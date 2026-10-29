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
  conversation: "对话",
  reading: "正在读取这段对话。",
  emptyHint: "用一句话说说这节课。回复会出现在这里。",
  me: "我",
  noRemembered: "本机还没有登录过的账号。",
  addAccount: "添加新账号",
  otherAccount: "选择其他账号",
  resumeExpired: "这个账号需要重新输入密码。",
  systemError: "系统出错了，可以再发一次。",
  contentLimit: "请把这句话写成 1 到 4000 字后再发送。",
  more: "更多操作",
  unavailable: "该功能尚未开放",
  add: "添加",
  file: "文件",
  attachments: "附件",
  renameAttachment: "附件名称",
  removeAttachment: "移除附件",
  unsupportedFile: "只支持 Excel、Word、PDF 和图片。",
  chooseFile: "选择文件",
  goal: "目标",
  goalDesc: "设置或查看长期任务目标",
  plan: "计划",
  planDesc: "进入或退出计划模式",
  feedback: "反馈",
  feedbackDesc: "发送关于当前会话的反馈",
  commands: "指令",
  compact: "压缩",
  compactDesc: "压缩以上对话内容",
  permission: "权限",
  model: "模型",
  modelDesc: "选择本会话使用的模型",
  exportLogs: "下载日志",
  exportDesc: "将当前会话内容导出为 ZIP",
  manual: "手动审批",
  automatic: "自动执行",
  manualHint: "每次工具调用都要确认",
  automaticHint: "直接执行所有工具调用",
  approvalMode: "审批模式",
  chooseApproval: "选择审批模式",
  currentPrefix: "当前：",
  apiLead: "本机环境读取环境变量。自行填写读取 .env，留空的密钥仍用文件里的那一份。",
  source: "接口来源",
  localEnv: "本机环境",
  customEnv: "自行填写",
  serviceUrl: "服务地址",
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
  conversation: "Conversation",
  reading: "Loading this conversation.",
  emptyHint: "Say what this lesson is about. The reply shows up here.",
  me: "Me",
  noRemembered: "No accounts have signed in on this device.",
  addAccount: "Add account",
  otherAccount: "Choose another account",
  resumeExpired: "This account needs a password again.",
  systemError: "Something went wrong. Try again.",
  contentLimit: "Keep this message between 1 and 4000 characters.",
  more: "More",
  unavailable: "This is not available yet",
  add: "Add",
  file: "File",
  attachments: "Attachments",
  renameAttachment: "Attachment name",
  removeAttachment: "Remove attachment",
  unsupportedFile: "Only Excel, Word, PDF, and images are supported.",
  chooseFile: "Choose file",
  goal: "Goal",
  goalDesc: "Set or view a longer-term goal",
  plan: "Plan",
  planDesc: "Enter or leave plan mode",
  feedback: "Feedback",
  feedbackDesc: "Send feedback about this conversation",
  commands: "Commands",
  compact: "Compact",
  compactDesc: "Compact the conversation above",
  permission: "Permission",
  model: "Model",
  modelDesc: "Choose the model for this conversation",
  exportLogs: "Download log",
  exportDesc: "Export this conversation as a ZIP",
  manual: "Manual",
  automatic: "Automatic",
  manualHint: "Confirm every tool call",
  automaticHint: "Run every tool call",
  approvalMode: "Approval",
  chooseApproval: "Choose approval mode",
  currentPrefix: "Now: ",
  apiLead: "This device reads environment variables. Custom values read .env, and a blank secret keeps the one in the file.",
  source: "Source",
  localEnv: "This device",
  customEnv: "Custom",
  serviceUrl: "Address",
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
