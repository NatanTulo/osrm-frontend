const fs = require('fs');
const path = require('path');

/**
 * Script to compute the difference (new/changed features) between two export CSV folders.
 * 
 * Usage:
 *   node scripts/export_diff_to_gmaps.js <old_exports_dir> <new_exports_dir> <diff_output_dir>
 * 
 * Example:
 *   node scripts/export_diff_to_gmaps.js ./exports_260330 ./exports_260806 ./exports_diff
 */

function getAllCsvFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllCsvFiles(fullPath, arrayOfFiles);
    } else if (file.endsWith('.csv')) {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

function loadWktSetFromFolder(dirPath) {
  const wktSet = new Set();
  const csvFiles = getAllCsvFiles(dirPath);

  console.log(`Wczytywanie bazowego zbioru CSV z "${dirPath}" (${csvFiles.length} plików)...`);
  for (const file of csvFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        // Store canonical line representation
        wktSet.add(line);
      }
    }
  }

  console.log(`Załadowano ${wktSet.size} unikalnych geometrii z bazy 260330.`);
  return wktSet;
}

function computeDiff(oldDir, newDir, diffDir) {
  const oldWktSet = loadWktSetFromFolder(oldDir);
  const newCsvFiles = getAllCsvFiles(newDir);

  console.log(`\nPorównywanie z nowym zbiorem "${newDir}" (${newCsvFiles.length} plików)...`);
  let totalNewRows = 0;
  let totalFilesCreated = 0;

  for (const newFile of newCsvFiles) {
    const relativePath = path.relative(newDir, newFile);
    const targetPath = path.join(diffDir, relativePath);
    const targetDir = path.dirname(targetPath);

    const content = fs.readFileSync(newFile, 'utf8');
    const lines = content.split(/\r?\n/);
    const header = lines[0];
    const diffLines = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !oldWktSet.has(line)) {
        diffLines.push(line);
      }
    }

    if (diffLines.length > 0) {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(targetPath, header + '\n' + diffLines.join('\n') + '\n', 'utf8');
      totalFilesCreated++;
      totalNewRows += diffLines.length;
      console.log(` -> Utworzono plik różnicowy: ${relativePath} (${diffLines.length} nowych linii)`);
    }
  }

  console.log(`\n=========================================`);
  console.log(`Zakończono wyznaczanie różnic!`);
  console.log(`Znaleziono nowych odcinków/zmian: ${totalNewRows}`);
  console.log(`Zapisano do ${totalFilesCreated} plików w: ${diffDir}`);
  console.log(`=========================================\n`);
}

const args = process.argv.slice(2);
const oldDir = args[0] || path.join(__dirname, '..', 'exports_260330');
const newDir = args[1] || path.join(__dirname, '..', 'exports_260806');
const diffDir = args[2] || path.join(__dirname, '..', 'exports_diff');

if (!fs.existsSync(oldDir) && fs.existsSync(path.join(__dirname, '..', 'exports'))) {
  console.log(`Wskazówka: Katalog '${oldDir}' nie istnieje. Jeśli aktualny folder 'exports' zawiera dane z wersji 260330, zmień jego nazwę na 'exports_260330'.`);
}

computeDiff(oldDir, newDir, diffDir);
