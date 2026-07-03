"""Local speech-to-text support for voice input.

The desktop app records short WAV clips in the renderer and sends them here.
Recognition is intentionally backend-owned so it does not depend on browser
SpeechRecognition services.
"""

import io
import importlib
import logging
import os
import sys
import threading
import wave

logger = logging.getLogger(__name__)


def _float_env(name, default):
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


DEFAULT_STT_MODEL = "openai/whisper-tiny"
TARGET_SAMPLE_RATE = 16000
ANALYSIS_FRAME_SECONDS = _float_env("VOICE_ANALYSIS_FRAME_SECONDS", 0.05)
MIN_AUDIO_SECONDS = _float_env("VOICE_MIN_AUDIO_SECONDS", 0.25)
MIN_VOICE_RMS = _float_env("VOICE_MIN_RMS", 0.0035)
MIN_VOICE_PEAK = _float_env("VOICE_MIN_PEAK", 0.018)
MIN_FRAME_RMS = _float_env("VOICE_FRAME_RMS", 0.006)
MIN_FRAME_PEAK = _float_env("VOICE_FRAME_PEAK", 0.025)
MIN_VOICED_SECONDS = _float_env("VOICE_MIN_VOICED_SECONDS", 0.15)
MIN_SPEECH_DYNAMIC_RATIO = _float_env("VOICE_MIN_SPEECH_DYNAMIC_RATIO", 1.7)
MIN_SPEECH_PEAK_RMS_RATIO = _float_env("VOICE_MIN_PEAK_RMS_RATIO", 2.6)
MAX_FLAT_VOICED_RATIO = _float_env("VOICE_MAX_FLAT_VOICED_RATIO", 0.92)

_ASR_PIPELINE = None
_ASR_MODEL_NAME = None
_ASR_LOCK = threading.Lock()


def _desktop_mode():
    return os.getenv("CURSED_CANVAS_DESKTOP") == "1" or bool(getattr(sys, "frozen", False))


def _voice_model_name():
    configured = os.getenv("VOICE_STT_MODEL")
    if configured:
        return configured
    bundled = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models", "whisper-tiny"))
    if os.path.isdir(bundled):
        return bundled
    return DEFAULT_STT_MODEL


def _local_files_only():
    configured = os.getenv("VOICE_STT_LOCAL_FILES_ONLY")
    if configured is not None:
        return configured.strip().lower() in {"1", "true", "yes", "on"}
    return _desktop_mode()


def _asr_loaded():
    return _ASR_PIPELINE is not None


def check_voice_runtime():
    """Probe local STT dependencies without loading the model."""
    missing = []
    failures = []
    for package in ("numpy", "torch", "transformers"):
        try:
            importlib.import_module(package)
        except Exception as exc:
            logger.info("Voice runtime dependency check failed for %s: %s", package, exc)
            missing.append(package)
            detail = str(exc).strip()
            if len(detail) > 180:
                detail = detail[:177].rstrip() + "..."
            failures.append({
                "package": package,
                "error_type": exc.__class__.__name__,
                "error": detail,
            })

    model_name = _voice_model_name()
    local_files_only = _local_files_only()
    model_available = True
    if local_files_only and not os.path.exists(model_name):
        model_available = False
        missing.append(f"model:{model_name}")
        failures.append({
            "package": "model",
            "error_type": "FileNotFoundError",
            "error": f"Local voice model not found: {model_name}",
        })

    ok = not missing and model_available
    error = None
    error_type = None
    if missing:
        details = []
        for failure in failures:
            package = failure["package"]
            kind = failure["error_type"]
            message = failure["error"]
            details.append(f"{package} ({kind}: {message})" if message else f"{package} ({kind})")
        error = (
            "Local voice runtime is optional and unavailable: "
            + "; ".join(details)
            + ". On Windows this can be caused by PyTorch or Microsoft Visual C++ runtime DLL issues."
        )
        error_type = ", ".join(sorted({failure["error_type"] for failure in failures}))

    return {
        "ok": ok,
        "voice_runtime_checked": True,
        "voice_runtime_ok": ok,
        "voice_runtime_error": error,
        "voice_runtime_error_type": error_type,
        "voice_runtime_recovery_hint": (
            None if ok else
            "Use manual typing or online correction, then repair the official PyTorch and Microsoft Visual C++ runtime setup."
        ),
        "voice_model": model_name,
        "voice_local_files_only": local_files_only,
        "voice_stt_ready": _asr_loaded(),
    }


def _decode_wav_bytes(wav_bytes):
    import numpy as np

    if not wav_bytes:
        raise ValueError("Empty voice audio")

    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            frame_count = wav_file.getnframes()
            pcm = wav_file.readframes(frame_count)
    except wave.Error as exc:
        raise ValueError("Invalid voice audio") from exc

    if channels < 1 or sample_rate <= 0 or frame_count <= 0:
        raise ValueError("Invalid voice audio")

    if sample_width == 1:
        samples = (np.frombuffer(pcm, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 2:
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 4:
        samples = np.frombuffer(pcm, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported voice audio sample width: {sample_width}")

    if channels > 1:
        usable_length = samples.size - (samples.size % channels)
        samples = samples[:usable_length].reshape((-1, channels)).mean(axis=1)

    samples = np.clip(samples, -1.0, 1.0).astype(np.float32, copy=False)
    if sample_rate != TARGET_SAMPLE_RATE:
        target_length = max(1, int(round(samples.size * TARGET_SAMPLE_RATE / sample_rate)))
        source_positions = np.arange(samples.size, dtype=np.float32)
        target_positions = np.linspace(0, max(0, samples.size - 1), target_length, dtype=np.float32)
        samples = np.interp(target_positions, source_positions, samples).astype(np.float32)
        sample_rate = TARGET_SAMPLE_RATE

    duration_seconds = float(samples.size) / float(sample_rate)
    if duration_seconds <= 0:
        raise ValueError("Empty voice audio")

    return samples, {
        "channels": channels,
        "sample_rate": sample_rate,
        "duration_seconds": round(duration_seconds, 3),
    }


def _voice_activity(samples, sample_rate):
    import numpy as np

    duration_seconds = float(samples.size) / float(max(1, sample_rate))
    if samples.size == 0 or duration_seconds < MIN_AUDIO_SECONDS:
        return {
            "has_speech": False,
            "reason": "too_short",
            "duration_seconds": round(duration_seconds, 3),
            "rms": 0.0,
            "peak": 0.0,
            "voiced_seconds": 0.0,
        }

    centered = samples.astype(np.float32, copy=False) - float(np.mean(samples))
    abs_samples = np.abs(centered)
    rms = float(np.sqrt(np.mean(np.square(centered))))
    peak = float(np.max(abs_samples)) if samples.size else 0.0
    frame_size = max(1, int(sample_rate * ANALYSIS_FRAME_SECONDS))
    frame_rms_values = []
    frame_peak_values = []
    for frame_start in range(0, samples.size, frame_size):
        frame = centered[frame_start:frame_start + frame_size]
        if frame.size == 0:
            continue
        frame_rms_values.append(float(np.sqrt(np.mean(np.square(frame)))))
        frame_peak_values.append(float(np.max(np.abs(frame))))

    if not frame_rms_values:
        return {
            "has_speech": False,
            "reason": "quiet",
            "duration_seconds": round(duration_seconds, 3),
            "rms": round(rms, 6),
            "peak": round(peak, 6),
            "voiced_seconds": 0.0,
        }

    frame_rms = np.asarray(frame_rms_values, dtype=np.float32)
    frame_peak = np.asarray(frame_peak_values, dtype=np.float32)
    noise_floor = float(np.percentile(frame_rms, 20))
    rms_p90 = float(np.percentile(frame_rms, 90))
    dynamic_ratio = rms_p90 / max(noise_floor, 1e-6)
    peak_rms_ratio = peak / max(rms, 1e-6)
    adaptive_frame_rms = max(MIN_FRAME_RMS, noise_floor * MIN_SPEECH_DYNAMIC_RATIO)
    voiced_mask = (frame_rms >= adaptive_frame_rms) | (frame_peak >= MIN_FRAME_PEAK)
    voiced_frames = int(np.count_nonzero(voiced_mask))

    voiced_seconds = float(voiced_frames * frame_size) / float(max(1, sample_rate))
    voiced_ratio = voiced_frames / max(1, frame_rms.size)
    dynamic_ok = (
        dynamic_ratio >= MIN_SPEECH_DYNAMIC_RATIO
        or peak_rms_ratio >= MIN_SPEECH_PEAK_RMS_RATIO
    )
    has_speech = (
        rms >= MIN_VOICE_RMS
        and peak >= MIN_VOICE_PEAK
        and voiced_seconds >= MIN_VOICED_SECONDS
        and dynamic_ok
    )
    if has_speech and voiced_ratio >= MAX_FLAT_VOICED_RATIO and dynamic_ratio < MIN_SPEECH_DYNAMIC_RATIO:
        has_speech = False
    return {
        "has_speech": bool(has_speech),
        "reason": "speech" if has_speech else ("noise" if rms >= MIN_VOICE_RMS or peak >= MIN_VOICE_PEAK else "quiet"),
        "duration_seconds": round(duration_seconds, 3),
        "rms": round(rms, 6),
        "peak": round(peak, 6),
        "voiced_seconds": round(voiced_seconds, 3),
        "voiced_ratio": round(voiced_ratio, 3),
        "dynamic_ratio": round(dynamic_ratio, 3),
        "peak_rms_ratio": round(peak_rms_ratio, 3),
        "noise_floor": round(noise_floor, 6),
    }


def _denoise_samples(samples, sample_rate):
    import numpy as np

    if samples.size == 0:
        return samples

    cleaned = samples.astype(np.float32, copy=True)
    cleaned -= float(np.mean(cleaned))
    frame_size = max(1, int(sample_rate * ANALYSIS_FRAME_SECONDS))
    frame_rms_values = []
    for frame_start in range(0, cleaned.size, frame_size):
        frame = cleaned[frame_start:frame_start + frame_size]
        if frame.size:
            frame_rms_values.append(float(np.sqrt(np.mean(np.square(frame)))))
    if not frame_rms_values:
        return cleaned

    noise_floor = float(np.percentile(np.asarray(frame_rms_values, dtype=np.float32), 20))
    gate = max(noise_floor * 0.85, MIN_VOICE_RMS * 0.45)
    quiet_mask = np.abs(cleaned) < gate
    cleaned[quiet_mask] *= 0.25
    return np.clip(cleaned, -1.0, 1.0).astype(np.float32, copy=False)


def _pick_device(torch):
    if torch.cuda.is_available():
        return 0
    return -1


def _get_asr_pipeline():
    global _ASR_MODEL_NAME, _ASR_PIPELINE

    model_name = _voice_model_name()
    with _ASR_LOCK:
        if _ASR_PIPELINE is not None and _ASR_MODEL_NAME == model_name:
            return _ASR_PIPELINE, model_name

        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

        local_files_only = _local_files_only()
        load_kwargs = {"local_files_only": local_files_only}
        logger.info("Loading voice STT model: %s", model_name)
        processor = AutoProcessor.from_pretrained(model_name, **load_kwargs)
        model = AutoModelForSpeechSeq2Seq.from_pretrained(model_name, **load_kwargs)
        _ASR_PIPELINE = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            device=_pick_device(torch),
        )
        _ASR_MODEL_NAME = model_name
        return _ASR_PIPELINE, model_name


def _normalize_lang(lang):
    value = (lang or "").lower()
    if value.startswith("zh") or value.startswith("cn"):
        return "zh"
    if value.startswith("en"):
        return "en"
    return None


def warmup_voice_model():
    _asr, model_name = _get_asr_pipeline()
    return {
        "source": "local-whisper",
        "model": model_name,
        "voice_runtime_checked": True,
        "voice_runtime_ok": True,
        "voice_runtime_error": None,
        "voice_stt_ready": True,
    }


def transcribe_wav_bytes(wav_bytes, lang=None):
    samples, metadata = _decode_wav_bytes(wav_bytes)
    samples = _denoise_samples(samples, metadata["sample_rate"])
    activity = _voice_activity(samples, metadata["sample_rate"])
    metadata["activity"] = activity
    if not activity["has_speech"]:
        raise ValueError("No speech was captured")

    asr, model_name = _get_asr_pipeline()

    generate_kwargs = {"task": "transcribe"}
    normalized_lang = _normalize_lang(lang)
    if normalized_lang:
        generate_kwargs["language"] = normalized_lang

    result = asr(
        {"raw": samples, "sampling_rate": metadata["sample_rate"]},
        generate_kwargs=generate_kwargs,
    )
    text = ""
    if isinstance(result, dict):
        text = result.get("text") or ""
    elif isinstance(result, str):
        text = result

    return text.strip(), {
        **metadata,
        "source": "local-whisper",
        "model": model_name,
        "language": normalized_lang or "auto",
    }
