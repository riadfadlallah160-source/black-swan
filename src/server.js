import http from 'node:http';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 3000;
const CREATOR_ADDRESS = process.env.CREATOR_ADDRESS || '0xf744573cdfFC211163c11c0a31730851Da78f708';
const LIVE_LAUNCH_ENABLED = process.env.LIVE_LAUNCH_ENABLED === 'true';

const state = {
  mode: LIVE_LAUNCH_ENABLED ? 'live-enabled' : 'dry-run',
  creatorAddress: CREATOR_ADDRESS,
  queued: [],
  launched: [],
  note: 'Live token submission is disabled by default. No funds are moved by this service.'
};

function json(res, status, body) {
  res.writeHead(status, {'content-type': 'application/json'});
  res.end(JSON.stringify(body, null, 2));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, {ok: true, mode: state.mode});
  }
  if (req.method === 'GET' && req.url === '/status') {
    return json(res, 200, state);
  }
  if (req.method === 'POST' && req.url === '/candidate') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, {error: 'invalid_json'}); }
    const required = ['name','symbol','description','score'];
    for (const k of required) if (body[k] == null) return json(res, 400, {error: `missing_${k}`});
    if (Number(body.score) < 85) return json(res, 200, {accepted: false, reason: 'score_below_threshold'});
    const candidate = {
      id: crypto.randomUUID(),
      name: String(body.name).slice(0, 64),
      symbol: String(body.symbol).slice(0, 16),
      description: String(body.description).slice(0, 500),
      score: Number(body.score),
      creatorAddress: CREATOR_ADDRESS,
      queuedAt: new Date().toISOString(),
      status: 'queued-dry-run'
    };
    state.queued.push(candidate);
    return json(res, 201, {accepted: true, candidate});
  }
  if (req.method === 'POST' && req.url === '/launch') {
    if (!LIVE_LAUNCH_ENABLED) {
      return json(res, 403, {
        error: 'live_launch_disabled',
        message: 'Dry-run safeguard is active. This build does not submit token launches or move funds.'
      });
    }
    return json(res, 501, {error: 'launch_adapter_not_armed'});
  }
  return json(res, 404, {error: 'not_found'});
});

server.listen(PORT, () => {
  console.log(`Black Swan launch factory listening on ${PORT} in ${state.mode} mode`);
});
