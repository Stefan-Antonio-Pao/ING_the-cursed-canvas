"""Intent classifier: TF-IDF + Logistic Regression. Full ML pipeline."""

import json, os, pickle, logging, numpy as np
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                              f1_score, confusion_matrix, classification_report)

logger = logging.getLogger(__name__)
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
VECTORIZER_PATH = MODEL_DIR / "vectorizer.pkl"
CLASSIFIER_PATH = MODEL_DIR / "classifier.pkl"

class IntentClassifier:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(max_features=3000, ngram_range=(1, 3),
                                           lowercase=True, sublinear_tf=True,
                                           min_df=1, max_df=0.95)
        self.classifier = LogisticRegression(max_iter=1000, C=10.0, solver="lbfgs")
        self._trained = False

    def load_data(self, path=None):
        if path is None: path = DATA_DIR / "intents.json"
        with open(path, "r", encoding="utf-8") as f: data = json.load(f)
        texts = [item["text"] for item in data]
        labels = [item["intent"] for item in data]
        logger.info(f"Loaded {len(data)} examples across {len(set(labels))} intents.")
        return texts, labels

    def train(self, texts=None, labels=None, test_size=0.2, random_state=42):
        if texts is None or labels is None: texts, labels = self.load_data()
        X_train, X_test, y_train, y_test = train_test_split(
            texts, labels, test_size=test_size, random_state=random_state, stratify=labels)
        X_train_vec = self.vectorizer.fit_transform(X_train)
        X_test_vec = self.vectorizer.transform(X_test)
        self.classifier.fit(X_train_vec, y_train)
        y_pred = self.classifier.predict(X_test_vec)
        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, average="weighted", zero_division=0)
        rec = recall_score(y_test, y_pred, average="weighted", zero_division=0)
        f1 = f1_score(y_test, y_pred, average="weighted", zero_division=0)
        cm = confusion_matrix(y_test, y_pred, labels=self.classifier.classes_)
        self._trained = True
        print("\n" + "=" * 60)
        print("INTENT CLASSIFIER -- EVALUATION REPORT")
        print("=" * 60)
        print(f"Training samples: {len(X_train)}, Test samples: {len(X_test)}")
        print(f"Intents: {list(self.classifier.classes_)}")
        print("-" * 60)
        print(f"Accuracy:  {acc:.4f}  ({acc*100:.1f}%)")
        print(f"Precision: {prec:.4f}")
        print(f"Recall:    {rec:.4f}")
        print(f"F1 Score:  {f1:.4f}")
        print("-" * 60)
        print(classification_report(y_test, y_pred, target_names=self.classifier.classes_, zero_division=0))
        print("Confusion Matrix (rows=true, cols=predicted):")
        print(list(self.classifier.classes_))
        print(cm)
        print("=" * 60)
        if acc >= 0.85: print(f"PASS: Accuracy {acc*100:.1f}% >= 85%")
        else: print(f"WARNING: Accuracy {acc*100:.1f}% < 85%. Add more data or tune.")
        return {"accuracy": acc, "precision": prec, "recall": rec, "f1": f1,
                "confusion_matrix": cm.tolist(), "classes": list(self.classifier.classes_),
                "train_size": len(X_train), "test_size": len(X_test)}

    def predict(self, text):
        if not self._trained: raise RuntimeError("Not trained. Call train() first.")
        return self.classifier.predict(self.vectorizer.transform([text]))[0]

    def save(self):
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        with open(VECTORIZER_PATH, "wb") as f: pickle.dump(self.vectorizer, f)
        with open(CLASSIFIER_PATH, "wb") as f: pickle.dump(self.classifier, f)
        logger.info(f"Saved to {CLASSIFIER_PATH}")

    def load(self):
        if not VECTORIZER_PATH.exists() or not CLASSIFIER_PATH.exists():
            raise FileNotFoundError(f"Models not found at {MODEL_DIR}. Train first.")
        with open(VECTORIZER_PATH, "rb") as f: self.vectorizer = pickle.load(f)
        with open(CLASSIFIER_PATH, "rb") as f: self.classifier = pickle.load(f)
        self._trained = True
        logger.info(f"Loaded from {CLASSIFIER_PATH}")

def train_and_save():
    clf = IntentClassifier()
    metrics = clf.train()
    clf.save()
    return clf, metrics

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    train_and_save()
