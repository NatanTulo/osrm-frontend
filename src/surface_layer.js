'use strict';

var L = require('leaflet');

var LEGEND_ITEMS = [
  { key: 'smooth', label: 'Asphalt / concrete / paved' },
  { key: 'cobbles', label: 'Cobblestone / sett' },
  { key: 'compact', label: 'Compacted' },
  { key: 'gravel', label: 'Gravel / coarse gravel' },
  { key: 'rough', label: 'Ground / sand / mud' },
  { key: 'unknown', label: 'No data' }
];

var EXTRA_FILTER_ITEMS = [
  { key: 'onlyBikePed', label: 'Only sidewalks / bicycle roads and paths' },
  { key: 'splitByVoivodeship', label: 'Split export into voivodeship folders' }
];

var DYNAMIC_LINE_TAG_KEYS = [
  'highway',
  'railway',
  'waterway',
  'aerialway',
  'route',
  'power',
  'barrier',
  'man_made',
  'natural',
  'boundary',
  'landuse'
];

var DYNAMIC_TAG_GROUP_LABELS = {
  route: 'Routes and transport lines',
  power: 'Power infrastructure',
  barrier: 'Barriers',
  man_made: 'Man-made structures',
  natural: 'Natural features',
  boundary: 'Boundaries',
  landuse: 'Land use'
};

var LINE_TYPE_GROUPS = {
  bikeped: {
    title: 'Bike and pedestrians',
    options: [
      { tagKey: 'highway', value: 'cycleway', label: 'Bicycle roads' },
      { tagKey: 'highway', value: 'track', label: 'Tracks and service roads' },
      { tagKey: 'highway', value: 'path', label: 'Paths' },
      { tagKey: 'highway', value: 'footway', label: 'Sidewalks' },
      { tagKey: 'highway', value: 'pedestrian', label: 'Pedestrian streets' },
      { tagKey: 'highway', value: 'steps', label: 'Steps' }
    ]
  },
  local: {
    title: 'Local roads',
    options: [
      { tagKey: 'highway', value: 'residential', label: 'Residential streets' },
      { tagKey: 'highway', value: 'unclassified', label: 'Local access roads' },
      { tagKey: 'highway', value: 'living_street', label: 'Living streets' },
      { tagKey: 'highway', value: 'service', label: 'Driveways and service roads' }
    ]
  },
  rail: {
    title: 'Rail and tram',
    options: [
      { tagKey: 'railway', value: 'rail', label: 'Rail lines' },
      { tagKey: 'railway', value: 'tram', label: 'Tram lines' },
      { tagKey: 'railway', value: 'light_rail', label: 'Light rail' },
      { tagKey: 'railway', value: 'subway', label: 'Subway' },
      { tagKey: 'railway', value: 'narrow_gauge', label: 'Narrow gauge rail' },
      { tagKey: 'railway', value: 'monorail', label: 'Monorail' }
    ]
  },
  ferry: {
    title: 'Ferry crossings',
    options: [
      { tagKey: 'route', value: 'ferry', label: 'Ferry routes' }
    ]
  },
  main: {
    title: 'Main roads',
    options: [
      { tagKey: 'highway', value: 'primary', label: 'Primary' },
      { tagKey: 'highway', value: 'primary_link', label: 'Primary links' },
      { tagKey: 'highway', value: 'secondary', label: 'Secondary' },
      { tagKey: 'highway', value: 'secondary_link', label: 'Secondary links' },
      { tagKey: 'highway', value: 'tertiary', label: 'Tertiary' },
      { tagKey: 'highway', value: 'tertiary_link', label: 'Tertiary links' }
    ]
  },
  fast: {
    title: 'High-speed roads',
    options: [
      { tagKey: 'highway', value: 'motorway', label: 'Motorways' },
      { tagKey: 'highway', value: 'motorway_link', label: 'Motorway links' },
      { tagKey: 'highway', value: 'trunk', label: 'Trunk roads' },
      { tagKey: 'highway', value: 'trunk_link', label: 'Trunk links' }
    ]
  },
  water: {
    title: 'Waterways',
    options: [
      { tagKey: 'waterway', value: 'river', label: 'Rivers' },
      { tagKey: 'waterway', value: 'canal', label: 'Canals' },
      { tagKey: 'waterway', value: 'stream', label: 'Streams' },
      { tagKey: 'waterway', value: 'drain', label: 'Drainage ditches' },
      { tagKey: 'waterway', value: 'ditch', label: 'Ditches' }
    ]
  },
  aerial: {
    title: 'Aerial lifts',
    options: [
      { tagKey: 'aerialway', value: 'cable_car', label: 'Cable cars' },
      { tagKey: 'aerialway', value: 'gondola', label: 'Gondolas' },
      { tagKey: 'aerialway', value: 'chair_lift', label: 'Chair lifts' },
      { tagKey: 'aerialway', value: 'drag_lift', label: 'Drag lifts' },
      { tagKey: 'aerialway', value: 'magic_carpet', label: 'Magic carpets' }
    ]
  }
};

var LINE_TYPE_FILTER_SECTIONS = [
  { title: 'Local mobility', groups: ['bikeped', 'local'], open: true },
  { title: 'Rail and water', groups: ['rail', 'ferry'], open: false },
  { title: 'Main and high-speed', groups: ['main', 'fast'], open: false },
  { title: 'Other', groups: ['water', 'aerial'], includeDynamic: true, open: false }
];

function makeLineTypeKey(tagKey, value) {
  return tagKey + ':' + value;
}

function formatTagValueLabel(value) {
  var text = (value || '').replace(/_/g, ' ');
  if (!text) {
    return value;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseLineTypeKey(optionKey) {
  var index = optionKey.indexOf(':');
  if (index <= 0) {
    return null;
  }

  return {
    tagKey: optionKey.slice(0, index),
    value: optionKey.slice(index + 1)
  };
}

function collectDynamicLineTypeOptions(elements, knownLineTypeKeys) {
  var buckets = {};
  var maxPerGroup = 30;

  for (var i = 0; i < elements.length; i++) {
    var element = elements[i];
    if (!element || element.type !== 'way' || !element.tags) {
      continue;
    }

    var tags = element.tags;
    for (var k = 0; k < DYNAMIC_LINE_TAG_KEYS.length; k++) {
      var tagKey = DYNAMIC_LINE_TAG_KEYS[k];
      var rawValue = tags[tagKey];
      if (!rawValue) {
        continue;
      }

      var value = String(rawValue).toLowerCase();
      if (!value || value === 'no') {
        continue;
      }

      var optionKey = makeLineTypeKey(tagKey, value);
      if (knownLineTypeKeys[optionKey]) {
        continue;
      }

      if (!buckets[tagKey]) {
        buckets[tagKey] = {};
      }
      if (!buckets[tagKey][value]) {
        buckets[tagKey][value] = 0;
      }
      buckets[tagKey][value] += 1;
    }
  }

  var dynamicGroups = [];
  for (var groupKey in buckets) {
    var values = Object.keys(buckets[groupKey]);
    values.sort(function(a, b) {
      return buckets[groupKey][b] - buckets[groupKey][a];
    });

    var options = [];
    for (var v = 0; v < values.length && v < maxPerGroup; v++) {
      options.push({
        tagKey: groupKey,
        value: values[v],
        label: formatTagValueLabel(values[v])
      });
    }

    if (options.length > 0) {
      dynamicGroups.push({
        title: DYNAMIC_TAG_GROUP_LABELS[groupKey] || ('Other: ' + groupKey),
        options: options
      });
    }
  }

  dynamicGroups.sort(function(a, b) {
    return a.title.localeCompare(b.title);
  });
  return dynamicGroups;
}

function hasAnySelectedLineType(includedLineTypes) {
  for (var key in includedLineTypes) {
    if (includedLineTypes[key]) {
      return true;
    }
  }
  return false;
}

function matchesSelectedLineType(tags, includedLineTypes) {
  for (var optionKey in includedLineTypes) {
    if (!includedLineTypes[optionKey]) {
      continue;
    }

    var parsed = parseLineTypeKey(optionKey);
    if (!parsed) {
      continue;
    }

    var tagValue = (tags[parsed.tagKey] || '').toLowerCase();
    if (tagValue === parsed.value) {
      return true;
    }
  }
  return false;
}

function isBikePedWay(tags) {
  var highway = (tags.highway || '').toLowerCase();
  return /^(cycleway|track|path|service)$/.test(highway);
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

  return 'unknown';
}

function styleFor(category) {
  var styles = {
    smooth: { color: '#2ca25f', weight: 4, opacity: 0.9 },
    cobbles: { color: '#f16913', weight: 4, opacity: 0.9, dashArray: '1,6' },
    compact: { color: '#fec44f', weight: 4, opacity: 0.9 },
    gravel: { color: '#8c6d31', weight: 4, opacity: 0.9, dashArray: '10,6' },
    rough: { color: '#cb181d', weight: 4, opacity: 0.9, dashArray: '4,8' },
    unknown: { color: '#6b7280', weight: 3, opacity: 0.7, dashArray: '2,8' }
  };

  return styles[category] || styles.unknown;
}

function createLegendControl(onToggleCategory, onToggleExtraFilter, onToggleLineTypeFilterEnabled, onToggleIncludedLineType, onGenerateExportCommand, categoryState, extraFilterState, lineTypeFilterEnabled, includedLineTypeState, translate) {
  var legend = (L && typeof L.control === 'function') ? L.control({ position: 'bottomright' }) : { onAdd: function() {}, addTo: function() {}, remove: function() {} };
  var dynamicOptionsContainer = null;
  var t = typeof translate === 'function' ? translate : function(key) {
    return key;
  };

  function renderLineTypeGroup(container, group) {
    var groupTitle = L.DomUtil.create('div', 'surface-highway-group-title', container);
    groupTitle.textContent = t(group.title);

    group.options.forEach(function(option) {
      var row = L.DomUtil.create('label', 'surface-legend-item surface-legend-toggle surface-highway-item', container);
      var checkbox = L.DomUtil.create('input', 'surface-legend-checkbox', row);
      checkbox.type = 'checkbox';
      var optionKey = makeLineTypeKey(option.tagKey, option.value);
      checkbox.checked = includedLineTypeState[optionKey] === true;

      var text = L.DomUtil.create('span', 'surface-legend-label', row);
      text.textContent = t(option.label);

      L.DomEvent.on(checkbox, 'change', function() {
        onToggleIncludedLineType(optionKey, checkbox.checked);
      });
    });
  }

  function renderLineTypeGroups(container, groups) {
    if (!container) {
      return;
    }

    container.innerHTML = '';
    if (!groups || groups.length === 0) {
      var empty = L.DomUtil.create('div', 'surface-highway-empty', container);
      empty.textContent = t('No additional line types in current view.');
      return;
    }

    groups.forEach(function(group) {
      renderLineTypeGroup(container, group);
    });
  }

  legend.onAdd = function() {
    var div = L.DomUtil.create('div', 'surface-legend leaflet-control');
    var title = L.DomUtil.create('div', 'surface-legend-title', div);
    title.textContent = t('Surface Quality');

    LEGEND_ITEMS.forEach(function(item) {
      var row = L.DomUtil.create('label', 'surface-legend-item surface-legend-toggle', div);
      var checkbox = L.DomUtil.create('input', 'surface-legend-checkbox', row);
      checkbox.type = 'checkbox';
      checkbox.checked = categoryState[item.key] !== false;

      var line = L.DomUtil.create('span', 'surface-line ' + item.key, row);
      var text = L.DomUtil.create('span', 'surface-legend-label', row);
      text.textContent = t(item.label);

      L.DomEvent.on(checkbox, 'change', function() {
        onToggleCategory(item.key, checkbox.checked);
      });
    });

    var divider = L.DomUtil.create('div', 'surface-legend-divider', div);
    divider.textContent = t('Additional filters');

    EXTRA_FILTER_ITEMS.forEach(function(item) {
      var row = L.DomUtil.create('label', 'surface-legend-item surface-legend-toggle', div);
      var checkbox = L.DomUtil.create('input', 'surface-legend-checkbox', row);
      checkbox.type = 'checkbox';
      checkbox.checked = extraFilterState[item.key] === true;

      var text = L.DomUtil.create('span', 'surface-legend-label', row);
      text.textContent = t(item.label);

      L.DomEvent.on(checkbox, 'change', function() {
        onToggleExtraFilter(item.key, checkbox.checked);
      });
    });

    var nested = L.DomUtil.create('details', 'surface-legend-nested', div);
    var summary = L.DomUtil.create('summary', 'surface-legend-nested-title', nested);
    summary.textContent = t('Keep only selected line types');

    var filterToggleRow = L.DomUtil.create('label', 'surface-legend-item surface-legend-toggle surface-line-filter-master', nested);
    var filterToggle = L.DomUtil.create('input', 'surface-legend-checkbox', filterToggleRow);
    filterToggle.type = 'checkbox';
    filterToggle.checked = lineTypeFilterEnabled === true;
    var filterToggleText = L.DomUtil.create('span', 'surface-legend-label', filterToggleRow);
    filterToggleText.textContent = t('Enable "keep only selected" filter');

    var nestedOptions = L.DomUtil.create('div', 'surface-highway-options', nested);
    if (!filterToggle.checked) {
      nestedOptions.classList.add('is-disabled');
    }

    L.DomEvent.on(filterToggle, 'change', function() {
      var enabled = filterToggle.checked;
      onToggleLineTypeFilterEnabled(enabled);
      if (enabled) {
        nestedOptions.classList.remove('is-disabled');
      } else {
        nestedOptions.classList.add('is-disabled');
      }
    });

    LINE_TYPE_FILTER_SECTIONS.forEach(function(section) {
      var sectionDetails = L.DomUtil.create('details', 'surface-legend-subsection', nestedOptions);
      if (section.open) {
        sectionDetails.open = true;
      }

      var sectionSummary = L.DomUtil.create('summary', 'surface-legend-subsection-title', sectionDetails);
      sectionSummary.textContent = t(section.title);

      var sectionBody = L.DomUtil.create('div', 'surface-legend-subsection-body', sectionDetails);

      section.groups.forEach(function(groupKey) {
        var group = LINE_TYPE_GROUPS[groupKey];
        if (group) {
          renderLineTypeGroup(sectionBody, group);
        }
      });

      if (section.includeDynamic) {
        var dynamicDivider = L.DomUtil.create('div', 'surface-highway-group-title surface-dynamic-title', sectionBody);
        dynamicDivider.textContent = t('Detected dynamically (from current view)');
        dynamicOptionsContainer = L.DomUtil.create('div', 'surface-highway-dynamic', sectionBody);
      }
    });

    var note = L.DomUtil.create('div', 'surface-legend-note', div);
    note.textContent = t('Source: OSM surface and tracktype tags plus OSM line types. No selection = no segments.');

    var buildCmdBtn = L.DomUtil.create('button', 'surface-legend-btn', div);
    buildCmdBtn.textContent = t('Generate Export Command (Widok)');
    buildCmdBtn.style.marginTop = '10px';
    buildCmdBtn.style.padding = '5px';
    buildCmdBtn.style.width = '100%';
    buildCmdBtn.style.cursor = 'pointer';

    L.DomEvent.on(buildCmdBtn, 'click', function() {
      if (typeof onGenerateExportCommand === 'function') {
        onGenerateExportCommand(false);
      }
    });

    var buildAllCmdBtn = L.DomUtil.create('button', 'surface-legend-btn', div);
    buildAllCmdBtn.textContent = t('Generate Export Command (Polska)');
    buildAllCmdBtn.style.marginTop = '5px';
    buildAllCmdBtn.style.padding = '5px';
    buildAllCmdBtn.style.width = '100%';
    buildAllCmdBtn.style.cursor = 'pointer';

    L.DomEvent.on(buildAllCmdBtn, 'click', function() {
      if (typeof onGenerateExportCommand === 'function') {
        onGenerateExportCommand(true);
      }
    });

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };

  legend.updateDynamicLineTypeOptions = function(groups) {
    renderLineTypeGroups(dynamicOptionsContainer, groups);
  };

  return legend;
}

var BaseLayerGroup = (L && L.LayerGroup) ? L.LayerGroup : function() {};
if (!BaseLayerGroup.extend) {
  BaseLayerGroup.extend = function(props) {
    function LayerSubclass(options) {
      if (props && typeof props.initialize === 'function') {
        props.initialize.call(this, options);
      }
    }
    LayerSubclass.prototype = Object.create(props || {});
    return LayerSubclass;
  };
}
var SurfaceLayer = BaseLayerGroup.extend({
  initialize: function(options) {
    options = options || {};
    if (BaseLayerGroup.prototype && BaseLayerGroup.prototype.initialize) {
      BaseLayerGroup.prototype.initialize.call(this);
    }
    this.translate = options.translate || function(key) {
      return key;
    };
    this.visibleCategories = {
      smooth: true,
      cobbles: true,
      compact: true,
      gravel: true,
      rough: true,
      unknown: true
    };
    this.extraFilters = {
      onlyBikePed: false,
      splitByVoivodeship: false
    };
    this.lineTypeFilterEnabled = false;
    this.includedLineTypes = {};
    this.knownLineTypeKeys = {};
    this.dynamicLineTypeGroups = [];
    Object.keys(LINE_TYPE_GROUPS).forEach(function(groupKey) {
      var group = LINE_TYPE_GROUPS[groupKey];
      group.options.forEach(function(option) {
        var optionKey = makeLineTypeKey(option.tagKey, option.value);
        this.knownLineTypeKeys[optionKey] = true;
      }, this);
    }, this);
    this.legendControl = createLegendControl(
      this.toggleCategory.bind(this),
      this.toggleExtraFilter.bind(this),
      this.toggleLineTypeFilterEnabled.bind(this),
      this.toggleIncludedLineType.bind(this),
      this.generateExportCommand.bind(this),
      this.visibleCategories,
      this.extraFilters,
      this.lineTypeFilterEnabled,
      this.includedLineTypes,
      this.translate
    );
    this.pendingRequest = null;
    this.inFlightRequestKey = null;
    this.lastRenderedRequestKey = null;
    this.lastElements = [];
    this.apiUrl = options.apiUrl || null;
    this.warnedMissingApi = false;
    this.maxSegments = 3200;
    this.onMoveEnd = this.onMoveEnd.bind(this);
  },

  setTranslator: function(translate) {
    this.translate = translate || function(key) {
      return key;
    };
    var previousLegendControl = this.legendControl;
    this.legendControl = createLegendControl(
      this.toggleCategory.bind(this),
      this.toggleExtraFilter.bind(this),
      this.toggleLineTypeFilterEnabled.bind(this),
      this.toggleIncludedLineType.bind(this),
      this.generateExportCommand.bind(this),
      this.visibleCategories,
      this.extraFilters,
      this.lineTypeFilterEnabled,
      this.includedLineTypes,
      this.translate
    );

    if (this.map && previousLegendControl) {
      this.map.removeControl(previousLegendControl);
      this.legendControl.addTo(this.map);
      this.legendControl.updateDynamicLineTypeOptions(this.dynamicLineTypeGroups);
    }
  },

  onAdd: function(map) {
    this.map = map;
    L.LayerGroup.prototype.onAdd.call(this, map);
    map.on('moveend', this.onMoveEnd);
    map.on('zoomend', this.onMoveEnd);
    this.legendControl.addTo(map);
    this.legendControl.updateDynamicLineTypeOptions(this.dynamicLineTypeGroups);
    this.refresh();
  },

  onRemove: function(map) {
    map.off('moveend', this.onMoveEnd);
    map.off('zoomend', this.onMoveEnd);
    if (this.pendingRequest && this.pendingRequest.abort) {
      this.pendingRequest.abort();
    }
    this.pendingRequest = null;
    this.inFlightRequestKey = null;
    this.lastRenderedRequestKey = null;
    this.lastElements = [];
    map.removeControl(this.legendControl);
    this.clearLayers();
    L.LayerGroup.prototype.onRemove.call(this, map);
    this.map = null;
  },

  toggleCategory: function(category, enabled) {
    this.visibleCategories[category] = enabled;
    if (this.lastElements && this.lastElements.length > 0) {
      this.renderElements(this.lastElements);
      return;
    }
    this.refresh();
  },

  toggleExtraFilter: function(filterKey, enabled) {
    this.extraFilters[filterKey] = enabled;
    if (this.lastElements && this.lastElements.length > 0) {
      this.renderElements(this.lastElements);
      return;
    }
    this.refresh();
  },

  toggleIncludedLineType: function(optionKey, enabled) {
    this.includedLineTypes[optionKey] = enabled;
    if (this.lastElements && this.lastElements.length > 0) {
      this.renderElements(this.lastElements);
      return;
    }
    this.refresh();
  },

  toggleLineTypeFilterEnabled: function(enabled) {
    this.lineTypeFilterEnabled = enabled;
    if (this.lastElements && this.lastElements.length > 0) {
      this.renderElements(this.lastElements);
      return;
    }
    this.refresh();
  },

  generateExportCommand: function(wholeMap) {
    if (!this.map) return;
    
    var bbox;
    if (wholeMap) {
      bbox = "48.9,13.8,54.9,24.3"; // Poland bounds
    } else {
      var bounds = this.map.getBounds();
      bbox = bounds.getSouthWest().lat.toFixed(3) + ',' + bounds.getSouthWest().lng.toFixed(3) + ',' + bounds.getNorthEast().lat.toFixed(3) + ',' + bounds.getNorthEast().lng.toFixed(3);
    }
    
    var categories = [];
    var allCategories = Object.keys(this.visibleCategories);
    for (var i = 0; i < allCategories.length; i++) {
      var key = allCategories[i];
      if (this.visibleCategories[key]) categories.push(key);
    }
    var catArg = categories.length > 0 ? categories.join(',') : 'none';
    if (categories.length === allCategories.length) {
      catArg = 'all';
    }

    var onlyBikePed = !!this.extraFilters.onlyBikePed;

    var splitByVoivodeship = !!this.extraFilters.splitByVoivodeship;

    var cmd = 'node ./scripts/export_to_gmaps.js --bbox ' + bbox + ' --categories ' + catArg + ' --bikeped ' + onlyBikePed + ' --split-voivodeships ' + splitByVoivodeship;
    
    if (this.lineTypeFilterEnabled) {
      var activeTypes = [];
      for (var tk in this.includedLineTypes) {
        if (this.includedLineTypes[tk]) activeTypes.push(tk);
      }
      if (activeTypes.length > 0) {
        cmd += ' --linetypes ' + activeTypes.join(',');
      } else {
        cmd += ' --linetypes none';
      }
    }
    
    window.prompt(this.translate('Copy this command to your terminal to export data for current view with these filters:'), cmd);
  },

  onMoveEnd: function() {
    this.refresh();
  },

  refresh: function() {
    if (!this.map) {
      return;
    }

    if (!this.apiUrl) {
      if (!this.warnedMissingApi && typeof console !== 'undefined' && console.warn) {
        console.warn('Surface Quality layer requires a local surface API endpoint. Set window.OSRM_SURFACE_API_URL to your local Overpass interpreter URL.');
        this.warnedMissingApi = true;
      }
      this.clearLayers();
      return;
    }

    var zoom = this.map.getZoom();
    if (zoom < 12) {
      this.clearLayers();
      this.inFlightRequestKey = null;
      this.lastRenderedRequestKey = null;
      return;
    }

    var bounds = this.map.getBounds();
    var requestKey = [
      zoom,
      bounds.getSouthWest().lat.toFixed(3),
      bounds.getSouthWest().lng.toFixed(3),
      bounds.getNorthEast().lat.toFixed(3),
      bounds.getNorthEast().lng.toFixed(3)
    ].join(',');

    if (requestKey === this.lastRenderedRequestKey || requestKey === this.inFlightRequestKey) {
      return;
    }

    if (this.pendingRequest && this.pendingRequest.abort) {
      this.pendingRequest.abort();
    }

    var controller = window.AbortController ? new window.AbortController() : null;
    this.pendingRequest = controller;
    this.inFlightRequestKey = requestKey;

    var south = bounds.getSouthWest().lat;
    var west = bounds.getSouthWest().lng;
    var north = bounds.getNorthEast().lat;
    var east = bounds.getNorthEast().lng;

    var query = '[out:json][timeout:20];(' +
      'way["highway"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["railway"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["waterway"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["aerialway"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["route"="ferry"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["power"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["barrier"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["man_made"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["natural"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["boundary"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      'way["landuse"](' + south + ',' + west + ',' + north + ',' + east + ');' +
      ');out tags geom;';

    var fetchOptions = {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8'
      }
    };

    if (controller) {
      fetchOptions.signal = controller.signal;
    }

    var self = this;
    fetch(this.apiUrl, fetchOptions)
      .then(function(response) {
        if (!response.ok) {
          throw new Error('Surface API request failed with status ' + response.status);
        }
        return response.json();
      })
      .then(function(data) {
        self.pendingRequest = null;
        self.inFlightRequestKey = null;
        self.lastRenderedRequestKey = requestKey;
        self.lastElements = data.elements || [];
        self.dynamicLineTypeGroups = collectDynamicLineTypeOptions(self.lastElements, self.knownLineTypeKeys);
        self.legendControl.updateDynamicLineTypeOptions(self.dynamicLineTypeGroups);
        self.renderElements(self.lastElements);
      })
      .catch(function(error) {
        // Ignore fetch aborts because they are expected during map moves.
        if (error && error.name === 'AbortError') {
          self.inFlightRequestKey = null;
          return;
        }
        self.pendingRequest = null;
        self.inFlightRequestKey = null;
      });
  },

  renderElements: function(elements) {
    this.clearLayers();

    if (this.lineTypeFilterEnabled) {
      var hasSelectedLineTypes = hasAnySelectedLineType(this.includedLineTypes);
      if (!hasSelectedLineTypes) {
        return;
      }
    }

    var drawn = 0;
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (drawn >= this.maxSegments) {
        break;
      }
      if (!element || element.type !== 'way' || !element.geometry || element.geometry.length < 2) {
        continue;
      }

      var latlngs = [];
      for (var g = 0; g < element.geometry.length; g++) {
        latlngs.push([element.geometry[g].lat, element.geometry[g].lon]);
      }

      var category = classifySurface(element.tags || {});
      if (!this.visibleCategories[category]) {
        continue;
      }

      var tags = element.tags || {};
      if (this.extraFilters.onlyBikePed && !isBikePedWay(tags)) {
        continue;
      }

      if (this.lineTypeFilterEnabled && !matchesSelectedLineType(tags, this.includedLineTypes)) {
        continue;
      }

      L.polyline(latlngs, styleFor(category)).addTo(this);
      drawn += 1;
    }
  }
});

module.exports = {
  createSurfaceLayer: function(options) {
    return new SurfaceLayer(options);
  }
};
