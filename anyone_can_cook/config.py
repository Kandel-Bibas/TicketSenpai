"""Central configuration. Everything environment-specific lives here."""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATABASE = os.environ.get("ACC_DATABASE", os.path.join(BASE_DIR, "anyone_can_cook.sqlite3"))

SECRET_KEY = "secret123"

DEBUG = True
PORT = int(os.environ.get("ACC_PORT", "5000"))

# The sample database shipped with placeholder passwords ("demo_hash_001", ...).
# On first start those are replaced with a real hash of this password so the
# seeded accounts can actually log in.
DEMO_PASSWORD = "password123"

MEDIA_TYPES = ("text", "image", "video")
MAX_CONTENT_LENGTH = 5000
