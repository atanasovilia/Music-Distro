const { getJamStore, roomKey } = require('../_lib/jam-store');

function json(res, status, payload, meta = {}) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (meta.consistencyToken) {
    res.setHeader('x-jam-sync-token', meta.consistencyToken);
  }

  if (meta.driver) {
    res.setHeader('x-jam-storage', meta.driver);
  }

  res.end(JSON.stringify(payload));
}

function parseBody(body) {
  if (!body) return {};

  if (typeof body === 'string') {
    try {
      return JSON.parse(body || '{}');
    } catch {
      return {};
    }
  }

  return body;
}

module.exports = async function handler(req, res) {
  const store = getJamStore();
  const method = req.method || 'GET';
  const requestConsistencyToken = req.headers['x-jam-sync-token'] || null;

  try {
    if (method === 'GET') {
      const roomId = roomKey(req.query?.roomId);
      const result = await store.getRoomState(roomId, requestConsistencyToken);

      return json(res, 200, {
        ok: true,
        state: result.state,
      }, result);
    }

    if (method === 'POST') {
      const body = parseBody(req.body);
      const roomId = roomKey(body.roomId);
      const result = await store.applyAction(
        roomId,
        body.action,
        body.payload || {},
        {
          id: body.userId || null,
          name: body.userName || null,
        },
        requestConsistencyToken
      );

      return json(res, 200, {
        ok: true,
        state: result.state,
      }, result);
    }

    return json(res, 405, {
      ok: false,
      error: 'Method not allowed',
    });
  } catch (error) {
    console.error('[Jam API] Request failed:', error);

    return json(res, 500, {
      ok: false,
      error: 'Jam storage unavailable',
    });
  }
};
