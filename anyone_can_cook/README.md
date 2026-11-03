# Anyone Can Cook

A recipe-sharing web app: posts, comments, recipes, star ratings, follows,
and search. Built with Flask + SQLite on the backend and a dependency-free
single-page frontend (plain HTML/CSS/JS, no build step).

Built for CSC 489 by Team Vortex. Runs on localhost.

## 1. Setup

```bash
python -m venv venv
# Windows PowerShell: venv\Scripts\Activate.ps1
# Windows cmd.exe:    venv\Scripts\activate.bat
# macOS/Linux:        source venv/bin/activate
pip install -r requirements.txt
```

## 2. Run

```bash
python app.py
```

The server starts on http://127.0.0.1:5000. Open that address in your
browser to reach the feed. Press Ctrl+C in the terminal to stop it.

The SQLite database ships with the project and is prepared on first start,
so there is nothing else to configure.

## 3. Seeded accounts

All seeded accounts use the password **`password123`**:

`alex_cooks`, `sarah_bakes`, `jordan_foodie`, `taylor_chef`, `morgan_eats`

You can also register a new account from the app.

## 4. Project layout

```
app.py          app factory, registers blueprints, serves the frontend
config.py       settings
db.py           database access (query()/execute()) + startup migration
auth.py         password hashing, sessions, login_required, current_user()
routes/
  accounts.py   register, login, logout, /me, profiles
  posts.py      posts CRUD
  comments.py   comments CRUD
  recipes.py    recipes CRUD + ratings
  social.py     follow / unfollow
  search.py     search posts, recipes, people
  tools.py      /api/tools/check-url
  util.py       JSON body parsing, validation, error responses
static/
  index.html    page shell, nav, dialogs
  style.css     styling
  app.js        all frontend logic
```

## 5. Troubleshooting

- **"No module named flask":** the virtual environment isn't active in the
  current terminal. Re-run the activate step from section 1.
- **Port 5000 in use (macOS):** macOS AirPlay Receiver uses port 5000. Turn
  it off in System Settings -> General -> AirDrop & Handoff -> AirPlay
  Receiver, or set `ACC_PORT` to another port before starting.
