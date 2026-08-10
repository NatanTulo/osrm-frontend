const fs = require('fs');
const path = require('path');

/**
 * Script to compute spatial difference (truly new/added road features) between two export CSV folders.
 * Processed voivodeship by voivodeship to ensure extremely low RAM footprint.
 * Exports TWO CSV files per voivodeship folder:
 *   1. diff_sciezki_<date>.csv (for bicycle path / cycleway additions)
 *   2. diff_inne_<date>.csv    (for other road additions)
 * 
 * Each CSV file is grouped by Surface Type (Asfalt, Kostka, Szuter, Utwardzona, Gruntowa, Brak danych)
 * and uses optimized MULTILINESTRING chunks (up to 500 geometries / 200KB per row)
 * for clean 1-click styling in Google My Maps.
 * 
 * Usage:
 *   node scripts/export_diff_to_gmaps.js <old_exports_dir> <new_exports_dir> <diff_output_dir>
 * 
 * Example:
 *   node scripts/export_diff_to_gmaps.js ./exports_260330 ./exports_260806 ./exports_diff
 */

const MAX_GEOMS_PER_ROW = 500;
const MAX_ROW_BYTES = 200 * 1024; // 200 KB target limit per MULTILINESTRING row
const DIST_THRESHOLD_METERS = 20.0; // 20 meters tolerance
const CELL_SIZE = 0.05; // ~5 km grid cells
const MAX_FILE_BYTES = 4.5 * 1024 * 1024; // 4.5 MB safety margin for Google My Maps

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

function extractSegmentsFromLine(line) {
  const segments = [];
  const regex = /\(([^()]+)\)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    const rawCoords = match[1].trim();
    if (rawCoords) {
      segments.push(rawCoords);
    }
  }
  return segments;
}

function parseCoords(coordsStr) {
  return coordsStr.split(/,\s*/).map(p => {
    const [lon, lat] = p.trim().split(/\s+/).map(Number);
    return { lon, lat };
  });
}

function reverseCoords(coordsStr) {
  return coordsStr.split(/,\s*/).reverse().join(', ');
}

function distToSegmentSquared(p, v, w) {
  const l2 = (v.lon - w.lon) ** 2 + (v.lat - w.lat) ** 2;
  if (l2 === 0) return (p.lon - v.lon) ** 2 + (p.lat - v.lat) ** 2;
  let t = ((p.lon - v.lon) * (w.lon - v.lon) + (p.lat - v.lat) * (w.lat - v.lat)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projLon = v.lon + t * (w.lon - v.lon);
  const projLat = v.lat + t * (w.lat - v.lat);
  const dx = (p.lon - projLon) * 111320 * Math.cos(54 * Math.PI / 180);
  const dy = (p.lat - projLat) * 111320;
  return dx * dx + dy * dy;
}

function minDistToPolyline(p, polylinePts) {
  let minDistSq = Infinity;
  for (let i = 0; i < polylinePts.length - 1; i++) {
    const dSq = distToSegmentSquared(p, polylinePts[i], polylinePts[i + 1]);
    if (dSq < minDistSq) minDistSq = dSq;
  }
  return Math.sqrt(minDistSq);
}

function determineSurfaceCategory(fileName) {
  const name = path.basename(fileName);
  if (name.startsWith('Asfalt')) return 'Asfalt';
  if (name.startsWith('Kostka')) return 'Kostka';
  if (name.startsWith('Szuter')) return 'Szuter';
  if (name.startsWith('Utwardzona')) return 'Utwardzona';
  if (name.startsWith('Gruntowa')) return 'Gruntowa';
  if (name.startsWith('Brak_danych')) return 'Brak danych';
  return 'Inne';
}

function determineGroupCategory(filePath, baseDir) {
  const relativePath = path.relative(baseDir, filePath);
  const parts = relativePath.split(path.sep);
  if (parts.length >= 3 && parts[0] === 'Sciezki_Rowerowe') {
    return 'sciezki';
  }
  if (parts.length >= 3 && parts[0] === 'Inne_Drogi') {
    return 'inne';
  }
  return 'sciezki';
}

function escapeCsv(field) {
  if (!field) return '""';
  if (field.includes('"') || field.includes(',') || field.includes('\n')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

function extractDateTag(dirName) {
  const match = dirName.match(/(\d{6})/);
  return match ? match[1] : '260806';
}

function getVoivodeshipMapFromDir(baseDir) {
  const csvFiles = getAllCsvFiles(baseDir);
  const map = {};

  for (const file of csvFiles) {
    const relativePath = path.relative(baseDir, file);
    const pathParts = relativePath.split(path.sep);

    let voivodeship = 'Inne';
    if (pathParts.length >= 3) {
      voivodeship = pathParts[1];
    } else if (pathParts.length === 2) {
      voivodeship = pathParts[0];
    }

    if (!map[voivodeship]) map[voivodeship] = [];
    map[voivodeship].push(file);
  }

  return map;
}

function computeDiff(oldDir, newDir, diffDir) {
  const dateTag = extractDateTag(newDir);

  if (fs.existsSync(diffDir)) {
    fs.rmSync(diffDir, { recursive: true, force: true });
  }

  const oldVoivodeshipMap = getVoivodeshipMapFromDir(oldDir);
  const newVoivodeshipMap = getVoivodeshipMapFromDir(newDir);

  const voivodeshipList = Object.keys(newVoivodeshipMap).sort();
  console.log(`Znaleziono ${voivodeshipList.length} województw w nowym zbiorze (${newDir}).`);
  console.log(`Tworzenie dwóch osobnych plików CSV dla każdego województwa: "diff_sciezki_${dateTag}.csv" oraz "diff_inne_${dateTag}.csv"...`);

  let globalNewSegments = 0;
  let globalFilteredSegments = 0;
  let globalFilesCreated = 0;

  const surfaceOrder = ['Asfalt', 'Kostka', 'Szuter', 'Utwardzona', 'Gruntowa', 'Brak danych'];

  for (const voivodeship of voivodeshipList) {
    console.log(`\n--- Przetwarzanie województwa: ${voivodeship} ---`);

    const oldFiles = oldVoivodeshipMap[voivodeship] || [];
    const newFiles = newVoivodeshipMap[voivodeship] || [];

    // 1. Build spatial grid index for old segments of THIS voivodeship (combining cycleways + other roads)
    const grid = {};
    const exactWktSet = new Set();
    let oldSegCount = 0;

    for (const file of oldFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const segs = extractSegmentsFromLine(line);
        for (const sStr of segs) {
          exactWktSet.add(sStr);
          exactWktSet.add(reverseCoords(sStr));

          const pts = parseCoords(sStr);
          if (pts.length < 2) continue;

          let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
          for (const p of pts) {
            if (p.lon < minLon) minLon = p.lon;
            if (p.lon > maxLon) maxLon = p.lon;
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
          }

          const segObj = { pts, minLon, maxLon, minLat, maxLat, id: oldSegCount++ };

          const minX = Math.floor((minLon - 0.0005) / CELL_SIZE);
          const maxX = Math.floor((maxLon + 0.0005) / CELL_SIZE);
          const minY = Math.floor((minLat - 0.0005) / CELL_SIZE);
          const maxY = Math.floor((maxLat + 0.0005) / CELL_SIZE);

          for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
              const key = x + '_' + y;
              if (!grid[key]) grid[key] = [];
              grid[key].push(segObj);
            }
          }
        }
      }
    }

    console.log(`  Zaindeksowano ${oldSegCount} starych tras w ${voivodeship}.`);

    // 2. Process new files for THIS voivodeship grouped by 'sciezki' and 'inne'
    const groupsData = {
      'sciezki': { 'Asfalt': [], 'Kostka': [], 'Szuter': [], 'Utwardzona': [], 'Gruntowa': [], 'Brak danych': [] },
      'inne':    { 'Asfalt': [], 'Kostka': [], 'Szuter': [], 'Utwardzona': [], 'Gruntowa': [], 'Brak danych': [] }
    };

    let voivodeshipNewSegs = 0;
    let voivodeshipFilteredSegs = 0;

    for (const newFile of newFiles) {
      const groupCat = determineGroupCategory(newFile, newDir);
      const surfaceCat = determineSurfaceCategory(newFile);
      const content = fs.readFileSync(newFile, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const segs = extractSegmentsFromLine(line);

        for (const sStr of segs) {
          // Fast path 1: Exact string match
          if (exactWktSet.has(sStr) || exactWktSet.has(reverseCoords(sStr))) {
            voivodeshipFilteredSegs++;
            continue;
          }

          // Fast path 2: Spatial buffer distance check (20m)
          const pts = parseCoords(sStr);
          if (pts.length < 2) continue;

          let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
          for (const p of pts) {
            if (p.lon < minLon) minLon = p.lon;
            if (p.lon > maxLon) maxLon = p.lon;
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
          }

          const minX = Math.floor((minLon - 0.0005) / CELL_SIZE);
          const maxX = Math.floor((maxLon + 0.0005) / CELL_SIZE);
          const minY = Math.floor((minLat - 0.0005) / CELL_SIZE);
          const maxY = Math.floor((maxLat + 0.0005) / CELL_SIZE);

          const candidateMap = new Map();
          for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
              const key = x + '_' + y;
              const cellItems = grid[key];
              if (cellItems) {
                for (let k = 0; k < cellItems.length; k++) {
                  candidateMap.set(cellItems[k].id, cellItems[k]);
                }
              }
            }
          }

          let isExistingRoad = false;
          if (candidateMap.size > 0) {
            let maxVertDist = 0;
            const candidates = Array.from(candidateMap.values());
            for (const pt of pts) {
              let minDistForPt = Infinity;
              for (let c = 0; c < candidates.length; c++) {
                const cand = candidates[c];
                if (pt.lon < cand.minLon - 0.0003 || pt.lon > cand.maxLon + 0.0003 ||
                    pt.lat < cand.minLat - 0.0003 || pt.lat > cand.maxLat + 0.0003) {
                  continue;
                }
                const d = minDistToPolyline(pt, cand.pts);
                if (d < minDistForPt) minDistForPt = d;
              }
              if (minDistForPt > maxVertDist) maxVertDist = minDistForPt;
              if (maxVertDist > DIST_THRESHOLD_METERS) break;
            }
            if (maxVertDist <= DIST_THRESHOLD_METERS) {
              isExistingRoad = true;
            }
          }

          if (isExistingRoad) {
            voivodeshipFilteredSegs++;
          } else {
            if (!groupsData[groupCat][surfaceCat]) {
              groupsData[groupCat][surfaceCat] = [];
            }
            groupsData[groupCat][surfaceCat].push(sStr);
            voivodeshipNewSegs++;
          }
        }
      }
    }

    // 3. Write separate CSV files for 'sciezki' and 'inne' for THIS voivodeship
    const header = 'WKT,Typ nawierzchni\n';
    const targetDir = path.join(diffDir, voivodeship);

    ['sciezki', 'inne'].forEach((groupKey) => {
      const surfaceMap = groupsData[groupKey];
      let groupNewSegs = 0;
      surfaceOrder.forEach(cat => groupNewSegs += (surfaceMap[cat] || []).length);

      if (groupNewSegs === 0) return;

      let currentFileIndex = 1;
      let baseName = `diff_${groupKey}_${dateTag}`;
      let currentFileName = `${baseName}.csv`;
      let targetPath = path.join(targetDir, currentFileName);

      let currentFileContent = header;
      let currentFileBytes = Buffer.byteLength(header, 'utf8');

      surfaceOrder.forEach((cat) => {
        const segs = surfaceMap[cat] || [];
        if (segs.length === 0) return;

        let chunk = [];
        let currentChunkBytes = 0;

        for (let i = 0; i < segs.length; i++) {
          const segStr = segs[i];
          const segByteLen = Buffer.byteLength(segStr, 'utf8') + 4;

          if (chunk.length >= MAX_GEOMS_PER_ROW || (currentChunkBytes + segByteLen > MAX_ROW_BYTES && chunk.length > 0)) {
            const formattedGeoms = chunk.map((s) => `(${s})`).join(', ');
            const wkt = `MULTILINESTRING(${formattedGeoms})`;
            const row = `${escapeCsv(wkt)},${escapeCsv(cat)}\n`;
            const rowBytes = Buffer.byteLength(row, 'utf8');

            if (currentFileBytes + rowBytes > MAX_FILE_BYTES) {
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }
              if (currentFileIndex === 1) {
                targetPath = path.join(targetDir, `${baseName}_1.csv`);
              }
              fs.writeFileSync(targetPath, currentFileContent, 'utf8');
              globalFilesCreated++;

              currentFileIndex++;
              currentFileName = `${baseName}_${currentFileIndex}.csv`;
              targetPath = path.join(targetDir, currentFileName);
              currentFileContent = header;
              currentFileBytes = Buffer.byteLength(header, 'utf8');
            }

            currentFileContent += row;
            currentFileBytes += rowBytes;

            chunk = [];
            currentChunkBytes = 0;
          }

          chunk.push(segStr);
          currentChunkBytes += segByteLen;
        }

        if (chunk.length > 0) {
          const formattedGeoms = chunk.map((s) => `(${s})`).join(', ');
          const wkt = `MULTILINESTRING(${formattedGeoms})`;
          const row = `${escapeCsv(wkt)},${escapeCsv(cat)}\n`;
          const rowBytes = Buffer.byteLength(row, 'utf8');

          if (currentFileBytes + rowBytes > MAX_FILE_BYTES) {
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }
            if (currentFileIndex === 1) {
              targetPath = path.join(targetDir, `${baseName}_1.csv`);
            }
            fs.writeFileSync(targetPath, currentFileContent, 'utf8');
            globalFilesCreated++;

            currentFileIndex++;
            currentFileName = `${baseName}_${currentFileIndex}.csv`;
            targetPath = path.join(targetDir, currentFileName);
            currentFileContent = header;
            currentFileBytes = Buffer.byteLength(header, 'utf8');
          }

          currentFileContent += row;
          currentFileBytes += rowBytes;
        }
      });

      if (currentFileContent.length > header.length) {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        if (currentFileIndex > 1) {
          targetPath = path.join(targetDir, `${baseName}_${currentFileIndex}.csv`);
        } else {
          targetPath = path.join(targetDir, `${baseName}.csv`);
        }
        fs.writeFileSync(targetPath, currentFileContent, 'utf8');
        globalFilesCreated++;
        console.log(`  -> Zapisano plik różnicowy (${groupKey}): ${path.relative(diffDir, targetPath)} (${groupNewSegs} nowych tras)`);
      }
    });

    globalNewSegments += voivodeshipNewSegs;
    globalFilteredSegments += voivodeshipFilteredSegs;
  }

  console.log(`\n=========================================`);
  console.log(`Zakończono wyznaczanie scalonych różnic!`);
  console.log(`Przefiltrowano istniejących odcinków: ${globalFilteredSegments}`);
  console.log(`Znaleziono FAKTYCZNIE NOWYCH odcinków: ${globalNewSegments}`);
  console.log(`Zapisano do ${globalFilesCreated} plików w: ${diffDir}`);
  console.log(`=========================================\n`);
}

const args = process.argv.slice(2);
const oldDir = args[0] || path.join(__dirname, '..', 'exports_260330');
const newDir = args[1] || path.join(__dirname, '..', 'exports_260806');
const diffDir = args[2] || path.join(__dirname, '..', 'exports_diff');

if (!fs.existsSync(oldDir) && fs.existsSync(path.join(__dirname, '..', 'exports'))) {
  console.log(`Wskazówka: Katalog '${oldDir}' nie istnieje. Zmień nazwę istniejącego folderu 'exports' na 'exports_260330'.`);
}

computeDiff(oldDir, newDir, diffDir);
