// KIS (한국투자증권) Open API - 국내 주식 시세 + 재무 + 프로그램매매 조회 (모의투자)
// 경로: /api/kis-quote?symbols=005930,000660
//       /api/kis-quote?mode=program  (비차익 프로그램 매매)

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=60, stale-while-revalidate=30'
};

const KIS_MOCK_BASE = 'https://openapivts.koreainvestment.com:29443'; // 모의투자
const KIS_REAL_BASE = 'https://openapi.koreainvestment.com:9443';     // 실투자

// 모의투자 토큰 캐시
let _cachedToken = null;
let _tokenExpiry = 0;

// 실투자 토큰 캐시 (프로그램 매매용)
let _cachedRealToken = null;
let _realTokenExpiry = 0;

// 모의투자 접근토큰 발급
async function getToken() {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiry) return _cachedToken;

  const res = await fetch(KIS_MOCK_BASE + '/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey:    process.env.KIS_MOCK_APP_KEY,
      appsecret: process.env.KIS_MOCK_APP_SECRET
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error('KIS 모의 토큰 발급 실패: ' + res.status + ' / ' + body.slice(0, 200));
  const data = JSON.parse(body);
  _cachedToken = data.access_token;
  _tokenExpiry = now + ((data.expires_in || 86400) * 1000) - 60000;
  return _cachedToken;
}

// 실투자 접근토큰 발급 (프로그램 매매용)
async function getRealToken() {
  const now = Date.now();
  if (_cachedRealToken && now < _realTokenExpiry) return _cachedRealToken;

  const res = await fetch(KIS_REAL_BASE + '/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey:    process.env.KIS_REAL_APP_KEY,
      appsecret: process.env.KIS_REAL_APP_SECRET
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error('KIS 실투자 토큰 발급 실패: ' + res.status + ' / ' + body.slice(0, 200));
  const data = JSON.parse(body);
  _cachedRealToken = data.access_token;
  _realTokenExpiry = now + ((data.expires_in || 86400) * 1000) - 60000;
  return _cachedRealToken;
}

// 주식 현재가 + 재무 조회 (KOSPI → KOSDAQ 순 시도)
async function fetchKisStock(symbol, token) {
  for (const mktDiv of ['J', 'Q']) { // J=KOSPI, Q=KOSDAQ
    try {
      const res = await fetch(
        KIS_MOCK_BASE + '/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=' + mktDiv + '&fid_input_iscd=' + symbol,
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

// 비차익 프로그램 매매 현황 조회 (실투자 서버 사용)
// trId: FHPTJ04040000 (KOSPI), FHPTJ04050000 (KOSDAQ)
async function fetchProgramTrading(market, token) {
  const trId   = market === 'KOSPI' ? 'FHPTJ04040000' : 'FHPTJ04050000';
  const mktDiv = market === 'KOSPI' ? '0' : '1';

  try {
    const res = await fetch(
      KIS_REAL_BASE + '/uapi/domestic-stock/v1/quotations/program-trade-by-group?fid_cond_mrkt_div_code=' + mktDiv,
      {
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + token,
          'appkey':    process.env.KIS_REAL_APP_KEY,
          'appsecret': process.env.KIS_REAL_APP_SECRET,
          'tr_id':     trId,
          'custtype':  'P'
        }
      }
    );
    if (!res.ok) return { market, supported: false, status: res.status };
    const data = await res.json();

    // output 배열에서 비차익 항목 탐색
    const output = data?.output || data?.output1 || [];
    const list = Array.isArray(output) ? output : [];

    // 비차익 행 찾기
    const nonArb = list.find(r =>
      (r.ptgn_stk_prdt_clsf_name || r.prdt_clsf_name || '').includes('비차익')
    ) || (list.length > 0 ? list[0] : null);

    if (!nonArb) return { market, supported: true, buyAmt: 0, sellAmt: 0, netAmt: 0, raw: data };

    const buyAmt  = parseInt(nonArb.ptgn_stk_shnu_tr_pbmn || nonArb.shnu_tr_pbmn  || '0', 10);
    const sellAmt = parseInt(nonArb.ptgn_stk_seln_tr_pbmn || nonArb.seln_tr_pbmn  || '0', 10);

    return { market, supported: true, buyAmt, sellAmt, netAmt: buyAmt - sellAmt };
  } catch (e) {
    return { market, supported: false, error: e.message };
  }
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const mode    = searchParams.get('mode');
  const symbols = searchParams.get('symbols');

  // ── 모드: 프로그램 매매 (실투자 서버) ──
  if (mode === 'program') {
    try {
      const token = await getRealToken();
      const [kospi, kosdaq] = await Promise.allSettled([
        fetchProgramTrading('KOSPI',  token),
        fetchProgramTrading('KOSDAQ', token)
      ]);
      return new Response(JSON.stringify({
        ok: true,
        data: {
          kospi:  kospi.status  === 'fulfilled' ? kospi.value  : null,
          kosdaq: kosdaq.status === 'fulfilled' ? kosdaq.value : null
        }
      }), { headers: CORS });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500, headers: CORS
      });
    }
  }

  // ── 모드: 주식 시세 (기본) ──
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
