'use strict';

var L = require('leaflet');

var LEGEND_ITEMS = [
  { key: 'smooth', label: 'Asfalt / beton / paved' },
  { key: 'cobbles', label: 'Kostka / bruk' },
  { key: 'compact', label: 'Utwardzone (compacted)' },
  { key: 'gravel', label: 'Szuter / grubszy żwir' },
  { key: 'rough', label: 'Grunt / piach / błoto' },
  { key: 'unknown', label: 'Brak danych' }
];

var EXTRA_FILTER_ITEMS = [
  { key: 'onlyBikePed', label: 'Tylko chodniki / drogi i ścieżki rowerowe' }
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
  route: 'Trasy i linie transportowe',
  power: 'Energetyka',
  barrier: 'Bariery',
  man_made: 'Obiekty techniczne',
  natural: 'Elementy naturalne',
  boundary: 'Granice',
  landuse: 'Użytkowanie terenu'
};

var LINE_TYPE_GROUPS = {
  bikeped: {
    title: 'Rower i piesi',
    options: [
      { tagKey: 'highway', value: 'cycleway', label: 'Drogi rowerowe' },
      { tagKey: 'highway', value: 'track', label: 'Drogi gruntowe i techniczne' },
      { tagKey: 'highway', value: 'path', label: 'Ścieżki' },
      { tagKey: 'highway', value: 'footway', label: 'Chodniki' },
      { tagKey: 'highway', value: 'pedestrian', label: 'Deptaki' },
      { tagKey: 'highway', value: 'steps', label: 'Schody' }
    ]
  },
  local: {
    title: 'Drogi lokalne',
    options: [
      { tagKey: 'highway', value: 'residential', label: 'Ulice osiedlowe' },
      { tagKey: 'highway', value: 'unclassified', label: 'Drogi lokalne' },
      { tagKey: 'highway', value: 'living_street', label: 'Strefy zamieszkania' },
      { tagKey: 'highway', value: 'service', label: 'Dojazdy i serwisowe' }
    ]
  },
  rail: {
    title: 'Kolej i tramwaje',
    options: [
      { tagKey: 'railway', value: 'rail', label: 'Linie kolejowe' },
      { tagKey: 'railway', value: 'tram', label: 'Linie tramwajowe' },
      { tagKey: 'railway', value: 'light_rail', label: 'Kolej lekka' },
      { tagKey: 'railway', value: 'subway', label: 'Metro' },
      { tagKey: 'railway', value: 'narrow_gauge', label: 'Kolej wąskotorowa' },
      { tagKey: 'railway', value: 'monorail', label: 'Monorail' }
    ]
  },
  ferry: {
    title: 'Przeprawy promowe',
    options: [
      { tagKey: 'route', value: 'ferry', label: 'Trasy promowe' }
    ]
  },
  main: {
    title: 'Drogi główne',
    options: [
      { tagKey: 'highway', value: 'primary', label: 'Główne' },
      { tagKey: 'highway', value: 'primary_link', label: 'Łączniki dróg głównych' },
      { tagKey: 'highway', value: 'secondary', label: 'Drugorzędne' },
      { tagKey: 'highway', value: 'secondary_link', label: 'Łączniki dróg drugorzędnych' },
      { tagKey: 'highway', value: 'tertiary', label: 'Lokalnie ważne' },
      { tagKey: 'highway', value: 'tertiary_link', label: 'Łączniki dróg lokalnie ważnych' }
    ]
  },
  fast: {
    title: 'Szybki ruch',
    options: [
      { tagKey: 'highway', value: 'motorway', label: 'Autostrady' },
      { tagKey: 'highway', value: 'motorway_link', label: 'Łączniki autostrad' },
      { tagKey: 'highway', value: 'trunk', label: 'Drogi ekspresowe' },
      { tagKey: 'highway', value: 'trunk_link', label: 'Łączniki dróg ekspresowych' }
    ]
  },
  water: {
    title: 'Cieki wodne',
    options: [
      { tagKey: 'waterway', value: 'river', label: 'Rzeki' },
      { tagKey: 'waterway', value: 'canal', label: 'Kanały' },
      { tagKey: 'waterway', value: 'stream', label: 'Strumienie' },
      { tagKey: 'waterway', value: 'drain', label: 'Rowy odwadniające' },
      { tagKey: 'waterway', value: 'ditch', label: 'Rowy' }
    ]
  },
  aerial: {
    title: 'Koleje linowe',
    options: [
      { tagKey: 'aerialway', value: 'cable_car', label: 'Koleje linowe kabinowe' },
      { tagKey: 'aerialway', value: 'gondola', label: 'Gondole' },
      { tagKey: 'aerialway', value: 'chair_lift', label: 'Wyciągi krzesełkowe' },
      { tagKey: 'aerialway', value: 'drag_lift', label: 'Wyciągi orczykowe' },
      { tagKey: 'aerialway', value: 'magic_carpet', label: 'Taśmy narciarskie' }
    ]
  }
};

var LINE_TYPE_FILTER_SECTIONS = [
  { title: 'Ruch lokalny', groups: ['bikeped', 'local'], open: true },
  { title: 'Szynowy i wodny', groups: ['rail', 'ferry'], open: false },
  { title: 'Główne i szybki ruch', groups: ['main', 'fast'], open: false },
  { title: 'Pozostałe', groups: ['water', 'aerial'], includeDynamic: true, open: false }
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
        title: DYNAMIC_TAG_GROUP_LABELS[groupKey] || ('Inne: ' + groupKey),
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

  if (cycleway && cycleway !== 'no') {
    return true;
  }

  if (cyclewayBoth && cyclewayBoth !== 'no') {
    return true;
  }

  if (isTruthyTag(bicycle) || isTruthyTag(foot)) {
    return true;
  }

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

function createLegendControl(onToggleCategory, onToggleExtraFilter, onToggleLineTypeFilterEnabled, onToggleIncludedLineType, categoryState, extraFilterState, lineTypeFilterEnabled, includedLineTypeState) {
  var legend = L.control({ position: 'bottomright' });
  var dynamicOptionsContainer = null;

  function renderLineTypeGroup(container, group) {
    var groupTitle = L.DomUtil.create('div', 'surface-highway-group-title', container);
    groupTitle.textContent = group.title;

    group.options.forEach(function(option) {
      var row = L.DomUtil.create('label', 'surface-legend-item surface-legend-toggle surface-highway-item', container);
      var checkbox = L.DomUtil.create('input', 'surface-legend-checkbox', row);
      checkbox.type = 'checkbox';
      var optionKey = makeLineTypeKey(option.tagKey, option.value);
      checkbox.checked = includedLineTypeState[optionKey] === true;

      var text = L.DomUtil.create('span', 'surface-legend-label', row);
      text.textContent = option.label;

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
      empty.textContent = 'Brak dodatkowych typów linii w bieżącym widoku.';
      return;
    }

    groups.forEach(function(group) {
      renderLineTypeGroup(container, group);
    });
  }

  legend.onAdd = function() {
    var div = L.DomUtil.create('div', 'surface-legend leaflet-control');
    var title = L.DomUtil.create('div', 'surface-legend-title', div);
    title.textContent = 'Surface Quality';

    LEGEND_ITEMS.forEach(function(item) {
      var row = L.DomUtil.create('label', 'surface-legend-item surface-legend-toggle', div);
      var checkbox = L.DomUtil.create('input', 'surface-legend-checkbox', row);
      checkbox.type = 'checkbox';
      checkbox.checked = categoryState[item.key] !== false;

      var line = L.DomUtil.create('span', 'surface-line ' + item.key, row);
      var text = L.DomUtil.create('span', 'surface-legend-label', row);
      text.textContent = item.label;

      L.DomEvent.on(checkbox, 'change', function() {
        onToggleCategory(item.key, checkbox.checked);
      });
    });

    var divider = L.DomUtil.create('div', 'surface-legend-divider', div);
    divider.textContent = 'Filtry dodatkowe';

    EXTRA_FILTER_ITEMS.forEach(function(item) {
      var row = L.DomUtil.create('label', 'surface-legend-item surface-legend-toggle', div);
      var checkbox = L.DomUtil.create('input', 'surface-legend-checkbox', row);
      checkbox.type = 'checkbox';
      checkbox.checked = extraFilterState[item.key] === true;

      var text = L.DomUtil.create('span', 'surface-legend-label', row);
      text.textContent = item.label;

      L.DomEvent.on(checkbox, 'change', function() {
        onToggleExtraFilter(item.key, checkbox.checked);
      });
    });

    var nested = L.DomUtil.create('details', 'surface-legend-nested', div);
    var summary = L.DomUtil.create('summary', 'surface-legend-nested-title', nested);
    summary.textContent = 'Pozostaw tylko wybrane typy linii';

    var filterToggleRow = L.DomUtil.create('label', 'surface-legend-item surface-legend-toggle surface-line-filter-master', nested);
    var filterToggle = L.DomUtil.create('input', 'surface-legend-checkbox', filterToggleRow);
    filterToggle.type = 'checkbox';
    filterToggle.checked = lineTypeFilterEnabled === true;
    var filterToggleText = L.DomUtil.create('span', 'surface-legend-label', filterToggleRow);
    filterToggleText.textContent = 'Włącz filtr "pozostaw tylko wybrane"';

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
      sectionSummary.textContent = section.title;

      var sectionBody = L.DomUtil.create('div', 'surface-legend-subsection-body', sectionDetails);

      section.groups.forEach(function(groupKey) {
        var group = LINE_TYPE_GROUPS[groupKey];
        if (group) {
          renderLineTypeGroup(sectionBody, group);
        }
      });

      if (section.includeDynamic) {
        var dynamicDivider = L.DomUtil.create('div', 'surface-highway-group-title surface-dynamic-title', sectionBody);
        dynamicDivider.textContent = 'Wykryte dynamicznie (z aktualnego widoku)';
        dynamicOptionsContainer = L.DomUtil.create('div', 'surface-highway-dynamic', sectionBody);
      }
    });

    var note = L.DomUtil.create('div', 'surface-legend-note', div);
    note.textContent = 'Źródło: tagi OSM surface, tracktype oraz typy linii OSM. Brak zaznaczenia = brak segmentów.';

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };

  legend.updateDynamicLineTypeOptions = function(groups) {
    renderLineTypeGroups(dynamicOptionsContainer, groups);
  };

  return legend;
}

var SurfaceLayer = L.LayerGroup.extend({
  initialize: function(options) {
    options = options || {};
    L.LayerGroup.prototype.initialize.call(this);
    this.visibleCategories = {
      smooth: true,
      cobbles: true,
      compact: true,
      gravel: true,
      rough: true,
      unknown: true
    };
    this.extraFilters = {
      onlyBikePed: false
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
      this.visibleCategories,
      this.extraFilters,
      this.lineTypeFilterEnabled,
      this.includedLineTypes
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
