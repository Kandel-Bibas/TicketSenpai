# Administrator guide

Administrators create and manage events. This guide covers the **Manage events**
page (`/admin`) and the rules behind it. For the underlying API, see
[Administration](api.md#administration) in the API reference.

- [Getting access](#getting-access)
- [The Manage events page](#the-manage-events-page)
- [Creating an event](#creating-an-event)
- [Editing an event](#editing-an-event)
- [Publishing and drafts](#publishing-and-drafts)
- [Pricing rules](#pricing-rules)
- [What administrators cannot do](#what-administrators-cannot-do)
- [Resetting demo data](#resetting-demo-data)

## Getting access

Sign in as the seeded administrator:

| Email | Password |
| --- | --- |
| `admin@example.test` | `admin-demo` |

**Manage events** then appears in the header. Accounts created through
`/register` are always customers, and there is no screen or API for promoting
one. Customers who open `/admin` see *Administrator access is required.*

## The Manage events page

The page has two parts:

- **Your events** lists every event, newest first, including drafts. Each entry
  shows whether it is **Published** or a **Draft** and its standard price. Click
  an entry to load it into the form.
- The form on the right is **New event** by default and switches to
  **Edit event** when you pick an existing one. Click **New event** to go back to
  a blank form.

## Creating an event

Fill in every field and click **Create event**.

| Field | Rules |
| --- | --- |
| Show name | 1–200 characters |
| Artist | 1–200 characters |
| Venue | 1–200 characters. Defaults to *Mock Arena · Chicago*. |
| Date and time (UTC) | Entered in **UTC**. Customers see it converted to Chicago time. |
| Genre | 1–200 characters |
| Standard seat price ($) | $1.00–$10,000.00 |
| Description | 1–2,000 characters |
| Published | Checked by default |

On success you'll see *Event created with 270 seats.* Every new event gets the
standard venue: 50 premium, 120 standard, and 100 general-admission seats.

Each submission creates a new event. Clicking **Create event** twice creates
two events.

## Editing an event

Pick the event under **Your events**, change any fields, and click **Save event**.
Every field is saved, including **Published**, so make sure that checkbox shows
what you want before you save.

| Change | Allowed |
| --- | --- |
| Name, artist, venue, date, genre, description | Always |
| Published / draft | Always |
| Price | Only while **no seat** for the event is held or sold |

Edits apply immediately. Customers see the new details on their next page load
or within five seconds on an open event page.

## Publishing and drafts

| | Published | Draft |
| --- | --- | --- |
| Listed and searchable on Explore | ✅ | ❌ |
| Event page opens | ✅ | ❌ (shows *This event does not exist.*) |
| New holds | ✅ | ❌ |
| Checkout of an existing hold | ✅ | ❌ |
| Listed on Manage events | ✅ | ✅ |
| Existing tickets stay valid in My Tickets | ✅ | ✅ |

Unpublishing is the way to stop sales for an event, including for shoppers who
are already holding seats. There is no delete; unpublish an event instead.

The seed data includes one draft, **Unannounced show**, to show that drafts
never appear in search.

## Pricing rules

You set the **standard** price. The other sections are derived from it:

| Section | Price |
| --- | --- |
| Standard (B) | Standard price |
| GA floor | Standard price + $25 |
| Premium (A) | Standard price + $90 |

For example, a $65.00 standard price gives $90.00 GA and $155.00 premium seats.

Once any seat is held or sold, the price is **locked**, and saving a new price
fails with *Prices cannot change after seats are held or sold.* Expired holds do
not count; they are cleared before the check. Prices are always calculated on
the server, so shoppers are charged the price stored with each seat.

## What administrators cannot do

These are deliberate limits:

- Delete events, seats, orders, or reviews.
- Change the venue layout or the six-seat limit.
- Refund, cancel, or move a customer's tickets.
- See or change customer accounts or passwords.
- Promote another account to administrator.

Purchasing works for administrators the same way as for customers.

## Resetting demo data

To throw away all events, orders, reviews, and accounts and return to the seed
data, stop the servers and run:

```sh
make reset CONFIRM=reset
```

This only deletes TicketSenpai's local database. It cannot be undone.
