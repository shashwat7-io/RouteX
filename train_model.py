import os
import json
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, HistGradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score, roc_auc_score

def generate_landslide_dataset(n_samples=8000, random_state=42):
    """
    Generates synthetic dataset calibrated on geotechnical & meteorological landslide precursors.
    Features:
      - slope_angle (degrees): 0 to 60
      - rainfall_24h (mm): 0 to 250
      - soil_saturation (0 to 1 ratio): 0.1 to 1.0
      - elevation (m): 100 to 4000
      - veg_cover (0 to 1 NDVI ratio): 0.0 to 1.0
    Target:
      - landslide_hazard (1 = High Risk / Landslide Triggered, 0 = Safe / Low Risk)
    """
    np.random.seed(random_state)
    
    slope_angle = np.random.uniform(5, 55, n_samples)
    rainfall_24h = np.random.uniform(0, 220, n_samples)
    soil_saturation = np.random.uniform(0.15, 0.98, n_samples)
    elevation = np.random.uniform(200, 3500, n_samples)
    veg_cover = np.random.uniform(0.1, 0.9, n_samples)
    
    # Calculate physical slope failure probability score based on Infinite Slope Model heuristics
    # Factor of Safety proxy: FS decreases with higher slope, higher rainfall, higher soil saturation, lower vegetation
    fs_proxy = (
        np.tan(np.radians(35)) / np.maximum(0.1, np.tan(np.radians(slope_angle)))
        - (soil_saturation * 0.45)
        - ((rainfall_24h / 150.0) ** 1.3 * 0.4)
        + (veg_cover * 0.25)
    )
    
    # Add geotechnical noise
    noise = np.random.normal(0, 0.12, n_samples)
    hazard_score = 1.0 - (fs_proxy + noise)
    hazard_prob = 1 / (1 + np.exp(-hazard_score * 3.5)) # Sigmoid transformation
    
    target = (hazard_prob > 0.65).astype(int)
    
    df = pd.DataFrame({
        'slope_angle': np.round(slope_angle, 2),
        'rainfall_24h': np.round(rainfall_24h, 2),
        'soil_saturation': np.round(soil_saturation, 3),
        'elevation': np.round(elevation, 1),
        'veg_cover': np.round(veg_cover, 3),
        'landslide_hazard': target
    })
    
    return df

def train_and_save_model():
    print("Generating synthetic geotechnical landslide dataset...")
    df = generate_landslide_dataset(n_samples=10000)
    
    feature_cols = ['slope_angle', 'rainfall_24h', 'soil_saturation', 'elevation', 'veg_cover']
    X = df[feature_cols]
    y = df['landslide_hazard']
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    # Train Gradient Boosting Classifier (Native ML Ensemble)
    print("Training Gradient Boosting ML Classifier...")
    model = GradientBoostingClassifier(
        n_estimators=150,
        max_depth=5,
        learning_rate=0.08,
        subsample=0.8,
        random_state=42
    )
    model.fit(X_train, y_train)
    
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]
    
    print("\n--- Model Evaluation ---")
    print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")
    print(f"ROC AUC: {roc_auc_score(y_test, y_prob):.4f}")
    print("\nClassification Report:\n", classification_report(y_test, y_pred))
    
    output_dir = "/Users/shashwatmishra/.gemini/antigravity/scratch/landslide_risk_engine/backend"
    os.makedirs(output_dir, exist_ok=True)
    model_path = os.path.join(output_dir, "landslide_model.pkl")
    joblib.dump(model, model_path)
    print(f"Landslide ML model successfully saved to {model_path}")

if __name__ == "__main__":
    train_and_save_model()
