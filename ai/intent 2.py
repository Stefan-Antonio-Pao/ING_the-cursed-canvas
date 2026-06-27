"""Intent classifier for The Cursed Canvas.

TF-IDF + Logistic Regression trained on data/intents.json.
Serves as the Tier-3 (last-resort) routing layer when the DM tier
and the keyword fallback both fail to produce an intent.

Usage:
    python -m ai.intent          # train + save models/classifier.pkl
    IntentClassifier().load()    # at app startup
    clf.predict("look around")   # -> "explore"
"""

import json
import logging
import os
import pickle

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

logger = logging.getLogger(__name__)

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
_INTENTS_PATH = os.path.join(_ROOT, "data", "intents.json")
_MODEL_DIR = os.path.join(_ROOT, "models")
_CLF_PATH = os.path.join(_MODEL_DIR, "classifier.pkl")
_VEC_PATH = os.path.join(_MODEL_DIR, "vectorizer.pkl")


class IntentClassifier:
    """Thin wrapper around a TF-IDF + LogisticRegression pipeline."""

    def __init__(self):
        self.vectorizer = None
        self.classifier = None

    def train(self, intents_path=_INTENTS_PATH):
        with open(intents_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        texts = [item["text"] for item in data if isinstance(item, dict)]
        labels = [item["intent"] for item in data if isinstance(item, dict)]
        if not texts:
            raise ValueError(f"No training examples in {intents_path}")

        self.vectorizer = TfidfVectorizer(
            ngram_range=(1, 2),
            sublinear_tf=True,
            strip_accents="unicode",
        )
        self.classifier = LogisticRegression(
            max_iter=1000,
            C=1.0,
            class_weight="balanced",
        )

        X = self.vectorizer.fit_transform(texts)
        self.classifier.fit(X, labels)
        train_acc = self.classifier.score(X, labels)
        logger.info(f"Intent classifier trained: {len(texts)} examples, "
                    f"{len(self.classifier.classes_)} classes, "
                    f"train_acc={train_acc:.3f}")
        return train_acc

    def save(self, clf_path=_CLF_PATH, vec_path=_VEC_PATH):
        os.makedirs(os.path.dirname(clf_path), exist_ok=True)
        with open(clf_path, "wb") as f:
            pickle.dump(self.classifier, f)
        with open(vec_path, "wb") as f:
            pickle.dump(self.vectorizer, f)
        logger.info(f"Saved classifier -> {clf_path}")

    def load(self, clf_path=_CLF_PATH, vec_path=_VEC_PATH):
        if not os.path.exists(clf_path) or not os.path.exists(vec_path):
            raise FileNotFoundError(
                f"Classifier artifacts not found: {clf_path}, {vec_path}"
            )
        with open(clf_path, "rb") as f:
            self.classifier = pickle.load(f)
        with open(vec_path, "rb") as f:
            self.vectorizer = pickle.load(f)

    def predict(self, text):
        if self.classifier is None or self.vectorizer is None:
            return "explore"
        try:
            X = self.vectorizer.transform([text])
            return str(self.classifier.predict(X)[0])
        except Exception as e:
            logger.warning(f"Intent prediction failed: {e}")
            return "explore"


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    clf = IntentClassifier()
    clf.train()
    clf.save()
