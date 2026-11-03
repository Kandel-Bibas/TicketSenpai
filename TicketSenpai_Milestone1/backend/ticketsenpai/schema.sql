PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','admin')) DEFAULT 'customer'
);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, artist TEXT NOT NULL, venue TEXT NOT NULL,
 starts_at TEXT NOT NULL, genre TEXT NOT NULL, description TEXT NOT NULL,
 price_cents INTEGER NOT NULL CHECK(price_cents > 0), published INTEGER NOT NULL DEFAULT 1 CHECK(published IN (0,1))
);
CREATE TABLE IF NOT EXISTS holds (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
 event_id INTEGER NOT NULL REFERENCES events(id), expires_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','released','expired','converted')) DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS seats (
 id TEXT NOT NULL, event_id INTEGER NOT NULL REFERENCES events(id), section TEXT NOT NULL,
 row_number INTEGER, seat_number INTEGER, price_cents INTEGER NOT NULL CHECK(price_cents > 0),
 status TEXT NOT NULL CHECK(status IN ('available','held','sold')) DEFAULT 'available',
 hold_id TEXT REFERENCES holds(id), PRIMARY KEY(event_id,id)
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), event_id INTEGER NOT NULL REFERENCES events(id),
 hold_id TEXT NOT NULL REFERENCES holds(id), status TEXT NOT NULL CHECK(status IN ('confirmed','declined')),
 total_cents INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
 order_id INTEGER NOT NULL REFERENCES orders(id), event_id INTEGER NOT NULL,
 seat_id TEXT NOT NULL, barcode TEXT NOT NULL UNIQUE,
 PRIMARY KEY(event_id,seat_id), FOREIGN KEY(event_id,seat_id) REFERENCES seats(event_id,id)
);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
 user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
 user_id INTEGER NOT NULL REFERENCES users(id), scope TEXT NOT NULL, key TEXT NOT NULL,
 fingerprint TEXT NOT NULL, response TEXT NOT NULL,
 PRIMARY KEY(user_id,scope,key)
);
CREATE INDEX IF NOT EXISTS holds_owner ON holds(user_id,event_id,status);
CREATE INDEX IF NOT EXISTS orders_owner ON orders(user_id,event_id);
CREATE INDEX IF NOT EXISTS reviews_event ON reviews(event_id,id);
