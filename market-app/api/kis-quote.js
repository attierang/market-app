// KIS (한국투자증권) Open API - 국내 주식 시세 + 재무 조회 (모의투자)
// 경로: /api/kis-quote?symbols=005930,000660

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=60, stale-while-revalidate=30'
};

const KIS_BASE = 'https://openapivts.koreainvestment.com:29443'; // 모의투자

// 접근토큰 발급
async function getToken() {
  const res = await fetch(KIS_BASE + '/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey:    process.env.KIS_MOCK_APP_KEY,
      appsecret: process.env.KIS_MOCK_APP_SECRET
    })
  });
  if (!res.ok) throw new Error('KIS 토큰 발급 실패: ' + res.status);
  const data = await res.json();
  return data.access_token;
}

// 주식 현재가 + 재무 조회 (국내주식-시세 + PER/시총)
async function fetchKisStock(symbol, token) {
  try {
    const res = await fetch(
      KIS_BASE + '/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=' + symbol,
      {
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + token,
          'appkey':    process.env.KIS_MOCK_APP_KEY,
          'appsecret': process.env.KIS_MOCK_APP_SECRET,
          'tr_id':     'FHKST01010100'
        }
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const o = data?.output;
    if (!o) return null;

    const price    = parseFloat(o.stck_prpr)  || 0;   // 현재가
    const change   = parseFloat(o.prdy_vrss)  || 0;   // 전일대비
    const changePct= parseFloat(o.prdy_ctrt)  || 0;   // 등락률(%)
    const per      = parseFloat(o.per)         || null; // PER
    const pbr      = parseFloat(o.pbr)         || null; // PBR
    const marketCap= parseFloat(o.hts_avls)   || null; // 시총(억원)
    const eps      = parseFloat(o.eps)         || null; // EPS

    return {
      symbol,
      price,
      change,
      changePct,
      currency: 'KRW',
      per:      per  > 0 ? per  : null,
      pbr:      pbr  > 0 ? pbr  : null,
      eps:      eps  > 0 ? eps  : null,
      marketCap: marketCap > 0 ? marketCap * 1e8 : null  // 억원 → 원
    };
  } catch { return null; }
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
    const symbolList = symbols.split(',').map(s => s.trim().replace(/\.(KS|KQ)$/i, '')).filter(Boolean);

    // 5개씩 나눠서 처리
    const result = [];
    const CHUNK = 5;
    for (let i = 0; i < symbolList.length; i += CHUNK) {
      const chunk = symbolList.slice(i, i + CHUNK);
      const rows = await Promise.all(chunk.map(s => fetchKisStock(s, token)));
      rows.forEach(r => { if (r) result.push(r); });
      if (i + CHUNK < symbolList.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    return new Response(JSON.stringify({ ok: true, data: result }), { headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}
