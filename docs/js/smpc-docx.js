/**
 * SmPC DOCX export (EN, AR, and bilingual EN+AR).
 * Builds real Word tables from section HTML and strips illegal XML chars
 * so bilingual files open cleanly in Word/LibreOffice.
 */

import { sanitizeXmlText } from "./smpc-tables.js";

const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm";
const FILESAVER_URL = "https://cdn.jsdelivr.net/npm/file-saver@2.0.5/+esm";

const FONT = "Times New Roman";
const SIZE_12 = 24; // half-points
const DOUBLE_LINE = { line: 480, lineRule: "auto" };

let docxMod = null;
let saveAsFn = null;

async function getDocx() {
  if (!docxMod) docxMod = await import(DOCX_URL);
  return docxMod;
}

async function getSaveAs() {
  if (!saveAsFn) {
    const mod = await import(FILESAVER_URL);
    saveAsFn = mod.saveAs || mod.default?.saveAs || mod.default;
  }
  return saveAsFn;
}

function safeFilename(name) {
  return (
    String(name || "smpc")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "smpc"
  );
}

function cleanText(value) {
  return sanitizeXmlText(String(value ?? ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
}

function htmlTableToMatrix(tableHtml) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tableHtml))) {
    const cells = [];
    const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      cells.push(
        cleanText(
          decodeEntities(
            cellMatch[2]
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
          )
        )
      );
    }
    if (cells.length) rows.push(cells);
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => {
    const copy = [...r];
    while (copy.length < width) copy.push("");
    return copy;
  });
}

function parseSectionBlocks(section) {
  const html = String(section?.html || "").trim();
  if (!html) {
    const plain = cleanText(section?.text || "");
    return plain
      ? plain
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => ({ type: "p", text: cleanText(line) }))
      : [];
  }

  const blocks = [];
  for (const part of html.split(/(<table\b[\s\S]*?<\/table>)/gi)) {
    if (!part) continue;
    if (/^<table\b/i.test(part)) {
      const matrix = htmlTableToMatrix(part);
      if (matrix.length >= 2) blocks.push({ type: "table", rows: matrix });
      else {
        const fallback = cleanText(decodeEntities(part.replace(/<[^>]+>/g, " ")));
        if (fallback) blocks.push({ type: "p", text: fallback });
      }
      continue;
    }
    const text = cleanText(
      decodeEntities(
        part
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/p>/gi, "\n")
          .replace(/<\/div>/gi, "\n")
          .replace(/<\/li>/gi, "\n")
          .replace(/<li[^>]*>/gi, "• ")
          .replace(/<[^>]+>/g, " ")
      )
    );
    for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
      blocks.push({ type: "p", text: cleanText(line) });
    }
  }
  return blocks;
}

function textRun(TextRun, text, { bold = false, italics = false, rtl = false } = {}) {
  return new TextRun({
    text: cleanText(text),
    bold,
    italics,
    font: FONT,
    size: SIZE_12,
    rightToLeft: rtl,
  });
}

function paragraph(
  Paragraph,
  TextRun,
  text,
  { rtl = false, bold = false, heading = null, after = 120 } = {}
) {
  const opts = {
    bidirectional: rtl,
    alignment: rtl ? "right" : "left",
    spacing: { ...DOUBLE_LINE, after },
    children: [textRun(TextRun, text, { bold, rtl })],
  };
  if (heading) opts.heading = heading;
  return new Paragraph(opts);
}

function docxTable(api, matrix, { rtl = false } = {}) {
  const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle } = api;
  if (!matrix || matrix.length < 2) return null;
  const cols = Math.max(...matrix.map((r) => r.length));
  if (cols < 1) return null;
  const colWidth = Math.max(900, Math.floor(9000 / cols));
  const border = { style: BorderStyle.SINGLE, size: 4, color: "666666" };
  const borders = { top: border, bottom: border, left: border, right: border };

  return new Table({
    width: { size: Math.min(9000, colWidth * cols), type: WidthType.DXA },
    columnWidths: Array.from({ length: cols }, () => colWidth),
    rows: matrix.map((row, rowIndex) => {
      const cells = [...row];
      while (cells.length < cols) cells.push("");
      return new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              borders,
              width: { size: colWidth, type: WidthType.DXA },
              children: [
                new Paragraph({
                  bidirectional: rtl,
                  alignment: rtl ? "right" : "left",
                  spacing: { ...DOUBLE_LINE, after: 40 },
                  children: [textRun(TextRun, cell || " ", { bold: rowIndex === 0, rtl })],
                }),
              ],
            })
        ),
      });
    }),
  });
}

function appendBlocks(children, api, blocks, { rtl = false } = {}) {
  const { Paragraph, TextRun } = api;
  for (const block of blocks || []) {
    if (block.type === "table") {
      const table = docxTable(api, block.rows, { rtl });
      if (table) {
        children.push(table);
        children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
      }
      continue;
    }
    if (!block.text) continue;
    children.push(paragraph(Paragraph, TextRun, block.text, { rtl, after: 120 }));
  }
}

function pairBilingualSections(englishSections = [], arabicSections = []) {
  const arByKey = new Map((arabicSections || []).map((s) => [s.key, s]));
  return (englishSections || []).map((en) => {
    const ar = arByKey.get(en.key);
    return {
      enTitle: cleanText(en.title || ""),
      enBlocks: parseSectionBlocks(en),
      arTitle: cleanText(ar?.title || en.title || ""),
      arBlocks: ar ? parseSectionBlocks(ar) : [],
    };
  });
}

export async function buildSmpcDocx({
  title,
  language = "en",
  sections = [],
  meta = {},
  bilingualSections = null,
} = {}) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
  } = await getDocx();

  const api = {
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
  };

  const rtlDefault = language === "ar";
  const children = [];

  const docTitle =
    language === "bilingual"
      ? "Summary of Product Characteristics / نشرة خصائص المنتج (SmPC)"
      : language === "ar"
        ? "نشرة خصائص المنتج (SmPC) — ترجمة عربية"
        : "Summary of Product Characteristics (SmPC)";

  children.push(
    paragraph(Paragraph, TextRun, docTitle, {
      rtl: language === "ar",
      bold: true,
      heading: HeadingLevel.HEADING_1,
      after: 200,
    })
  );
  children.push(
    paragraph(Paragraph, TextRun, title || "", {
      rtl: language === "ar",
      bold: true,
      heading: HeadingLevel.HEADING_2,
      after: 160,
    })
  );

  const metaLines =
    language === "ar"
      ? [
          meta.api ? `المادة الفعّالة: ${meta.api}` : "",
          meta.formulation ? `الشكل الصيدلاني: ${meta.formulation}` : "",
          meta.source ? `المصدر: ${meta.source}` : "",
        ]
      : language === "bilingual"
        ? [
            meta.api ? `API / المادة الفعّالة: ${meta.api}` : "",
            meta.formulation ? `Formulation / الشكل: ${meta.formulation}` : "",
            meta.source ? `Source / المصدر: ${meta.source}` : "",
          ]
        : [
            meta.api ? `API: ${meta.api}` : "",
            meta.formulation ? `Formulation: ${meta.formulation}` : "",
            meta.source ? `Source: ${meta.source}` : "",
          ];

  for (const line of metaLines.filter(Boolean)) {
    children.push(paragraph(Paragraph, TextRun, line, { rtl: language === "ar", after: 80 }));
  }
  children.push(new Paragraph({ text: "", spacing: { ...DOUBLE_LINE, after: 120 } }));

  if (language === "bilingual" && bilingualSections?.length) {
    for (const pair of bilingualSections) {
      children.push(
        paragraph(Paragraph, TextRun, pair.enTitle || "Section", {
          bold: true,
          heading: HeadingLevel.HEADING_1,
          after: 140,
        })
      );
      appendBlocks(children, api, pair.enBlocks, { rtl: false });
      children.push(
        paragraph(Paragraph, TextRun, pair.arTitle || pair.enTitle || "قسم", {
          rtl: true,
          bold: true,
          heading: HeadingLevel.HEADING_2,
          after: 140,
        })
      );
      appendBlocks(children, api, pair.arBlocks, { rtl: true });
      children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
    }
  } else {
    for (const section of sections || []) {
      children.push(
        paragraph(Paragraph, TextRun, section.title || "", {
          rtl: rtlDefault,
          bold: true,
          heading: HeadingLevel.HEADING_2,
          after: 140,
        })
      );
      appendBlocks(children, api, parseSectionBlocks(section), { rtl: rtlDefault });
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_12 },
          paragraph: { spacing: DOUBLE_LINE },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickStyle: true,
          run: { font: FONT, size: SIZE_12, bold: true },
          paragraph: { spacing: DOUBLE_LINE },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickStyle: true,
          run: { font: FONT, size: SIZE_12, bold: true },
          paragraph: { spacing: DOUBLE_LINE },
        },
      ],
    },
    sections: [{ properties: {}, children: children.filter(Boolean) }],
  });

  return Packer.toBlob(doc);
}

/**
 * Download SmPC DOCX files.
 * bilingual:true → one EN+AR document (Times New Roman 12pt, double spaced).
 */
export async function downloadSmpcDocxPair({
  title,
  englishSections,
  arabicSections,
  meta = {},
  bilingual = false,
} = {}) {
  const saveAs = await getSaveAs();
  const base = safeFilename(title);

  if (bilingual && englishSections?.length && arabicSections?.length) {
    const blob = await buildSmpcDocx({
      title,
      language: "bilingual",
      bilingualSections: pairBilingualSections(englishSections, arabicSections),
      meta,
    });
    if (!blob || blob.size < 2000) {
      throw new Error("تعذّر إنشاء ملف DOCX الثنائي (الملف فارغ أو تالف).");
    }
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (!(head[0] === 0x50 && head[1] === 0x4b)) {
      throw new Error("ملف DOCX الثنائي تالف (توقيع ZIP غير صالح).");
    }
    saveAs(blob, `${base}-SmPC-EN-AR.docx`);
    return;
  }

  if (englishSections?.length) {
    const enBlob = await buildSmpcDocx({
      title,
      language: "en",
      sections: englishSections,
      meta,
    });
    saveAs(enBlob, `${base}-SmPC-EN.docx`);
  }

  if (arabicSections?.length) {
    const arBlob = await buildSmpcDocx({
      title,
      language: "ar",
      sections: arabicSections,
      meta,
    });
    saveAs(arBlob, `${base}-SmPC-AR.docx`);
  }
}
