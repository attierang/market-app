// KIS API - 외국인/기관 순매수·순매도 상위 20 수집
// Endpoint: /uapi/domestic-stock/v1/ranking/quote-balance (TR: FHPST01720000)

const fs   = require('fs');
const path = require('path');

const APP_KEY    = process.env.KIS_REAL_APP_KEY;
const APP_SECRET = process.env.KIS_REAL_APP_SECRET;
const KIS_BASE   = 'https://openapi.koreainvestment.com:9443';
const dataDir    = path.join(__dirname, '../data');
const TOKEN_FILE = path.join(dataDir, 'kis-real-token.json');

if (!APP_KEY || !APP_SECRET) {
  console.error('KIS_REAL_APP_KEY / KIS_REAL_APP_SECRET 없음');
  process.exit(1);
}

function loadCachedToken() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const cached = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (!cached.access_token || !cached.expires_at) return null;
    if (Date.now() < cached.expires_at - 10 * 60 * 1000) return cached.access_token;
    return null;
  } catch { return null; }
}

async function issueToken() {
  console.log('새 KIS 토큰 발급 중...');
  const res = await fetch(KIS_BASE + '/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET })
  });
  if (!res.ok) throw new Error('토큰 발급 실패: ' + res.status);
  const data = await res.json();
  const expiresIn = data.expires_in || 86400;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({
    access_token: data.access_token,
    expires_at: Date.now() + expiresIn * 1000
  }), 'utf8');
  console.log('토큰 발급 완료 (' + Math.round(expiresIn / 3600) + '시간)');
  return data.access_token;
}

async function getToken() {
  return loadCachedToken() || await issueToken();
}

// KIS API: 주식 순매수 상위 조회
// FID_COND_SCR_DIV_CODE: 20171 (외국인), 20172 (기관), 20173 (연기금 등)
// FID_BLNG_CLS_CODE: 0 = 순매수, 1 = 순매도
async function fetchInvestorRank(token, scrCode, buySelCode, count) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE:  scrCode,
    FID_INPUT_ISCD:         '0000',
    FID_DIV_CLS_CODE:       '0',
    FID_BLNG_CLS_CODE:      buySelCode,
    FID_TRGT_CLS_CODE:      '0',
    FID_TRGT_EXLS_CLS_CODE: '0',
    FID_INPUT_PRICE_1:      '',
    FID_INPUT_PRICE_2:      '',
    FID_VOL_CNT:            '',
    FID_INPUT_DATE_1:       '',
  });

  const res = await fetch(KIS_BASE + '/uapi/domestic-stock/v1/ranking/quote-balance?' + params, {
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + token,
      'appkey':    APP_KEY,
      'appsecret': APP_SECRET,
      'tr_id':     'FHPST01720000',
      'custtype':  'P'
    }
  });

  const data = await res.json();
  console.log(`  응답 (scrCode=${scrCode}, buySel=${buySelCode}): rt_cd=${data.rt_cd} msg=${data.msg1||''}`);

  if (data.rt_cd !== '0') {
    console.log('  응답 전체:', JSON.stringify(data).slice(0, 400));
    return [];
  }

  const rows = data.output || [];
  if (!rows.length) {
    console.log('  데이터 없음 (output 빈 배열)');
    return [];
  }

  // Log first row keys for debugging
  console.log('  첫 행 키:', Object.keys(rows[0]).join(', '));
  console.log('  첫 행:', JSON.stringify(rows[0]).slice(0, 300));

  return rows.slice(0, count).map((row, i) => {
    const code = row.mksc_shrn_iscd || row.stck_shrn_iscd || '';
    const name = row.hts_kor_isnm || row.kor_isnm || '';
    const price = row.stck_prpr || row.last_prpr || '0';
    const diff = parseInt(row.prdy_vrss || '0');
    return {
      rank:      i + 1,
      code:      code,
      name:      name,
      price:     price,
      direction: diff >= 0 ? 'up' : 'down',
    };
  });
}

async function main() {
  const outFile = path.join(dataDir, 'krx-netbuy.json');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const now = new Date();
  const nowStr = now.toISOString();

  // Load existing data for fallback
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {}

  console.log('KIS API 외국인/기관 순매수·순매도 상위 수집 중...');

  try {
    const token = await getToken();

    // scrCode: 20171=외국인, 20172=기관합계
    // buySelCode: 0=순매수, 1=순매도
    console.log('\n[외국인 순매수]');
    const fornBuy  = await fetchInvestorRank(token, '20171', '0', 20);
    console.log('\n[외국인 순매도]');
    const fornSell = await fetchInvestorRank(token, '20171', '1', 20);
    console.log('\n[기관 순매수]');
    const instBuy  = await fetchInvestorRank(token, '20172', '0', 20);
    console.log('\n[기관 순매도]');
    const instSell = await fetchInvestorRank(token, '20172', '1', 20);

    const d = now;
    const dateStr = d.getFullYear().toString()
      + String(d.getMonth()+1).padStart(2,'0')
      + String(d.getDate()).padStart(2,'0');

    const output = {
      updated_at: nowStr,
      date:       dateStr,
      source:     'KIS API',
      note:       '외국인/기관 순매수·순매도 상위20 (KOSPI)',
      kospi_foreigner_buy:  fornBuy.length  ? fornBuy  : (existing.kospi_foreigner_buy  || []),
      kospi_foreigner_sell: fornSell.length ? fornSell : (existing.kospi_foreigner_sell || []),
      kospi_institute_buy:  instBuy.length  ? instBuy  : (existing.kospi_institute_buy  || []),
      kospi_institute_sell: instSell.length ? instSell : (existing.kospi_institute_sell || []),
      // 하위 호환 유지
      kospi_foreigner: fornBuy.length ? fornBuy : (existing.kospi_foreigner || []),
      kospi_institute: instBuy.length ? instBuy : (existing.kospi_institute || []),
      kospi:  fornBuy.length ? fornBuy : (existing.kospi || []),
      kosdaq: [],
    };

    fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');
    console.log('\n외국인 순매수:', fornBuy.length, '개');
    console.log('외국인 순매도:', fornSell.length, '개');
    console.log('기관 순매수:', instBuy.length, '개');
    console.log('기관 순매도:', instSell.length, '개');
    console.log('krx-netbuy.json 저장 완료');

  } catch (err) {
    console.error('오류:', err.message);
    // Save partial data if we have existing
    if (Object.keys(existing).length) {
      console.log('기존 데이터 유지');
    } else {
      process.exit(1);
    }
  }
}

main();
