// Landslide Risk Detection & Dynamic Routing Engine - Frontend Application Script

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // App State
  let map = null;
  let primaryRouteLayer = null;
  let safeRouteLayer = null;
  let geofenceLayersGroup = L.layerGroup();
  let heatmapLayer = null;
  let hazardMarkersGroup = L.layerGroup();
  
  let activeRegionKey = 'himalayas';
  let currentRegionData = null;
  let isSimulatingLandslide = false;
  let currentGeoJSONGeofences = null;
  
  // Preset Region Definitions
  const REGIONS = {
    himalayas: {
      name: "Himalayas Highway (Rishikesh to Kedarnath)",
      start: [78.2676, 30.0869], // [lon, lat]
      end: [79.0669, 30.7346],
      center: [30.4000, 78.6500],
      zoom: 10,
      hazard: {
        latitude: 30.4120,
        longitude: 78.6850,
        slope_angle: 44.5,
        rainfall_24h: 142.0,
        soil_saturation: 0.88,
        name: "Rudraprayag Slope Sector 4"
      }
    },
    pacific_nw: {
      name: "Pacific Northwest Corridor",
      start: [-122.3321, 47.6062],
      end: [-121.7604, 46.8523],
      center: [47.2000, -122.0000],
      zoom: 9,
      hazard: {
        latitude: 47.1850,
        longitude: -121.9850,
        slope_angle: 38.0,
        rainfall_24h: 115.0,
        soil_saturation: 0.82,
        name: "Carbon River Landslide Sector"
      }
    },
    western_ghats: {
      name: "Western Ghats Escarpment",
      start: [72.8777, 19.0760],
      end: [73.6559, 17.9237],
      center: [18.4000, 73.2500],
      zoom: 9,
      hazard: {
        latitude: 18.3250,
        longitude: 73.2850,
        slope_angle: 42.0,
        rainfall_24h: 158.0,
        soil_saturation: 0.91,
        name: "Varandha Ghat Escarpment"
      }
    },
    swiss_alps: {
      name: "Swiss Alps Pass",
      start: [6.1432, 46.2044],
      end: [7.7491, 46.0207],
      center: [46.1200, 6.9500],
      zoom: 9,
      hazard: {
        latitude: 46.1150,
        longitude: 6.9850,
        slope_angle: 48.0,
        rainfall_24h: 105.0,
        soil_saturation: 0.79,
        name: "Valais Steep Gorge Sector"
      }
    }
  };

  // DOM Elements
  const sliderRain = document.getElementById('slider-rain');
  const sliderSoil = document.getElementById('slider-soil');
  const sliderSlope = document.getElementById('slider-slope');
  
  const valRain = document.getElementById('val-rain');
  const valSoil = document.getElementById('val-soil');
  const valSlope = document.getElementById('val-slope');
  
  const lhiVal = document.getElementById('lhi-val');
  const lhiFillBar = document.getElementById('lhi-fill-bar');
  const lhiClassText = document.getElementById('lhi-class-text');
  const lhiMethodText = document.getElementById('lhi-method-text');
  
  const alertBanner = document.getElementById('alert-banner');
  const alertTitle = document.getElementById('alert-title');
  const alertMessage = document.getElementById('alert-message');
  const alertOrigDist = document.getElementById('alert-orig-dist');
  const alertSafeDist = document.getElementById('alert-safe-dist');
  const alertEtaDelta = document.getElementById('alert-eta-delta');
  
  const btnSimulate = document.getElementById('btn-simulate');
  const btnResetRoute = document.getElementById('btn-reset-route');
  const btnFetchMeteo = document.getElementById('btn-fetch-open-meteo');
  const btnRecalcLHI = document.getElementById('btn-recalculate-lhi');
  
  const chkGeofences = document.getElementById('chk-geofences');
  const chkHeatmap = document.getElementById('chk-heatmap');

  // Initialize Map
  function initMap() {
    currentRegionData = REGIONS[activeRegionKey];
    const centerLat = currentRegionData.center[0];
    const centerLon = currentRegionData.center[1];
    
    map = L.map('map', {
      center: [centerLat, centerLon],
      zoom: currentRegionData.zoom,
      zoomControl: false
    });
    
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Dark Tile Layer (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);

    geofenceLayersGroup.addTo(map);
    hazardMarkersGroup.addTo(map);

    // Load initial route and evaluate hazard
    loadRegionRoute(activeRegionKey);
  }

  // Load Route for selected region
  async function loadRegionRoute(regionKey, simulateEvent = false) {
    activeRegionKey = regionKey;
    currentRegionData = REGIONS[regionKey];
    
    map.flyTo([currentRegionData.center[0], currentRegionData.center[1]], currentRegionData.zoom, {
      duration: 1.2
    });

    const start = currentRegionData.start; // [lon, lat]
    const end = currentRegionData.end;

    if (simulateEvent) {
      triggerLandslideSimulation(start, end);
    } else {
      fetchAndRenderDualRoute(start, end, [currentRegionData.hazard]);
    }
  }

  // Fetch Dual Route from Backend API
  async function fetchAndRenderDualRoute(start, end, hazardPoints) {
    try {
      const resp = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: start,
          end: end,
          hazard_points: hazardPoints
        })
      });
      const data = await resp.json();
      
      renderRoutesAndGeofences(data, start, end);
    } catch (e) {
      console.warn("API route query error, using local route rendering: ", e);
      renderLocalFallbackRoute(start, end, hazardPoints);
    }
  }

  // Trigger Live Landslide Rerouting Simulation
  async function triggerLandslideSimulation(start, end) {
    btnSimulate.classList.add('loading');
    btnSimulate.disabled = true;

    try {
      const resp = await fetch('/api/simulate-landslide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: start,
          end: end,
          hazard_intensity: "CRITICAL"
        })
      });
      const data = await resp.json();

      isSimulatingLandslide = true;
      renderSimulationResult(data, start, end);
    } catch (e) {
      console.error("Simulation endpoint error: ", e);
    } finally {
      btnSimulate.classList.remove('loading');
      btnSimulate.disabled = false;
    }
  }

  // Render Routes and Geofence Layers
  function renderRoutesAndGeofences(routeData, start, end) {
    clearMapLayers();

    // 1. Draw Start & End Markers
    const startIcon = L.divIcon({
      className: 'custom-map-marker start-marker',
      html: '<div style="background:#10b981; width:16px; height:16px; border-radius:50%; border:3px solid #fff; box-shadow: 0 0 12px #10b981;"></div>',
      iconSize: [20, 20]
    });
    
    const endIcon = L.divIcon({
      className: 'custom-map-marker end-marker',
      html: '<div style="background:#3b82f6; width:16px; height:16px; border-radius:50%; border:3px solid #fff; box-shadow: 0 0 12px #3b82f6;"></div>',
      iconSize: [20, 20]
    });

    L.marker([start[1], start[0]], { icon: startIcon }).addTo(map).bindPopup("<b>Route Start</b>");
    L.marker([end[1], end[0]], { icon: endIcon }).addTo(map).bindPopup("<b>Destination</b>");

    // 2. Draw Geofences
    currentGeoJSONGeofences = routeData.geofences;
    if (chkGeofences.checked && currentGeoJSONGeofences) {
      drawGeofencePolygons(currentGeoJSONGeofences);
    }

    // 3. Draw Heatmap
    if (chkHeatmap.checked && currentGeoJSONGeofences) {
      drawHeatmapOverlay(currentGeoJSONGeofences);
    }

    // 4. Render Dual Routes
    const isRerouted = routeData.is_rerouted || routeData.hazard_detected;
    
    if (isRerouted && routeData.primary_route && routeData.recalculated_safe_route) {
      // Draw Original Blocked Route (Red Dashed)
      const origCoords = routeData.primary_route.coordinates.map(c => [c[1], c[0]]);
      primaryRouteLayer = L.polyline(origCoords, {
        color: '#ef4444',
        weight: 5,
        dashArray: '8, 10',
        opacity: 0.85
      }).addTo(map);

      // Draw Recalculated Safe Route (Green Solid)
      const safeCoords = routeData.recalculated_safe_route.coordinates.map(c => [c[1], c[0]]);
      safeRouteLayer = L.polyline(safeCoords, {
        color: '#10b981',
        weight: 6,
        opacity: 0.95
      }).addTo(map);

      // Show Warning Alert Banner
      showAlertBanner({
        title: "⚠️ CRITICAL HAZARD DETECTED - AUTOMATIC REROUTE ACTIVE",
        message: `Landslide danger geofence (LHI > 0.75) detected on primary route. Bypassing active zone via safe detour.`,
        origDist: `${routeData.primary_route.distance_km} km`,
        safeDist: `${routeData.recalculated_safe_route.distance_km} km`,
        etaDelta: `+${Math.abs(routeData.eta_impact_min)} min`
      });
    } else {
      // Safe Route Only (Green Solid)
      const coords = routeData.primary_route.coordinates.map(c => [c[1], c[0]]);
      safeRouteLayer = L.polyline(coords, {
        color: '#10b981',
        weight: 6,
        opacity: 0.95
      }).addTo(map);

      hideAlertBanner();
    }
  }

  // Render Simulation Result
  function renderSimulationResult(simData, start, end) {
    clearMapLayers();

    // 1. Draw Start & End Markers
    L.marker([start[1], start[0]]).addTo(map).bindPopup("<b>Route Start</b>");
    L.marker([end[1], end[0]]).addTo(map).bindPopup("<b>Destination</b>");

    // 2. Draw Obstacle Hazard Marker
    const hazLoc = simData.hazard_location; // [lon, lat]
    const obstacleIcon = L.divIcon({
      className: 'custom-map-marker obstacle-marker',
      html: '<div style="background:#ef4444; width:26px; height:26px; border-radius:50%; border:3px solid #fff; box-shadow: 0 0 20px #ef4444; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:bold; font-size:14px;">⚠️</div>',
      iconSize: [26, 26]
    });
    
    L.marker([hazLoc[1], hazLoc[0]], { icon: obstacleIcon }).addTo(hazardMarkersGroup)
      .bindPopup(`<b>SUDDEN SLOPE FAILURE</b><br>LHI: ${simData.hazard_lhi}<br>Status: Critical Hazard Zone`)
      .openPopup();

    // 3. Draw Danger Geofence Buffer
    currentGeoJSONGeofences = simData.geofences;
    if (chkGeofences.checked && currentGeoJSONGeofences) {
      drawGeofencePolygons(currentGeoJSONGeofences);
    }
    if (chkHeatmap.checked && currentGeoJSONGeofences) {
      drawHeatmapOverlay(currentGeoJSONGeofences);
    }

    // 4. Draw Blocked Primary Route (Dashed Red)
    const origCoords = simData.blocked_primary_route.coordinates.map(c => [c[1], c[0]]);
    primaryRouteLayer = L.polyline(origCoords, {
      color: '#ef4444',
      weight: 5,
      dashArray: '8, 10',
      opacity: 0.85
    }).addTo(map);

    // 5. Draw Recalculated Safe Bypass Route (Green Solid)
    const safeCoords = simData.recalculated_safe_route.coordinates.map(c => [c[1], c[0]]);
    safeRouteLayer = L.polyline(safeCoords, {
      color: '#10b981',
      weight: 6,
      opacity: 0.95
    }).addTo(map);

    // 6. Update Gauge UI
    updateLHIGaugeUI(simData.lhi_breakdown);

    // 7. Show Alert Banner
    showAlertBanner({
      title: simData.event_title,
      message: simData.alert.status,
      origDist: `${simData.alert.primary_distance_km} km`,
      safeDist: `${simData.alert.safe_distance_km} km`,
      etaDelta: `+${simData.alert.added_eta_min} min`
    });
  }

  // Draw GeoJSON Geofence Polygons
  function drawGeofencePolygons(geojson) {
    geofenceLayersGroup.clearLayers();
    
    L.geoJSON(geojson, {
      style: function(feature) {
        return {
          color: '#ef4444',
          fillColor: '#ef4444',
          fillOpacity: 0.35,
          weight: 2,
          dashArray: '4, 4'
        };
      },
      onEachFeature: function(feature, layer) {
        const props = feature.properties || {};
        layer.bindPopup(`
          <div style="font-family: sans-serif; padding:4px;">
            <h4 style="color:#ef4444; margin-bottom:4px;">⚠️ ${props.name || 'Landslide Geofence'}</h4>
            <p><b>Hazard Index (LHI):</b> ${props.lhi}</p>
            <p><b>Buffer Radius:</b> ${props.radius_m} meters</p>
            <p><b>Status:</b> Dynamic Avoidance Polygon</p>
          </div>
        `);
      }
    }).addTo(geofenceLayersGroup);
  }

  // Draw Heatmap Overlay
  function drawHeatmapOverlay(geojson) {
    if (heatmapLayer) {
      map.removeLayer(heatmapLayer);
    }
    
    const heatPoints = [];
    const features = geojson.features || [];
    features.forEach(feat => {
      const props = feat.properties || {};
      const center = props.center || [0, 0];
      heatPoints.push([center[1], center[0], props.lhi || 0.9]);
    });
    
    if (window.L.heatLayer && heatPoints.length > 0) {
      heatmapLayer = L.heatLayer(heatPoints, {
        radius: 45,
        blur: 25,
        maxZoom: 13,
        gradient: { 0.4: '#eab308', 0.7: '#f97316', 1.0: '#ef4444' }
      }).addTo(map);
    }
  }

  // Clear Map Layers
  function clearMapLayers() {
    if (primaryRouteLayer) map.removeLayer(primaryRouteLayer);
    if (safeRouteLayer) map.removeLayer(safeRouteLayer);
    geofenceLayersGroup.clearLayers();
    hazardMarkersGroup.clearLayers();
    if (heatmapLayer) map.removeLayer(heatmapLayer);
  }

  // Show Alert Banner
  function showAlertBanner(info) {
    alertTitle.textContent = info.title;
    alertMessage.textContent = info.message;
    alertOrigDist.textContent = info.origDist;
    alertSafeDist.textContent = info.safeDist;
    alertEtaDelta.textContent = info.etaDelta;
    alertBanner.classList.remove('hidden');
  }

  // Hide Alert Banner
  function hideAlertBanner() {
    alertBanner.classList.add('hidden');
  }

  // Update LHI Gauge UI
  function updateLHIGaugeUI(lhiData) {
    const lhi = lhiData.lhi;
    lhiVal.textContent = lhi.toFixed(3);
    lhiFillBar.style.width = `${Math.min(100, lhi * 100)}%`;
    
    if (lhi >= 0.75) {
      lhiVal.className = "lhi-score-text danger";
      lhiFillBar.className = "lhi-bar-fill danger-bg";
      lhiClassText.textContent = "CRITICAL / GEOFENCE ACTIVE";
      lhiClassText.className = "value danger-text";
    } else if (lhi >= 0.50) {
      lhiVal.className = "lhi-score-text warning";
      lhiFillBar.className = "lhi-bar-fill danger-bg";
      lhiClassText.textContent = "MODERATE HAZARD";
      lhiClassText.className = "value warning-text";
    } else {
      lhiVal.className = "lhi-score-text safe";
      lhiFillBar.className = "lhi-bar-fill safe-bg";
      lhiClassText.textContent = "SAFE / LOW RISK";
      lhiClassText.className = "value safe-text";
    }
    
    if (lhiData.calculation_method) {
      lhiMethodText.textContent = lhiData.calculation_method;
    }
  }

  // Evaluate Current Sliders via Backend API
  async function evaluateSlidersLHI() {
    const rain = parseFloat(sliderRain.value);
    const soil = parseFloat(sliderSoil.value);
    const slope = parseFloat(sliderSlope.value);
    
    const center = currentRegionData.center; // [lat, lon] approx
    
    try {
      const resp = await fetch('/api/calculate-lhi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: center[0],
          longitude: center[1],
          slope_angle: slope,
          rainfall_24h: rain,
          soil_saturation: soil
        })
      });
      const data = await resp.json();
      updateLHIGaugeUI(data);
    } catch (e) {
      console.error("LHI evaluation API error: ", e);
    }
  }

  // Fetch Open-Meteo Data for Region Center
  async function fetchOpenMeteoData() {
    btnFetchMeteo.disabled = true;
    const center = currentRegionData.center;
    
    try {
      const resp = await fetch(`/api/environmental-metrics?lat=${center[0]}&lon=${center[1]}`);
      const data = await resp.json();
      
      sliderRain.value = data.rainfall_24h_mm;
      sliderSoil.value = data.soil_saturation_index;
      sliderSlope.value = data.estimated_slope_deg;
      
      valRain.textContent = `${data.rainfall_24h_mm} mm`;
      valSoil.textContent = `${data.soil_saturation_index}`;
      valSlope.textContent = `${data.estimated_slope_deg}°`;
      
      evaluateSlidersLHI();
    } catch (e) {
      console.error("Open-Meteo API fetch error: ", e);
    } finally {
      btnFetchMeteo.disabled = false;
    }
  }

  // Slider Event Listeners
  sliderRain.addEventListener('input', (e) => {
    valRain.textContent = `${e.target.value} mm`;
    evaluateSlidersLHI();
  });
  
  sliderSoil.addEventListener('input', (e) => {
    valSoil.textContent = `${e.target.value}`;
    evaluateSlidersLHI();
  });
  
  sliderSlope.addEventListener('input', (e) => {
    valSlope.textContent = `${e.target.value}°`;
    evaluateSlidersLHI();
  });

  // Region Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      
      const regionKey = targetBtn.dataset.region;
      isSimulatingLandslide = false;
      loadRegionRoute(regionKey);
    });
  });

  // Simulation & Action Buttons
  btnSimulate.addEventListener('click', () => {
    triggerLandslideSimulation(currentRegionData.start, currentRegionData.end);
  });

  btnResetRoute.addEventListener('click', () => {
    isSimulatingLandslide = false;
    loadRegionRoute(activeRegionKey);
  });

  btnFetchMeteo.addEventListener('click', () => {
    fetchOpenMeteoData();
  });

  btnRecalcLHI.addEventListener('click', () => {
    evaluateSlidersLHI();
  });

  // Toggle Controls
  chkGeofences.addEventListener('change', () => {
    if (chkGeofences.checked) {
      if (currentGeoJSONGeofences) drawGeofencePolygons(currentGeoJSONGeofences);
    } else {
      geofenceLayersGroup.clearLayers();
    }
  });

  chkHeatmap.addEventListener('change', () => {
    if (chkHeatmap.checked) {
      if (currentGeoJSONGeofences) drawHeatmapOverlay(currentGeoJSONGeofences);
    } else {
      if (heatmapLayer) map.removeLayer(heatmapLayer);
    }
  });

  // System Clock Update
  setInterval(() => {
    const clockEl = document.getElementById('system-clock');
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }
  }, 1000);

  // Initialize Map on Launch
  initMap();
});
