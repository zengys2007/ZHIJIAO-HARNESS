/** 本机记住的账号（localStorage，存用户名、显示名和免密登录令牌，绝不存密码） */
export type RememberedAccount = {
  username: string;
  display_name: string;
  /** 记住此设备的令牌。旧记录或令牌失效后为空串，此时切换需要输入密码 */
  token: string;
};

const STORAGE_KEY = "zhijiao.remembered-accounts";
const MAX_REMEMBERED = 8;

export function loadRememberedAccounts(): RememberedAccount[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const accounts: RememberedAccount[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.username !== "string" || record.username.trim().length === 0) continue;
    accounts.push({
      username: record.username,
      display_name: typeof record.display_name === "string" ? record.display_name : "",
      token: typeof record.token === "string" ? record.token : "",
    });
  }
  return accounts;
}

/** 登录、注册或免密恢复成功后调用：去重并置顶，最多保留 MAX_REMEMBERED 个。
 * 不传 token 时保留该账号已有的令牌，避免刷新登录态时把免密凭证清掉。
 */
export function rememberAccount(account: {
  username: string;
  display_name: string;
  token?: string;
}): void {
  const previous = loadRememberedAccounts();
  const prior = previous.find((item) => item.username === account.username);
  const token = account.token !== undefined ? account.token : (prior?.token ?? "");
  const rest = previous.filter((item) => item.username !== account.username);
  const next = [
    { username: account.username, display_name: account.display_name, token },
    ...rest,
  ].slice(0, MAX_REMEMBERED);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用（隐私模式等）时静默跳过，不影响登录本身
  }
}
