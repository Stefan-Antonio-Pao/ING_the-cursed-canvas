"""Intent classifier: TF-IDF + Logistic Regression — i18n-aware."""

import json, os, pickle, logging, numpy as np
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                              f1_score, confusion_matrix, classification_report)

from i18n.loader import get_intents

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MODEL_DIR = Path(__file__).resolve().parent.parent / "models"


def _model_paths(lang):
    return (
        MODEL_DIR / f"vectorizer_{lang}.pkl",
        MODEL_DIR / f"classifier_{lang}.pkl",
    )


class IntentClassifier:
    def __init__(self, lang="en"):
        self.lang = lang
        if lang == "zh":
            self.vectorizer = TfidfVectorizer(
                analyzer="char_wb", ngram_range=(1, 4),
                max_features=5000, sublinear_tf=True,
                min_df=1, max_df=0.95,
            )
        else:
            self.vectorizer = TfidfVectorizer(max_features=3000, ngram_range=(1, 3),
                                               lowercase=True, sublinear_tf=True,
                                               min_df=1, max_df=0.95)
        self.classifier = LogisticRegression(max_iter=1000, C=10.0, solver="lbfgs")
        self._trained = False

    def load_data(self, path=None):
        if path is None:
            return self.load_i18n_data()
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        texts = [item["text"] for item in data]
        labels = [item["intent"] for item in data]
        logger.info(f"Loaded {len(data)} examples across {len(set(labels))} intents.")
        return texts, labels

    def load_i18n_data(self):
        data = get_intents(self.lang)
        texts = [item["text"] for item in data]
        labels = [item["intent"] for item in data]
        logger.info(f"Loaded {len(data)} {self.lang} examples across {len(set(labels))} intents.")
        return texts, labels

    def train(self, texts=None, labels=None, test_size=0.2, random_state=42):
        if texts is None or labels is None:
            texts, labels = self.load_i18n_data()
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
        print(f"INTENT CLASSIFIER ({self.lang}) -- EVALUATION REPORT")
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
        if acc >= 0.85:
            print(f"PASS: Accuracy {acc*100:.1f}% >= 85%")
        else:
            print(f"WARNING: Accuracy {acc*100:.1f}% < 85%. Add more data or tune.")
        return {"accuracy": acc, "precision": prec, "recall": rec, "f1": f1,
                "confusion_matrix": cm.tolist(), "classes": list(self.classifier.classes_),
                "train_size": len(X_train), "test_size": len(X_test)}

    def predict(self, text):
        if not self._trained:
            raise RuntimeError("Not trained. Call train() first.")
        return self.classifier.predict(self.vectorizer.transform([text]))[0]

    def save(self):
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        vec_path, clf_path = _model_paths(self.lang)
        with open(vec_path, "wb") as f:
            pickle.dump(self.vectorizer, f)
        with open(clf_path, "wb") as f:
            pickle.dump(self.classifier, f)
        logger.info(f"Saved {self.lang} classifier to {clf_path}")

    def load(self):
        vec_path, clf_path = _model_paths(self.lang)
        if not vec_path.exists() or not clf_path.exists():
            raise FileNotFoundError(
                f"Models not found for '{self.lang}' at {MODEL_DIR}. "
                f"Run 'python -m ai.intent {self.lang}' to train."
            )
        with open(vec_path, "rb") as f:
            self.vectorizer = pickle.load(f)
        with open(clf_path, "rb") as f:
            self.classifier = pickle.load(f)
        self._trained = True
        logger.info(f"Loaded {self.lang} classifier from {clf_path}")


def train_and_save(lang="en"):
    clf = IntentClassifier(lang=lang)
    metrics = clf.train()
    clf.save()
    return clf, metrics


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    lang = sys.argv[1] if len(sys.argv) > 1 else "en"
    train_and_save(lang)
