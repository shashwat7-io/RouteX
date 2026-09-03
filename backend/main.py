import os
import sys
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from lhi_engine import LHIEngine
from geofence import GeofenceEngine
from router import RouterEngine

app = FastAPI(
    title="Landslide Risk Detection & Dynamic Routing Engine",
    description="Real-time environmental metrics, XGBoost Landslide Hazard Index (LHI), Shapely/GeoPandas geofence buffer generation, and obstacle avoidance routing API.",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Core Engines
lhi_engine = LHIEngine()
geofence_engine = GeofenceEngine(default_buffer_radius_m=800.0)
router_engine = RouterEngine()

# Pydantic Schemas
class HazardPointInput(BaseModel):
    latitude: float
    longitude: float
    slope_angle: Optional[float] = None
    rainfall_24h: Optional[float] = None
    soil_saturation: Optional[float] = None
    name: Optional[str] = None

class GeofenceRequest(BaseModel):
    points: List[HazardPointInput]
    hazard_threshold: float = Field(default=0.75, description="LHI threshold for danger geofence buffer")

class RouteRequest(BaseModel):
    start: List[float] = Field(..., description="[longitude, latitude]")
    end: List[float] = Field(..., description="[longitude, latitude]")
    hazard_points: Optional[List[HazardPointInput]] = None
    ors_api_key: Optional[str] = None

class SimulationRequest(BaseModel):
    start: List[float] = Field(..., description="[longitude, latitude]")
    end: List[float] = Field(..., description="[longitude, latitude]")
    hazard_intensity: str = Field(default="CRITICAL", description="CRITICAL, SEVERE, or MODERATE")

# Regional Presets
PRESET_REGIONS = {
    "himalayas": {
        "name": "Himalayas Highway (Rishikesh to Kedarnath)",
        "start": [78.2676, 30.0869],
        "end": [79.0669, 30.7346],
        "center": [30.4000, 78.6500],
        "hazard_sample": {
            "latitude": 30.4120,
            "longitude": 78.6850,
            "slope_angle": 44.5,
            "rainfall_24h": 142.0,
            "soil_saturation": 0.88,
            "name": "Rudraprayag Slope Sector 4"
        }
    },
    "pacific_nw": {
        "name": "Pacific Northwest (Seattle to Mt Rainier Corridor)",
        "start": [-122.3321, 47.6062],
        "end": [-121.7604, 46.8523],
        "center": [47.2000, -122.0000],
        "hazard_sample": {
            "latitude": 47.1850,
            "longitude": -121.9850,
            "slope_angle": 38.0,
            "rainfall_24h": 115.0,
            "soil_saturation": 0.82,
            "name": "Carbon River Landslide Zone"
        }
    },
    "western_ghats": {
        "name": "Western Ghats Pass (Mumbai to Mahabaleshwar)",
        "start": [72.8777, 19.0760],
        "end": [73.6559, 17.9237],
        "center": [18.4000, 73.2500],
        "hazard_sample": {
            "latitude": 18.3250,
            "longitude": 73.2850,
            "slope_angle": 42.0,
            "rainfall_24h": 158.0,
            "soil_saturation": 0.91,
            "name": "Varandha Ghat Escarpment"
        }
    },
    "swiss_alps": {
        "name": "Swiss Alps Route (Geneva to Zermatt)",
        "start": [6.1432, 46.2044],
        "end": [7.7491, 46.0207],
        "center": [46.1200, 6.9500],
        "hazard_sample": {
            "latitude": 46.1150,
            "longitude": 6.9850,
            "slope_angle": 48.0,
            "rainfall_24h": 105.0,
            "soil_saturation": 0.79,
            "name": "Valais Steep Gorge Sector"
        }
    }
}

@app.get("/api/health")
def health_check():
    return {
        "status": "ONLINE",
        "engine": "Landslide Risk Detection & Dynamic Routing System",
        "xgboost_loaded": lhi_engine.model is not None
    }

@app.get("/api/presets")
def get_presets():
    return PRESET_REGIONS

@app.get("/api/environmental-metrics")
def get_environmental_metrics(lat: float = Query(..., description="Latitude"),
                               lon: float = Query(..., description="Longitude")):
    """
    Fetches real-time hourly rainfall, soil moisture volumetric levels, and DEM elevation from Open-Meteo API.
    """
    metrics = lhi_engine.fetch_open_meteo_metrics(lat, lon)
    slope = lhi_engine.estimate_slope_angle(lat, lon)
    metrics["estimated_slope_deg"] = slope
    return metrics

@app.post("/api/calculate-lhi")
def calculate_lhi(input_data: HazardPointInput):
    """
    Calculates Landslide Hazard Index (LHI) using Open-Meteo metrics, XGBoost ML, and geotechnical physical formula.
    """
    lat, lon = input_data.latitude, input_data.longitude
    
    # Auto-fetch environmental metrics if not manually supplied
    if input_data.rainfall_24h is None or input_data.soil_saturation is None:
        env = lhi_engine.fetch_open_meteo_metrics(lat, lon)
        rainfall_24h = input_data.rainfall_24h if input_data.rainfall_24h is not None else env["rainfall_24h_mm"]
        soil_saturation = input_data.soil_saturation if input_data.soil_saturation is not None else env["soil_saturation_index"]
        elevation = env["elevation_m"]
    else:
        rainfall_24h = input_data.rainfall_24h
        soil_saturation = input_data.soil_saturation
        elevation = 800.0
        
    slope_angle = input_data.slope_angle if input_data.slope_angle is not None else lhi_engine.estimate_slope_angle(lat, lon)
    
    res = lhi_engine.calculate_lhi(
        slope_angle=slope_angle,
        rainfall_24h=rainfall_24h,
        soil_saturation=soil_saturation,
        elevation=elevation
    )
    res["location"] = {"latitude": lat, "longitude": lon, "name": input_data.name or "Target Coordinates"}
    return res

@app.post("/api/geofences")
def generate_geofences(req: GeofenceRequest):
    """
    Converts coordinates exceeding hazard threshold (LHI > 0.75) into circular buffer polygons using Shapely / GeoPandas.
    """
    evaluated_points = []
    for pt in req.points:
        lat, lon = pt.latitude, pt.longitude
        slope = pt.slope_angle if pt.slope_angle is not None else lhi_engine.estimate_slope_angle(lat, lon)
        r24 = pt.rainfall_24h if pt.rainfall_24h is not None else 125.0
        ssi = pt.soil_saturation if pt.soil_saturation is not None else 0.85
        
        eval_res = lhi_engine.calculate_lhi(slope, r24, ssi)
        evaluated_points.append({
            "latitude": lat,
            "longitude": lon,
            "lhi": eval_res["lhi"],
            "name": pt.name or f"Sector ({lat:.3f}, {lon:.3f})"
        })
        
    geofences_geojson = geofence_engine.generate_danger_geofences(evaluated_points, threshold=req.hazard_threshold)
    return {
        "geofences": geofences_geojson,
        "evaluated_points": evaluated_points
    }

@app.post("/api/route")
def compute_route(req: RouteRequest):
    """
    Queries primary route, tests polyline-polygon intersections, and if blocked (LHI > 0.75), requests safe alternate route avoiding landslide geofences.
    """
    if req.ors_api_key:
        router_engine.ors_api_key = req.ors_api_key

    # 1. Fetch Primary Route
    primary_route = router_engine.get_route(req.start, req.end)
    
    # 2. Evaluate hazard points & generate danger geofences
    hazard_pts = req.hazard_points or []
    evaluated_pts = []
    for pt in hazard_pts:
        slope = pt.slope_angle if pt.slope_angle is not None else 42.0
        r24 = pt.rainfall_24h if pt.rainfall_24h is not None else 135.0
        ssi = pt.soil_saturation if pt.soil_saturation is not None else 0.88
        lhi_res = lhi_engine.calculate_lhi(slope, r24, ssi)
        evaluated_pts.append({
            "latitude": pt.latitude,
            "longitude": pt.longitude,
            "lhi": lhi_res["lhi"],
            "name": pt.name or "Active Landslide Zone"
        })
        
    geofences = geofence_engine.generate_danger_geofences(evaluated_pts, threshold=0.75)
    
    # 3. Check spatial intersection
    primary_coords = primary_route.get("coordinates", [])
    intersection_res = router_engine.check_route_intersections(primary_coords, geofences)
    
    recalculated_route = None
    is_rerouted = False
    
    if intersection_res["intersects"]:
        is_rerouted = True
        avoid_coords = geofences.get("avoid_polygons_coordinates", [])
        recalculated_route = router_engine.get_route(req.start, req.end, avoid_polygons=avoid_coords)
        
    return {
        "is_rerouted": is_rerouted,
        "hazard_detected": intersection_res["intersects"],
        "intersecting_geofence_count": intersection_res.get("intersecting_count", 0),
        "geofences": geofences,
        "primary_route": primary_route,
        "recalculated_safe_route": recalculated_route if is_rerouted else primary_route,
        "distance_impact_km": round((recalculated_route["distance_km"] - primary_route["distance_km"]), 2) if recalculated_route else 0.0,
        "eta_impact_min": round((recalculated_route["duration_min"] - primary_route["duration_min"]), 1) if recalculated_route else 0.0
    }

@app.post("/api/simulate-landslide")
def simulate_landslide(req: SimulationRequest):
    """
    Simulates a sudden landslide directly along driver's active path, triggering danger geofence and live safe rerouting.
    """
    # Get baseline primary route
    primary_route = router_engine.get_route(req.start, req.end)
    coords = primary_route.get("coordinates", [])
    
    if len(coords) < 10:
        raise HTTPException(status_code=400, detail="Route too short for simulation")
        
    # Inject landslide at ~45% along route polyline
    mid_idx = int(len(coords) * 0.45)
    hazard_lon, hazard_lat = coords[mid_idx]
    
    # Critical hazard metrics
    slope_angle = 46.5
    rainfall_24h = 168.0
    soil_saturation = 0.94
    
    lhi_res = lhi_engine.calculate_lhi(slope_angle, rainfall_24h, soil_saturation)
    
    hazard_point = {
        "latitude": hazard_lat,
        "longitude": hazard_lon,
        "lhi": lhi_res["lhi"],
        "name": "SUDDEN LANDSLIDE OBSTACLE"
    }
    
    geofences = geofence_engine.generate_danger_geofences([hazard_point], threshold=0.75)
    
    # Recalculate safe route bypassing hazard
    avoid_coords = geofences.get("avoid_polygons_coordinates", [])
    safe_route = router_engine.get_route(req.start, req.end, avoid_polygons=avoid_coords)
    
    return {
        "simulation_active": True,
        "event_title": "⚠️ SUDDEN LANDSLIDE DETECTED ALONG ACTIVE PATH",
        "hazard_location": [hazard_lon, hazard_lat],
        "hazard_lhi": lhi_res["lhi"],
        "lhi_breakdown": lhi_res,
        "geofences": geofences,
        "blocked_primary_route": primary_route,
        "recalculated_safe_route": safe_route,
        "alert": {
            "status": "ROUTE BLOCKED - AUTOMATIC DETOUR ENGAGED",
            "primary_distance_km": primary_route["distance_km"],
            "safe_distance_km": safe_route["distance_km"],
            "added_distance_km": round(safe_route["distance_km"] - primary_route["distance_km"], 2),
            "added_eta_min": round(safe_route["duration_min"] - primary_route["duration_min"], 1)
        }
    }

# Mount static frontend directory at root /
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
