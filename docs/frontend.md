# Frontend guide

How the Next.js frontend in [`frontend/`](../frontend) is organized and how its
pages talk to the API. For setup and commands, see the
[development guide](development.md#working-on-the-frontend).

| | |
| --- | --- |
| Framework | Next.js 16.4 App Router, React 19.3 |
| Language | JavaScript (no TypeScript) |
| Dev server | `next dev --hostname 127.0.0.1 --port 3000` |
| API access | `fetch('/api/...')`, rewritten to `http://127.0.0.1:5001/api/...` by `next.config.mjs` |
| Styling | One global stylesheet, `app/globals.css` |
| Dependencies | `next`, `react`, `react-dom` only |

- [Routes](#routes)
- [Shared components](#shared-components)
- [The API client](#the-api-client)
- [State and data flow](#state-and-data-flow)
- [Idempotency keys in the UI](#idempotency-keys-in-the-ui)
- [Styling and theming](#styling-and-theming)
- [Accessibility](#accessibility)
- [Adding a page](#adding-a-page)

## Routes

| URL | File | Sign-in | Purpose |
| --- | --- | --- | --- |
| `/` | `app/page.js` | — | Redirects to `/events` |
| `/events` | `app/events/page.js` | No | Show list, search, pagination |
| `/events/[id]` | `app/events/[id]/page.js` | To hold, buy, or review | Event details, seat map, hold, checkout, reviews |
| `/tickets` | `app/tickets/page.js` | Yes | The user's orders |
| `/tickets/[id]` | `app/tickets/[id]/page.js` | Yes | One order with its tickets |
| `/login` | `app/login/page.js` | No | Sign-in form |
| `/register` | `app/register/page.js` | No | Registration form; signs in on success |
| `/profile` | `app/profile/page.js` | Yes | Edit display name |
| `/admin` | `app/admin/page.js` | Admin | Create and edit events |

Pages that need a session show a sign-in prompt instead of redirecting. The
admin page shows *Administrator access is required.* to customers. The server
enforces the same rules; the UI checks only decide what to render.

## Shared components

### `components/shell.js`

Wraps every page (from `app/layout.js`) and provides:

| Export | Purpose |
| --- | --- |
| `Shell` | Header, navigation, theme toggle, sign-out, footer, and the session context |
| `useSession()` | Returns `{ user, loading, refresh }`. `user` is `null` when signed out. Call `refresh()` after anything that changes the user. |
| `Notice` | Error (`role="alert"`) or success (`role="status"`) message. Renders nothing when empty. |
| `Loading` | Loading indicator with `role="status"` |
| `SignInPrompt` | Empty state with a link to `/login` |

On mount, `Shell` calls `GET /api/me`. A `401` means signed out and is not shown
as an error.

### `components/seat-map.js`

A React port of the reference mock's `web/js/seatMap.js`.

| Prop | Type | Meaning |
| --- | --- | --- |
| `seats` | array | Seat objects from `GET /api/events/{id}` |
| `selected` | string[] | Selected seat IDs (controlled) |
| `onChange` | function | Called with the new list of selected IDs |
| `held` | string[] | Seats in the user's active hold, highlighted |
| `disabled` | boolean | Locks the map while a hold exists or a request is running |

Selection is capped at six. GA spots are chosen by quantity: the component picks
the first available GA seats. Arrow keys move focus across the grid.

### `components/auth-form.js`

The form behind both `/login` and `/register`. Registration calls
`POST /api/register` and then `POST /api/login`, then routes to `/events`.

## The API client

[`lib/api.js`](../frontend/lib/api.js) exports:

| Export | Purpose |
| --- | --- |
| `api(path, { method, body, key })` | Calls `/api${path}`. JSON-encodes `body`, sends `key` as `Idempotency-Key`, parses the JSON response, and throws on non-2xx. |
| `money(cents)` | Formats integer cents as US dollars |
| `date(value)` | Formats a date in `America/Chicago`, e.g. *Mar 20, 2027* |

Errors thrown by `api()` have:

- `message`: the server's `error.message`, or a generic fallback.
- `status`: the HTTP status, or `undefined` when no response was received.

Example:

```js
import { api } from "../../lib/api";

try {
  const { items } = await api(`/events?q=${encodeURIComponent(query)}`);
} catch (err) {
  if (err.status === 401) {
    // signed out
  }
  setError(err.message);
}
```

## State and data flow

There is no global store. Each page keeps its own state with `useState` and loads
data in `useEffect`, using an `active` flag to ignore responses that arrive after
the page has moved on.

The event page is the most involved:

1. Loads the event and seat map, then **polls it every five seconds** so other
   shoppers' holds appear.
2. Loads reviews for the current review page.
3. When signed in, calls `GET /api/events/{id}/hold` to restore an active hold.
4. While a hold exists, runs a one-second countdown from `expires_at`.

## Idempotency keys in the UI

The event page keeps the current hold and checkout requests in refs
(`holdRequest`, `orderRequest`) as `{ key, body }`:

- A key is created with `crypto.randomUUID()` the first time an action is tried.
- **Retries of the same action reuse the same key and body**, so a double click
  or retried network call can't hold or buy twice.
- The key is thrown away when the request gets an HTTP response (`err.status`
  set), when the selection or payment option changes, or after a checkout
  succeeds. A network failure with no response keeps the key so the retry is
  safe.

Follow the same pattern for any new state-changing action that the server
makes idempotent.

## Styling and theming

- All styles live in `app/globals.css`. Use the existing CSS custom properties
  (tokens) for colors, spacing, and radii instead of hard-coded values.
- The theme follows `prefers-color-scheme` by default. The **Theme** button sets
  `data-theme="light"` or `"dark"` on `<html>` and saves it to `localStorage`
  under `ticketsenpai-theme`.
- Check every change in both themes and at phone width.

## Accessibility

Keep these working when you change the UI:

- The **Skip to content** link at the top of every page.
- `aria-current="page"` on the active navigation link.
- Keyboard navigation of the seat map.
- `Notice` roles so errors and confirmations are announced.
- Real `<label>` elements for every form field.
- Text rendering of user content. **Never** use `dangerouslySetInnerHTML`; see
  [V02](vulnerabilities.md#v02-stored-xss).

## Adding a page

1. Create `app/<route>/page.js` starting with `"use client";`.
2. Get the user with `useSession()`. Render `<Loading />` while `loading` is
   true and `<SignInPrompt />` if the page needs a user.
3. Load data with `api()` in `useEffect`, and show failures with `<Notice>`.
4. Add a navigation link in `components/shell.js` if needed.
5. Run `make build` to confirm the production build succeeds.
6. Update the [routes table](#routes) above.
