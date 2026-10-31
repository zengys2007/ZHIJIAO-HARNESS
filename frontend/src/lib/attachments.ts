export type DraftAttachment = {
  id: string;
  file: File;
  displayName: string;
  kind: "document" | "image";
  previewUrl?: string;
};

const DOCUMENT_EXT = new Set(["xls", "xlsx", "xlsm", "doc", "docx", "pdf"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

export const ATTACHMENT_ACCEPT = [
  ".xls",
  ".xlsx",
  ".xlsm",
  ".doc",
  ".docx",
  ".pdf",
  "image/*",
].join(",");

export function isAllowedAttachment(file: File): boolean {
  const ext = extension(file.name);
  if (DOCUMENT_EXT.has(ext) || IMAGE_EXT.has(ext)) return true;
  if (file.type.startsWith("image/")) return true;
  if (file.type === "application/pdf") return true;
  return file.type.includes("word") || file.type.includes("excel") || file.type.includes("spreadsheet");
}

export function createDraftAttachment(file: File): DraftAttachment {
  const kind = kindOf(file);
  return {
    id: crypto.randomUUID(),
    file,
    displayName: file.name,
    kind,
    ...(kind === "image" ? { previewUrl: objectUrl(file) } : {}),
  };
}

export function renameDraftAttachment(item: DraftAttachment, displayName: string): DraftAttachment {
  return { ...item, displayName };
}

export function revokeDraftAttachment(item: DraftAttachment): void {
  if (!item.previewUrl || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(item.previewUrl);
}

function kindOf(file: File): "document" | "image" {
  if (IMAGE_EXT.has(extension(file.name)) || file.type.startsWith("image/")) return "image";
  return "document";
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

function objectUrl(file: File): string | undefined {
  if (typeof URL.createObjectURL !== "function") return undefined;
  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
}
