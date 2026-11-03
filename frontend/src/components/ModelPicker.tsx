import { useEffect, useMemo, useRef, useState } from "react";
import type { LlmSources } from "../api/http";
import { useAppearance } from "../lib/appearance";

export type LlmSourceId = "local" | "dotenv";

type Props = {
  selected: LlmSourceId | null;
  onSelect: (source: LlmSourceId) => void;
  onClose: () => void;
  loadSources: (signal?: AbortSignal) => Promise<LlmSources>;
  onLoadError: () => void;
};

type Row = {
  source: LlmSourceId;
  group: string;
  model: string;
};

function sourceReady(value: { base_url: string; model: string; has_api_key: boolean } | undefined): boolean {
  return Boolean(value && value.base_url && value.model && value.has_api_key);
}

export function ModelPicker({ selected, onSelect, onClose, loadSources, onLoadError }: Props) {
  const { t } = useAppearance();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadSources(controller.signal)
      .then((sources) => {
        if (controller.signal.aborted) return;
        const next: Row[] = [];
        if (sourceReady(sources.environment)) {
          next.push({ source: "local", group: t("localEnv"), model: sources.environment.model });
        }
        setRows(next);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        onLoadError();
        onClose();
      });
    return () => controller.abort();
    // 只在打开时拉一次；回调用渲染时闭包即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSources]);

  useEffect(() => {
    const handleDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleDoc);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDoc);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) => row.model.toLowerCase().includes(needle) || row.group.toLowerCase().includes(needle),
    );
  }, [query, rows]);

  const groups = useMemo(() => {
    if (!filtered) return [];
    const order: LlmSourceId[] = ["local"];
    return order
      .map((source) => {
        const items = filtered.filter((row) => row.source === source);
        if (items.length === 0) return null;
        return { source, title: items[0].group, items };
      })
      .filter((group): group is { source: LlmSourceId; title: string; items: Row[] } => group !== null);
  }, [filtered]);

  return (
    <div className="model-picker" ref={rootRef} role="dialog" aria-label={t("model")}>
      <label className="sr-only" htmlFor="model-picker-search">
        {t("searchModels")}
      </label>
      <input
        id="model-picker-search"
        className="model-picker-search"
        type="search"
        value={query}
        placeholder={t("searchModels")}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      <div className="model-picker-body" role="listbox" aria-label={t("model")}>
        {filtered === null ? null : filtered.length === 0 ? (
          <p className="model-picker-empty">{t("noModels")}</p>
        ) : (
          groups.map((group) => (
            <div key={group.source} className="model-picker-section">
              <p className="model-picker-section-label">{group.title}</p>
              {group.items.map((row) => {
                const isSelected = selected === row.source;
                return (
                  <button
                    key={row.source}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`model-picker-item ${isSelected ? "is-selected" : ""}`}
                    onClick={() => onSelect(row.source)}
                  >
                    <span className="model-picker-item-label">{row.model}</span>
                    {isSelected ? (
                      <span className="model-picker-check" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
