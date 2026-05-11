// KIS Open API - 프로그램 매매 현황 (비차익 매수/매도)
// 경로: /api/program-trading

export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=60, stale-while-revalidate=30'
};

const KIS_BASE = 'https://openapivts.koreainvestment.com:29443'; // 모의투자

let _cachedToken = null;
let _tokenExpiry = 0;

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
  _tokenExpiry = now + ((data.expires_in || 86400) * 1000) - 60000;
  return _cachedToken;
}

// 프로그램 매매 현황 조회
// trId: FHPTJ04040000 (KOSPI), FHPTJ04050000 (KOSDAQ)
async function fetchProgramTrading(market, token) {
  const trId = market === 'KOSPI' ? 'FHPTJ04040000' : 'FHPTJ04050000';
  const mktDiv = market === 'KOSPI' ? '0' : '1';

  const res = await fetch(
    KIS_BASE + '/uapi/domestic-stock/v1/quotations/program-trade-by-group?fid_cond_mrkt_div_code=' + mktDiv,
    {
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + token,
        'appkey':    process.env.KIS_MOCK_APP_KEY,
        'appsecret': process.env.KIS_MOCK_APP_SECRET,
        'tr_id':     trId,
        'custtype':  'P'
      }
    }
  );

  if (!res.ok) return null;
  const data = await res.json();

  // 비차익 항목 찾기 (output 배열에서 구분값으로 필터)
  const output = data?.output || data?.output1 || [];
  const list = Array.isArray(output) ? output : [];

  // 비차익 = prdt_clsf_name 또는 ptgn_stk_prdt_clsf_name 중 '비차익'
  const nonArb = list.find(r =>
    (r.ptgn_stk_prdt_clsf_name || r.prdt_clsf_name || '').includes('비차익')
  ) || list[0]; // fallback: 첫 번째 행

  if (!nonArb) return null;

  // 매수/매도 금액 (단위: 백만원)
  const buyAmt  = parseInt(nonArb.ptgn_stk_shnu_tr_pbmn || nonArb.shnu_tr_pbmn  || '0', 10); // 매수 체결금액
  const sellAmt = parseInt(nonArb.ptgn_stk_seln_tr_pbmn || nonArb.seln_tr_pbmn || '0', 10); // 매도 체결금액
  const netAmt  = buyAmt - sellAmt; // 순매수

  return { market, buyAmt, sellAmt, netAmt, raw: nonArb };
}

export default async function handler(req) {
  try {
    const token = await getToken();
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
