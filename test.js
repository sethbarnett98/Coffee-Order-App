// End-to-end smoke test: node test.js
process.env.DATA_FILE = require('path').join(require('os').tmpdir(), `coffee-test-${process.pid}.json`);
process.env.ADMIN_PASSWORD = 'pw';
const assert = require('assert');
const { server } = require('./server');

server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const j = (p, body, headers = {}) => fetch(base + p, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const admin = { 'x-admin-key': 'pw' };
  try {
    let r = await j('/api/orders', { name: 'Ann', drinkId: 'latte', temp: 'iced', milk: 'Oat', flavors: ['Vanilla', 'Bogus'] });
    assert.equal(r.status, 201);
    const annId = r.body.id;
    r = await j('/api/admin/state', null, { 'x-admin-key': 'pw' });
    assert.deepEqual(r.body.orders[0].flavors, ['Vanilla'], 'only listed flavors kept');
    r = await j('/api/orders', { name: 'Sig', drinkId: 'honey-honey', milk: 'Whole', flavors: ['Maple'] });
    assert.equal(r.status, 201);
    r = await j('/api/admin/state', null, { 'x-admin-key': 'pw' });
    assert.deepEqual(r.body.orders[1].flavors, [], 'signature drinks have fixed recipe');
    assert.equal(r.body.orders[1].recipe, 'Honey, vanilla bean paste, sea salt');
    await j('/api/admin/orders/' + r.body.orders[1].id, { status: 'cancelled' }, { 'x-admin-key': 'pw' });
    r = await j('/api/orders', { name: 'Milkless', drinkId: 'latte' });
    assert.equal(r.status, 400, 'milk drinks require a milk');
    r = await j('/api/orders', { name: 'ann', drinkId: 'espresso' });
    assert.equal(r.status, 409, 'one active order per person');
    r = await j('/api/orders', { name: 'Bob', drinkId: 'espresso' });
    assert.equal(r.status, 201);
    r = await j('/api/state');
    assert.deepEqual(r.body.queue.map((o) => [o.name, o.position]), [['Ann', 1], ['Bob', 2]]);
    assert.equal((await j('/api/admin/state')).status, 401);
    for (const s of ['making', 'ready', 'picked_up']) {
      assert.equal((await j('/api/admin/orders/' + annId, { status: s }, admin)).status, 200);
    }
    r = await j('/api/state');
    assert.equal(r.body.queue.length, 1);
    assert.equal((await j('/api/orders', { name: 'Ann', drinkId: 'latte', milk: 'Oat' })).status, 201, 'can reorder after pickup');
    await j('/api/admin/settings', { accepting: false, message: 'Closed' }, admin);
    assert.equal((await j('/api/orders', { name: 'Cy', drinkId: 'latte', milk: 'Oat' })).status, 403);
    console.log('all tests passed');
  } catch (e) { console.error(e); process.exitCode = 1; }
  server.close(); setTimeout(() => process.exit(), 300);
});
