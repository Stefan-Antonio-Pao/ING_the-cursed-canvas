"""Sentiment analysis for The Cursed Canvas — i18n-aware.

- English: NLTK VADER
- Chinese: SnowNLP (with keyword fallback)
"""

from functools import lru_cache
import logging

logger = logging.getLogger(__name__)


def _current_lang():
    try:
        from flask import g
        return getattr(g, "lang", "en")
    except (ImportError, RuntimeError):
        return "en"


@lru_cache(maxsize=1)
def _vader_analyzer():
    from nltk.sentiment import SentimentIntensityAnalyzer
    return SentimentIntensityAnalyzer()


def _vader_analyze(text):
    try:
        score = _vader_analyzer().polarity_scores(text)["compound"]
    except Exception:
        return "neutral"
    if score >= 0.2:
        return "positive"
    if score <= -0.2:
        return "negative"
    return "neutral"


_SNOWLP_AVAILABLE = False
try:
    from snownlp import SnowNLP
    _SNOWLP_AVAILABLE = True
except ImportError:
    logger.info("SnowNLP not installed. Chinese sentiment will use keyword fallback.")


def _snownlp_analyze(text):
    if not _SNOWLP_AVAILABLE:
        return _chinese_keyword_analyze(text)
    try:
        score = SnowNLP(text).sentiments
    except Exception:
        return "neutral"
    if score >= 0.65:
        return "positive"
    if score <= 0.35:
        return "negative"
    return "neutral"


_CN_POSITIVE = {"好", "太好了", "棒", "感谢", "谢谢", "开心", "喜欢", "美丽",
                "漂亮", "温暖", "光明", "希望", "成功", "完成", "恢复"}
_CN_NEGATIVE = {"糟", "糟糕", "害怕", "恐惧", "黑暗", "悲伤", "愤怒", "绝望",
                "失败", "诅咒", "偷", "丢失", "不安", "困惑", "迷茫"}


def _chinese_keyword_analyze(text):
    pos = sum(1 for w in _CN_POSITIVE if w in text)
    neg = sum(1 for w in _CN_NEGATIVE if w in text)
    if pos > neg:
        return "positive"
    if neg > pos:
        return "negative"
    return "neutral"


def analyze_sentiment(text):
    if not text:
        return "neutral"
    lang = _current_lang()
    if lang == "zh":
        return _snownlp_analyze(text)
    return _vader_analyze(text)
