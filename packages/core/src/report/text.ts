import type { ReportModel, ReportRow } from '../measurements/report';

/** One measurement on one line: the name, the numbers, the series and slice, and where it came from. */
function lineOf(row: ReportRow): string {
  const numbers = row.value.length === 0 ? '' : row.value.join('. ');
  const where = [row.series, row.slice === '' ? '' : `slice ${row.slice}`]
    .filter((part) => part !== '')
    .join(', ');
  const body = [numbers, where].filter((part) => part !== '').join('. ');
  const head = body === '' ? row.name : `${row.name}: ${body}`;
  return `${head} (${row.source})`;
}

/**
 * The report as plain text, to paste into a message or a report: the title, the study, when it was
 * made, one line for each measurement, and the footer. It is made from the same model as the PDF,
 * so they say the same. Text is not limited to Latin-1, and a label is written as it is.
 */
export function renderText(model: ReportModel): string {
  const lines = [
    model.title,
    ...model.studyLines,
    ...model.patientLines,
    `Made: ${model.madeAt}`,
    '',
    ...model.rows.map(lineOf),
  ];
  if (model.rows.length > 0) lines.push('');
  lines.push(model.footer);
  return lines.join('\n');
}
