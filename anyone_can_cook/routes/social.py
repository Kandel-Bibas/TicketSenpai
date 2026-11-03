"""Follow / unfollow."""
import sqlite3

from flask import Blueprint, jsonify

import auth
import db
from .util import error

bp = Blueprint("social", __name__, url_prefix="/api")


@bp.post("/users/<int:user_id>/follow")
@auth.login_required
def follow(user_id):
    me = auth.current_user()
    if me["id"] == user_id:
        return error("You can't follow yourself")
    if not db.query("SELECT 1 FROM Users WHERE user_ID = ?", (user_id,), one=True):
        return error("User not found", 404)
    try:
        db.execute("INSERT INTO Follows (followed_user_ID, follows_user_ID) VALUES (?, ?)",
                   (user_id, me["id"]))
    except sqlite3.IntegrityError:
        pass  # already following
    return jsonify({"ok": True, "is_following": True})


@bp.delete("/users/<int:user_id>/follow")
@auth.login_required
def unfollow(user_id):
    me = auth.current_user()
    db.execute("DELETE FROM Follows WHERE followed_user_ID = ? AND follows_user_ID = ?",
               (user_id, me["id"]))
    return jsonify({"ok": True, "is_following": False})
