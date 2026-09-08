const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm";
const FILESAVER_URL = "https://cdn.jsdelivr.net/npm/file-saver@2.0.5/+esm";

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
  return String(name || "smpc")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "smpc";
}

export async function buildSmpcDocx({
  title,
  language = "en",
  sections = [],
  meta = {},
} = {}) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await getDocx();
  const isRtl = language === "ar";
  const children = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: isRtl,
      children: [
        new TextRun({
          text:
            language === "ar"
              ? "نشرة خصائص المنتج (SmPC) — ترجمة عربية"
              : "Summary of Product Characteristics (SmPC)",
          bold: true,
        }),
      ],
    })
  );

  children.push(
    new Paragraph({
      alignment: isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      bidirectional: isRtl,
      children: [new TextRun({ text: title || "", bold: true, size: 28 })],
    })
  );

  const metaLines = [
    meta.api ? (language === "ar" ? `المادة الفعّالة: ${meta.api}` : `API: ${meta.api}`) : "",
    meta.formulation
      ? language === "ar"
        ? `الشكل الصيدلاني: ${meta.formulation}`
        : `Formulation: ${meta.formulation}`
      : "",
    meta.source
      ? language === "ar"
        ? `المصدر: ${meta.source}`
        : `Source: ${meta.source}`
      : "",
  ].filter(Boolean);

  for (const line of metaLines) {
    children.push(
      new Paragraph({
        alignment: isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        bidirectional: isRtl,
        children: [new TextRun({ text: line, italics: true, size: 20 })],
      })
    );
  }

  children.push(new Paragraph({ text: "" }));

  for (const section of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        alignment: isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        bidirectional: isRtl,
        children: [new TextRun({ text: section.title || "", bold: true })],
      })
    );

    const paragraphs = String(section.text || "").split(/\n+/);
    for (const para of paragraphs) {
      if (!para.trim()) continue;
      children.push(
        new Paragraph({
          alignment: isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          bidirectional: isRtl,
          spacing: { after: 160 },
          children: [new TextRun({ text: para.trim(), size: 22 })],
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

export async function downloadSmpcDocxPair({
  title,
  englishSections,
  arabicSections,
  meta = {},
} = {}) {
  const saveAs = await getSaveAs();
  const base = safeFilename(title);

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
