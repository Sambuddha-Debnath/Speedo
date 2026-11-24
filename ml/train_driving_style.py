"""Train an optional local SPEEDO driving-style classifier.

Input CSV columns:
  speed_kmh, acceleration_mps2, heading_delta_deg, gps_accuracy_m,
  speed_limit_kmh, label

Labels must be manually reviewed and must not be generated solely by the
same heuristic rules that this model is intended to validate. The script
refuses to train without at least two classes and a minimum sample count.
"""
from pathlib import Path
import argparse
import json
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score
from skl2onnx import to_onnx
from skl2onnx.common.data_types import FloatTensorType

FEATURES = ["speed_kmh", "acceleration_mps2", "heading_delta_deg", "gps_accuracy_m", "speed_limit_kmh"]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", nargs="?", default="driving_training.csv")
    parser.add_argument("--out", default="../models/driving-style-v1.onnx")
    args = parser.parse_args()
    data = pd.read_csv(args.csv)
    missing = [c for c in FEATURES + ["label"] if c not in data.columns]
    if missing: raise SystemExit(f"Missing columns: {missing}")
    data = data.dropna(subset=["label"])
    if len(data) < 200: raise SystemExit("Need at least 200 manually labelled samples before training.")
    if data.label.nunique() < 2: raise SystemExit("Need at least two distinct labels.")
    X = data[FEATURES].apply(pd.to_numeric, errors="coerce")
    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(data.label.astype(str))
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=.25, random_state=42, stratify=y)
    prep = ColumnTransformer([("numeric", Pipeline([("imputer", SimpleImputer(strategy="median")), ("scale", StandardScaler())]), FEATURES)])
    model = Pipeline([("prep", prep), ("classifier", RandomForestClassifier(n_estimators=160, max_depth=10, class_weight="balanced", random_state=42))])
    model.fit(X_train, y_train)
    pred = model.predict(X_test)
    print("Holdout accuracy:", round(accuracy_score(y_test, pred), 4))
    print(classification_report(y_test, pred))
    output = Path(args.out); output.parent.mkdir(parents=True, exist_ok=True)
    initial = [("input", FloatTensorType([None, len(FEATURES)]))]
    onnx_model = to_onnx(model, initial_types=initial, target_opset=17)
    output.write_bytes(onnx_model.SerializeToString())
    output.with_suffix(".labels.json").write_text(json.dumps({int(i): str(label) for i, label in enumerate(label_encoder.classes_)}, indent=2))
    print("Exported:", output.resolve())
    print("Label map:", output.with_suffix(".labels.json").resolve())
    print("IMPORTANT: review class balance, per-class precision/recall and false-positive rates before shipping.")

if __name__ == "__main__": main()
