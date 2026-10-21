const STORAGE_KEY = "zhijiao.conversations:v1";
const ID = /^[0-9a-f]{32}$/;

export type SessionSummary = {
  id: string;
  title: string;
};

export function loadSessions(): SessionSummary[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.title !== "string") return [];
      if (!ID.test(record.id) || record.title.trim().length === 0) return [];
      return [{ id: record.id, title: record.title }];
    });
  } catch {
    return [];
  }
}

export function saveSessions(sessions: SessionSummary[]): void {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(sessions.map((session) => ({ id: session.id, title: session.title }))),
    );
  } catch {
    // 隐私模式或配额用尽时，会话仍留在当前页面里。
  }
}
