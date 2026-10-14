import ExcelJS from 'exceljs';
import fs from 'fs';

const filePath = 'C:\\Users\\HP\\Downloads\\Telegram Desktop\\EC Banck Reconcilation Form For ALL.xlsx';

async function main() {
  console.log('Starting read at', new Date().toISOString());
  const t0 = Date.now();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  console.log(`Read finished in ${Date.now() - t0}ms. Worksheets: ${wb.worksheets.length}`);
  
  const summary = [];
  for (const ws of wb.worksheets) {
    const info = {
      name: ws.name,
      rowCount: ws.rowCount,
      columnCount: ws.columnCount,
    };
    summary.push(info);
    console.log(`Sheet "${ws.name}": rows=${ws.rowCount}, cols=${ws.columnCount}`);
  }

  // Dump detailed sample of each sheet to a text file
  let report = `Worksheets (${wb.worksheets.length}):\n` + JSON.stringify(summary, null, 2) + '\n\n';
  
  for (const ws of wb.worksheets) {
    report += `\n============================================================\n`;
    report += `SHEET: "${ws.name}" (rows: ${ws.rowCount}, cols: ${ws.columnCount})\n`;
    report += `============================================================\n`;
    
    let rowIdx = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      rowIdx++;
      if (rowNumber <= 30 || (rowNumber >= ws.rowCount - 10 && rowNumber <= ws.rowCount)) {
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (colNumber <= 30) {
            let v = cell.value;
            if (v && typeof v === 'object') {
              if (v.result !== undefined) v = `formula[${v.formula} => ${v.result}]`;
              else if (v.text !== undefined) v = v.text;
              else if (v.richText) v = v.richText.map(r => r.text).join('');
            }
            if (v !== null && v !== undefined && v !== '') {
              cells.push(`C${colNumber}: ${JSON.stringify(v)}`);
            }
          }
        });
        if (cells.length > 0) {
          report += `R${rowNumber}: ` + cells.join(' | ') + '\n';
        }
      }
    });
  }

  fs.writeFileSync('scripts/reconciliation-summary.txt', report, 'utf8');
  console.log('Saved to scripts/reconciliation-summary.txt');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
