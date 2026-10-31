import { useAppearance } from "../lib/appearance";
import type { DraftAttachment } from "../lib/attachments";

type Props = {
  items: DraftAttachment[];
  onRename: (id: string, displayName: string) => void;
  onRemove: (id: string) => void;
};

export function AttachmentBar({ items, onRename, onRemove }: Props) {
  const { t } = useAppearance();
  if (items.length === 0) return null;

  return (
    <ul className="attachment-bar" aria-label={t("attachments")}>
      {items.map((item) => (
        <li key={item.id} className="attachment-chip">
          {item.kind === "image" && item.previewUrl ? (
            <img className="attachment-thumb" src={item.previewUrl} alt="" />
          ) : (
            <span className="attachment-type">{typeLabel(item)}</span>
          )}
          {item.kind === "image" ? (
            <span className="attachment-name-text">{item.displayName}</span>
          ) : (
            <input
              className="attachment-name"
              aria-label={t("renameAttachment")}
              value={item.displayName}
              onChange={(event) => onRename(item.id, event.target.value)}
            />
          )}
          <button
            type="button"
            className="attachment-remove"
            aria-label={t("removeAttachment")}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function typeLabel(item: DraftAttachment): string {
  const name = item.file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "PDF";
  if (name.endsWith(".xls") || name.endsWith(".xlsx") || name.endsWith(".xlsm")) return "Excel";
  return "Word";
}
