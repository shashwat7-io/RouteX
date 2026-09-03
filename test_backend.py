import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from lhi_engine import LHIEngine
from geofence import GeofenceEngine
from router import RouterEngine

def test_system():
    print("--- 1. Testing LHIEngine ---")
    lhi_engine = LHIEngine()
    
    # Test LHI calculation with critical values
    res = lhi_engine.calculate_lhi(slope_angle=45.0, rainfall_24h=145.0, soil_saturation=0.92)
    print(f"LHI Score: {res['lhi']} | Danger: {res['is_danger']} | Method: {res['calculation_method']}")
    assert res['lhi'] >= 0.75, "Expected critical LHI >= 0.75"
    
    # Test Open-Meteo API
    print("\n--- 2. Testing Open-Meteo Environmental Metrics ---")
    env = lhi_engine.fetch_open_meteo_metrics(30.0869, 78.2676)
    print("Environmental Metrics:", env)
    
    print("\n--- 3. Testing GeofenceEngine (Shapely & GeoPandas) ---")
    geofence_engine = GeofenceEngine()
    points = [
        {"latitude": 30.4120, "longitude": 78.6850, "lhi": 0.864, "name": "Sector A"},
        {"latitude": 30.2000, "longitude": 78.4000, "lhi": 0.350, "name": "Safe Zone"}
    ]
    geofences = geofence_engine.generate_danger_geofences(points, threshold=0.75)
    print(f"Geofences Generated Count: {geofences['geofence_count']}")
    print("Avoidance Bboxes:", geofences["avoid_polygons_bboxes"])
    assert geofences['geofence_count'] == 1, "Expected exactly 1 danger geofence"
    
    print("\n--- 4. Testing RouterEngine & Spatial Intersection ---")
    router_engine = RouterEngine()
    start = [78.2676, 30.0869]
    end = [79.0669, 30.7346]
    
    primary_route = router_engine.get_route(start, end)
    print(f"Primary Route Provider: {primary_route['provider']} | Distance: {primary_route['distance_km']} km | Points: {len(primary_route['coordinates'])}")
    
    # Check intersection
    intersect_res = router_engine.check_route_intersections(primary_route['coordinates'], geofences)
    print(f"Intersects Danger Geofence? {intersect_res['intersects']}")
    
    if intersect_res['intersects']:
        avoid_coords = geofences.get("avoid_polygons_coordinates", [])
        safe_route = router_engine.get_route(start, end, avoid_polygons=avoid_coords)
        print(f"Recalculated Safe Route Distance: {safe_route['distance_km']} km | Provider: {safe_route['provider']}")
        
    print("\n✅ ALL SYSTEM TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_system()
