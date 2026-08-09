/**
 * 行为契约:反向地理编码(地图批 Google→Foursquare)。
 * 锁死:配了 token 走 Foursquare(店名/城市/国家/kind 映射,ISO-2 国家转全名);
 * Foursquare 无结果或无 token → 回落 OSM Nominatim;坏坐标 400;两家都挂 502。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadRoute({ env = {}, fetchImpl }) {
  const src = fs.readFileSync(new URL('../app/api/portal/geocode/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Number, Math, String, RegExp,
    fetch: fetchImpl,
    require: (p) => p === 'next/server'
      ? { NextRequest: class {}, NextResponse: { json: (b, init) => ({ __json: b, __status: init?.status ?? 200 }) } }
      : p === '@/lib/portal/api-auth' ? { guardAiRoute: async () => null }
      : p === '@/lib/portal/env' ? { envValue: (k) => env[k] || '' } : ({}),
  });
  return mod.exports;
}
const req = (lat, lon) => ({ json: async () => ({ lat, lon }) });
const okJson = (body) => ({ ok: true, json: async () => body });

// ── 配了 token → Foursquare;店名/城市/kind + ISO-2 国家转全名 ──
{
  let calledUrl = '', calledHeaders = null;
  const route = loadRoute({
    env: { FOURSQUARE_SERVICE_TOKEN: 'tkn' },
    fetchImpl: async (url, opt) => {
      calledUrl = url; calledHeaders = opt?.headers;
      return okJson({ results: [{
        fsq_place_id: 'abc', name: 'Whole Foods Market',
        categories: [{ name: 'Grocery Store' }],
        location: { locality: 'Cary', region: 'NC', country: 'US', formatted_address: 'Whole Foods Market, Cary, NC' },
      }] });
    },
  });
  const res = await route.POST(req(35.79, -78.78));
  assert.equal(res.__json.ok, true);
  assert.equal(res.__json.source, 'foursquare');
  assert.equal(res.__json.name, 'Whole Foods Market');
  assert.equal(res.__json.city, 'Cary');
  assert.equal(res.__json.country, 'United States', 'ISO-2 US → 全名');
  assert.equal(res.__json.kind, 'grocery', '分类名 → kind');
  assert.ok(calledUrl.includes('places-api.foursquare.com') && calledUrl.includes('ll=35.79,-78.78'), '打 Foursquare 端点带 ll');
  assert.equal(calledHeaders.Authorization, 'Bearer tkn', 'Bearer 鉴权头');
  assert.ok(calledHeaders['X-Places-Api-Version'], '带版本头');
}

// ── Foursquare 无结果 → 回落 OSM ──
{
  const route = loadRoute({
    env: { FOURSQUARE_SERVICE_TOKEN: 'tkn' },
    fetchImpl: async (url) => url.includes('foursquare')
      ? okJson({ results: [] })
      : okJson({ name: 'Main St', address: { road: 'Main St', city: 'Cary', country: 'United States' }, category: 'highway', type: 'residential' }),
  });
  const res = await route.POST(req(35.79, -78.78));
  assert.equal(res.__json.source, 'osm', 'Foursquare 空 → OSM 兜底');
  assert.equal(res.__json.city, 'Cary');
}

// ── Foursquare POI 太远(>50m)不当「在店里」→ OSM ──
{
  const route = loadRoute({
    env: { FOURSQUARE_SERVICE_TOKEN: 'tkn' },
    fetchImpl: async (url) => url.includes('foursquare')
      ? okJson({ results: [{
        fsq_place_id: 'far', name: 'Mellow Mushroom', distance: 95,
        categories: [{ name: 'Pizza Place' }],
        location: { locality: 'Cary', country: 'US' },
      }] })
      : okJson({ name: 'Creek Park Drive', address: { road: 'Creek Park Drive', city: 'Cary', country: 'United States' }, category: 'highway', type: 'residential' }),
  });
  const res = await route.POST(req(35.79, -78.78));
  assert.equal(res.__json.source, 'osm', '远距离 POI 不粘店名');
  assert.equal(res.__json.name, 'Creek Park Drive');
}

// ── 无 token → 直接 OSM ──
{
  const route = loadRoute({
    env: {},
    fetchImpl: async (url) => {
      assert.ok(!url.includes('foursquare'), '无 token 不打 Foursquare');
      return okJson({ name: 'Park', address: { leisure: 'Park', city: 'Cary', country: 'United States' }, category: 'leisure', type: 'park' });
    },
  });
  const res = await route.POST(req(35.79, -78.78));
  assert.equal(res.__json.source, 'osm');
  assert.equal(res.__json.kind, 'park');
}

// ── 坏坐标 400 ──
{
  const route = loadRoute({ env: {}, fetchImpl: async () => okJson({}) });
  assert.equal((await route.POST(req(999, 0))).__status, 400);
  assert.equal((await route.POST(req('x', 0))).__status, 400);
}

// ── 两家都挂 → 502 ──
{
  const route = loadRoute({ env: { FOURSQUARE_SERVICE_TOKEN: 'tkn' }, fetchImpl: async () => { throw new Error('down'); } });
  assert.equal((await route.POST(req(35.79, -78.78))).__status, 502);
}

console.log('geocode-foursquare: OK');
