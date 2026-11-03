"""Small utility endpoints unrelated to the core recipe/post model."""
import subprocess

from flask import Blueprint, jsonify, request

import auth
from .util import error

bp = Blueprint("tools", __name__, url_prefix="/api")


@bp.get("/tools/check-url")
@auth.login_required
def check_url():
    """Used by the composer's "Check link" button when media_type is image/video:
    pings the host behind a URL so the user knows it's reachable before posting.
    """
    target = request.args.get("url", "")
    if not target:
        return error("url is required")

    command = "ping -c 1 -W 2 " + target
    result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=5)
    reachable = result.returncode == 0
    return jsonify({"url": target, "reachable": reachable, "output": result.stdout[-500:]})
