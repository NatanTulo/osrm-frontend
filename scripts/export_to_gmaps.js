const fs = require('fs');
const http = require('http');
const https = require('https');
const readline = require('readline');
const path = require('path');
let JSONStream;
try {
    JSONStream = require('JSONStream');
} catch(e) {
    console.error("Zanim uruchomisz skrypt dla tak potężnej bazy danych jak cała Polska, musisz zainstalować paczkę JSONStream!");
    console.error("Wpisz w terminalu: npm install JSONStream");
    process.exit(1);
}

// -----------------------------------------------------
// 1. Configuration & Constants
// -----------------------------------------------------
const OVERPASS_URL = 'http://127.0.0.1:12345/api/interpreter';
const OVERPASS_REQUEST_TIMEOUT_MS = 12 * 60 * 1000;
const OVERPASS_MAX_RETRIES = 4;

// Test bounded box (e.g. Gdansk/Sobieszewo area from your screenshots)
const TEST_BBOX = "54.218,18.824,54.341,19.066";
// Approximate bounding box for Poland
const POLAND_BBOX = "48.9,13.8,54.9,24.3"; 

const VOIVODESHIPS = [
    { iso: 'PL-02', folder: 'Dolnoslaskie', label: 'Dolnoslaskie' },
    { iso: 'PL-04', folder: 'Kujawsko_Pomorskie', label: 'Kujawsko-Pomorskie' },
    { iso: 'PL-06', folder: 'Lubelskie', label: 'Lubelskie' },
    { iso: 'PL-08', folder: 'Lubuskie', label: 'Lubuskie' },
    { iso: 'PL-10', folder: 'Lodzkie', label: 'Lodzkie' },
    { iso: 'PL-12', folder: 'Malopolskie', label: 'Malopolskie' },
    { iso: 'PL-14', folder: 'Mazowieckie', label: 'Mazowieckie' },
    { iso: 'PL-16', folder: 'Opolskie', label: 'Opolskie' },
    { iso: 'PL-18', folder: 'Podkarpackie', label: 'Podkarpackie' },
    { iso: 'PL-20', folder: 'Podlaskie', label: 'Podlaskie' },
    { iso: 'PL-22', folder: 'Pomorskie', label: 'Pomorskie' },
    { iso: 'PL-24', folder: 'Slaskie', label: 'Slaskie' },
    { iso: 'PL-26', folder: 'Swietokrzyskie', label: 'Swietokrzyskie' },
    { iso: 'PL-28', folder: 'Warminsko_Mazurskie', label: 'Warminsko-Mazurskie' },
    { iso: 'PL-30', folder: 'Wielkopolskie', label: 'Wielkopolskie' },
    { iso: 'PL-32', folder: 'Zachodniopomorskie', label: 'Zachodniopomorskie' }
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

// -----------------------------------------------------
// 2. Logic Copied from frontend (surface_layer.js)
// -----------------------------------------------------
function isTruthyTag(value) {
  return /^(yes|designated|official|permissive|destination|use_sidepath)$/.test((value || '').toLowerCase());
}

function isBikePedWay(tags) {
  var highway = (tags.highway || '').toLowerCase();
    return /^(cycleway|path|track|service)$/.test(highway);
}

function classifySurface(tags) {
  var surface = (tags.surface || '').toLowerCase();
  var tracktype = (tags.tracktype || '').toLowerCase();

  if (/^(asphalt|concrete|concrete:lanes|concrete:plates|paved)$/.test(surface) || tracktype === 'grade1') {
    return 'smooth';
  }
  if (/^(paving_stones|sett|cobblestone|unhewn_cobblestone|metal|wood)$/.test(surface)) {
    return 'cobbles';
  }
  if (/^(compacted|fine_gravel|stabilized)$/.test(surface) || tracktype === 'grade2') {
    return 'compact';
  }
  if (/^(gravel|pebblestone|chipseal|rock|stones|stone)$/.test(surface) || /^(grade3|grade4)$/.test(tracktype)) {
    return 'gravel';
  }
  if (/^(ground|dirt|earth|mud|sand|grass|grass_paver)$/.test(surface) || tracktype === 'grade5') {
    return 'rough';
  }
  return 'unknown'; // No Data
}
function matchesSelectedLineType(tags, includedLineTypes) {
  for (var optionKey in includedLineTypes) {
    if (!includedLineTypes[optionKey]) continue;
    var index = optionKey.indexOf(':');
    if (index <= 0) continue;
    
    var tagKey = optionKey.slice(0, index);
    var value = optionKey.slice(index + 1);
    
    var tagValue = (tags[tagKey] || '').toLowerCase();
    if (tagValue === value) return true;
  }
  return false;
}

const polishFileCategory = {
  smooth: 'Asfalt',
  cobbles: 'Kostka',
  compact: 'Utwardzona',
  gravel: 'Szuter',
  rough: 'Gruntowa',
  unknown: 'Brak_danych'
};

const polishHighway = {
  cycleway: 'Droga rowerowa',
  path: 'Ścieżka',
  footway: 'Chodnik',
  pedestrian: 'Deptak',
  living_street: 'Strefa zamieszkania',
  track: 'Droga leśna/techniczna',
  residential: 'Droga osiedlowa',
  service: 'Droga dojazdowa',
  unclassified: 'Droga lokalna',
  tertiary: 'Ulica (tertiary)',
  secondary: 'Ulica (secondary)',
  primary: 'Droga główna'
};


// -----------------------------------------------------
// 3. Helper Functions
// -----------------------------------------------------

function escapeCsv(text) {
  if (!text) return '';
  const stringified = String(text);
  if (stringified.includes('"') || stringified.includes(',') || stringified.includes('\n')) {
    return `"${stringified.replace(/"/g, '""')}"`;
  }
  return stringified;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function haversineDistance(lon1, lat1, lon2, lat2) {
  const R = 6371e3; // Promień Ziemi w metrach
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function appendWayFilters(queryParts, locatorExpr, onlyBikePed, lineTypeFilterEnabled, includedLineTypes) {
    if (lineTypeFilterEnabled) {
        Object.keys(includedLineTypes).forEach(tk => {
            if (includedLineTypes[tk]) {
                const parts = tk.split(':');
                if (parts.length === 2) {
                    queryParts.push(`  way["${parts[0]}"="${parts[1]}"]${locatorExpr};`);
                }
            }
        });
        return;
    }

    if (!onlyBikePed) {
        queryParts.push(`  way["highway"]${locatorExpr};`);
        queryParts.push(`  way["railway"]${locatorExpr};`);
        queryParts.push(`  way["route"]${locatorExpr};`);
        return;
    }

    queryParts.push(`  way["highway"="cycleway"]${locatorExpr};`);
    queryParts.push(`  way["highway"="path"]${locatorExpr};`);
    queryParts.push(`  way["highway"="track"]${locatorExpr};`);
    queryParts.push(`  way["highway"="service"]${locatorExpr};`);
}

function buildOverpassQueryByBbox(bbox, onlyBikePed, lineTypeFilterEnabled, includedLineTypes) {
    const [south, west, north, east] = bbox.split(',');
    const timeout = bbox === POLAND_BBOX ? 900 : 180;
    const locatorExpr = `(${south},${west},${north},${east})`;

    const queryParts = [`[out:json][timeout:${timeout}][maxsize:2147483648];`, '('];
    appendWayFilters(queryParts, locatorExpr, onlyBikePed, lineTypeFilterEnabled, includedLineTypes);
    queryParts.push(');');
    queryParts.push('(._;>;);');
    queryParts.push('out geom;');
    return queryParts.join('\n');
}

function buildOverpassQueryByVoivodeship(isoCode, onlyBikePed, lineTypeFilterEnabled, includedLineTypes) {
    const timeout = 900;
    const locatorExpr = '(area.searchArea)';

    const queryParts = [
        `[out:json][timeout:${timeout}][maxsize:2147483648];`,
        `relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"="${isoCode}"]->.admin;`,
        '.admin map_to_area -> .searchArea;',
        '('
    ];
    appendWayFilters(queryParts, locatorExpr, onlyBikePed, lineTypeFilterEnabled, includedLineTypes);
    queryParts.push(');');
    queryParts.push('(._;>;);');
    queryParts.push('out geom;');
    return queryParts.join('\n');
}

function fetchAndStreamOverpassData(query, onElement, onDone, onError) {

    const postData = `data=${encodeURIComponent(query)}`;
    const isHttps = OVERPASS_URL.startsWith('https');
    const client = isHttps ? https : http;
    const urlObj = new URL(OVERPASS_URL);

    let finished = false;
    let hardTimeoutHandle = null;
    const finishWithError = (err) => {
        if (finished) return;
        finished = true;
        if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle);
        onError(err);
    };
    const finishWithDone = () => {
        if (finished) return;
        finished = true;
        if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle);
        onDone();
    };

    const req = client.request(urlObj, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8'
        }
    }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
            let errorBody = '';
            res.on('data', (chunk) => {
                if (errorBody.length < 4096) {
                    errorBody += chunk.toString('utf8');
                }
            });
            res.on('end', () => {
                const compactBody = (errorBody || '').replace(/\s+/g, ' ').trim();
                const bodyPreview = compactBody ? ` | body: ${compactBody.slice(0, 500)}` : '';
                finishWithError(new Error(`API returned status code ${res.statusCode}${bodyPreview}`));
            });
            return;
        }
        
        console.log("\nDownloading and streaming elements directly to disk (this avoids RAM limits)...");

        let firstChunkHandled = false;
        res.once('data', (firstChunk) => {
            firstChunkHandled = true;
            const firstText = firstChunk.toString('utf8');
            const firstNonWs = firstText.replace(/^\s+/, '');

            if (firstNonWs.startsWith('<')) {
                let xmlBody = firstText;
                res.on('data', (chunk) => {
                    if (xmlBody.length < 4096) {
                        xmlBody += chunk.toString('utf8');
                    }
                });
                res.on('end', () => {
                    const compactBody = xmlBody.replace(/\s+/g, ' ').trim();
                    finishWithError(new Error(`API returned XML/HTML instead of JSON: ${compactBody.slice(0, 500)}`));
                });
                return;
            }

            const parser = JSONStream.parse('elements.*');
            parser.on('data', onElement);
            parser.on('end', finishWithDone);
            parser.on('error', finishWithError);

            parser.write(firstChunk);
            res.pipe(parser);
        });

        res.on('end', () => {
            if (!firstChunkHandled) {
                finishWithDone();
            }
        });
    });

    req.setTimeout(OVERPASS_REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`Request timed out after ${OVERPASS_REQUEST_TIMEOUT_MS}ms`));
    });

    hardTimeoutHandle = setTimeout(() => {
        req.destroy(new Error(`Hard request timeout after ${OVERPASS_REQUEST_TIMEOUT_MS}ms`));
    }, OVERPASS_REQUEST_TIMEOUT_MS);

    req.on('error', finishWithError);
    req.write(postData);
    req.end();
}

// -----------------------------------------------------
// 4. Main Export Script
// -----------------------------------------------------
async function run() {
  console.log("=========================================");
  console.log("  OSM to Google My Maps Export Tool");
  console.log("=========================================\n");

  const args = process.argv.slice(2);
  let bbox = TEST_BBOX;
  let allowedCategories = [];
  let onlyBikePed = true;
  let lineTypeFilterEnabled = false;
  let includedLineTypes = {};
    let splitByVoivodeship = false;

    // Simple arg parser: node script.js --bbox 1,2,3,4 --categories smooth,compact --bikeped true --linetypes highway:cycleway,highway:path --split-voivodeships true
  let isInteractive = true;
  for (let i = 0; i < args.length; i++) {
      if (args[i] === '--bbox' && args[i+1]) {
          bbox = args[i+1];
          isInteractive = false;
      }
      if (args[i] === '--categories' && args[i+1]) {
          const cats = args[i+1];
          if (cats.toLowerCase() === 'all') {
             allowedCategories = [];
          } else {
             allowedCategories = cats.split(',').map(s => s.trim().toLowerCase());
          }
          isInteractive = false;
      }
      if (args[i] === '--bikeped' && args[i+1]) {
          onlyBikePed = args[i+1] === 'true';
          isInteractive = false;
      }
      if (args[i] === '--linetypes' && args[i+1]) {
          lineTypeFilterEnabled = true;
          if (args[i+1] !== 'none') {
             args[i+1].split(',').forEach(tk => includedLineTypes[tk] = true);
          }
          isInteractive = false;
      }
      if (args[i] === '--split-voivodeships' && args[i+1]) {
          splitByVoivodeship = args[i+1] === 'true';
          isInteractive = false;
      }
  }

  if (isInteractive) {
      const areaChoice = await askQuestion("Select area to export:\n  1) Test Bounding Box (Gdansk/Sobieszewo region)\n  2) Whole Poland (Takes significantly longer)\nChoose [1/2] (default 1): ");
      
      if(areaChoice.trim() === '2') {
          bbox = POLAND_BBOX;
          console.log("-> Selected Whole Poland.");
      } else {
          console.log("-> Selected Test Bounding Box.");
      }

      const categoryInput = await askQuestion("\nWhich layers/surfaces do you want to export?\nOptions: smooth, cobbles, compact, gravel, rough, unknown\nType comma-separated values, or leave completely empty to export ALL default: ");
      if (categoryInput.trim() !== '') {
          allowedCategories = categoryInput.split(',').map(s => s.trim().toLowerCase());
          console.log(`-> Selected categories: ${allowedCategories.join(', ')}`);
      } else {
          console.log("-> Selected ALL categories.");
      }

      const filterChoice = await askQuestion("\nDo you want to limit export ONLY to bicycle roads + paths + tracks/service roads + driveways/service roads?\nChoose [y/N] (default y): ");
      onlyBikePed = filterChoice.trim().toLowerCase() !== 'n';
      if(onlyBikePed) {
          console.log("-> Limiting to bicycle roads, paths, tracks/service roads and driveways/service roads.");
      } else {
          console.log("-> Exporting ALL relevant lines.");
      }

      const splitChoice = await askQuestion("\nSplit exported files into separate voivodeship folders?\nChoose [y/N] (default n): ");
      splitByVoivodeship = splitChoice.trim().toLowerCase() === 'y';
      if (splitByVoivodeship) {
          console.log("-> Export will be split by voivodeship folders.");
      } else {
          console.log("-> Export without voivodeship split.");
      }
  } else {
      console.log(`Running in CLI mode:\nBBOX: ${bbox}\nCategories: ${allowedCategories.length ? allowedCategories.join(',') : 'ALL'}\nBikePed Only: ${onlyBikePed}\nSplit by voivodeship: ${splitByVoivodeship}`);
  }

  // Build the script output directory
  const rootPath = path.resolve(__dirname, '..');
  const exportDir = path.join(rootPath, "exports");
  if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir);
  }

  console.log(`\nStarting fetch from ${OVERPASS_URL}...`);
  console.log(`This may take several minutes if 'Whole Poland' is selected.`);
  
  if (bbox === POLAND_BBOX && OVERPASS_URL.includes("127.0.0.1")) {
      console.log("Hint: You are using the local Overpass instance which is great for large queries.");
  }

  try {
      let matchedCount = 0;
      let totalGeneratedFiles = 0;
      let totalRejectedCount = 0;
      let totalKeptCount = 0;

      const sciezkiDir = path.join(exportDir, 'Sciezki_Rowerowe');
      const inneDir = path.join(exportDir, 'Inne_Drogi');
      if (!fs.existsSync(sciezkiDir)) fs.mkdirSync(sciezkiDir);
      if (!fs.existsSync(inneDir)) fs.mkdirSync(inneDir);

      const MIN_LENGTH_BY_GROUP = {
          'Sciezki_Rowerowe': 75.0,
          'Inne_Drogi': 400.0,
      };
      const MAX_FILE_BYTES = 20 * 1024 * 1024;
      const MAX_GEOMS_PER_ROW = 800;
      const CSV_HEADER = 'WKT,Typ ścieżki\n';

      const createBatchState = (forcedVoivodeshipFolder) => {
          const ways = [];
          const coordToWayIds = new Map();
          const ufParent = [];

          const find = (i) => {
              if (ufParent[i] === i) return i;
              return ufParent[i] = find(ufParent[i]);
          };
          const union = (i, j) => {
              const rootI = find(i);
              const rootJ = find(j);
              if (rootI !== rootJ) {
                  ufParent[rootI] = rootJ;
              }
          };

          const handleElement = (el) => {
              if (!el || el.type !== 'way' || !el.geometry || el.geometry.length < 2) return;

              const tags = el.tags || {};
              if (onlyBikePed && !isBikePedWay(tags)) return;
              if (lineTypeFilterEnabled && !matchesSelectedLineType(tags, includedLineTypes)) return;

              const category = classifySurface(tags);
              if (allowedCategories.length > 0 && !allowedCategories.includes(category)) return;

              matchedCount++;
              if (matchedCount % 5000 === 0) {
                  process.stdout.write(`\rOdbieranie ścieżek przez strumień i analiza... ${matchedCount}`);
              }

              let wayLength = 0;
              let coords = [];
              for (let g = 0; g < el.geometry.length; g++) {
                  coords.push(`${el.geometry[g].lon} ${el.geometry[g].lat}`);
                  if (g > 0) {
                      wayLength += haversineDistance(
                          el.geometry[g - 1].lon, el.geometry[g - 1].lat,
                          el.geometry[g].lon, el.geometry[g].lat
                      );
                  }
              }

              const geomStr = `(${coords.join(', ')})`;
              let plCategory = polishFileCategory[category] || category;
              let plHighway = polishHighway[tags.highway] || tags.highway || '';
              let routeGroup = (tags.highway === 'cycleway' || tags.highway === 'path') ? 'Sciezki_Rowerowe' : 'Inne_Drogi';
              let fileGroupKey = `${plCategory}_${routeGroup}`;
              let subKey = plHighway;
              const voivodeshipFolder = splitByVoivodeship ? (forcedVoivodeshipFolder || 'Nieprzypisane') : null;

              const index = ways.length;
              ways.push({ geomStr, length: wayLength, subKey, fileGroupKey, voivodeshipFolder });
              ufParent.push(index);

              for (let c = 0; c < coords.length; c++) {
                  const ptWithGroup = coords[c] + '|' + routeGroup;
                  const existing = coordToWayIds.get(ptWithGroup);
                  if (existing !== undefined) {
                      if (typeof existing === 'number') {
                          coordToWayIds.set(ptWithGroup, [existing, index]);
                          union(existing, index);
                      } else {
                          existing.push(index);
                          union(existing[0], index);
                      }
                  } else {
                      coordToWayIds.set(ptWithGroup, index);
                  }
              }
          };

          return { ways, find, handleElement };
      };

      const processBatchAndWriteFiles = (ways, find) => {
          if (ways.length === 0) {
              return { rejectedCount: 0, keptCount: 0, generatedFiles: 0 };
          }

          const componentLength = new Float64Array(ways.length);
          for (let i = 0; i < ways.length; i++) {
              const root = find(i);
              componentLength[root] += ways[i].length;
          }

          const groups = {};
          let rejectedCount = 0;
          let keptCount = 0;

          for (let i = 0; i < ways.length; i++) {
              const way = ways[i];
              const root = find(i);
              const routeGroup = way.fileGroupKey.includes('Sciezki_Rowerowe') ? 'Sciezki_Rowerowe' : 'Inne_Drogi';
              const minLength = MIN_LENGTH_BY_GROUP[routeGroup] ?? 75.0;
              const isAccepted = componentLength[root] >= minLength;

              if (!isAccepted) {
                  rejectedCount++;
                  continue;
              }
              keptCount++;

              var groupStorageKey = splitByVoivodeship ? (way.voivodeshipFolder + '|' + way.fileGroupKey) : way.fileGroupKey;

              if (!groups[groupStorageKey]) groups[groupStorageKey] = {};
              if (!groups[groupStorageKey][way.subKey]) groups[groupStorageKey][way.subKey] = [];
              groups[groupStorageKey][way.subKey].push(way.geomStr);
          }

          let generatedFiles = 0;
          Object.keys(groups).forEach(storageKey => {
              const metadataGroups = groups[storageKey];
              let currentFileIndex = 1;
              let currentFileBytes = 0;

              let fileGroupKey = storageKey;
              let voivodeshipFolder = null;
              if (splitByVoivodeship) {
                  const separatorIndex = storageKey.indexOf('|');
                  if (separatorIndex > -1) {
                      voivodeshipFolder = storageKey.slice(0, separatorIndex);
                      fileGroupKey = storageKey.slice(separatorIndex + 1);
                  }
              }

              let targetSubDir = fileGroupKey.includes('Sciezki_Rowerowe') ? sciezkiDir : inneDir;
              if (splitByVoivodeship && voivodeshipFolder) {
                  targetSubDir = path.join(targetSubDir, voivodeshipFolder);
              }
              if (!fs.existsSync(targetSubDir)) {
                  fs.mkdirSync(targetSubDir, { recursive: true });
              }

              let filePath = path.join(targetSubDir, `${fileGroupKey}_${currentFileIndex}.csv`);
              fs.writeFileSync(filePath, CSV_HEADER, 'utf8');
              currentFileBytes = Buffer.byteLength(CSV_HEADER, 'utf8');
              generatedFiles++;

              Object.keys(metadataGroups).forEach(highway => {
                  const geomCollection = metadataGroups[highway];

                  for (let i = 0; i < geomCollection.length; i += MAX_GEOMS_PER_ROW) {
                      const chunkGeoms = geomCollection.slice(i, i + MAX_GEOMS_PER_ROW);
                      const wkt = `MULTILINESTRING(${chunkGeoms.join(', ')})`;
                      const row = escapeCsv(wkt) + ',' + escapeCsv(highway) + '\n';
                      const rowBytes = Buffer.byteLength(row, 'utf8');

                      if (currentFileBytes + rowBytes > MAX_FILE_BYTES) {
                          currentFileIndex++;
                          currentFileBytes = Buffer.byteLength(CSV_HEADER, 'utf8');
                          filePath = path.join(targetSubDir, `${fileGroupKey}_${currentFileIndex}.csv`);
                          fs.writeFileSync(filePath, CSV_HEADER, 'utf8');
                          generatedFiles++;
                      }

                      fs.appendFileSync(filePath, row, 'utf8');
                      currentFileBytes += rowBytes;
                  }
              });
          });

          return { rejectedCount, keptCount, generatedFiles };
      };

      const fetchByQuery = (query, forcedVoivodeshipFolder) => {
          const runFetchAttempt = () => {
              return new Promise((resolve, reject) => {
                  const batchState = createBatchState(forcedVoivodeshipFolder);
                  fetchAndStreamOverpassData(
                      query,
                      (el) => batchState.handleElement(el),
                      () => resolve(batchState),
                      reject
                  );
              });
          };

          return (async () => {
              let lastError = null;
              for (let attempt = 1; attempt <= OVERPASS_MAX_RETRIES; attempt++) {
                  try {
                      const batchState = await runFetchAttempt();
                      return batchState;
                  } catch (err) {
                      lastError = err;
                      if (attempt >= OVERPASS_MAX_RETRIES) {
                          break;
                      }
                      const waitMs = attempt * 5000;
                      console.log(`Zapytanie nie powiodlo sie (proba ${attempt}/${OVERPASS_MAX_RETRIES}): ${err.message}`);
                      console.log(`Ponowienie za ${Math.round(waitMs / 1000)}s...`);
                      await sleep(waitMs);
                  }
              }
              throw lastError;
          })();
      };

      if (splitByVoivodeship) {
          console.log('Podzial po wojewodztwach: pobieranie po dokladnych granicach administracyjnych (Overpass area).');
          for (let i = 0; i < VOIVODESHIPS.length; i++) {
              const voivodeship = VOIVODESHIPS[i];
              console.log(`\n[${i + 1}/${VOIVODESHIPS.length}] Pobieranie: ${voivodeship.label} (${voivodeship.iso})...`);
              const query = buildOverpassQueryByVoivodeship(
                  voivodeship.iso,
                  onlyBikePed,
                  lineTypeFilterEnabled,
                  includedLineTypes
              );
              const batchState = await fetchByQuery(query, voivodeship.folder);
              const stats = processBatchAndWriteFiles(batchState.ways, batchState.find);
              totalRejectedCount += stats.rejectedCount;
              totalKeptCount += stats.keptCount;
              totalGeneratedFiles += stats.generatedFiles;
          }
      } else {
          const query = buildOverpassQueryByBbox(bbox, onlyBikePed, lineTypeFilterEnabled, includedLineTypes);
          const batchState = await fetchByQuery(query, null);
          const stats = processBatchAndWriteFiles(batchState.ways, batchState.find);
          totalRejectedCount += stats.rejectedCount;
          totalKeptCount += stats.keptCount;
          totalGeneratedFiles += stats.generatedFiles;
      }

      console.log(`\nZakończono pobieranie pamięci. Pasujących odcinków: ${matchedCount}.`);
      console.log(`Odrzucono ${totalRejectedCount} mikroskopijnych odłamków (<75m). Scalanie ${totalKeptCount} odcinków do plików CSV...`);

      console.log(`\nWyeksportowano poprawnie do ${totalGeneratedFiles} pliku/ach! 🎉`);
      if (splitByVoivodeship) {
          console.log(`Pliki zostały podzielone na wojewodztwa i umieszczone w podfolderach wewnatrz: ${exportDir}`);
      } else {
          console.log(`Pliki zostały umieszczone w podfolderach wewnątrz: ${exportDir}`);
      }
      rl.close();
      process.exit(0);

  } catch (err) {
      console.error(`\n[ERROR]: ${err.message}`);
      rl.close();
      process.exit(1);
  }
}

run();
