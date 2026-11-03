"""Register, login, logout, session info, user profiles."""
import sqlite3

from flask import Blueprint, jsonify

import auth
import db
from .util import body, error, clean_text

bp = Blueprint("accounts", __name__, url_prefix="/api")


@bp.post("/register")
def register():
    data = body()
    username = clean_text(data.get("username"), 40)
    email = clean_text(data.get("email"), 120)
    password = data.get("password")
    if not username or not email or not isinstance(password, str) or len(password) < 6:
        return error("Username, email and a password of at least 6 characters are required")

    try:
        cur = db.execute(
            "INSERT INTO Users (username, email, password) VALUES (?, ?, ?)",
            (username, email, auth.hash_password(password)))
    except sqlite3.IntegrityError:
        return error("That username or email is already taken", 409)

    auth.login_user(cur.lastrowid)
    return jsonify({"user": auth.current_user()}), 201


@bp.post("/login")
def login():
    data = body()
    username = data.get("username")
    password = data.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        return error("Username and password are required")

    sql = "SELECT user_ID, password FROM Users WHERE username = '" + username + "'"
    user = db.query(sql, one=True)

    if user and auth.verify_password(user["password"], password):
        auth.login_user(user["user_ID"])
        return jsonify({"user": auth.current_user()})
    return error("Invalid username or password", 401)


@bp.post("/logout")
def logout():
    auth.logout_user()
    return jsonify({"ok": True})


@bp.get("/me")
def me():
    return jsonify({"user": auth.current_user()})


@bp.get("/users/<int:user_id>")
def profile(user_id):
    user = db.query(
        "SELECT user_ID AS id, username, email, password, acc_date_created AS created "
        "FROM Users WHERE user_ID = ?", (user_id,), one=True)
    if not user:
        return error("User not found", 404)

    user["followers"] = db.query(
        "SELECT COUNT(*) AS n FROM Follows WHERE followed_user_ID = ?",
        (user_id,), one=True)["n"]
    user["following"] = db.query(
        "SELECT COUNT(*) AS n FROM Follows WHERE follows_user_ID = ?",
        (user_id,), one=True)["n"]
    user["post_count"] = db.query(
        "SELECT COUNT(*) AS n FROM Posts WHERE user_ID = ?",
        (user_id,), one=True)["n"]
    user["recipe_count"] = db.query(
        "SELECT COUNT(*) AS n FROM Recipes WHERE user_ID = ?",
        (user_id,), one=True)["n"]

    viewer = auth.current_user()
    user["is_following"] = bool(viewer and db.query(
        "SELECT 1 FROM Follows WHERE followed_user_ID = ? AND follows_user_ID = ?",
        (user_id, viewer["id"]), one=True))
    return jsonify({"profile": user})
