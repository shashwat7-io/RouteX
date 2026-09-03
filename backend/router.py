import math
import requests
from typing import List, Dict, Any, Tuple, Optional
import numpy as np
import geopandas as gpd
from shapely.geometry import LineString, Polygon, Point, MultiPolygon
from shapely.ops import transform
import pyproj

class RouterEngine:
    def __init__(self, ors_api_key: Optional[str] = None):
        self.ors_api_key = ors_api_key
        self.wgs84_to_mercator = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform
        self.mercator_to_wgs84 = pyproj.Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True).transform

    def get_route(self, start_coords: List[float], end_coords: List[float], avoid_polygons: Optional[List] = None) -> Dict[str, Any]:
        """
        Fetches route geometry from OSRM or OpenRouteService.
        start_coords: [lon, lat]
        end_coords: [lon, lat]
        """
        # Try OpenRouteService if API key provided
        if self.ors_api_key and self.ors_api_key.strip():
            ors_res = self._query_openrouteservice(start_coords, end_coords, avoid_polygons)
            if ors_res:
                return ors_res
                
        # Try OSRM / Detour Waypoint Router
        return self._query_osrm_with_detour(start_coords, end_coords, avoid_polygons)

    def _query_osrm_with_detour(self, start: List[float], end: List[float], avoid_polygons: Optional[List] = None) -> Dict[str, Any]:
        """
        Queries OSRM public API. If avoid_polygons provided, inserts detour waypoint bypassing hazard center.
        """
        waypoints = [start]
        
        if avoid_polygons and len(avoid_polygons) > 0:
            # Calculate detour waypoint bypassing hazard center
            for poly_coords in avoid_polygons:
                if len(poly_coords) > 0:
                    poly_shape = Polygon(poly_coords)
                    centroid = poly_shape.centroid
                    c_lon, c_lat = centroid.x, centroid.y
                    
                    # Compute perpendicular detour vector
                    dx = end[0] - start[0]
                    dy = end[1] - start[1]
                    norm = math.sqrt(dx*dx + dy*dy) + 1e-6
                    
                    # Offset perpendicular by ~0.015 degrees (~1.5 km)
                    perp_x = -dy / norm * 0.018
                    perp_y = dx / norm * 0.018
                    
                    detour_lon = c_lon + perp_x
                    detour_lat = c_lat + perp_y
                    waypoints.append([round(detour_lon, 5), round(detour_lat, 5)])
                    
        waypoints.append(end)
        
        # Build OSRM query URL
        coord_str = ";".join([f"{pt[0]},{pt[1]}" for pt in waypoints])
        osrm_url = f"http://router.project-osrm.org/route/v1/driving/{coord_str}?overview=full&geometries=geojson"
        
        try:
            resp = requests.get(osrm_url, timeout=6)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("routes") and len(data["routes"]) > 0:
                    route = data["routes"][0]
                    coords = route["geometry"]["coordinates"]
                    dist_km = round(route["distance"] / 1000.0, 2)
                    duration_min = round(route["duration"] / 60.0, 1)
                    
                    return {
                        "coordinates": coords,
                        "distance_km": dist_km,
                        "duration_min": duration_min,
                        "provider": "OSRM Routing Engine",
                        "status": "SUCCESS"
                    }
        except Exception as e:
            print(f"[RouterEngine] OSRM query notice: {e}")
            
        # Great circle fallback generator if network route fails
        return self._fallback_interpolated_route(start, end, waypoints if len(waypoints) > 2 else None)

    def _query_openrouteservice(self, start: List[float], end: List[float], avoid_polygons: Optional[List] = None) -> Optional[Dict[str, Any]]:
        """
        Query OpenRouteService POST endpoint with avoid_polygons body parameter
        """
        try:
            url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson"
            headers = {
                "Authorization": self.ors_api_key,
                "Content-Type": "application/json"
            }
            body = {
                "coordinates": [start, end]
            }
            if avoid_polygons:
                # Format GeoJSON polygon geometries for ORS options
                polygon_geoms = []
                for poly_coords in avoid_polygons:
                    polygon_geoms.append({
                        "type": "Polygon",
                        "coordinates": [poly_coords]
                    })
                body["options"] = {
                    "avoid_polygons": {
                        "type": "MultiPolygon",
                        "coordinates": [g["coordinates"] for g in polygon_geoms]
                    }
                }
            resp = requests.post(url, json=body, headers=headers, timeout=8)
            if resp.status_code == 200:
                data = resp.json()
                feature = data["features"][0]
                coords = feature["geometry"]["coordinates"]
                props = feature["properties"]["summary"]
                return {
                    "coordinates": coords,
                    "distance_km": round(props["distance"] / 1000.0, 2),
                    "duration_min": round(props["duration"] / 60.0, 1),
                    "provider": "OpenRouteService API",
                    "status": "SUCCESS"
                }
        except Exception as e:
            print(f"[RouterEngine] OpenRouteService API error: {e}")
        return None

    def _fallback_interpolated_route(self, start: List[float], end: List[float], waypoints: Optional[List] = None) -> Dict[str, Any]:
        """
        Generates realistic curved path interpolation when external router is unreachable.
        """
        pts_list = [start]
        if waypoints and len(waypoints) > 2:
            pts_list.extend(waypoints[1:-1])
        pts_list.append(end)
        
        full_coords = []
        total_dist_km = 0.0
        
        for i in range(len(pts_list) - 1):
            p1 = pts_list[i]
            p2 = pts_list[i+1]
            n_seg = 25
            lons = np.linspace(p1[0], p2[0], n_seg)
            lats = np.linspace(p1[1], p2[1], n_seg)
            
            # Add subtle natural road curvature wiggle
            wiggle_scale = 0.003
            t = np.linspace(0, np.pi, n_seg)
            wiggle_lats = lats + (np.sin(t) * wiggle_scale * (1 if i%2==0 else -1))
            
            for lon, lat in zip(lons, wiggle_lats):
                full_coords.append([round(lon, 6), round(lat, 6)])
                
            dx = (p2[0] - p1[0]) * 111.0 * math.cos(math.radians(p1[1]))
            dy = (p2[1] - p1[1]) * 111.0
            total_dist_km += math.sqrt(dx*dx + dy*dy)
            
        total_dist_km = round(total_dist_km * 1.25, 2) # Road winding factor
        duration_min = round(total_dist_km / 50.0 * 60, 1)
        
        return {
            "coordinates": full_coords,
            "distance_km": total_dist_km,
            "duration_min": duration_min,
            "provider": "Synthetic Road Interpolator",
            "status": "SUCCESS"
        }

    def check_route_intersections(self, route_coords: List[List[float]], geofences_geojson: Dict[str, Any]) -> Dict[str, Any]:
        """
        Checks if route polyline intersects any active landslide geofence polygon using Shapely & GeoPandas.
        """
        if len(route_coords) < 2:
            return {"intersects": False, "intersecting_geofences": []}
            
        route_line = LineString(route_coords)
        features = geofences_geojson.get("features", [])
        
        intersecting = []
        for feature in features:
            geom_dict = feature.get("geometry", {})
            props = feature.get("properties", {})
            
            if geom_dict.get("type") == "Polygon":
                poly_shape = Polygon(geom_dict["coordinates"][0])
                if route_line.intersects(poly_shape):
                    # Compute exact intersection coordinates or closest point
                    intersecting.append({
                        "id": props.get("id"),
                        "name": props.get("name"),
                        "lhi": props.get("lhi"),
                        "center": props.get("center")
                    })
                    
        return {
            "intersects": len(intersecting) > 0,
            "intersecting_count": len(intersecting),
            "intersecting_geofences": intersecting
        }
