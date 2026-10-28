# Coffee Order App

A tiny ordering queue for a home espresso bar. Guests open a link on their phones and order from your menu. You run the queue from a barista dashboard and get notified of every order.

- **Guests** (`/`): type a name, pick a drink, hot/iced, milk, size and notes. They see live status and how many orders are ahead of them. One active order per person.
- **Barista** (`/admin`, password protected): live queue with Start, Ready and Picked up buttons, a sound and vibration on each new order, an open/close toggle, a closed message, and an editable menu, milks and sizes (including marking items sold out).
- **Push notifications**: set `NTFY_TOPIC` and every order is pushed to your phone through [ntfy.sh](https://ntfy.sh).

No dependencies, just Node 18+.

## Run locally

    ADMIN_PASSWORD=yourpassword npm start
    # guests: http://localhost:3000   barista: http://localhost:3000/admin

## Phone notifications (ntfy)

1. Install the free **ntfy** app (iOS or Android) and subscribe to a hard-to-guess topic, e.g. `smith-wedding-coffee-83921`.
2. Set that name as the `NTFY_TOPIC` environment variable on the server.
3. Keep the `/admin` page open as well. It plays a sound for each new order.

## Deploy (Render, free)

1. Push this repo to GitHub, then on Render choose **New > Blueprint** and select it (`render.yaml` is included).
2. Set `ADMIN_PASSWORD` and `NTFY_TOPIC` when prompted.
3. Share the `https://....onrender.com` link with guests, or turn it into a QR code to print.

Notes:
- Free Render services sleep when idle, so open the link a minute before service starts. The first load can be slow.
- Order data is stored in `data.json` on the server's disk. Free-tier disks reset on redeploy or restart, which is fine for a weekend. Set up your menu after the last deploy.
- Use the **Close ordering** button between the wedding morning and Monday.

## Tests

    npm test
