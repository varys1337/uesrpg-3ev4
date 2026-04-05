import { RELIGION_INVOCATION_DOMAIN_UNIVERSAL } from "../../core/religion/constants.js";

function asKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePunctuation(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, "\"")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...");
}

function normalizeBlock(value) {
  return normalizePunctuation(value)
    .replace(/\r/g, "")
    .replace(/\u000b/g, "\n")
    .replace(/\u000c/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInline(value) {
  return normalizeBlock(value).replace(/\n+/g, " ").trim();
}

function stripMarkdown(value) {
  return normalizePunctuation(value)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([[\](){}_*+.\-])/g, "$1");
}

function slugify(value) {
  return normalizeInline(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "entry";
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function romanToCircle(value) {
  return {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
  }[String(value ?? "").trim().toUpperCase()] ?? 1;
}

function titleCaseIfAllCaps(value) {
  const text = normalizeInline(stripMarkdown(value));
  const letters = text.replace(/[^A-Za-z]+/g, "");
  if (!letters || letters !== letters.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s([{-])([a-z])/g, (_, prefix, ch) => `${prefix}${ch.toUpperCase()}`);
}

function buildSourceKey(kind, domainKey, rankOrLevel, name) {
  return `${kind}.${domainKey}.${rankOrLevel}.${slugify(name)}`;
}

function buildSourcePath(sourcePath, ...parts) {
  return [sourcePath, ...parts].filter(Boolean).join("::");
}

function extractField(text, label, nextLabels = []) {
  const nextPattern = nextLabels.length
    ? `(?=${nextLabels.map((entry) => `${escapeRegex(entry)}\\s*:`).join("|")}|$)`
    : "$";
  const pattern = new RegExp(`${escapeRegex(label)}\\s*:\\s*([\\s\\S]*?)${nextPattern}`, "i");
  const match = String(text ?? "").match(pattern);
  return normalizeInline(match?.[1] ?? "");
}

function collectWrappedTableRow(lines, startIndex) {
  const rowLines = [];
  let index = startIndex;
  while (index < lines.length) {
    rowLines.push(lines[index]);
    if (/\|\s*\|\s*$/.test(lines[index])) break;
    index += 1;
  }
  return {
    nextIndex: Math.min(lines.length, index + 1),
    text: rowLines.join("\n"),
  };
}

function cleanTableRow(text) {
  return normalizeBlock(
    stripMarkdown(
      String(text ?? "")
        .replace(/^\|\s*/, "")
        .replace(/\|\s*\|\s*$/, "")
    )
  );
}

function parseInvocationHeader(headerLine) {
  const match = String(headerLine ?? "").match(/^\|\s*(.*?)\s*\|\s*([IVX]+)\s*\(Rank and Piety\)\s*\|/i);
  if (!match) return null;

  const headerText = normalizeInline(stripMarkdown(match[1]));
  const headerParts = headerText.split(/\s+-\s+/);
  const name = titleCaseIfAllCaps(headerParts[0]);
  const aspects = headerParts[1]
    ? headerParts[1].split(",").map((entry) => normalizeInline(entry)).filter(Boolean)
    : [];

  return {
    name,
    aspects,
    circle: romanToCircle(match[2]),
  };
}

function buildInvocationRecord({ domainKey, sourcePath, headerLine, detailRow, effectRow }) {
  const header = parseInvocationHeader(headerLine);
  if (!header?.name) return null;

  const detailText = cleanTableRow(detailRow);
  const effectText = cleanTableRow(effectRow).replace(/^Effect\s*:\s*/i, "").trim();
  const rankKey = `circle${header.circle}`;

  return {
    name: header.name,
    domainKey,
    circle: header.circle,
    pietyCost: header.circle,
    aspects: domainKey === RELIGION_INVOCATION_DOMAIN_UNIVERSAL ? [] : header.aspects,
    time: extractField(detailText, "Time", ["Ritual", "Range", "Duration"]),
    ritual: extractField(detailText, "Ritual", ["Range", "Duration"]),
    range: extractField(detailText, "Range", ["Duration"]),
    duration: extractField(detailText, "Duration", []),
    requirements: "",
    text: {
      raw: effectText,
    },
    sourceKey: buildSourceKey("invocation", domainKey, rankKey, header.name),
    sourcePath: buildSourcePath(sourcePath, "Invocations", domainKey, header.name),
  };
}

function parseInvocationSection(sectionText, domainKey, sourcePath) {
  const lines = normalizeBlock(sectionText).split("\n");
  const records = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\|/.test(lines[index]) || !/\(Rank and Piety\)\s*\|/i.test(lines[index])) continue;

    const headerLine = lines[index];
    if (index + 3 >= lines.length) continue;
    index += 1;

    if (!/^\|\s*-+/.test(lines[index])) continue;

    const detailRow = collectWrappedTableRow(lines, index + 1);
    const effectRow = collectWrappedTableRow(lines, detailRow.nextIndex);
    index = effectRow.nextIndex - 1;

    if (/^\|\s*\|\s*\|\s*$/.test(lines[index + 1] ?? "")) index += 1;

    const record = buildInvocationRecord({
      domainKey,
      sourcePath,
      headerLine,
      detailRow: detailRow.text,
      effectRow: effectRow.text,
    });
    if (record) records.push(record);
  }

  return records;
}

function getInvocationSections(text) {
  const start = text.indexOf("## **Universal Invocations**");
  const end = text.indexOf("## **Divine Intervention Examples**") >= 0
    ? text.indexOf("## **Divine Intervention Examples**")
    : text.indexOf("## **Domain Spells**");
  if (start < 0 || end < 0 || end <= start) return [];

  const sectionText = text.slice(start, end);
  const headings = [...sectionText.matchAll(/^##\s+\*\*([^*]+)\*\*\s*$/gm)];
  const sections = [];

  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings[i + 1];
    const title = normalizeInline(stripMarkdown(current[1]));
    const bodyStart = current.index + current[0].length;
    const bodyEnd = next ? next.index : sectionText.length;
    const body = sectionText.slice(bodyStart, bodyEnd).trim();
    if (!body) continue;

    if (title === "Universal Invocations") {
      sections.push({
        domainKey: RELIGION_INVOCATION_DOMAIN_UNIVERSAL,
        label: title,
        body,
      });
      continue;
    }

    const match = title.match(/^(.+?)\s+Domain$/i);
    if (!match) continue;
    sections.push({
      domainKey: asKey(match[1]),
      label: title,
      body,
    });
  }

  return sections;
}

function isSpellHeading(lines, index) {
  const line = normalizeInline(lines[index]);
  const match = line.match(/^\*\*(.+?)\*\*\s*$/);
  if (!match) return false;

  const label = normalizeInline(stripMarkdown(match[1]));
  if (!label) return false;
  if (/^(Level|Cost|Casting Time|Range|Duration|Attributes|Effect)$/i.test(label)) return false;

  for (let cursor = index + 1; cursor < Math.min(lines.length, index + 6); cursor += 1) {
    const probe = normalizeInline(stripMarkdown(lines[cursor]));
    if (!probe) continue;
    if (/^Level\s*:/i.test(probe)) return true;
    if (/^###\s+/.test(lines[cursor])) break;
  }

  return false;
}

function parseDomainSpellBlock(domainKey, spellName, blockLines, sourcePath) {
  const state = {
    level: "",
    cost: "",
    castingTime: "",
    range: "",
    duration: "",
    attributes: "",
    effectLines: [],
  };
  let captureEffect = false;

  for (const rawLine of blockLines) {
    const plainLine = normalizeInline(stripMarkdown(rawLine));
    if (!plainLine) {
      if (captureEffect) state.effectLines.push("");
      continue;
    }

    const labelMatch = plainLine.match(/^(Level|Cost|Casting Time|Range|Duration|Attributes|Effect)\s*:\s*(.*)$/i);
    if (labelMatch) {
      const label = asKey(labelMatch[1]).replace(/\s+/g, "");
      const remainder = normalizeInline(labelMatch[2]);
      captureEffect = label === "effect";

      if (label === "level") state.level = remainder;
      else if (label === "cost") state.cost = remainder;
      else if (label === "castingtime") state.castingTime = remainder;
      else if (label === "range") state.range = remainder;
      else if (label === "duration") state.duration = remainder;
      else if (label === "attributes") state.attributes = remainder;
      else if (label === "effect" && remainder) state.effectLines.push(remainder);
      continue;
    }

    if (captureEffect) state.effectLines.push(normalizeBlock(stripMarkdown(rawLine)));
  }

  const level = Number((state.level.match(/\d+/) ?? [1])[0]) || 1;
  const cost = Number((state.cost.match(/\d+/) ?? [0])[0]) || 0;

  return {
    name: titleCaseIfAllCaps(spellName),
    seedSpellName: titleCaseIfAllCaps(spellName),
    domainKey,
    domainCastSchool: "",
    level,
    cost,
    castingTime: state.castingTime,
    range: state.range,
    duration: state.duration,
    attributes: state.attributes,
    effect: normalizeBlock(state.effectLines.join("\n")).trim(),
    sourceKey: buildSourceKey("domain-spell", domainKey, `level${level}`, spellName),
    sourcePath: buildSourcePath(sourcePath, "Domain Spells", domainKey, spellName),
  };
}

export function parseReligionMarkdown(markdown, { sourcePath = "docs/Core/The Annotated Anuad of Worship.md" } = {}) {
  const text = normalizeBlock(markdown);
  const invocations = [];

  for (const section of getInvocationSections(text)) {
    invocations.push(...parseInvocationSection(section.body, section.domainKey, sourcePath));
  }

  const domainSpells = [];
  const domainSpellsStart = text.indexOf("## **Domain Spells**");
  if (domainSpellsStart >= 0) {
    const lines = text.slice(domainSpellsStart).split("\n");
    let domainKey = "";

    for (let index = 0; index < lines.length; index += 1) {
      const sectionMatch = lines[index].match(/^###\s+(?:\*\*)?([^*]+?)(?:\*\*)?\s*$/);
      if (sectionMatch) {
        domainKey = asKey(sectionMatch[1]);
        continue;
      }
      if (!domainKey || !isSpellHeading(lines, index)) continue;

      const spellName = normalizeInline(stripMarkdown(lines[index]));
      const blockLines = [];
      index += 1;
      while (index < lines.length) {
        if (/^###\s+/.test(lines[index]) || isSpellHeading(lines, index)) {
          index -= 1;
          break;
        }
        blockLines.push(lines[index]);
        index += 1;
      }

      const record = parseDomainSpellBlock(domainKey, spellName, blockLines, sourcePath);
      if (record?.name) domainSpells.push(record);
    }
  }

  return { invocations, domainSpells };
}
