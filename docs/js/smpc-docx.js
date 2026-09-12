const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm";
const FILESAVER_URL = "https://cdn.jsdelivr.net/npm/file-saver@2.0.5/+esm";

const FONT = "Times New Roman";
const SIZE_12 = 24; // docx half-points
const DOUBLE_LINE = { line: 480, lineRule: "auto" };

let docxModule = null;
let saveAsFn = null;

async function getDocx() {
  if (!docxModule) docxModule = await import(DOCX_URL);
  return docxModule;
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

function plainFromSection(section) {
  const html = String(section?.html || "");
  if (html) {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, "[Image: $1]")
      .replace(/<img[^>]*>/gi, "[Image]")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  return String(section?.text || "").trim();
}

function paraOpts(isRtl, extra = {}) {
  return {
    bidirectional: isRtl,
    spacing: { ...DOUBLE_LINE, after: 120 },
    ...extra,
  };
}

function textRun(text, { bold = false, italics = false } = {}) {
  return {
    text: String(text || ""),
    bold,
    italics,
    font: FONT,
    size: SIZE_12,
  };
}

async function buildChildren({
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  title,
  language,
  sections,
  meta,
  bilingualSections,
}) {
  const isRtl = language === "ar";
  const align = isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT;
  const children = [];

  const pushPara = (opts, runs) => {
    const rtl = opts.bidirectional ?? isRtl;
    children.push(
      new Paragraph({
        ...opts,
        alignment: opts.alignment ?? (rtl ? AlignmentType.RIGHT : AlignmentType.LEFT),
        bidirectional: rtl,
        spacing: opts.spacing || { ...DOUBLE_LINE, after: 120 },
        children: runs.map((run) => new TextRun(run)),
      })
    );
  };

  const docTitle =
    language === "bilingual"
      ? "Summary of Product Characteristics / نشرة خصائص المنتج (SmPC)"
      : language === "ar"
        ? "نشرة خصائص المنتج (SmPC) — ترجمة عربية"
        : "Summary of Product Characteristics (SmPC)";

  pushPara(
    {
      heading: HeadingLevel.HEADING_1,
      alignment: language === "ar" ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: language === "ar",
      spacing: { ...DOUBLE_LINE, after: 200 },
    },
    [textRun(docTitle, { bold: true })]
  );

  pushPara(
    paraOpts(language === "ar", {
      heading: HeadingLevel.HEADING_2,
      spacing: { ...DOUBLE_LINE, after: 160 },
    }),
    [textRun(title || "", { bold: true })]
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
    pushPara(paraOpts(language === "ar"), [textRun(line, { italics: true })]);
  }

  children.push(new Paragraph({ text: "", spacing: { ...DOUBLE_LINE, after: 120 } }));

  if (language === "bilingual" && bilingualSections?.length) {
    for (const pair of bilingualSections) {
      pushPara(
        {
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.LEFT,
          bidirectional: false,
          spacing: { ...DOUBLE_LINE, after: 160 },
        },
        [textRun(pair.enTitle || "Section", { bold: true })]
      );
      for (const para of String(pair.enText || "").split(/\n+/)) {
        if (!para.trim()) continue;
        pushPara(paraOpts(false), [textRun(para.trim())]);
      }

      pushPara(
        {
          heading: HeadingLevel.HEADING_2,
          alignment: AlignmentType.RIGHT,
          bidirectional: true,
          spacing: { ...DOUBLE_LINE, after: 160 },
        },
        [textRun(pair.arTitle || pair.enTitle || "قسم", { bold: true })]
      );
      for (const para of String(pair.arText || "").split(/\n+/)) {
        if (!para.trim()) continue;
        pushPara(paraOpts(true), [textRun(para.trim())]);
      }

      children.push(new Paragraph({ text: "", spacing: { ...DOUBLE_LINE, after: 200 } }));
    }
  } else {
    for (const section of sections || []) {
      pushPara(
        {
          heading: HeadingLevel.HEADING_2,
          alignment: align,
          bidirectional: isRtl,
          spacing: { ...DOUBLE_LINE, after: 160 },
        },
        [textRun(section.title || "", { bold: true })]
      );

      const body = plainFromSection(section);
      for (const para of body.split(/\n+/)) {
        if (!para.trim()) continue;
        pushPara(paraOpts(isRtl), [textRun(para.trim())]);
      }
    }
  }

  return children;
}

export async function buildSmpcDocx({
  title,
  language = "en",
  sections = [],
  meta = {},
  bilingualSections = null,
} = {}) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await getDocx();
  const children = await buildChildren({
    Document,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    title,
    language,
    sections,
    meta,
    bilingualSections,
  });

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
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

function pairBilingualSections(englishSections = [], arabicSections = []) {
  const arByKey = new Map((arabicSections || []).map((s) => [s.key, s]));
  const pairs = [];
  for (const en of englishSections || []) {
    const ar = arByKey.get(en.key);
    pairs.push({
      enTitle: en.title || "",
      enText: plainFromSection(en),
      arTitle: ar?.title || en.title || "",
      arText: ar ? plainFromSection(ar) : "",
    });
  }
  return pairs;
}

/**
 * Download SmPC DOCX files.
 * mode "both" → one bilingual EN+AR document (Times New Roman 12pt, double spaced).
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
