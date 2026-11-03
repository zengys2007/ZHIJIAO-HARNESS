/** 本机自定义模型提供商（仅 localStorage，不上传）。 */

export type CustomProvider = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_key: string;
};

export const PROVIDERS_STORAGE_KEY = "zhijiao.providers:v1";

export function loadCustomProviders(): CustomProvider[] {
  try {
    const raw = localStorage.getItem(PROVIDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.name !== "string") return [];
      return [
        {
          id: row.id,
          name: row.name,
          base_url: typeof row.base_url === "string" ? row.base_url : "",
          model: typeof row.model === "string" ? row.model : "",
          api_key: typeof row.api_key === "string" ? row.api_key : "",
        },
      ];
    });
  } catch {
    return [];
  }
}

export function saveCustomProviders(providers: CustomProvider[]): void {
  try {
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(providers));
  } catch {
    // 隐私模式或配额满时忽略
  }
}

export function newProviderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

export function customProviderReady(provider: CustomProvider): boolean {
  return Boolean(provider.base_url.trim() && provider.model.trim() && provider.api_key.trim());
}
