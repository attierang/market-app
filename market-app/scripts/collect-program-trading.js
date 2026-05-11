// KIS 실투자 API - 비차익 프로그램 매매 현황 수집
// 장중(09:00~15:30 KST) GitHub Actions에서 주기적으로 실행

const fs   = require('fs');
const path = require('path');

const APP_KEY    = process.env.KIS_REAL_APP_KEY;
const APP_SECRET = process.env.KIS_REAL_APP_SECRET;
const KIS_BASE   = 'https://openapi.koreainvestment.com:9443';

if (!APP_KEY || !APP_SECRET) {
  console.error('KIS_REAL_APP_KEY / KIS_REAL_APP_SECRET 없음');
  process.exit(1);
}

async function getToken() {
  const res = await fetch(KIS_BASE + '/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey:    APP_KEY,
      appsecret: APP_SECRET
    })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('토큰 발급 실패: ' + res.status + ' / ' + txt.slice(0, 200));
  }
  const data = await res.json();
  return data.access_token;
}

async function fetchProgramTrading(market, token) {
  const clsCode = market === 'KOSPI' ? 'K' : 'Q';
  const url = KIS_BASE + '/uapi/domestic-stock/v1/quotations/comp-program-trade-today'
    + '?FID_COND_MRKT_DIV_CODE=J&FID_MRKT_CLS_CODE=' + clsCode
    + '&FID_SCTN_CLS_CODE=&FID_INPUT_ISCD=&FID_COND_MRKT_DIV_CODE1=&FID_INPUT_HOUR_1=';

  const res = await fetch(url, {
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + token,
      'appkey':    APP_KEY,
      'appsecret': APP_SECRET,
      'tr_id':     'FHPPG04600101',
      'custtype':  'P'
    }
  });
  if (!res.ok) throw new Error(market + ' 조회 실패: ' + res.status);
  const data = await res.json();

  const output = data?.output || [];
  const latest = Array.isArray(output) ? output[0] : null;
  if (!latest) return { market, buyAmt: 0, sellAmt: 0, netAmt: 0 };

  return {
    market,
    buyAmt:  parseInt(latest.nabt_smtn_shnu_tr_pbmn || '0', 10),
    sellAmt: parseInt(latest.nabt_smtn_seln_tr_pbmn || '0', 10),
    netAmt:  parseInt(latest.nabt_smtn_ntby_tr_pbmn || '0', 10),
    updatedAt: latest.bsop_hour || ''
  };
}

async function main() {
  try {
    console.log('KIS 비차익 프로그램 매매 수집 중...');
    const token = await getToken();

    const [kospi, kosdaq] = await Promise.all([
      fetchProgramTrading('KOSPI',  token),
      fetchProgramTrading('KOSDAQ', token)
    ]);

    const output = {
      updated_at: new Date().toISOString(),
      kospi,
      kosdaq
    };

    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    fs.writeFileSync(
      path.join(dataDir, 'program-trading.json'),
      JSON.stringify(output, null, 2),
      'utf8'
    );

    console.log('KOSPI 비차익 순매수: ' + (kospi.netAmt / 100).toFixed(0) + '억원');
    console.log('KOSDAQ 비차익 순매수: ' + (kosdaq.netAmt / 100).toFixed(0) + '억원');
    console.log('✅ program-trading.json 저장 완료');
  } catch (err) {
    console.error('오류:', err.message);
    process.exit(1);
  }
}

main();
