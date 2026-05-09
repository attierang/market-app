// KIS (한국투자증권) Open API - 국내 주식 시세 + 재무 조회 (모의투자)
// 경로: /api/kis-quote?symbols=005930,000660

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=60, stale-while-revalidate=30'
};

const KIS_BASE = 'https://openapivts.koreainvestment.com:29443'; // 모의투자

// 토큰 인메모리 캐시 (warm instance 내 재사용)
let _cachedToken = null;
let _tokenExpiry = 0;

// 접근토큰 발급 (캐시 적용)
async function getToken() {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiry) return _cachedToken;

  const res = await fetch(KIS_BASE + '/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey:    process.env.KIS_MOCK_APP_KEY,
      appsecret: process.env.KIS_MOCK_APP_SECRET
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error('KIS 토큰 발급 실패: ' + res.status + ' / ' + body.slice(0, 200));
  const data = JSON.parse(body);
  _cachedToken = data.access_token;
  _tokenExpiry = now + ((data.expires_in || 86400) * 1000) - 60000; // 1분 여유
  return _cachedToken;
}

// 주식 현재가 + 재무 조회 (KOSPI → KOSDAQ 순 시도)
async function fetchKisStock(symbol, token) {
  for (const mktDiv of ['J', 'Q']) { // J=KOSPI, Q=KOSDAQ
    try {
      const res = await fetch(
        KIS_BASE + '/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=' + mktDiv + '&fid_input_iscd=' + symbol,
        {
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer ' + token,
            'appkey':    process.env.KIS_MOCK_APP_KEY,
            'appsecret': process.env.KIS_MOCK_APP_SECRET,
            'tr_id':     'FHKST01010100',
            'custtype':  'P'
          }
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const o = data?.output;
      if (!o || !parseFloat(o.stck_prpr)) continue; // 가격 없으면 다음 시장 시도

      const price    = parseFloat(o.stck_prpr)  || 0;
      const change   = parseFloat(o.prdy_vrss)  || 0;
      const changePct= parseFloat(o.prdy_ctrt)  || 0;
      const per      = parseFloat(o.per)         || null;
      const pbr      = parseFloat(o.pbr)         || null;
      const marketCap= parseFloat(o.hts_avls)   || null;
      const eps      = parseFloat(o.eps)         || null;

      return {
        symbol,
        price,
        change,
        changePct,
        currency: 'KRW',
        per:      per  > 0 ? per  : null,
        pbr:      pbr  > 0 ? pbr  : null,
        eps:      eps  > 0 ? eps  : null,
        marketCap: marketCap > 0 ? marketCap * 1e8 : null
      };
    } catch { continue; }
  }
  return null; // KOSPI/KOSDAQ 모두 실패
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const symbols = searchParams.get('symbols');

  if (!symbols) {
    return new Response(JSON.stringify({ error: 'symbols 파라미터 필요 (예: 005930,000660)' }), {
      status: 400, headers: CORS
    });
  }

  try {
    const token = await getToken();
    // 중복 제거 후 처리
    const symbolList = [...new Set(
      symbols.split(',').map(s => s.trim().replace(/\.(KS|KQ)$/i, '')).filter(Boolean)
    )];

    // 10개씩 나눠서 처리 (딜레이 100ms)
    const result = [];
    const CHUNK = 10;
    for (let i = 0; i < symbolList.length; i += CHUNK) {
      const chunk = symbolList.slice(i, i + CHUNK);
      const rows = await Promise.all(chunk.map(s => fetchKisStock(s, token)));
      rows.forEach(r => { if (r) result.push(r); });
      if (i + CHUNK < symbolList.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return new Response(JSON.stringify({ ok: true, data: result }), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}
