// Landslide Risk Detection & Dynamic Routing Engine - Frontend Application Script

document.addEventListener('DOMContentLoaded', () => {
  // Register Service Worker for Offline Caching
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('[ServiceWorker] Registered successfully:', reg.scope))
      .catch((err) => console.warn('[ServiceWorker] Registration failed:', err));
  }

  // Network Status Monitor
  const offlineBadge = document.getElementById('offline-badge');
  function updateOnlineStatus() {
    if (!navigator.onLine) {
      if (offlineBadge) offlineBadge.classList.remove('hidden');
    } else {
      if (offlineBadge) offlineBadge.classList.add('hidden');
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // Initialize Lucide icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // App State
  let map = null;
  let primaryRouteLayer = null;
  let safeRouteLayer = null;
  let geofenceLayersGroup = L.layerGroup();
  let hazardMarkersGroup = L.layerGroup();
  let routeMarkersGroup = L.layerGroup();
  let heatmapLayer = null;
  
  let activeRegionKey = 'badrinath';
  let currentRegionData = null;
  let currentGeoJSONGeofences = null;
  
  // Preset Region Definitions
  const REGIONS = {
    badrinath: {
      name: "Himalayas Highway (Rishikesh to Badrinath)",
      start: [78.2676, 30.0869], // [lon, lat]
      end: [79.4938, 30.7433],
      center: [30.4100, 78.8800], // [lat, lon]
      zoom: 9,
      hazard: {
        latitude: 30.5500,
        longitude: 79.1200,
        slope_angle: 46.5,
        rainfall_24h: 165.0,
        soil_saturation: 0.92,
        name: "Rudraprayag-Joshimath Landslide Corridor"
      }
    },
    sikkim_gangtok: {
      name: "North-East Pass (Siliguri to Gangtok NH10)",
      start: [88.4236, 26.7271],
      end: [88.6138, 27.3389],
      center: [27.0500, 88.5200],
      zoom: 9,
      hazard: {
        latitude: 27.0850,
        longitude: 88.4750,
        slope_angle: 45.0,
        rainfall_24h: 175.0,
        soil_saturation: 0.94,
        name: "Teesta River Valley (NH10 Landslide Zone)"
      }
    },
    arunachal_tawang: {
      name: "Arunachal Highway (Guwahati to Tawang)",
      start: [91.7362, 26.1445],
      end: [91.8594, 27.5861],
      center: [26.8500, 91.8000],
      zoom: 8,
      hazard: {
        latitude: 27.5050,
        longitude: 92.1000,
        slope_angle: 49.0,
        rainfall_24h: 160.0,
        soil_saturation: 0.89,
        name: "Sela Pass High Altitude Slope Sector"
      }
    },
    meghalaya_sohra: {
      name: "Meghalaya Escarpment (Shillong to Cherrapunji)",
      start: [91.8933, 25.5788],
      end: [91.7323, 25.2702],
      center: [25.4200, 91.8100],
      zoom: 10,
      hazard: {
        latitude: 25.3550,
        longitude: 91.7850,
        slope_angle: 47.5,
        rainfall_24h: 210.0,
        soil_saturation: 0.96,
        name: "Duwan Sing Syiem Slope Escarpment"
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

  // Initialize Leaflet Map
  function initMap() {
    currentRegionData = REGIONS[activeRegionKey];
    const centerLat = currentRegionData.center[0];
    const centerLon = currentRegionData.center[1];
    
    map = L.map('map').setView([centerLat, centerLon], currentRegionData.zoom);
    
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Standard OpenStreetMap Tile Layer
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    geofenceLayersGroup.addTo(map);
    hazardMarkersGroup.addTo(map);
    routeMarkersGroup.addTo(map);

    // Invalidate map size after DOM layout renders
    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 200);

    // Window resize handler
    window.addEventListener('resize', () => {
      if (map) map.invalidateSize();
    });

    // Load initial route and evaluate hazard
    loadRegionRoute(activeRegionKey);
  }

  // Load Route for selected region
  async function loadRegionRoute(regionKey, simulateEvent = false) {
    if (!REGIONS[regionKey]) return;
    activeRegionKey = regionKey;
    currentRegionData = REGIONS[regionKey];
    
    map.flyTo([currentRegionData.center[0], currentRegionData.center[1]], currentRegionData.zoom, {
      duration: 1.0
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

      if (!resp.ok) {
        throw new Error(`Server returned HTTP ${resp.status}`);
      }

      const data = await resp.json();
      renderRoutesAndGeofences(data, start, end);
    } catch (e) {
      console.warn("API route query error, using dynamic local fallback route: ", e);
      renderLocalFallbackRoute(start, end, hazardPoints);
    }
  }

  // Local Fallback Route Renderer if API fails or network delays
  function renderLocalFallbackRoute(start, end, hazardPoints) {
    const hazard = (hazardPoints && hazardPoints.length > 0) ? hazardPoints[0] : currentRegionData.hazard;
    const hLat = hazard.latitude;
    const hLon = hazard.longitude;
    
    // Direct blocked path points
    const directCoords = [
      [start[1], start[0]],
      [hLat, hLon],
      [end[1], end[0]]
    ];

    // Detour path points avoiding hazard center
    const detourOffsetLat = 0.08;
    const detourOffsetLon = -0.06;
    const safeCoords = [
      [start[1], start[0]],
      [hLat + detourOffsetLat, hLon + detourOffsetLon],
      [end[1], end[0]]
    ];

    // Construct mock GeoJSON geofence
    const mockGeofence = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {
          name: hazard.name || "Critical Landslide Geofence",
          lhi: 0.88,
          radius_m: 800,
          center: [hLon, hLat]
        },
        geometry: {
          type: "Polygon",
          coordinates: [createCirclePolygonCoords(hLon, hLat, 0.012)]
        }
      }]
    };

    const mockRouteData = {
      is_rerouted: true,
      hazard_detected: true,
      primary_route: {
        coordinates: directCoords.map(c => [c[1], c[0]]),
        distance_km: 74.2
      },
      recalculated_safe_route: {
        coordinates: safeCoords.map(c => [c[1], c[0]]),
        distance_km: 81.5
      },
      geofences: mockGeofence,
      eta_impact_min: 14
    };

    renderRoutesAndGeofences(mockRouteData, start, end);
  }

  // Generate circle coordinates array for polygon buffer
  function createCirclePolygonCoords(centerLon, centerLat, radiusDeg) {
    const coords = [];
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const dx = radiusDeg * Math.cos(angle);
      const dy = radiusDeg * Math.sin(angle);
      coords.push([centerLon + dx, centerLat + dy]);
    }
    coords.push(coords[0]); // close loop
    return coords;
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

      if (!resp.ok) throw new Error("Simulation request failed");
      const data = await resp.json();

      renderSimulationResult(data, start, end);
    } catch (e) {
      console.warn("Simulation endpoint error, triggering fallback simulation: ", e);
      renderLocalFallbackRoute(start, end, [currentRegionData.hazard]);
    } finally {
      btnSimulate.classList.remove('loading');
      btnSimulate.disabled = false;
    }
  }

  // Render Routes and Geofence Layers
  function renderRoutesAndGeofences(routeData, start, end) {
    clearMapLayers();

    // 1. Draw Start & End Custom Markers
    const startIcon = L.divIcon({
      className: 'custom-map-marker start-marker',
      html: '<div style="background:#10b981; width:18px; height:18px; border-radius:50%; border:3px solid #ffffff; box-shadow: 0 0 14px #10b981;"></div>',
      iconSize: [22, 22]
    });
    
    const endIcon = L.divIcon({
      className: 'custom-map-marker end-marker',
      html: '<div style="background:#3b82f6; width:18px; height:18px; border-radius:50%; border:3px solid #ffffff; box-shadow: 0 0 14px #3b82f6;"></div>',
      iconSize: [22, 22]
    });

    L.marker([start[1], start[0]], { icon: startIcon }).addTo(routeMarkersGroup).bindPopup("<b>Route Origin</b>");
    L.marker([end[1], end[0]], { icon: endIcon }).addTo(routeMarkersGroup).bindPopup("<b>Destination</b>");

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
        weight: 4,
        dashArray: '8, 8',
        opacity: 0.85
      }).addTo(map);

      // Draw Recalculated Safe Detour Route (Emerald Green Solid)
      const safeCoords = routeData.recalculated_safe_route.coordinates.map(c => [c[1], c[0]]);
      safeRouteLayer = L.polyline(safeCoords, {
        color: '#10b981',
        weight: 6,
        opacity: 0.95
      }).addTo(map);

      // Auto-fit bounds around safe detour route
      if (safeRouteLayer.getBounds().isValid()) {
        map.fitBounds(safeRouteLayer.getBounds(), { padding: [50, 50] });
      }

      // Show Warning Alert Banner
      showAlertBanner({
        title: "⚠️ CRITICAL HAZARD DETECTED - AUTONOMOUS DETOUR ENGAGED",
        message: `High Landslide Hazard Index (LHI > 0.75) detected along primary corridor. Safe obstacle-avoidance route recalculated.`,
        origDist: `${routeData.primary_route.distance_km} km`,
        safeDist: `${routeData.recalculated_safe_route.distance_km} km`,
        etaDelta: `+${Math.abs(routeData.eta_impact_min || 12)} min`
      });
    } else {
      // Safe Route Only (Green Solid)
      const coords = routeData.primary_route.coordinates.map(c => [c[1], c[0]]);
      safeRouteLayer = L.polyline(coords, {
        color: '#10b981',
        weight: 6,
        opacity: 0.95
      }).addTo(map);

      if (safeRouteLayer.getBounds().isValid()) {
        map.fitBounds(safeRouteLayer.getBounds(), { padding: [50, 50] });
      }

      hideAlertBanner();
    }

    if (window.lucide) lucide.createIcons();
  }

  // Render Simulation Result
  function renderSimulationResult(simData, start, end) {
    clearMapLayers();

    // 1. Draw Start & End Markers
    L.marker([start[1], start[0]]).addTo(routeMarkersGroup).bindPopup("<b>Route Origin</b>");
    L.marker([end[1], end[0]]).addTo(routeMarkersGroup).bindPopup("<b>Destination</b>");

    // 2. Draw Hazard Marker
    const hazLoc = simData.hazard_location || [currentRegionData.hazard.longitude, currentRegionData.hazard.latitude];
    const obstacleIcon = L.divIcon({
      className: 'custom-map-marker obstacle-marker',
      html: '<div style="background:#ef4444; width:28px; height:28px; border-radius:50%; border:3px solid #ffffff; box-shadow: 0 0 20px #ef4444; display:flex; align-items:center; justify-content:center; color:#ffffff; font-weight:bold; font-size:14px;">⚠️</div>',
      iconSize: [28, 28]
    });
    
    L.marker([hazLoc[1], hazLoc[0]], { icon: obstacleIcon }).addTo(hazardMarkersGroup)
      .bindPopup(`<b>CATASTROPHIC SLOPE FAILURE</b><br>LHI: ${simData.hazard_lhi || 0.92}<br>Status: Hazard Geofence Active`)
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
    if (simData.blocked_primary_route) {
      const origCoords = simData.blocked_primary_route.coordinates.map(c => [c[1], c[0]]);
      primaryRouteLayer = L.polyline(origCoords, {
        color: '#ef4444',
        weight: 4,
        dashArray: '8, 8',
        opacity: 0.85
      }).addTo(map);
    }

    // 5. Draw Recalculated Safe Bypass Route (Green Solid)
    if (simData.recalculated_safe_route) {
      const safeCoords = simData.recalculated_safe_route.coordinates.map(c => [c[1], c[0]]);
      safeRouteLayer = L.polyline(safeCoords, {
        color: '#10b981',
        weight: 6,
        opacity: 0.95
      }).addTo(map);

      if (safeRouteLayer.getBounds().isValid()) {
        map.fitBounds(safeRouteLayer.getBounds(), { padding: [50, 50] });
      }
    }

    // 6. Update Gauge UI
    if (simData.lhi_breakdown) {
      updateLHIGaugeUI(simData.lhi_breakdown);
    }

    // 7. Show Alert Banner
    if (simData.alert) {
      showAlertBanner({
        title: simData.event_title || "🚨 SUDDEN SLOPE FAILURE EVENT SIMULATED",
        message: simData.alert.status || "Critical landslide triggered along active trajectory. Safe detour route calculated.",
        origDist: `${simData.alert.primary_distance_km || 74} km`,
        safeDist: `${simData.alert.safe_distance_km || 82} km`,
        etaDelta: `+${simData.alert.added_eta_min || 15} min`
      });
    }
  }

  // Draw GeoJSON Geofence Polygons
  function drawGeofencePolygons(geojson) {
    geofenceLayersGroup.clearLayers();
    
    L.geoJSON(geojson, {
      style: function(feature) {
        return {
          color: '#ef4444',
          fillColor: '#ef4444',
          fillOpacity: 0.30,
          weight: 2,
          dashArray: '5, 5'
        };
      },
      onEachFeature: function(feature, layer) {
        const props = feature.properties || {};
        layer.bindPopup(`
          <div style="font-family: 'Inter', sans-serif; padding:4px;">
            <h4 style="color:#ef4444; margin-bottom:4px; font-weight:700;">⚠️ ${props.name || 'Landslide Danger Zone'}</h4>
            <p style="margin:2px 0;"><b>Hazard Index (LHI):</b> <span style="color:#f59e0b; font-weight:600;">${props.lhi || '0.86'}</span></p>
            <p style="margin:2px 0;"><b>Geofence Buffer Radius:</b> ${props.radius_m || 800} meters</p>
            <p style="margin:2px 0;"><b>Status:</b> Dynamic Obstacle Avoidance Polygon</p>
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
    
    if (window.L && window.L.heatLayer && heatPoints.length > 0) {
      heatmapLayer = L.heatLayer(heatPoints, {
        radius: 50,
        blur: 30,
        maxZoom: 13,
        gradient: { 0.4: '#f59e0b', 0.7: '#f97316', 1.0: '#ef4444' }
      }).addTo(map);
    }
  }

  // Clear Map Layers
  function clearMapLayers() {
    if (primaryRouteLayer) map.removeLayer(primaryRouteLayer);
    if (safeRouteLayer) map.removeLayer(safeRouteLayer);
    geofenceLayersGroup.clearLayers();
    hazardMarkersGroup.clearLayers();
    routeMarkersGroup.clearLayers();
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
    const lhi = typeof lhiData.lhi === 'number' ? lhiData.lhi : 0.864;
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
    
    const center = currentRegionData.center; // [lat, lon]
    
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
      if (resp.ok) {
        const data = await resp.json();
        updateLHIGaugeUI(data);
      }
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
      if (resp.ok) {
        const data = await resp.json();
        
        sliderRain.value = data.rainfall_24h_mm;
        sliderSoil.value = data.soil_saturation_index;
        sliderSlope.value = data.estimated_slope_deg;
        
        valRain.textContent = `${data.rainfall_24h_mm} mm`;
        valSoil.textContent = `${data.soil_saturation_index}`;
        valSlope.textContent = `${data.estimated_slope_deg}°`;
        
        evaluateSlidersLHI();
      }
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
      loadRegionRoute(regionKey);
    });
  });

  // Mobile Control Panel Toggle
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  if (btnToggleSidebar) {
    btnToggleSidebar.addEventListener('click', () => {
      const sidebar = document.querySelector('.sidebar-panel');
      if (sidebar) {
        sidebar.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // Simulation & Action Buttons
  btnSimulate.addEventListener('click', () => {
    triggerLandslideSimulation(currentRegionData.start, currentRegionData.end);
  });

  btnResetRoute.addEventListener('click', () => {
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
      clockEl.textContent = now.toISOString().replace('T', ' ').substring(11, 19) + ' UTC';
    }
  }, 1000);

  // ==========================================================================
  // AI CHATBOT ASSISTANT LOGIC (HUGGING FACE POWERED)
  // ==========================================================================
  const btnOpenChat = document.getElementById('btn-open-chat');
  const btnCloseChat = document.getElementById('btn-close-chat');
  const chatWidget = document.getElementById('chat-widget');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInputField = document.getElementById('chat-input-field');

  if (btnOpenChat && chatWidget) {
    btnOpenChat.addEventListener('click', () => {
      chatWidget.classList.toggle('hidden');
      if (!chatWidget.classList.contains('hidden') && chatInputField) {
        chatInputField.focus();
      }
    });
  }

  if (btnCloseChat && chatWidget) {
    btnCloseChat.addEventListener('click', () => {
      chatWidget.classList.add('hidden');
    });
  }

  // Quick Suggestion Chips
  document.querySelectorAll('.chip-btn').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (prompt && chatInputField) {
        chatInputField.value = prompt;
        sendChatMessage(prompt);
      }
    });
  });

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = chatInputField.value.trim();
      if (msg) {
        sendChatMessage(msg);
      }
    });
  }

  async function sendChatMessage(userText) {
    chatInputField.value = '';

    // Append User Message Bubble
    appendMessageBubble(userText, 'user');

    // Append Typing Indicator
    const typingBubble = appendMessageBubble('<i>RouteX AI is thinking...</i>', 'bot');

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          region_context: activeRegionKey
        })
      });

      if (!resp.ok) throw new Error("Chat response failed");
      const data = await resp.json();

      // Replace typing bubble with actual reply
      typingBubble.querySelector('.msg-bubble').innerHTML = formatChatReply(data.reply);
    } catch (e) {
      console.error("Chat API error: ", e);
      typingBubble.querySelector('.msg-bubble').innerHTML = "⚠️ Sorry, I could not reach the Hugging Face AI assistant. Please check your backend connection.";
    } finally {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  function appendMessageBubble(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${sender}`;
    msgDiv.innerHTML = `<div class="msg-bubble">${text}</div>`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgDiv;
  }

  // ==========================================================================
  // SOS EMERGENCY SURVIVAL & GPS TELEMETRY HANDLERS
  // ==========================================================================
  const btnSosGuide = document.getElementById('btn-sos-guide');
  const btnCloseSos = document.getElementById('btn-close-sos');
  const sosModal = document.getElementById('sos-modal');
  const sosGpsText = document.getElementById('sos-gps-text');
  const btnCopyGps = document.getElementById('btn-copy-gps');

  if (btnSosGuide && sosModal) {
    btnSosGuide.addEventListener('click', () => {
      sosModal.classList.remove('hidden');
      fetchEmergencyGPSLocation();
    });
  }

  if (btnCloseSos && sosModal) {
    btnCloseSos.addEventListener('click', () => {
      sosModal.classList.add('hidden');
    });
  }

  function fetchEmergencyGPSLocation() {
    if (!sosGpsText) return;
    
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(5);
          const lon = pos.coords.longitude.toFixed(5);
          const alt = pos.coords.altitude ? ` • Alt: ${pos.coords.altitude.toFixed(0)}m` : '';
          sosGpsText.textContent = `LAT: ${lat}° N, LON: ${lon}° E${alt}`;
        },
        (err) => {
          // Fallback to active region center coordinates if GPS denied or unavailable
          if (currentRegionData) {
            const center = currentRegionData.center;
            sosGpsText.textContent = `LAT: ${center[0].toFixed(4)}° N, LON: ${center[1].toFixed(4)}° E (Region Center)`;
          } else {
            sosGpsText.textContent = "LAT: 30.4100° N, LON: 78.8800° E (Preset Region Fix)";
          }
        },
        { timeout: 8000, enableHighAccuracy: true }
      );
    } else if (currentRegionData) {
      const center = currentRegionData.center;
      sosGpsText.textContent = `LAT: ${center[0].toFixed(4)}° N, LON: ${center[1].toFixed(4)}° E (Region Center)`;
    }
  }

  if (btnCopyGps && sosGpsText) {
    btnCopyGps.addEventListener('click', () => {
      const textToCopy = `EMERGENCY SOS LANDSLIDE LOCATION: ${sosGpsText.textContent}`;
      navigator.clipboard.writeText(textToCopy).then(() => {
        const span = btnCopyGps.querySelector('span');
        if (span) {
          span.textContent = "Copied!";
          setTimeout(() => { span.textContent = "Copy Coordinates"; }, 2500);
        }
      }).catch(err => console.error("Copy failed:", err));
    });
  }

  // Initialize Map on Launch
  initMap();
});



