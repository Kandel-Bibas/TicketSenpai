"""Comments on posts."""
from flask import Blueprint, jsonify

import auth
import db
from .util import body, error, clean_text

bp = Blueprint("comments", __name__, url_prefix="/api")

COMMENT_SELECT = """
    SELECT c.comment_ID AS id, c.post_ID AS post_id, c.user_ID AS user_id,
           u.username, c.com_content AS content, c.timestamp
    FROM Comments c JOIN Users u ON u.user_ID = c.user_ID
"""


@bp.get("/posts/<int:post_id>/comments")
def list_comments(post_id):
    rows = db.query(COMMENT_SELECT + " WHERE c.post_ID = ? "
                    "ORDER BY c.timestamp ASC, c.comment_ID ASC", (post_id,))
    return jsonify({"comments": rows})


@bp.post("/posts/<int:post_id>/comments")
@auth.login_required
def create_comment(post_id):
    if not db.query("SELECT 1 FROM Posts WHERE post_ID = ?", (post_id,), one=True):
        return error("Post not found", 404)
    content = clean_text(body().get("content"), 1000)
    if not content:
        return error("Comment can't be empty")

    user = auth.current_user()
    cur = db.execute(
        "INSERT INTO Comments (user_ID, post_ID, com_content) VALUES (?, ?, ?)",
        (user["id"], post_id, content))
    comment = db.query(COMMENT_SELECT + " WHERE c.comment_ID = ?", (cur.lastrowid,), one=True)
    return jsonify({"comment": comment}), 201


@bp.delete("/comments/<int:comment_id>")
@auth.login_required
def delete_comment(comment_id):
    row = db.query("SELECT user_ID FROM Comments WHERE comment_ID = ?", (comment_id,), one=True)
    if not row:
        return error("Comment not found", 404)
    db.execute("DELETE FROM Comments WHERE comment_ID = ?", (comment_id,))
    return jsonify({"ok": True})
