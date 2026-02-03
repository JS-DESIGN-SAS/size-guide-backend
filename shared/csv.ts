export function rowsToCsv(rows: unknown[][]): string {
  const cleanedData = rows.map((row) =>
    row.map((cell) => {
      const text = cell === null || cell === undefined ? "" : String(cell);
      const noNewLines = text.replace(/\r?\n/g, " ");
      const escaped = noNewLines.replace(/"/g, '""');
      return `"${escaped.trim()}"`;
    })
  );

  return cleanedData.map((row) => row.join(",")).join("\n");
}
 
  