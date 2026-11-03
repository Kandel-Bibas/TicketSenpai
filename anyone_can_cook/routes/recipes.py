"""Recipes: list, create, edit, delete, rate."""
from flask import Blueprint, jsonify, request

import auth
import config
import db
from .util import body, error, clean_text

bp = Blueprint("recipes", __name__, url_prefix="/api")

RECIPE_SELECT = """
    SELECT r.recipe_ID AS id, r.user_ID AS user_id, u.username, r.content,
           r.media_type,
           (SELECT ROUND(AVG(score), 1) FROM Ratings WHERE recipe_ID = r.recipe_ID) AS avg_rating,
           (SELECT COUNT(*) FROM Ratings WHERE recipe_ID = r.recipe_ID) AS rating_count
    FROM Recipes r JOIN Users u ON u.user_ID = r.user_ID
"""


@bp.get("/recipes")
def list_recipes():
    user_id = request.args.get("user_id", type=int)
    if user_id is not None:
        rows = db.query(RECIPE_SELECT + " WHERE r.user_ID = ? ORDER BY r.recipe_ID DESC", (user_id,))
    else:
        rows = db.query(RECIPE_SELECT + " ORDER BY r.recipe_ID DESC")

    viewer = auth.current_user()
    if viewer:
        mine = {r["recipe_ID"]: r["score"] for r in db.query(
            "SELECT recipe_ID, score FROM Ratings WHERE user_ID = ?", (viewer["id"],))}
        for r in rows:
            r["my_rating"] = mine.get(r["id"])
    return jsonify({"recipes": rows})


@bp.post("/recipes")
@auth.login_required
def create_recipe():
    data = body()
    content = clean_text(data.get("content"))
    media_type = data.get("media_type", "text")
    if not content:
        return error("Recipe content is required")
    if media_type not in config.MEDIA_TYPES:
        return error("media_type must be one of: " + ", ".join(config.MEDIA_TYPES))

    user = auth.current_user()
    cur = db.execute(
        "INSERT INTO Recipes (user_ID, media_type, content) VALUES (?, ?, ?)",
        (user["id"], media_type, content))
    recipe = db.query(RECIPE_SELECT + " WHERE r.recipe_ID = ?", (cur.lastrowid,), one=True)
    return jsonify({"recipe": recipe}), 201


@bp.put("/recipes/<int:recipe_id>")
@auth.login_required
def update_recipe(recipe_id):
    row = db.query("SELECT user_ID FROM Recipes WHERE recipe_ID = ?", (recipe_id,), one=True)
    if not row:
        return error("Recipe not found", 404)

    content = clean_text(body().get("content"))
    if not content:
        return error("Recipe content is required")
    db.execute("UPDATE Recipes SET content = ? WHERE recipe_ID = ?", (content, recipe_id))
    return jsonify({"recipe": db.query(RECIPE_SELECT + " WHERE r.recipe_ID = ?", (recipe_id,), one=True)})


@bp.delete("/recipes/<int:recipe_id>")
@auth.login_required
def delete_recipe(recipe_id):
    row = db.query("SELECT user_ID FROM Recipes WHERE recipe_ID = ?", (recipe_id,), one=True)
    if not row:
        return error("Recipe not found", 404)

    db.execute("DELETE FROM Ratings WHERE recipe_ID = ?", (recipe_id,))
    db.execute("DELETE FROM Recipes WHERE recipe_ID = ?", (recipe_id,))
    return jsonify({"ok": True})


@bp.post("/recipes/<int:recipe_id>/rating")
@auth.login_required
def rate_recipe(recipe_id):
    if not db.query("SELECT 1 FROM Recipes WHERE recipe_ID = ?", (recipe_id,), one=True):
        return error("Recipe not found", 404)
    score = body().get("score")
    if not isinstance(score, int) or isinstance(score, bool) or not 1 <= score <= 5:
        return error("Score must be a whole number from 1 to 5")

    user = auth.current_user()
    db.execute(
        "INSERT INTO Ratings (user_ID, recipe_ID, score) VALUES (?, ?, ?) "
        "ON CONFLICT(user_ID, recipe_ID) DO UPDATE SET score = excluded.score, "
        "timestamp = CURRENT_TIMESTAMP", (user["id"], recipe_id, score))
    recipe = db.query(RECIPE_SELECT + " WHERE r.recipe_ID = ?", (recipe_id,), one=True)
    recipe["my_rating"] = score
    return jsonify({"recipe": recipe})
