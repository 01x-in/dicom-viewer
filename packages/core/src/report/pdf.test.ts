import { describe, expect, it } from 'vitest';
import {
  REPORT_COLUMNS,
  REPORT_FOOTER,
  type ReportModel,
  type ReportRow,
} from '../measurements/report';
import { renderPdf, textWidth, wrapText } from './pdf';

const row = (name: string, overrides: Partial<ReportRow> = {}): ReportRow => ({
  name,
  type: 'Length',
  value: ['Length 5.0 mm'],
  series: 'CT, Axial',
  slice: '5',
  source: 'Drawn',
  ...overrides,
});

function model(rows: readonly ReportRow[], overrides: Partial<ReportModel> = {}): ReportModel {
  return {
    title: 'Measurement report',
    madeAt: '2026-11-07 14:05 UTC',
    studyLines: ['Study: CT chest', 'Study UID: 1.2.3'],
    patientLines: [],
    columns: REPORT_COLUMNS,
    rows,
    footer: REPORT_FOOTER,
    ...overrides,
  };
}

/** The file as text: every byte is one character, so offsets are the same in both. */
function text(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function pagesOf(pdf: string): number {
  return (pdf.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
}

describe('renderPdf', () => {
  it('makes a PDF file', () => {
    const bytes = renderPdf(model([row('Length 1')]));
    const pdf = text(bytes);
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    expect(pagesOf(pdf)).toBe(1);
    expect(pdf).toContain('/Count 1');
  });

  it('writes a table of offsets that points at each object', () => {
    const pdf = text(renderPdf(model([row('Length 1')])));
    const start = Number(/startxref\n(\d+)\n/.exec(pdf)?.[1]);
    expect(pdf.slice(start, start + 4)).toBe('xref');
    const entries = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(entries.length).toBeGreaterThan(5);
    for (const [index, offset] of entries.entries()) {
      expect(pdf.slice(offset, offset + `${(index + 1).toString()} 0 obj`.length)).toBe(
        `${(index + 1).toString()} 0 obj`,
      );
    }
    expect(pdf).toContain(`/Size ${(entries.length + 1).toString()}`);
  });

  it('puts the title, the study, the rows and the footer on the page', () => {
    const pdf = text(renderPdf(model([row('Length 1'), row('Aorta', { type: 'Probe' })])));
    for (const expected of [
      'Measurement report',
      'Study: CT chest',
      'Made 2026-11-07 14:05 UTC',
      'Length 1',
      'Aorta',
      'Length 5.0 mm',
      REPORT_FOOTER,
    ]) {
      expect(pdf).toContain(`(${expected})`);
    }
  });

  it('goes on to more pages for a long list, with the footer and the heading of the table on each', () => {
    const rows = Array.from({ length: 120 }, (_, index) => row(`Length ${(index + 1).toString()}`));
    const pdf = text(renderPdf(model(rows)));
    const pages = pagesOf(pdf);
    expect(pages).toBeGreaterThan(2);
    expect(pdf).toContain(`/Count ${pages.toString()}`);
    expect(pdf.split(`(${REPORT_FOOTER})`)).toHaveLength(pages + 1);
    expect(pdf.split('(Source)')).toHaveLength(pages + 1);
    expect(pdf).toContain(`(Page ${pages.toString()} of ${pages.toString()})`);
    // Every row is on some page, once.
    expect(pdf.split('(Length 120)')).toHaveLength(2);
  });

  it('keeps a row together on one page: a row that does not fit goes to the next', () => {
    const rows = Array.from({ length: 40 }, (_, index) =>
      row(`Ellipse ${(index + 1).toString()}`, {
        value: ['Area 1.0 mm²', 'Mean 1.0 HU', 'SD 1.0 HU', 'Min 1.0 HU', 'Max 1.0 HU'],
      }),
    );
    const pdf = text(renderPdf(model(rows)));
    const contents = [...pdf.matchAll(/stream\n([\s\S]*?)endstream/g)].map((m) => m[1] ?? '');
    expect(contents.length).toBeGreaterThan(1);
    for (const content of contents) {
      // Text sits above the footer's line, except the footer itself, which is at the bottom.
      const body = content.split('\n').filter((line) => !line.includes('/F1 8 Tf'));
      const ys = body
        .flatMap((line) => [...line.matchAll(/([\d.]+) ([\d.]+) Td/g)])
        .map((m) => Number(m[2]));
      expect(ys.length).toBeGreaterThan(0);
      expect(ys.every((y) => y >= 52)).toBe(true);
    }
  });

  it('escapes the characters that end a string', () => {
    const pdf = text(renderPdf(model([row('a (b) \\ c')])));
    expect(pdf).toContain('(a \\(b\\) \\\\ c)');
  });

  it('draws the degree sign, the square, and the middle dot', () => {
    const pdf = text(
      renderPdf(model([row('x', { value: ['Angle 90.0°', 'Area 1.0 mm²', 'a·b'] })])),
    );
    expect(pdf).toContain('(Angle 90.0\\260)');
    expect(pdf).toContain('(Area 1.0 mm\\262)');
    expect(pdf).toContain('(a\\267b)');
  });

  it('draws the accented letters of Latin-1, as wide as the letter they are built on', () => {
    const pdf = text(renderPdf(model([row('Müller José')])));
    expect(pdf).toContain('(M\\374ller Jos\\351)');
    expect(pdf).not.toContain('could not be drawn');
    expect(textWidth('é', 10, false)).toBe(textWidth('e', 10, false));
    expect(textWidth('Ü', 10, true)).toBe(textWidth('U', 10, true));
  });

  it('shows ? for what the standard font cannot draw, and says so on the page', () => {
    const pdf = text(renderPdf(model([row('肺結節 é')])));
    expect(pdf).toContain('(??? \\351)');
    expect(pdf).toContain('3 characters could not be drawn and are shown as ?.');
    expect(text(renderPdf(model([row('肺')])))).toContain(
      '1 character could not be drawn and is shown as ?.',
    );
  });

  it('says nothing about characters when all could be drawn', () => {
    expect(text(renderPdf(model([row('Length 1')])))).not.toContain('could not be drawn');
  });

  it('shows the patient lines it is given, and no others', () => {
    const shown = text(renderPdf(model([row('x')], { patientLines: ['Patient: DOE JANE'] })));
    expect(shown).toContain('(Patient: DOE JANE)');
    expect(text(renderPdf(model([row('x')])))).not.toContain('Patient');
  });

  it('says so when there is nothing to list', () => {
    expect(text(renderPdf(model([])))).toContain('(No measurements.)');
  });

  it('gives the same bytes for the same report', () => {
    const rows = [row('Length 1')];
    expect(renderPdf(model(rows))).toEqual(renderPdf(model(rows)));
  });
});

describe('wrapText', () => {
  it('keeps a short text on one line', () => {
    expect(wrapText('Length 1', 200, 9, false)).toEqual(['Length 1']);
  });

  it('breaks at spaces, so no line is wider than the column', () => {
    const lines = wrapText('The first lesion in the left lobe near the hilum', 80, 9, false);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 9, false)).toBeLessThanOrEqual(80);
    expect(lines.join(' ')).toBe('The first lesion in the left lobe near the hilum');
  });

  it('breaks a word that is wider than the column, and loses none of it', () => {
    const word = 'W'.repeat(60);
    const lines = wrapText(word, 50, 9, false);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 9, false)).toBeLessThanOrEqual(50);
    expect(lines.join('')).toBe(word);
  });

  it('has one empty line for no text', () => {
    expect(wrapText('', 50, 9, false)).toEqual(['']);
  });
});

describe('textWidth', () => {
  it('follows the widths of Helvetica, in points', () => {
    // 1000 units to the em: "HH" is 722 + 722, at 10 points.
    expect(textWidth('HH', 10, false)).toBeCloseTo(14.44, 5);
    expect(textWidth('i', 10, false)).toBeCloseTo(2.22, 5);
    expect(textWidth('H', 10, true)).toBeCloseTo(7.22, 5);
    expect(textWidth('', 10, false)).toBe(0);
  });
});
