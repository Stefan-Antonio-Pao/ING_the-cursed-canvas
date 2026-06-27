"""Sentiment analysis for The Cursed Canvas.

Uses NLTK's VADER lexicon to classify player-input mood.
Returns one of: "positive", "negative", "neutral".
"""

from functools import lru_cache

from nltk.sentiment import SentimentIntensityAnalyzer


@lru_cache(maxsize=1)
def _analyzer():
    return SentimentIntensityAnalyzer()


def analyze_sentiment(text):
    """Return a coarse mood label for the given player text."""
    if not text:
        return "neutral"
    try:
        score = _analyzer().polarity_scores(text)["compound"]
    except LookupError:
        return "neutral"
    except Exception:
        return "neutral"
    if score >= 0.2:
        return "positive"
    if score <= -0.2:
        return "negative"
    return "neutral"
