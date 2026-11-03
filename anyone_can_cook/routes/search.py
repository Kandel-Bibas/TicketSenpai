"""Search across posts, recipes and people."""
from flask import Blueprint, jsonify, request

import db
from .posts import POST_SELECT
from .recipes import RECIPE_SELECT

bp = Blueprint("search", __name__, url_prefix="/api")


@bp.get("/search")
def search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"query": q, "posts": [], "recipes": [], "users": []})

    like = f"%{q}%"
    posts = db.query(POST_SELECT + " WHERE p.content LIKE ? "
                     "ORDER BY p.timestamp DESC", (like,))
    recipes = db.query(RECIPE_SELECT + " WHERE r.content LIKE ? "
                       "ORDER BY r.recipe_ID DESC", (like,))
    users = db.query("SELECT user_ID AS id, username FROM Users "
                     "WHERE username LIKE ? ORDER BY username", (like,))
    return jsonify({"query": q, "posts": posts, "recipes": recipes, "users": users})
