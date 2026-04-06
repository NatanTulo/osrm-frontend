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
const MAX_ROWS_PER_CSV = 2000; // Keep safely below 2000 for Google My Maps

// Test bounded box (e.g. Gdansk/Sobieszewo area from your screenshots)
const TEST_BBOX = "54.218,18.824,54.341,19.066";
// Approximate bounding box for Poland
const POLAND_BBOX = "48.9,13.8,54.9,24.3"; 

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
  var cycleway = (tags.cycleway || '').toLowerCase();
  var cyclewayBoth = (tags['cycleway:both'] || '').toLowerCase();
  var bicycle = (tags.bicycle || '').toLowerCase();
  var foot = (tags.foot || '').toLowerCase();

  if (/^(cycleway|path|footway|pedestrian|living_street|track)$/.test(highway)) {
    return true;
  }
  if (cycleway && cycleway !== 'no') return true;
  if (cyclewayBoth && cyclewayBoth !== 'no') return true;
  if (isTruthyTag(bicycle) || isTruthyTag(foot)) return true;

  return false;
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

const polishSurface = {
  asphalt: 'Asfalt',
  paved: 'Utwardzona',
  concrete: 'Beton',
  paving_stones: 'Kostka brukowa / Bauma',
  compacted: 'Ubista / żwirowa',
  fine_gravel: 'Drobny szuter',
  gravel: 'Szuter / żwir',
  ground: 'Ziemia',
  dirt: 'Ziemia',
  earth: 'Ubita ziemia',
  sand: 'Piach',
  grass: 'Trawa',
  wood: 'Drewno',
  cobblestone: 'Kocie łby',
  sett: 'Ciosany kamień (sett)'
};

// -----------------------------------------------------
// 3. Helper Functions
// -----------------------------------------------------
function drawProgressBar(current, total, prefix = "Progress:") {
  const barLength = 40;
  let percent = 0;
  let chars = 0;
  if(total > 0) {
      percent = Math.floor((current / total) * 100);
      chars = Math.floor((current / total) * barLength);
  } else {
      percent = 100;
      chars = barLength;
  }
  const emptyChars = barLength - chars;
  const bar = '█'.repeat(chars) + '-'.repeat(emptyChars);
  process.stdout.write(`\r${prefix} [${bar}] ${percent}% (${Math.floor(current/1024/1024)}mb / ${Math.floor(total/1024/1024)}mb)`);
}

function escapeCsv(text) {
  if (!text) return '';
  const stringified = String(text);
  if (stringified.includes('"') || stringified.includes(',') || stringified.includes('\n')) {
    return `"${stringified.replace(/"/g, '""')}"`;
  }
  return stringified;
}

function fetchAndStreamOverpassData(bbox, onlyBikePed, lineTypeFilterEnabled, includedLineTypes, onElement, onDone, onError) {
    const [south, west, north, east] = bbox.split(',');
    const timeout = bbox === POLAND_BBOX ? 900 : 180;
    
    let query = `[out:json][timeout:${timeout}][maxsize:2147483648];\n(\n`;

    if (lineTypeFilterEnabled) {
        Object.keys(includedLineTypes).forEach(tk => {
            if (includedLineTypes[tk]) {
                const parts = tk.split(':');
                if(parts.length === 2) {
                    query += `  way["${parts[0]}"="${parts[1]}"](${south},${west},${north},${east});\n`;
                }
            }
        });
    } else if (!onlyBikePed) {
        query += `  way["highway"](${south},${west},${north},${east});\n`;
        query += `  way["railway"](${south},${west},${north},${east});\n`;
        query += `  way["route"](${south},${west},${north},${east});\n`;
    } else {
        query += `  way["highway"="cycleway"](${south},${west},${north},${east});\n`;
        query += `  way["highway"="path"](${south},${west},${north},${east});\n`;
        query += `  way["highway"="footway"](${south},${west},${north},${east});\n`;
        query += `  way["highway"="pedestrian"](${south},${west},${north},${east});\n`;
        query += `  way["highway"="living_street"](${south},${west},${north},${east});\n`;
        query += `  way["highway"="track"](${south},${west},${north},${east});\n`;
        query += `  way["route"="bicycle"](${south},${west},${north},${east});\n`;
    }
    query += `);\n(._;>;);\nout geom;\n`;

    const postData = `data=${encodeURIComponent(query)}`;
    const isHttps = OVERPASS_URL.startsWith('https');
    const client = isHttps ? https : http;
    const urlObj = new URL(OVERPASS_URL);

    const req = client.request(urlObj, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) return onError(new Error(`API returned status code ${res.statusCode}`));
        
        console.log("\nDownloading and streaming elements directly to disk (this avoids RAM limits)...");
        
        const parser = JSONStream.parse('elements.*');
        res.pipe(parser);
        
        parser.on('data', onElement);
        parser.on('end', onDone);
        parser.on('error', onError);
    });
    
    req.on('error', onError);
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

  // Simple arg parser: node script.js --bbox 1,2,3,4 --categories smooth,compact --bikeped true --linetypes highway:cycleway,highway:path
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

      const filterChoice = await askQuestion("\nDo you want to limit export ONLY to Bicycle Roads & Paths?\nChoose [y/N] (default y): ");
      onlyBikePed = filterChoice.trim().toLowerCase() !== 'n';
      if(onlyBikePed) {
          console.log("-> Limiting to Bicycle Roads & Paths.");
      } else {
          console.log("-> Exporting ALL relevant lines.");
      }
  } else {
      console.log(`Running in CLI mode:\nBBOX: ${bbox}\nCategories: ${allowedCategories.length ? allowedCategories.join(',') : 'ALL'}\nBikePed Only: ${onlyBikePed}`);
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
      
      // Structure: groups[FileGroup][MetadataCombination] = [ "(lon lat, lon lat)", ... ]
      const groups = {};

      fetchAndStreamOverpassData(bbox, onlyBikePed, lineTypeFilterEnabled, includedLineTypes, 
          // onElement
          (el) => {
              if (!el || el.type !== 'way' || !el.geometry || el.geometry.length < 2) return;

              const tags = el.tags || {};
              if (onlyBikePed && !isBikePedWay(tags)) return;
              if (lineTypeFilterEnabled && !matchesSelectedLineType(tags, includedLineTypes)) return;

              const category = classifySurface(tags);
              if (allowedCategories.length > 0 && !allowedCategories.includes(category)) return;

              matchedCount++;
              
              if (matchedCount % 5000 === 0) {
                  process.stdout.write(`\rAnalizowanie ścieżek przez strumień i kompresowanie w MULTILINESTRING: ${matchedCount}...`);
              }

              let coords = [];
              for (let g = 0; g < el.geometry.length; g++) {
                  coords.push(`${el.geometry[g].lon} ${el.geometry[g].lat}`);
              }
              const geomStr = `(${coords.join(', ')})`;
              
              // Extract metadata, normalizing identical names to group perfectly
              const rawName = tags.name || tags.ref;
              const name = rawName ? rawName : 'Brak nazwy';
              
              let plCategory = polishFileCategory[category] || category;
              let plHighway = polishHighway[tags.highway] || tags.highway || '';
              let plSurface = polishSurface[tags.surface] || tags.surface || '';

              let routeGroup = (tags.highway === 'cycleway' || tags.highway === 'path') ? 'Sciezki_Rowerowe' : 'Inne_Drogi';
              let fileGroupKey = `${plCategory}_${routeGroup}`;
              
              // Metadata key used for perfect combination merging
              let subKey = `${name}|${plCategory}|${plHighway}|${plSurface}`;

              if (!groups[fileGroupKey]) groups[fileGroupKey] = {};
              if (!groups[fileGroupKey][subKey]) groups[fileGroupKey][subKey] = [];
              
              groups[fileGroupKey][subKey].push(geomStr);
          },
          // onDone
          () => {
              console.log(`\nZakończono pobieranie pamięci. Pasujących odcinków: ${matchedCount}. Scalanie do plików...`);
              
              const MAX_LINES_PER_CSV = 1900;
              const MAX_GEOMS_PER_ROW = 800; // Limits cell sizes to avoid crashing browsers
              let totalGeneratedFiles = 0;
              
              Object.keys(groups).forEach(fileGroupKey => {
                  const metadataGroups = groups[fileGroupKey];
                  
                  let currentFileIndex = 1;
                  let currentRowCount = 0;
                  
                  let filePath = path.join(exportDir, `${fileGroupKey}_${currentFileIndex}.csv`);
                  fs.writeFileSync(filePath, "WKT,Nazwa,Grupa jakościowa,Typ ścieżki,Tag nawierzchni OSM\n", 'utf8');
                  totalGeneratedFiles++;
                  
                  Object.keys(metadataGroups).forEach(subKey => {
                      const [name, category, highway, surface] = subKey.split('|');
                      const geomCollection = metadataGroups[subKey];
                      
                      // Chunk huge networks of exactly same metadata to avoid Google Maps cell text length explosions
                      for (let i = 0; i < geomCollection.length; i += MAX_GEOMS_PER_ROW) {
                          const chunkGeoms = geomCollection.slice(i, i + MAX_GEOMS_PER_ROW);
                          const wkt = `MULTILINESTRING(${chunkGeoms.join(', ')})`;
                          
                          const row = [
                              escapeCsv(wkt),
                              escapeCsv(name),
                              escapeCsv(category),
                              escapeCsv(highway),
                              escapeCsv(surface)
                          ].join(',');
                          
                          fs.appendFileSync(filePath, row + "\n", 'utf8');
                          currentRowCount++;
                          
                          // Roll file over if limits reached
                          if (currentRowCount >= MAX_LINES_PER_CSV) {
                              currentFileIndex++;
                              currentRowCount = 0;
                              filePath = path.join(exportDir, `${fileGroupKey}_${currentFileIndex}.csv`);
                              fs.writeFileSync(filePath, "WKT,Nazwa,Grupa jakościowa,Typ ścieżki,Tag nawierzchni OSM\n", 'utf8');
                              totalGeneratedFiles++;
                          }
                      }
                  });
              });

              console.log(`\nWyeksportowano poprawnie łącznie ${matchedCount} pojedynczych odcinków tras! 🎉`);
              console.log(`Ogromne zbiory zostały skompresowane poprzez MULTILINESTRING i zmieszczone w zaledwie ${totalGeneratedFiles} pliku/ach!`);
              console.log(`Bez problemu przyjmie je teraz Google My Maps bez błędów o limitach 2000 wierszy.`);
              console.log(`Otwórz folder: ${exportDir} i wgraj pliki na nowo.`);
              rl.close();
              process.exit(0);
          },
          // onError
          (err) => {
              console.error(`\n[ERROR]: ${err.message}`);
              rl.close();
              process.exit(1);
          }
      );
  } catch (err) {
      console.error(`\n[ERROR]: ${err.message}`);
      rl.close();
      process.exit(1);
  }
}

run();
