from flask import request, jsonify

import config


def body():
    """JSON body as a dict (empty dict if missing/invalid)."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def error(message, status=400):
    return jsonify({"error": message}), status


def clean_text(value, max_len=config.MAX_CONTENT_LENGTH):
    """Return stripped string, or None if empty / wrong type / too long."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > max_len:
        return None
    return value
