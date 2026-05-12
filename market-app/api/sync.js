// 관심종목 동기화 API (Upstash Redis REST)
// GET  /api/sync?code=ABC123      → 코드로 저장된 관심종목 조회
// POST /api/sync {code, stocks}   → 현재 관심종목을 코드에 저장

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

// Upstash (신) 또는 Vercel KV (구) 환경변수 둘 다 지원
const KV_URL   = process.env.UPSTASH_REDIS_REST_URL   || process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const TTL      = 60 * 60 * 24 * 180; // 180일 보관

function validateCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{4,12}$/.test(code.toUpperCase());
}

// Upstash REST API: GET /get/<key>
async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ?? null;
}

// Upstash REST API: POST /set/<key>/<value>/ex/<seconds>
async function kvSet(key, value) {
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(
    `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(valueStr)}/ex/${TTL}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    }
  );
  return res.ok;
}

export default async function handler(req) {
  // KV 미설정 체크
  if (!KV_URL || !KV_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'KV_NOT_CONFIGURED' }), {
      status: 503, headers: CORS
    });
  }

  // OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // ── GET: 코드로 관심종목 불러오기 ──
  if (req.method === 'GET') {
    const code = new URL(req.url).searchParams.get('code');
    if (!code || !validateCode(code)) {
      return new Response(JSON.stringify({ ok: false, error: '유효하지 않은 코드예요 (영문+숫자 4~12자)' }), {
        status: 400, headers: CORS
      });
    }

    const raw = await kvGet(`wl:${code.toUpperCase()}`);
    if (!raw) {
      return new Response(JSON.stringify({ ok: false, error: '코드를 찾을 수 없어요. 다시 확인해주세요.' }), {
        status: 404, headers: CORS
      });
    }

    const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return new Response(JSON.stringify({ ok: true, stocks: saved.stocks, updatedAt: saved.updatedAt }), {
      headers: CORS
    });
  }

  // ── POST: 관심종목 저장 ──
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: '잘못된 요청이에요' }), {
        status: 400, headers: CORS
      });
    }

    const { code, stocks } = body;
    if (!code || !validateCode(code)) {
      return new Response(JSON.stringify({ ok: false, error: '유효하지 않은 코드예요 (영문+숫자 4~12자)' }), {
        status: 400, headers: CORS
      });
    }
    if (!Array.isArray(stocks)) {
      return new Response(JSON.stringify({ ok: false, error: 'stocks 형식 오류' }), {
        status: 400, headers: CORS
      });
    }

    const payload = { stocks, updatedAt: new Date().toISOString() };
    const ok = await kvSet(`wl:${code.toUpperCase()}`, payload);

    return new Response(JSON.stringify({ ok, updatedAt: new Date().toISOString() }), {
      status: ok ? 200 : 500, headers: CORS
    });
  }

  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
    status: 405, headers: CORS
  });
}
