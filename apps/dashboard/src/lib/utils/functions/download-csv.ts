import Papa from 'papaparse';

/**
 * Serializes an array of row objects to CSV and triggers a client-side
 * download. Reusable across every reporting view (gradebook, student 360,
 * program progress, at-risk). Uses UTF-8 so accented characters survive Excel.
 *
 * @param rows One object per row; keys become column headers.
 * @param filename File name without extension.
 */
export function downloadCSV(rows: Array<Record<string, string | number>>, filename: string): void {
  const csv = Papa.unparse(rows);
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
