"""Anyone Can Cook - application entry point.

Run with:  python app.py
"""
import os

from flask import Flask, jsonify, send_from_directory

import config
import db
import routes


def create_app(overrides=None):
    static_dir = os.path.join(config.BASE_DIR, "static")
    app = Flask(__name__, static_folder=static_dir, static_url_path="/static")
    app.config.update(
        DATABASE=config.DATABASE,
        SECRET_KEY=config.SECRET_KEY,
        DEBUG=config.DEBUG,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
    )
    if overrides:
        app.config.update(overrides)

    db.init_db(app.config["DATABASE"])
    app.teardown_appcontext(db.close_db)

    for module in routes.ALL:
        app.register_blueprint(module.bp)

    @app.get("/")
    def index():
        return send_from_directory(static_dir, "index.html")

    @app.errorhandler(404)
    def not_found(_e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(405)
    def bad_method(_e):
        return jsonify({"error": "Method not allowed"}), 405

    @app.errorhandler(500)
    def server_error(_e):
        return jsonify({"error": "Something went wrong on our side"}), 500

    return app


if __name__ == "__main__":
    create_app().run(debug=config.DEBUG, port=config.PORT)
