# User guide

This guide walks through TicketSenpai as a customer, from finding a show to
holding your tickets. It assumes the app is running (`make dev`) at
<http://127.0.0.1:3000>. Administrators should also read the
[administrator guide](admin-guide.md).

- [Signing in](#signing-in)
- [Finding a show](#finding-a-show)
- [Choosing seats](#choosing-seats)
- [Holding seats](#holding-seats)
- [Checking out](#checking-out)
- [Your tickets](#your-tickets)
- [Reviews](#reviews)
- [Your profile](#your-profile)
- [Themes and accessibility](#themes-and-accessibility)
- [Rules at a glance](#rules-at-a-glance)

## Signing in

You can browse shows without an account. To hold seats, buy tickets, or post a
review, you need to sign in.

- **Use a demo account.** Click **Sign in ↗** in the header and use one of the
  [demo accounts](../README.md#demo-accounts), for example
  `alice@example.test` / `alice-demo`.
- **Create an account.** Go to `/register`, enter a name (up to 80 characters),
  an email address, and a password of at least eight characters. You are signed
  in automatically and taken to the show list.

Sessions last 24 hours. Signing in somewhere else ends your previous session.
Click **Sign out** in the header when you are done.

> [!NOTE]
> All data is local and fictional. Never use a real password you use elsewhere.

## Finding a show

**Explore** (`/events`) lists every published show, soonest first. Each card shows
the genre, date, artist, venue, and the starting price.

To search, type part of a show name or artist into **Search shows or artists**
and press **Search ↗**. Search ignores case and matches anywhere in the name, so
`mid` finds *The Midnight Assembly*. Results are shown 20 at a time; use
**Previous** and **Next** to page through them.

Dates are shown in Chicago time (`America/Chicago`).

## Choosing seats

Open a show to see its venue map under **Find your spot.** Every venue has three
areas:

| Area | Seats | Price |
| --- | --- | --- |
| Premium (section A) | 5 rows of 10 | Standard price + $90 |
| Standard (section B) | 10 rows of 12 | Standard price |
| GA floor (standing) | 100 spots | Standard price + $25 |

- **Reserved seats:** click a seat to select it, and click again to deselect it.
  Only available seats can be selected.
- **General admission:** choose a number from the **Quantity** list on the GA
  floor. The next available spots are picked for you.
- You can mix reserved seats and GA spots, up to **six in total**.

The panel on the right shows how many tickets you have selected, which seats,
and the total. The map refreshes every five seconds, so seats taken by other
people disappear as you watch.

**Keyboard:** Tab into the map, then use the arrow keys to move between seats
and Enter or Space to select.

## Holding seats

Click **Hold my seats ↗**. If every seat is still free, they are reserved for you
for **eight minutes**, and a countdown shows how long you have left.

- If someone else got a seat first, you'll see *Seat … is no longer available.
  Choose again.* Nothing is held; pick different seats and try again.
- Reloading the page, or coming back later, restores your hold as long as it has
  not expired.
- **Choose different seats** releases your hold right away and puts the seats
  back on sale.
- When the countdown reaches zero, the seats go back on sale and you have to
  choose again.

## Checking out

While your hold is active, choose a **Simulated payment**:

| Option | Result |
| --- | --- |
| **Approved** | The purchase succeeds and you are taken to your tickets. |
| **Declined (demo)** | The payment fails. Your seats **stay held**, so you can switch to Approved and try again before the countdown ends. |

Click **Confirm purchase ↗**. No card details are asked for and nothing is
charged.

Clicking twice, or a flaky connection, never buys your seats twice. Each
purchase attempt carries a unique key, and the server ignores repeats of the
same attempt.

## Your tickets

**My tickets** (`/tickets`) lists your orders, newest first, with the date, venue,
number of tickets, and total. Declined attempts are listed as **Payment declined**.

Open an order to see:

- The order number and status.
- Who booked it and the total paid.
- One **Admit one** ticket per seat, with the seat ID and a unique ticket code.

You can only see your own orders. Opening someone else's order link shows
*This order does not exist.*

## Reviews

At the bottom of each show page, under **Before the encore.**, signed-in users
can leave a review of up to 2,000 characters. Reviews are listed newest first,
20 per page.

Reviews are shown exactly as typed. Any HTML in a review is shown as plain text
and never runs.

## Your profile

Click your name in the header to open **Profile** (`/profile`). You can change
your display name (up to 80 characters). Your email address cannot be changed.
Your name appears on your orders and reviews.

## Themes and accessibility

- **Theme:** the **◐ Theme** button switches between light and dark. Your choice
  is remembered in this browser. Until you choose, the app follows your system
  setting.
- **Skip link:** press Tab on any page to reveal **Skip to content**.
- **Layout:** pages adapt to narrow screens.
- Status and error messages are announced to screen readers.

## Rules at a glance

| Rule | Value |
| --- | --- |
| Seats per person per event | 6, counting held **and** bought seats |
| Hold length | 8 minutes |
| Session length | 24 hours |
| Password length | 8–100 characters |
| Review length | Up to 2,000 characters |
| Display name length | Up to 80 characters |
| Results per page | 20 |

Something not working? See [troubleshooting](troubleshooting.md).
