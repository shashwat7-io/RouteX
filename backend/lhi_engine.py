import os
import math
import joblib
import requests
import numpy as np
import pandas as pd
from typing import Dict, Any, Optional, Tuple

MODEL_PKL_PATH = os.path.join(os.path.dirname(__file__), "landslide_model.pkl")

class LHIEngine:
    def __init__(self):
        self.model = None
        self._load_model()
        
    def _load_model(self):
        if os.path.exists(MODEL_PKL_PATH):
            try:
                self.model = joblib.load(MODEL_PKL_PATH)
                print(f"[LHIEngine] Landslide ML model loaded successfully from {MODEL_PKL_PATH}")
            except Exception as e:
                print(f"[LHIEngine] Warning loading ML model: {e}. Will use weighted formula.")
                self.model = None
        else:
            print("[LHIEngine] Model file not found. Will use weighted formula fallback.")

    def fetch_open_meteo_metrics(self, lat: float, lon: float) -> Dict[str, Any]:
        """
        Fetches real-time hourly precipitation, soil moisture, and elevation from Open-Meteo API.
        """
        try:
            url = "https://api.open-meteo.com/v1/forecast"
            params = {
                "latitude": lat,
                "longitude": lon,
                "hourly": "precipitation,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm",
                "forecast_days": 2,
                "timezone": "auto"
            }
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            
            hourly = data.get("hourly", {})
            precip_list = hourly.get("precipitation", [0.0]*24)
            soil_0_7 = hourly.get("soil_moisture_0_to_7cm", [0.25]*24)
            soil_7_28 = hourly.get("soil_moisture_7_to_28cm", [0.28]*24)
            
            r24 = float(np.sum(precip_list[:24])) if len(precip_list) >= 24 else float(np.sum(precip_list))
            
            current_soil_0_7 = float(soil_0_7[0]) if soil_0_7 and soil_0_7[0] is not None else 0.25
            current_soil_7_28 = float(soil_7_28[0]) if soil_7_28 and soil_7_28[0] is not None else 0.28
            mean_volumetric_moisture = (current_soil_0_7 + current_soil_7_28) / 2.0
            
            soil_saturation_index = min(1.0, max(0.0, mean_volumetric_moisture / 0.45))
            elevation = self.fetch_elevation(lat, lon)
            
            return {
                "latitude": lat,
                "longitude": lon,
                "rainfall_24h_mm": round(r24, 2),
                "soil_saturation_index": round(soil_saturation_index, 3),
                "volumetric_moisture_m3_m3": round(mean_volumetric_moisture, 3),
                "elevation_m": round(elevation, 1),
                "source": "Open-Meteo Live API"
            }
        except Exception as e:
            print(f"[LHIEngine] Open-Meteo API fallback triggered for ({lat}, {lon}): {e}")
            return self._fallback_environmental_metrics(lat, lon)

    def fetch_elevation(self, lat: float, lon: float) -> float:
        try:
            url = "https://api.open-meteo.com/v1/elevation"
            resp = requests.get(url, params={"latitude": lat, "longitude": lon}, timeout=5)
            if resp.status_code == 200:
                elev_list = resp.json().get("elevation", [500.0])
                if isinstance(elev_list, list) and len(elev_list) > 0:
                    return float(elev_list[0])
                return float(elev_list)
        except Exception:
            pass
        return 650.0

    def estimate_slope_angle(self, lat: float, lon: float) -> float:
        delta = 0.002
        try:
            z_north = self.fetch_elevation(lat + delta, lon)
            z_south = self.fetch_elevation(lat - delta, lon)
            z_east = self.fetch_elevation(lat, lon + delta)
            z_west = self.fetch_elevation(lat, lon - delta)
            
            dist_m = delta * 111320.0
            dz_dx = (z_east - z_west) / (2 * dist_m)
            dz_dy = (z_north - z_south) / (2 * dist_m)
            
            slope_rad = math.atan(math.sqrt(dz_dx**2 + dz_dy**2))
            slope_deg = math.degrees(slope_rad)
            return round(min(65.0, max(5.0, slope_deg)), 2)
        except Exception:
            elev = self.fetch_elevation(lat, lon)
            slope = min(50.0, max(8.0, (elev / 100.0) * 1.8))
            return round(slope, 2)

    def _fallback_environmental_metrics(self, lat: float, lon: float) -> Dict[str, Any]:
        seed_val = int(abs(lat * 1000 + lon * 1000)) % 100
        r24 = 35.0 + (seed_val % 110)
        ssi = 0.40 + ((seed_val % 50) / 100.0)
        elev = 400.0 + (seed_val * 25)
        
        return {
            "latitude": lat,
            "longitude": lon,
            "rainfall_24h_mm": round(r24, 2),
            "soil_saturation_index": round(ssi, 3),
            "volumetric_moisture_m3_m3": round(ssi * 0.45, 3),
            "elevation_m": round(elev, 1),
            "source": "Estimated Baseline"
        }

    def calculate_lhi(self, 
                      slope_angle: float, 
                      rainfall_24h: float, 
                      soil_saturation: float, 
                      elevation: float = 800.0,
                      veg_cover: float = 0.45) -> Dict[str, Any]:
        """
        Calculates Landslide Hazard Index (LHI) between 0.0 and 1.0 using ML inference & weighted physical formula.
        """
        # 1. Weighted Formula Calculation
        f_slope = min(1.0, (slope_angle / 45.0) ** 1.4)
        f_rain = min(1.0, (rainfall_24h / 120.0) ** 1.2)
        f_soil = min(1.0, soil_saturation / 0.85)
        
        w_slope, w_rain, w_soil = 0.40, 0.40, 0.20
        lhi_formula = (w_slope * f_slope) + (w_rain * f_rain) + (w_soil * f_soil)
        lhi_formula = float(np.clip(lhi_formula, 0.0, 1.0))
        
        # 2. ML Prediction
        lhi_ml = None
        if self.model is not None:
            try:
                input_df = pd.DataFrame([{
                    'slope_angle': slope_angle,
                    'rainfall_24h': rainfall_24h,
                    'soil_saturation': soil_saturation,
                    'elevation': elevation,
                    'veg_cover': veg_cover
                }])
                prob = self.model.predict_proba(input_df)[0][1]
                lhi_ml = float(round(prob, 4))
            except Exception as e:
                print(f"[LHIEngine] ML inference error: {e}")
                
        if lhi_ml is not None:
            lhi_final = round((0.65 * lhi_ml) + (0.35 * lhi_formula), 4)
            method = "Gradient Boosting ML + Infinite Slope Ensemble"
        else:
            lhi_final = round(lhi_formula, 4)
            lhi_ml = lhi_formula
            method = "Geotechnical Weighted Formula"

        is_danger = (lhi_final >= 0.75)
        
        if lhi_final >= 0.75:
            risk_level = "CRITICAL / DANGER GEOFENCE"
            risk_color = "#ef4444"
        elif lhi_final >= 0.50:
            risk_level = "MODERATE HAZARD"
            risk_color = "#f97316"
        elif lhi_final >= 0.25:
            risk_level = "LOW RISK"
            risk_color = "#eab308"
        else:
            risk_level = "SAFE"
            risk_color = "#22c55e"

        return {
            "lhi": lhi_final,
            "lhi_ml": lhi_ml,
            "lhi_formula": round(lhi_formula, 4),
            "is_danger": is_danger,
            "hazard_threshold": 0.75,
            "risk_level": risk_level,
            "risk_color": risk_color,
            "calculation_method": method,
            "input_metrics": {
                "slope_angle_deg": slope_angle,
                "rainfall_24h_mm": rainfall_24h,
                "soil_saturation_index": soil_saturation,
                "elevation_m": elevation,
                "veg_cover": veg_cover
            }
        }
