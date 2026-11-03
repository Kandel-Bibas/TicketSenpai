"""All database access goes through this module.

Routes never open connections themselves; they call query()/execute() with a
SQL string and a parameter tuple. That keeps every SQL statement visible in the
route files and gives a single place to change how queries are run.
"""
import sqlite3

from flask import g, current_app
from werkzeug.security import generate_password_hash

import config


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query(sql, params=(), one=False):
    """Run a SELECT. Returns a list of dicts (or one dict / None if one=True)."""
    rows = [dict(r) for r in get_db().execute(sql, params).fetchall()]
    if one:
        return rows[0] if rows else None
    return rows


def execute(sql, params=()):
    """Run INSERT/UPDATE/DELETE, commit, and return the cursor."""
    db = get_db()
    cur = db.execute(sql, params)
    db.commit()
    return cur


# ---------------------------------------------------------------------------
# Startup: make sure the sample database is usable by the app.
# ---------------------------------------------------------------------------
def init_db(path):
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    # The original schema has no ratings table, but ratings are part of the
    # project brief. Added idempotently so the DB designers' tables stay as-is.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS Ratings (
            rating_ID INTEGER PRIMARY KEY,
            user_ID   INTEGER NOT NULL,
            recipe_ID INTEGER NOT NULL,
            score     INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (user_ID, recipe_ID),
            FOREIGN KEY (user_ID)   REFERENCES Users(user_ID),
            FOREIGN KEY (recipe_ID) REFERENCES Recipes(recipe_ID)
        )
    """)

    # Replace placeholder seed passwords with real hashes of the demo password.
    placeholder_ids = [r[0] for r in cur.execute(
        "SELECT user_ID FROM Users WHERE password LIKE 'demo_hash_%'")]
    if placeholder_ids:
        hashed = generate_password_hash(config.DEMO_PASSWORD)
        cur.executemany("UPDATE Users SET password = ? WHERE user_ID = ?",
                        [(hashed, uid) for uid in placeholder_ids])

    conn.commit()
    conn.close()
