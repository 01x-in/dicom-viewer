import type { ReportModel } from '../measurements/report';

/**
 * Puts a report on A4 pages as a PDF file. It writes the file itself, with the two standard fonts
 * every PDF reader has (Helvetica and Helvetica-Bold), so it adds no library to the page. Text is
 * laid out from the fonts' own widths. The standard fonts hold only Latin-1 letters in their
 * Windows form: a character outside what the table below draws is shown as `?`, and the report says
 * how many there were.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
/** Nothing but the footer is drawn below this line. */
const FOOTER_LINE = 52;
const FOOTER_BASELINE = 28;
const LEADING = 11;
const BODY = 9;

/** Helvetica widths in 1/1000 em for the characters from space (32) to `~` (126). */
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
] as const;
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
] as const;
/** The degree sign, the superscript two, and the middle dot: widths are the same in both fonts. */
const EXTRA: Readonly<Record<number, number>> = { 0xb0: 400, 0xb2: 333, 0xb7: 278 };

/** The letter an accented Latin-1 letter is built on (`é` is `e`), or `undefined` for any other character. */
function baseLetter(code: number): number | undefined {
  if (code < 0xc0 || code > 0xff) return undefined;
  const parts = String.fromCharCode(code).normalize('NFD');
  const base = parts.charCodeAt(0);
  return parts.length > 1 && /[A-Za-z]/.test(parts.charAt(0)) ? base : undefined;
}

/**
 * The code of a character in the Windows encoding the fonts use, or `undefined` if it has none
 * here. Drawn: ASCII, the three signs in `EXTRA`, and the Latin-1 letters with an accent, which
 * are as wide as the letter they are built on.
 */
function codeOf(char: string): number | undefined {
  const code = char.codePointAt(0);
  if (code === undefined) return undefined;
  if (code >= 32 && code <= 126) return code;
  return EXTRA[code] !== undefined || baseLetter(code) !== undefined ? code : undefined;
}

function unitsOf(code: number, bold: boolean): number {
  const table = bold ? BOLD : REGULAR;
  const ascii = baseLetter(code) ?? code;
  return ascii >= 32 && ascii <= 126 ? (table[ascii - 32] ?? 556) : (EXTRA[code] ?? 556);
}

/** The width of a text in points. Characters the fonts cannot draw count as `?`, which is what is drawn. */
export function textWidth(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const char of text) units += unitsOf(codeOf(char) ?? 63, bold);
  return (units * size) / 1000;
}

/** Breaks a text into lines no wider than `maxWidth`, at spaces, and inside a word that is too wide by itself. */
export function wrapText(text: string, maxWidth: number, size: number, bold: boolean): string[] {
  const lines: string[] = [];
  let line = '';
  const push = (): void => {
    lines.push(line);
    line = '';
  };
  for (const word of text.split(' ').filter((part) => part !== '')) {
    const joined = line === '' ? word : `${line} ${word}`;
    if (textWidth(joined, size, bold) <= maxWidth) {
      line = joined;
      continue;
    }
    if (line !== '') push();
    let rest = word;
    while (textWidth(rest, size, bold) > maxWidth) {
      let cut = 1;
      const chars = Array.from(rest);
      while (
        cut < chars.length &&
        textWidth(chars.slice(0, cut + 1).join(''), size, bold) <= maxWidth
      ) {
        cut += 1;
      }
      lines.push(chars.slice(0, cut).join(''));
      rest = chars.slice(cut).join('');
    }
    line = rest;
  }
  if (line !== '' || lines.length === 0) push();
  return lines;
}

/** What goes on a page, in points from its bottom left corner. */
type Mark =
  | {
      readonly kind: 'text';
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly bold: boolean;
      readonly gray: number;
      readonly text: string;
    }
  | {
      readonly kind: 'line';
      readonly x1: number;
      readonly x2: number;
      readonly y: number;
      readonly gray: number;
    };

/** Text as the file holds it: only what the fonts can draw, as a string whose characters are bytes. */
function drawable(text: string): { readonly text: string; readonly replaced: number } {
  let out = '';
  let replaced = 0;
  for (const char of text) {
    const code = codeOf(char);
    if (code === undefined) {
      out += '?';
      replaced += 1;
    } else {
      out += String.fromCharCode(code);
    }
  }
  return { text: out, replaced };
}

function escaped(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += char;
  }
  return out;
}

function number(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function contentOf(marks: readonly Mark[]): string {
  const ops: string[] = [];
  for (const mark of marks) {
    if (mark.kind === 'line') {
      ops.push(
        `${number(mark.gray)} G 0.5 w ${number(mark.x1)} ${number(mark.y)} m ${number(mark.x2)} ${number(mark.y)} l S`,
      );
    } else {
      ops.push(
        `BT ${number(mark.gray)} g /${mark.bold ? 'F2' : 'F1'} ${number(mark.size)} Tf ${number(mark.x)} ${number(mark.y)} Td (${escaped(mark.text)}) Tj ET`,
      );
    }
  }
  return ops.join('\n');
}

/** The widths of the six columns: they add up to the width of the page between its margins. */
const COLUMN_SHARES = [0.23, 0.14, 0.27, 0.19, 0.07, 0.1] as const;
const CELL_PADDING = 3;

export function renderPdf(report: ReportModel): Uint8Array<ArrayBuffer> {
  // Everything is made drawable first, so a width is the width of what is drawn and the number of
  // characters that were replaced is known before the first page is laid out.
  let replaced = 0;
  const draw = (text: string): string => {
    const result = drawable(text);
    replaced += result.replaced;
    return result.text;
  };
  const title = draw(report.title);
  const madeAt = draw(`Made ${report.madeAt}`);
  const studyLines = report.studyLines.map(draw);
  const patientLines = report.patientLines.map(draw);
  const columns = report.columns.map(draw);
  const rows = report.rows.map((row) => ({
    cells: [
      [draw(row.name)],
      [draw(row.type)],
      row.value.map(draw),
      [draw(row.series)],
      [draw(row.slice)],
      [draw(row.source)],
    ],
  }));
  const footer = draw(report.footer);

  const pages: Mark[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  const page = (): Mark[] => pages[pages.length - 1] ?? [];
  const text = (
    value: string,
    x: number,
    at: number,
    size: number,
    bold = false,
    gray = 0,
  ): void => {
    page().push({ kind: 'text', x, y: at, size, bold, gray, text: value });
  };
  const paragraph = (value: string, size: number, bold = false, gray = 0): void => {
    for (const line of wrapText(value, CONTENT_WIDTH, size, bold)) {
      y -= size + 3;
      text(line, MARGIN, y, size, bold, gray);
    }
  };

  y -= 4;
  paragraph(title, 16, true);
  y -= 4;
  paragraph(madeAt, BODY, false, 0.35);
  y -= 6;
  for (const line of studyLines) paragraph(line, 10);
  for (const line of patientLines) paragraph(line, 10);
  if (replaced > 0) {
    y -= 4;
    paragraph(
      replaced === 1
        ? '1 character could not be drawn and is shown as ?.'
        : `${replaced.toString()} characters could not be drawn and are shown as ?.`,
      BODY,
      false,
      0.35,
    );
  }
  y -= 14;

  const widths = COLUMN_SHARES.map((share) => share * CONTENT_WIDTH);
  const lefts = widths.map((_, index) =>
    widths.slice(0, index).reduce((sum, width) => sum + width, MARGIN),
  );
  const header = (): void => {
    y -= 12;
    columns.forEach((name, index) => {
      text(name, (lefts[index] ?? MARGIN) + CELL_PADDING, y, BODY, true);
    });
    y -= 5;
    page().push({ kind: 'line', x1: MARGIN, x2: PAGE_WIDTH - MARGIN, y, gray: 0.3 });
  };

  if (rows.length === 0) {
    paragraph('No measurements.', 10);
  } else {
    header();
    for (const row of rows) {
      const wrapped = row.cells.map((lines, index) =>
        lines.flatMap((line) =>
          wrapText(line, (widths[index] ?? 0) - 2 * CELL_PADDING, BODY, index === 0),
        ),
      );
      const height = Math.max(1, ...wrapped.map((lines) => lines.length)) * LEADING + 7;
      if (y - height < FOOTER_LINE) {
        pages.push([]);
        y = PAGE_HEIGHT - MARGIN;
        header();
      }
      const top = y;
      wrapped.forEach((lines, index) => {
        lines.forEach((line, at) => {
          text(
            line,
            (lefts[index] ?? MARGIN) + CELL_PADDING,
            top - 9 - at * LEADING,
            BODY,
            index === 0,
          );
        });
      });
      y -= height;
      page().push({ kind: 'line', x1: MARGIN, x2: PAGE_WIDTH - MARGIN, y, gray: 0.8 });
    }
  }

  pages.forEach((marks, index) => {
    marks.push({
      kind: 'line',
      x1: MARGIN,
      x2: PAGE_WIDTH - MARGIN,
      y: FOOTER_LINE - 8,
      gray: 0.6,
    });
    marks.push({
      kind: 'text',
      x: MARGIN,
      y: FOOTER_BASELINE,
      size: 8,
      bold: false,
      gray: 0.35,
      text: footer,
    });
    const label = `Page ${(index + 1).toString()} of ${pages.length.toString()}`;
    marks.push({
      kind: 'text',
      x: PAGE_WIDTH - MARGIN - textWidth(label, 8, false),
      y: FOOTER_BASELINE,
      size: 8,
      bold: false,
      gray: 0.35,
      text: label,
    });
  });

  // The objects: 1 the catalog, 2 the page list, 3 and 4 the fonts, 5 the title, then a page and
  // its content for each page.
  const pageObject = (index: number): number => 6 + 2 * index;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length.toString()} /Kids [${pages
      .map((_, index) => `${pageObject(index).toString()} 0 R`)
      .join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${escaped(title)}) /Producer (01x DICOM viewer) >>`,
  ];
  for (const [index, marks] of pages.entries()) {
    const content = contentOf(marks);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toString()} ${PAGE_HEIGHT.toString()}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${(pageObject(index) + 1).toString()} 0 R >>`,
      `<< /Length ${content.length.toString()} >>\nstream\n${content}\nendstream`,
    );
  }

  // Every character below is one byte: the text was made drawable, and what is not ASCII is escaped.
  let file = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(file.length);
    file += `${(index + 1).toString()} 0 obj\n${body}\nendobj\n`;
  }
  const xref = file.length;
  file += `xref\n0 ${(objects.length + 1).toString()}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${(objects.length + 1).toString()} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref.toString()}\n%%EOF\n`;

  const bytes = new Uint8Array(file.length);
  for (let index = 0; index < file.length; index += 1) bytes[index] = file.charCodeAt(index);
  return bytes;
}
