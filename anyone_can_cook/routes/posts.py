"""Posts: list, create, edit, delete."""
from flask import Blueprint, jsonify, request

import auth
import config
import db
from .util import body, error, clean_text

bp = Blueprint("posts", __name__, url_prefix="/api")

POST_SELECT = """
    SELECT p.post_ID AS id, p.user_ID AS user_id, u.username, p.content,
           p.media_type, p.timestamp,
           (SELECT COUNT(*) FROM Comments c WHERE c.post_ID = p.post_ID) AS comment_count
    FROM Posts p JOIN Users u ON u.user_ID = p.user_ID
"""


@bp.get("/posts")
def list_posts():
    user_id = request.args.get("user_id", type=int)
    if user_id is not None:
        rows = db.query(POST_SELECT + " WHERE p.user_ID = ? "
                        "ORDER BY p.timestamp DESC, p.post_ID DESC", (user_id,))
    else:
        rows = db.query(POST_SELECT + " ORDER BY p.timestamp DESC, p.post_ID DESC")
    return jsonify({"posts": rows})


@bp.post("/posts")
@auth.login_required
def create_post():
    data = body()
    content = clean_text(data.get("content"))
    media_type = data.get("media_type", "text")
    if not content:
        return error("Post content is required")
    if media_type not in config.MEDIA_TYPES:
        return error("media_type must be one of: " + ", ".join(config.MEDIA_TYPES))

    user = auth.current_user()
    cur = db.execute(
        "INSERT INTO Posts (user_ID, content, media_type) VALUES (?, ?, ?)",
        (user["id"], content, media_type))
    post = db.query(POST_SELECT + " WHERE p.post_ID = ?", (cur.lastrowid,), one=True)
    return jsonify({"post": post}), 201


@bp.put("/posts/<int:post_id>")
@auth.login_required
def update_post(post_id):
    post = db.query("SELECT user_ID FROM Posts WHERE post_ID = ?", (post_id,), one=True)
    if not post:
        return error("Post not found", 404)

    content = clean_text(body().get("content"))
    if not content:
        return error("Post content is required")
    db.execute("UPDATE Posts SET content = ? WHERE post_ID = ?", (content, post_id))
    return jsonify({"post": db.query(POST_SELECT + " WHERE p.post_ID = ?", (post_id,), one=True)})


@bp.delete("/posts/<int:post_id>")
@auth.login_required
def delete_post(post_id):
    post = db.query("SELECT user_ID FROM Posts WHERE post_ID = ?", (post_id,), one=True)
    if not post:
        return error("Post not found", 404)

    db.execute("DELETE FROM Comments WHERE post_ID = ?", (post_id,))
    db.execute("DELETE FROM Posts WHERE post_ID = ?", (post_id,))
    return jsonify({"ok": True})
