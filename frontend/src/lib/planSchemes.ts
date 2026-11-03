export type PlanScheme = {
  key: string;
  title: string;
  body: string;
  recommended: boolean;
};

const SCHEME_HEADING = /^(?:#{1,6}\s*)?(方案\s*[A-Za-z0-9一二三四五六七八九十]+)\s*[：:]\s*(.*)$/;
const OPTIONAL_SCHEME = /^可选第([一二三四五六七八九十\d]+)套[：:]\s*(.*)$/;
const RECOMMENDED = /推荐\s*[：:]?\s*(?:方案\s*)?([A-Za-z0-9一二三四五六七八九十]+)/;
const ORDINAL: Record<string, string> = {
  "1": "A",
  "2": "B",
  "3": "C",
  "4": "D",
  一: "A",
  二: "B",
  三: "C",
  四: "D",
};

export function splitPlanSchemes(text: string): { preface: string; footer: string; schemes: PlanScheme[] } {
  const tableSchemes = schemesFromTables(text);
  if (tableSchemes.length >= 2) {
    const schemes = [...tableSchemes, ...optionalSchemes(text, tableSchemes)];
    markRecommended(schemes, text);
    return { preface: prefaceWithoutSchemeRows(text), footer: "", schemes };
  }
  return splitHeadings(text);
}

function splitHeadings(text: string): { preface: string; footer: string; schemes: PlanScheme[] } {
  const preface: string[] = [];
  const footer: string[] = [];
  const schemes: PlanScheme[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of text.split("\n")) {
    if (footer.length > 0 || (current && isRecommendation(line))) {
      if (current) {
        schemes.push(finishHeading(current, schemes.length));
        current = null;
      }
      footer.push(line);
      continue;
    }
    const match = SCHEME_HEADING.exec(schemePlain(line));
    if (match) {
      if (current) schemes.push(finishHeading(current, schemes.length));
      const name = match[1].replace(/\s+/g, " ");
      const rest = match[2].trim();
      current = { title: rest ? `${name}：${rest}` : name, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else preface.push(line);
  }
  if (current) schemes.push(finishHeading(current, schemes.length));
  if (schemes.length < 2) return { preface: text.trim(), footer: "", schemes: [] };
  markRecommended(schemes, text);
  return {
    preface: preface.join("\n").trim(),
    footer: footer.join("\n").trim(),
    schemes,
  };
}

function isRecommendation(line: string): boolean {
  return /^推荐\s*[：:]\s*方案\s*[A-Za-z0-9一二三四五六七八九十]+/.test(schemePlain(line));
}

function schemePlain(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function finishHeading(current: { title: string; lines: string[] }, index: number): PlanScheme {
  const body = trimOuterBlank(current.lines).join("\n").trim();
  return {
    key: `heading-${index}`,
    title: current.title,
    body,
    recommended: current.lines.some((line) => /^推荐\s*[：:]/.test(schemePlain(line))),
  };
}

function schemesFromTables(text: string): PlanScheme[] {
  const lines = text.split("\n");
  const schemes: PlanScheme[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!isTableRow(lines[index])) {
      index += 1;
      continue;
    }
    const block: string[] = [];
    while (index < lines.length && isTableRow(lines[index])) {
      block.push(lines[index]);
      index += 1;
    }
    schemes.push(...tableBlock(block, schemes.length));
  }
  return schemes;
}

function tableBlock(block: string[], offset: number): PlanScheme[] {
  if (block.length < 3) return [];
  const header = splitCells(block[0]);
  const separator = splitCells(block[1]);
  if (separator.length !== header.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) return [];
  const idIndex = header.findIndex((cell) => cell === "方案" || cell.includes("方案"));
  if (idIndex < 0) return [];
  const nameIndex = header.findIndex((cell) => cell === "名称" || cell.includes("名称"));
  return block.slice(2).map((line, index) => {
    const cells = splitCells(line);
    const id = cells[idIndex] || String(index + 1);
    const name = nameIndex >= 0 ? cells[nameIndex] : "";
    const title = name ? `方案 ${id}：${name}` : `方案 ${id}`;
    const body = header
      .map((label, column) => {
        if (column === idIndex || column === nameIndex) return "";
        const value = cells[column];
        return value ? `${label}：${value}` : "";
      })
      .filter(Boolean)
      .join("\n");
    return { key: `table-${offset + index}`, title, body, recommended: false };
  });
}

function optionalSchemes(text: string, existing: PlanScheme[]): PlanScheme[] {
  const found: PlanScheme[] = [];
  for (const line of text.split("\n")) {
    const plain = line.replace(/\*/g, "").trim();
    const match = OPTIONAL_SCHEME.exec(plain);
    if (!match) continue;
    const letter = ORDINAL[match[1]] ?? match[1];
    const title = `方案 ${letter}：可选第${match[1]}套`;
    if (existing.some((scheme) => scheme.title.includes(`方案 ${letter}`))) continue;
    found.push({ key: `optional-${letter}`, title, body: match[2].trim(), recommended: false });
  }
  return found;
}

function markRecommended(schemes: PlanScheme[], text: string) {
  const plain = text.replace(/\*/g, "");
  const match = RECOMMENDED.exec(plain);
  if (!match) return;
  const id = match[1].toUpperCase();
  const hits = schemes.map((scheme) => scheme.title.replace(/\s+/g, "").toUpperCase().startsWith(`方案${id}`));
  if (!hits.some(Boolean)) return;
  schemes.forEach((scheme, index) => {
    scheme.recommended = hits[index];
  });
}

function prefaceWithoutSchemeRows(text: string): string {
  const kept = text.split("\n").filter((line) => {
    const plain = line.replace(/\*/g, "").trim();
    if (isTableRow(line)) return false;
    if (OPTIONAL_SCHEME.test(plain)) return false;
    return true;
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|");
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function trimOuterBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}
