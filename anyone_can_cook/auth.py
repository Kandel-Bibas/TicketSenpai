"""Authentication and authorization helpers, all in one place.

Routes use only these functions to answer "who is calling?" and
"may they touch this?", so changing auth behaviour means editing this file.
"""
from functools import wraps

from flask import session, jsonify, request
from werkzeug.security import generate_password_hash, check_password_hash

import db


# --- passwords -------------------------------------------------------------
def hash_password(password):
    return generate_password_hash(password)


def verify_password(stored_hash, password):
    return check_password_hash(stored_hash, password)


# --- sessions --------------------------------------------------------------
def login_user(user_id):
    session.clear()
    session["user_id"] = user_id


def logout_user():
    session.clear()


def current_user():
    """The logged-in user as a dict (no password), or None.
    """
    header_uid = request.headers.get("X-User-Id")
    if header_uid is not None:
        return db.query(
            "SELECT user_ID AS id, username, email, acc_date_created AS created "
            "FROM Users WHERE user_ID = ?", (header_uid,), one=True)

    uid = session.get("user_id")
    if uid is None:
        return None
    return db.query(
        "SELECT user_ID AS id, username, email, acc_date_created AS created "
        "FROM Users WHERE user_ID = ?", (uid,), one=True)


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return jsonify({"error": "Please log in first"}), 401
        return view(*args, **kwargs)
    return wrapper


# --- authorization ---------------------------------------------------------
def can_modify(owner_id):
    """True if the current user owns the resource. Used by every edit/delete."""
    user = current_user()
    return user is not None and user["id"] == owner_id
