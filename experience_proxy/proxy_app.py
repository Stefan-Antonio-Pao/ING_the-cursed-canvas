"""Remote Experience Mode proxy for The Cursed Canvas.

Deploy this service separately. It owns DEEPSEEK_EXPERIENCE_API_KEY, tracks
trial token usage by client_id, and exposes a DeepSeek-compatible chat proxy
for the desktop app.
"""

from __future__ import annotations

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from openai import OpenAI
import json
import os
import secrets
import sqlite3
import tempfile
import time

load_dotenv()

app = Flask(__name__)

DB_PATH = os.getenv("EXPERIENCE_PROXY_DB_PATH", "experience_proxy.sqlite3")
TOKEN_LIMIT = max(0, int(os.getenv("EXPERIENCE_TOKEN_LIMIT", "120000")))
UNLOCK_TTL_SECONDS = max(60, int(os.getenv("EXPERIENCE_UNLOCK_TTL_SECONDS", "21600")))
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
API_KEY = os.getenv("DEEPSEEK_EXPERIENCE_API_KEY", "")
AUTH_TOKEN = os.getenv("EXPERIENCE_PROXY_AUTH_TOKEN", "")
MAX_MESSAGE_CHARS = int(os.getenv("EXPERIENCE_PROXY_MAX_MESSAGE_CHARS", "60000"))


def _db_path():
    global DB_PATH
    parent = os.path.dirname(os.path.abspath(DB_PATH))
    if parent:
        try:
            os.makedirs(parent, exist_ok=True)
        except OSError as exc:
            fallback = os.path.join(tempfile.gettempdir(), os.path.basename(DB_PATH) or "experience_proxy.sqlite3")
            app.logger.warning("Experience proxy DB path %s is unavailable (%s); using %s", DB_PATH, exc, fallback)
            DB_PATH = fallback
    return DB_PATH


def _db():
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS clients (
            client_id TEXT PRIMARY KEY,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            unlocked_until REAL NOT NULL DEFAULT 0,
            updated_at REAL NOT NULL
        )
        """
    )
    return conn


def _require_auth():
    if not AUTH_TOKEN:
        return None
    header = request.headers.get("Authorization", "")
    expected = f"Bearer {AUTH_TOKEN}"
    if not secrets.compare_digest(header, expected):
        return jsonify({"error": "Unauthorized."}), 401
    return None


def _client_id(value):
    value = (value or "").strip()
    if not value or len(value) > 128:
        return ""
    return value


def _get_client(conn, client_id):
    now = time.time()
    row = conn.execute("SELECT * FROM clients WHERE client_id = ?", (client_id,)).fetchone()
    if row:
        return dict(row)
    conn.execute(
        "INSERT INTO clients (client_id, tokens_used, unlocked_until, updated_at) VALUES (?, 0, 0, ?)",
        (client_id, now),
    )
    conn.commit()
    return {"client_id": client_id, "tokens_used": 0, "unlocked_until": 0, "updated_at": now}


def _quota_payload(client):
    unlocked = float(client.get("unlocked_until", 0)) > time.time()
    used = max(0, int(client.get("tokens_used", 0)))
    remaining = TOKEN_LIMIT if unlocked else max(0, TOKEN_LIMIT - used)
    percent = 100 if unlocked else (round((remaining / TOKEN_LIMIT) * 100) if TOKEN_LIMIT else 0)
    return {
        "client_id": client["client_id"],
        "token_limit": TOKEN_LIMIT,
        "tokens_used": used,
        "remaining_tokens": remaining,
        "remaining_percent": max(0, min(100, percent)),
        "unlocked": unlocked,
        "unlocked_until": client.get("unlocked_until", 0),
    }


def _usage_total(response, messages, completion_text):
    usage = getattr(response, "usage", None)
    total = getattr(usage, "total_tokens", None)
    if total is not None:
        return max(0, int(total))
    prompt_chars = sum(len(str(msg.get("content", ""))) for msg in messages)
    return max(1, (prompt_chars + len(completion_text or "") + 3) // 4)


def _trim(text):
    last = max(text.rfind("."), text.rfind("!"), text.rfind("?"))
    if last > 20:
        return text[: last + 1].strip()
    return text


def _validate_messages(messages):
    if not isinstance(messages, list) or not messages:
        return False
    total_chars = 0
    for msg in messages:
        if not isinstance(msg, dict):
            return False
        if msg.get("role") not in ("system", "user", "assistant"):
            return False
        total_chars += len(str(msg.get("content", "")))
    return total_chars <= MAX_MESSAGE_CHARS


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/experience/status", methods=["GET"])
def status():
    auth_error = _require_auth()
    if auth_error:
        return auth_error
    client_id = _client_id(request.args.get("client_id", ""))
    if not client_id:
        return jsonify({"error": "Missing client_id."}), 400
    with _db() as conn:
        client = _get_client(conn, client_id)
    return jsonify(_quota_payload(client))


@app.route("/api/experience/unlock", methods=["POST"])
def unlock():
    auth_error = _require_auth()
    if auth_error:
        return auth_error
    data = request.get_json(force=True)
    client_id = _client_id(data.get("client_id"))
    unlock_key = (data.get("unlock_key") or "").strip()
    expected_key = os.getenv("DEEPSEEK_EXPERIENCE_UNLOCK_KEY", "")
    if not client_id:
        return jsonify({"error": "Missing client_id."}), 400
    if not expected_key:
        return jsonify({"error": "Experience unlock is not configured."}), 400
    if not secrets.compare_digest(unlock_key, expected_key):
        return jsonify({"error": "Unlock key was not accepted."}), 400
    unlocked_until = time.time() + UNLOCK_TTL_SECONDS
    with _db() as conn:
        _get_client(conn, client_id)
        conn.execute(
            "UPDATE clients SET unlocked_until = ?, updated_at = ? WHERE client_id = ?",
            (unlocked_until, time.time(), client_id),
        )
        conn.commit()
        client = _get_client(conn, client_id)
    return jsonify(_quota_payload(client))


@app.route("/api/experience/lock", methods=["POST"])
def lock():
    auth_error = _require_auth()
    if auth_error:
        return auth_error
    data = request.get_json(force=True)
    client_id = _client_id(data.get("client_id"))
    if not client_id:
        return jsonify({"error": "Missing client_id."}), 400
    with _db() as conn:
        _get_client(conn, client_id)
        conn.execute(
            "UPDATE clients SET unlocked_until = 0, updated_at = ? WHERE client_id = ?",
            (time.time(), client_id),
        )
        conn.commit()
        client = _get_client(conn, client_id)
    return jsonify(_quota_payload(client))


@app.route("/api/experience/chat", methods=["POST"])
def chat():
    auth_error = _require_auth()
    if auth_error:
        return auth_error
    if not API_KEY:
        return jsonify({"error": "Experience API key is not configured."}), 503

    data = request.get_json(force=True)
    client_id = _client_id(data.get("client_id"))
    messages = data.get("messages")
    max_tokens = int(data.get("max_tokens", 512))
    model = data.get("model") or MODEL
    trim = bool(data.get("trim", True))
    if not client_id:
        return jsonify({"error": "Missing client_id."}), 400
    if not _validate_messages(messages):
        return jsonify({"error": "Invalid or oversized messages."}), 413

    with _db() as conn:
        client = _get_client(conn, client_id)
        quota = _quota_payload(client)
        if not quota["unlocked"] and quota["remaining_tokens"] <= 0:
            return jsonify({"error": "Experience token quota is exhausted.", **quota}), 402

        openai_client = OpenAI(api_key=API_KEY, base_url="https://api.deepseek.com")
        response = openai_client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=max(1, min(1500, max_tokens)),
            temperature=0.7,
            top_p=0.9,
            timeout=30,
        )
        text = (response.choices[0].message.content or "").strip()
        usage_total = _usage_total(response, messages, text)
        if not quota["unlocked"]:
            conn.execute(
                "UPDATE clients SET tokens_used = MIN(?, tokens_used + ?), updated_at = ? WHERE client_id = ?",
                (TOKEN_LIMIT, usage_total, time.time(), client_id),
            )
            conn.commit()
        client = _get_client(conn, client_id)
        quota = _quota_payload(client)

    return jsonify({
        "text": _trim(text) if trim else text,
        "usage_total_tokens": usage_total,
        **quota,
    })


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
