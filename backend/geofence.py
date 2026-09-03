import json
from typing import List, Dict, Any, Tuple
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point, Polygon, MultiPolygon
from shapely.ops import transform
import pyproj

class GeofenceEngine:
    def __init__(self, default_buffer_radius_m: float = 800.0):
        self.default_buffer_radius_m = default_buffer_radius_m
        # Transformers for accurate metric buffering
        self.wgs84_to_mercator = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True).transform
        self.mercator_to_wgs84 = pyproj.Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True).transform

    def generate_danger_geofences(self, hazard_points: List[Dict[str, Any]], threshold: float = 0.75) -> Dict[str, Any]:
        """
        Converts hazard points exceeding threshold (LHI > 0.75) into circular buffer polygons using Shapely & GeoPandas.
        
        Input hazard_points: List of dicts containing:
          {'latitude': float, 'longitude': float, 'lhi': float, 'name': str (optional)}
        """
        danger_points = [pt for pt in hazard_points if pt.get('lhi', 0.0) >= threshold]
        
        if not danger_points:
            return {
                "type": "FeatureCollection",
                "features": [],
                "geofence_count": 0,
                "avoid_polygons_bboxes": [],
                "avoid_polygons_coordinates": []
            }

        geometries = []
        properties_list = []
        avoid_bboxes = []
        avoid_coords = []

        for idx, pt in enumerate(danger_points):
            lat = pt['latitude']
            lon = pt['longitude']
            lhi = pt.get('lhi', 0.8)
            name = pt.get('name', f"Hazard Zone {idx+1}")
            
            # Dynamic buffer radius based on LHI severity (500m to 1500m)
            radius_m = self.default_buffer_radius_m * (1.0 + (lhi - 0.75) * 2.0)
            
            # Create WGS84 point
            point_wgs84 = Point(lon, lat)
            
            # Transform to Mercator EPSG:3857 for accurate meter buffer
            point_mercator = transform(self.wgs84_to_mercator, point_wgs84)
            buffer_mercator = point_mercator.buffer(radius_m)
            
            # Transform back to WGS84
            buffer_wgs84 = transform(self.mercator_to_wgs84, buffer_mercator)
            
            geometries.append(buffer_wgs84)
            
            # Compute bounding box [min_lon, min_lat, max_lon, max_lat]
            bounds = buffer_wgs84.bounds
            avoid_bboxes.append([bounds[0], bounds[1], bounds[2], bounds[3]])
            
            # Extract polygon coordinates [[[lon, lat], ...]]
            if isinstance(buffer_wgs84, Polygon):
                coords = [[c[0], c[1]] for c in buffer_wgs84.exterior.coords]
                avoid_coords.append(coords)
            
            properties_list.append({
                "id": f"geofence-{idx+1}",
                "name": name,
                "lhi": lhi,
                "radius_m": round(radius_m, 1),
                "center": [lon, lat],
                "hazard_level": "CRITICAL"
            })

        # Construct GeoPandas GeoDataFrame
        gdf = gpd.GeoDataFrame(properties_list, geometry=geometries, crs="EPSG:4326")
        
        # Convert to GeoJSON Dict
        geojson_dict = json.loads(gdf.to_json())
        geojson_dict["geofence_count"] = len(danger_points)
        geojson_dict["avoid_polygons_bboxes"] = avoid_bboxes
        geojson_dict["avoid_polygons_coordinates"] = avoid_coords
        
        return geojson_dict
