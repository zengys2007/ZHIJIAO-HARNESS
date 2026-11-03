/** 本机自定义模型提供商（仅 localStorage，不上传）。 */

export type ProviderModel = {
  alias: string;
  label: string;
};

export type CustomProvider = {
  id: string;
  name: string;
  base_url: string;
  /** 兼容字段：取 models 第一行的 label 或 alias */
  model: string;
  api_key: string;
  models: ProviderModel[];
};

export const PROVIDERS_STORAGE_KEY = "zhijiao.providers:v1";

function readModels(row: Record<string, unknown>): ProviderModel[] {
  if (Array.isArray(row.models)) {
    return row.models.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const model = item as Record<string, unknown>;
      const alias = typeof model.alias === "string" ? model.alias : "";
      const label = typeof model.label === "string" ? model.label : "";
      if (!alias && !label) return [];
      return [{ alias, label }];
    });
  }
  const legacy = typeof row.model === "string" ? row.model.trim() : "";
  if (!legacy) return [];
  return [{ alias: legacy, label: legacy }];
}

export function primaryModelName(models: ProviderModel[], fallback = ""): string {
  const first = models.find((item) => item.label.trim() || item.alias.trim());
  if (!first) return fallback;
  return first.label.trim() || first.alias.trim();
}

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
      const models = readModels(row);
      return [
        {
          id: row.id,
          name: row.name,
          base_url: typeof row.base_url === "string" ? row.base_url : "",
          model: primaryModelName(models, typeof row.model === "string" ? row.model : ""),
          api_key: typeof row.api_key === "string" ? row.api_key : "",
          models,
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
  const model = primaryModelName(provider.models, provider.model);
  return Boolean(provider.base_url.trim() && model && provider.api_key.trim());
}
