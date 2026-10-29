// Coffee Order App: zero-dependency Node server.
// Guests order at "/", the barista runs the queue at "/admin".
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'espresso';
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const NTFY_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const ACTIVE = ['waiting', 'making', 'ready'];
const STATUSES = [...ACTIVE, 'picked_up', 'cancelled'];

const defaultState = () => ({
  accepting: true,
  message: '',
  milks: ['Whole', 'Oat'],
  flavors: ['Pumpkin Spice', 'Vanilla', 'Honey', 'Cinnamon', 'Maple', 'Sea Salt', 'Blueberry', 'Brown Sugar'],
  menu: [
    { id: 'espresso', name: 'Espresso', emoji: '☕', section: 'Classics', desc: 'A straight shot', temps: ['hot'], milk: false, flavors: true, recipe: '', available: true },
    { id: 'latte', name: 'Latte', emoji: '🥛', section: 'Classics', desc: 'Espresso with steamed milk', temps: ['hot', 'iced'], milk: true, flavors: true, recipe: '', available: true },
    { id: 'cappuccino', name: 'Cappuccino', emoji: '☁️', section: 'Classics', desc: 'Espresso with airy foam', temps: ['hot'], milk: true, flavors: true, recipe: '', available: true },
    { id: 'flat-white', name: 'Flat White', emoji: '🤍', section: 'Classics', desc: 'Espresso with velvety microfoam', temps: ['hot'], milk: true, flavors: true, recipe: '', available: true },
    { id: 'americano', name: 'Americano', emoji: '💧', section: 'Classics', desc: 'Espresso with water', temps: ['hot', 'iced'], milk: false, flavors: true, recipe: '', available: true },
    { id: 'cortado', name: 'Cortado', emoji: '🫘', section: 'Classics', desc: 'Espresso with equal parts steamed milk', temps: ['hot'], milk: true, flavors: true, recipe: '', available: true },
    { id: 'honey-honey', name: '“Honey, Honey”', emoji: '🍯', section: 'Shelburne Specials', desc: 'Latte with honey, vanilla bean paste and sea salt', temps: ['hot', 'iced'], milk: true, flavors: false, recipe: 'Honey, vanilla bean paste, sea salt', available: true },
    { id: 'sunday-morning-toast', name: '“Sunday Morning Toast”', emoji: '🥂', section: 'Shelburne Specials', desc: 'Cappuccino with brown sugar, maple syrup and cinnamon', temps: ['hot'], milk: true, flavors: false, recipe: 'Brown sugar, maple syrup, cinnamon', available: true },
    { id: 'woodbine-maple', name: '“Woodbine Maple”', emoji: '🍁', section: 'Shelburne Specials', desc: 'Maple sea salt cortado', temps: ['hot'], milk: true, flavors: false, recipe: 'Maple, sea salt', available: true },
    { id: 'something-blue', name: '“Something Blue”', emoji: '🫐', section: 'Shelburne Specials', desc: 'Latte with blueberry and vanilla', temps: ['hot', 'iced'], milk: true, flavors: false, recipe: 'Blueberry, vanilla', available: true },
  ],
  orders: [],
  nextNumber: 1,
});

let state = defaultState();
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // data saved by an older version without flavors keeps its orders but gets the new menu
  if (!saved.flavors) { delete saved.menu; delete saved.milks; }
  delete saved.sizes;
  state = { ...state, ...saved };
} catch { /* first run */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(state), () => {});
  }, 200);
}

// ---------- views ----------
const clean = (s, max) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const norm = (s) => s.toLowerCase();

function publicView() {
  const active = state.orders.filter((o) => ACTIVE.includes(o.status));
  return {
    accepting: state.accepting,
    message: state.message,
    milks: state.milks,
    flavors: state.flavors,
    menu: state.menu,
    queue: active.map((o, i) => ({
      id: o.id, number: o.number, name: o.name, status: o.status, position: i + 1,
    })),
    // include recently finished orders so a guest's own page can show "picked up"
    done: state.orders
      .filter((o) => !ACTIVE.includes(o.status))
      .slice(-30)
      .map((o) => ({ id: o.id, number: o.number, status: o.status })),
  };
}
const adminView = () => ({ ...publicView(), orders: state.orders });

// ---------- live updates (SSE) ----------
const publicClients = new Set();
const adminClients = new Set();
function broadcast() {
  const pub = `data: ${JSON.stringify(publicView())}\n\n`;
  const adm = `data: ${JSON.stringify(adminView())}\n\n`;
  for (const res of publicClients) res.write(pub);
  for (const res of adminClients) res.write(adm);
}
setInterval(() => {
  for (const res of [...publicClients, ...adminClients]) res.write(': ping\n\n');
}, 25000);

function sse(req, res, set, initial) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 2000\ndata: ${JSON.stringify(initial)}\n\n`);
  set.add(res);
  req.on('close', () => set.delete(res));
}

// ---------- push notification (ntfy.sh) ----------
function notify(order) {
  if (!NTFY_TOPIC) return;
  const drink = describe(order);
  fetch(`${NTFY_SERVER}/${encodeURIComponent(NTFY_TOPIC)}`, {
    method: 'POST',
    headers: { Title: `New order #${order.number}: ${order.name}`, Priority: 'high', Tags: 'coffee' },
    body: drink + (order.notes ? `\nNote: ${order.notes}` : ''),
  }).catch((e) => console.error('ntfy failed:', e.message));
}
function describe(o) {
  const extras = [o.milk && `${o.milk} milk`, ...(o.flavors || [])].filter(Boolean);
  return [o.temp && o.temp[0].toUpperCase() + o.temp.slice(1), o.drinkName].filter(Boolean).join(' ') + (extras.length ? ` (${extras.join(', ')})` : '');
}

// ---------- helpers ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 50_000) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('bad json')); }
    });
  });
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function isAdmin(req, url) {
  const key = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
  const a = Buffer.from(String(key));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- routes ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/state') return send(res, 200, publicView());
  if (method === 'GET' && pathname === '/api/stream') return sse(req, res, publicClients, publicView());

  if (method === 'POST' && pathname === '/api/orders') {
    const b = await readBody(req);
    if (!state.accepting) return send(res, 403, { error: state.message || "We're not taking orders right now." });
    const name = clean(b.name, 40);
    if (!name) return send(res, 400, { error: 'Please enter your name.' });
    const item = state.menu.find((m) => m.id === b.drinkId);
    if (!item || !item.available) return send(res, 400, { error: 'That drink is not available.' });
    const temp = item.temps.includes(b.temp) ? b.temp : item.temps[0];
    if (item.milk && state.milks.length && !state.milks.includes(b.milk)) return send(res, 400, { error: 'Please choose a milk.' });
    const milk = item.milk && state.milks.length ? b.milk : '';
    if (state.orders.some((o) => ACTIVE.includes(o.status) && norm(o.name) === norm(name))) {
      return send(res, 409, { error: `${name} already has a drink in the queue. Once it's picked up you can order again!` });
    }
    const flavors = item.flavors && Array.isArray(b.flavors) ? state.flavors.filter((f) => b.flavors.includes(f)) : [];
    const order = {
      id: crypto.randomBytes(6).toString('hex'),
      number: state.nextNumber++,
      name, drinkId: item.id, drinkName: item.name, recipe: item.recipe, temp, milk, flavors,
      notes: clean(b.notes, 200),
      status: 'waiting',
      createdAt: Date.now(),
    };
    state.orders.push(order);
    save(); broadcast(); notify(order);
    return send(res, 201, { id: order.id, number: order.number });
  }

  // guest can cancel their own order while it is still waiting
  let m = pathname.match(/^\/api\/orders\/([a-f0-9]+)\/cancel$/);
  if (method === 'POST' && m) {
    const o = state.orders.find((x) => x.id === m[1]);
    if (!o) return send(res, 404, { error: 'Order not found.' });
    if (o.status !== 'waiting') return send(res, 409, { error: "It's already being made, so it can't be cancelled." });
    o.status = 'cancelled';
    save(); broadcast();
    return send(res, 200, { ok: true });
  }

  // ---- admin ----
  if (pathname.startsWith('/api/admin/')) {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Wrong password.' });
    if (method === 'GET' && pathname === '/api/admin/stream') return sse(req, res, adminClients, adminView());
    if (method === 'GET' && pathname === '/api/admin/state') return send(res, 200, adminView());

    m = pathname.match(/^\/api\/admin\/orders\/([a-f0-9]+)$/);
    if (method === 'POST' && m) {
      const b = await readBody(req);
      const o = state.orders.find((x) => x.id === m[1]);
      if (!o) return send(res, 404, { error: 'Order not found.' });
      if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'Bad status.' });
      o.status = b.status;
      save(); broadcast();
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/admin/settings') {
      const b = await readBody(req);
      if (typeof b.accepting === 'boolean') state.accepting = b.accepting;
      if (typeof b.message === 'string') state.message = clean(b.message, 200);
      if (Array.isArray(b.milks)) state.milks = b.milks.map((s) => clean(s, 30)).filter(Boolean).slice(0, 12);
      if (Array.isArray(b.flavors)) state.flavors = b.flavors.map((s) => clean(s, 30)).filter(Boolean).slice(0, 20);
      save(); broadcast();
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/admin/menu') {
      const b = await readBody(req);
      if (!Array.isArray(b.menu)) return send(res, 400, { error: 'Bad menu.' });
      const seen = new Set();
      state.menu = b.menu.slice(0, 40).map((it) => {
        const name = clean(it.name, 40);
        let id = clean(it.id, 40) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        while (seen.has(id)) id += '-2';
        seen.add(id);
        const temps = ['hot', 'iced'].filter((t) => (it.temps || []).includes(t));
        return { id, name, emoji: clean(it.emoji, 4), section: clean(it.section, 30) || 'Classics', desc: clean(it.desc, 120), temps: temps.length ? temps : ['hot'], milk: !!it.milk, flavors: !!it.flavors, recipe: clean(it.recipe, 120), available: it.available !== false };
      }).filter((it) => it.name);
      save(); broadcast();
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/admin/clear') {
      state.orders = state.orders.filter((o) => ACTIVE.includes(o.status));
      save(); broadcast();
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Not found.' });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    let file = url.pathname === '/' ? '/index.html' : url.pathname === '/admin' ? '/admin.html' : url.pathname;
    const full = path.join(PUBLIC_DIR, path.normalize(file));
    if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Coffee app on http://localhost:${PORT}  (barista: /admin)`);
    if (ADMIN_PASSWORD === 'espresso') console.warn('WARNING: using default admin password. Set ADMIN_PASSWORD.');
  });
}
module.exports = { server };
