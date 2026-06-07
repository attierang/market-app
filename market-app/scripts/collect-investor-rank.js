// 외국인/기관 순매수·순매도 상위 수집
// 1차: KIS API /ranking/quote-balance (FHPST01720000)
// 2차 fallback: 네이버금융 사이드바 (순매수 상위7만 가능)

const fs   = require('fs');
const path = require('path');
const https = require('https');

const APP_KEY    = process.env.KIS_REAL_APP_KEY;
const APP_SECRET = process.env.KIS_REAL_APP_SECRET;
const KIS_BASE   = 'https://openapi.koreainvestment.com:9443';
const dataDir    = path.join(__dirname, '../data');
const TOKEN_FILE = path.join(dataDir, 'kis-real-token.json');

if (!APP_KEY || !APP_SECRET) {
  console.error('KIS_REAL_APP_KEY / KIS_REAL_APP_SECRET 없음');
  process.exit(1);
}

// ── 토큰 ──────────────────────────────────────────────
function loadCachedToken() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const c = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (Date.now() < (c.expires_at || 0) - 10 * 60 * 1000) return c.access_token;
    return null;
  } catch { return null; }
}

async function issueToken() {
  const res = await fetch(KIS_BASE + '/oauth2/tokenP', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET })
  });
  if (!res.ok) throw new Error('토큰 발급 실패: ' + res.status + ' / ' + await res.text());
  const d = await res.json();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({
    access_token: d.access_token,
    expires_at: Date.now() + (d.expires_in || 86400) * 1000
  }), 'utf8');
  console.log('KIS 토큰 발급 완료');
  return d.access_token;
}

async function getToken() { return loadCachedToken() || await issueToken(); }

// ── 최근 영업일 계산 ──────────────────────────────────
function recentTradingDate() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  // 장 마감 전(16시 이전)이면 전날 사용
  if (d.getUTCHours() < 7) d.setUTCDate(d.getUTCDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// ── KIS API: 순매수 상위 ──────────────────────────────
// FID_COND_SCR_DIV_CODE 시도값:
//   20171 = 외국인 순매수, 20172 = 기관합계, 20110 = 배당, etc.
// FID_BLNG_CLS_CODE: 0 = 순매수, 1 = 순매도
async function fetchRankKIS(token, scrCode, blngCode, label) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE:  scrCode,
    FID_INPUT_ISCD:         '0000',
    FID_DIV_CLS_CODE:       '0',
    FID_BLNG_CLS_CODE:      blngCode,
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
  console.log(`[${label}] rt_cd=${data.rt_cd} msg=${(data.msg1||'').slice(0,60)}`);

  if (data.rt_cd !== '0') {
    console.log(`[${label}] 오류 응답:`, JSON.stringify(data).slice(0, 500));
    return null; // null = API 오류
  }

  const rows = (data.output || []).slice(0, 20);
  if (!rows.length) {
    console.log(`[${label}] output 비어있음 (시장 마감 또는 파라미터 오류)`);
    return null;
  }

  console.log(`[${label}] ${rows.length}개 수집. 첫 행 키:`, Object.keys(rows[0]).join(', '));
  console.log(`[${label}] 첫 행 샘플:`, JSON.stringify(rows[0]).slice(0, 300));

  return rows.map((r, i) => ({
    rank:      i + 1,
    code:      r.mksc_shrn_iscd || r.stck_shrn_iscd || '',
    name:      r.hts_kor_isnm   || r.kor_isnm       || '',
    price:     r.stck_prpr      || r.last_prpr       || '0',
    direction: parseInt(r.prdy_vrss || '0') >= 0 ? 'up' : 'down',
  }));
}

// ── 네이버금융 fallback (순매수 상위7만, 서버렌더링 사이드바) ──
async function fetchNaverSidebar(investorGubun) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'finance.naver.com',
      path: `/sise/sise_deal_rank.naver?investor_gubun=${investorGubun}&sosok=0`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    };
    let body = Buffer.alloc(0);
    const req = https.request(options, (res) => {
      res.on('data', c => { body = Buffer.concat([body, c]); });
      res.on('end', () => {
        try {
          const html = body.toString('binary').replace(/[\x80-\xff]/g, c => String.fromCharCode(c.charCodeAt(0)));
          // Try EUC-KR decode via iconv replacement
          const text = body.toString('latin1');
          // Find stocks in the sidebar (class="company" links with number column)
          const pattern = /code=(\d{6})[^>]*>([^<]+)<\/a>.*?class=["']number["']>([^<]+)<\/td>.*?alt="(up|down)"/gs;
          const results = [];
          const seen = new Set();
          let m;
          while ((m = pattern.exec(text)) !== null) {
            if (seen.has(m[1])) continue;
            seen.add(m[1]);
            results.push({
              rank: results.length + 1,
              code: m[1],
              name: m[2].trim().replace(/&amp;/g,'&'),
              price: m[3].trim(),
              direction: m[4]
            });
            if (results.length >= 20) break;
          }
          resolve(results);
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// ── 메인 ──────────────────────────────────────────────
async function main() {
  const outFile = path.join(dataDir, 'krx-netbuy.json');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {}

  const trdDate = recentTradingDate();
  console.log('수집 기준일:', trdDate, '/ 현재:', new Date().toISOString());

  let fornBuy = null, fornSell = null, instBuy = null, instSell = null;

  try {
    const token = await getToken();

    console.log('\n=== KIS API 조회 ===');
    // FID_COND_SCR_DIV_CODE: 20171=외국인, 20172=기관합계
    fornBuy  = await fetchRankKIS(token, '20171', '0', '외국인 순매수');
    fornSell = await fetchRankKIS(token, '20171', '1', '외국인 순매도');
    instBuy  = await fetchRankKIS(token, '20172', '0', '기관 순매수');
    instSell = await fetchRankKIS(token, '20172', '1', '기관 순매도');

  } catch(err) {
    console.error('KIS API 오류:', err.message);
  }

  // KIS 실패 시 네이버 fallback (순매수 상위7만)
  if (!fornBuy || !fornBuy.length) {
    console.log('\n=== 네이버금융 fallback (외국인 순매수) ===');
    // 기관 페이지의 사이드바에 외국인 상위7이 서버렌더링됨
    const navForn = await fetchNaverSidebar('1000');
    console.log('네이버 외국인:', navForn.length, '개');
    if (navForn.length) fornBuy = navForn;
  }
  if (!instBuy || !instBuy.length) {
    console.log('\n=== 네이버금융 fallback (기관 순매수) ===');
    // 외국인 페이지의 사이드바에 기관 상위7이 서버렌더링됨
    const navInst = await fetchNaverSidebar('9000');
    console.log('네이버 기관:', navInst.length, '개');
    if (navInst.length) instBuy = navInst;
  }

  const now = new Date();
  const dateStr = trdDate;

  const output = {
    updated_at: now.toISOString(),
    date:       dateStr,
    source:     (fornBuy && fornBuy.length && !fornSell) ? '네이버금융' : 'KIS API',
    note:       '외국인/기관 순매수·순매도 상위20 (KOSPI)',
    kospi_foreigner_buy:  fornBuy  || existing.kospi_foreigner_buy  || [],
    kospi_foreigner_sell: fornSell || existing.kospi_foreigner_sell || [],
    kospi_institute_buy:  instBuy  || existing.kospi_institute_buy  || [],
    kospi_institute_sell: instSell || existing.kospi_institute_sell || [],
    // 하위 호환
    kospi_foreigner: fornBuy  || existing.kospi_foreigner || [],
    kospi_institute: instBuy  || existing.kospi_institute || [],
    kospi:  fornBuy  || existing.kospi  || [],
    kosdaq: [],
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');
  console.log('\n외국인 순매수:', output.kospi_foreigner_buy.length, '개');
  console.log('외국인 순매도:', output.kospi_foreigner_sell.length, '개');
  console.log('기관 순매수:', output.kospi_institute_buy.length, '개');
  console.log('기관 순매도:', output.kospi_institute_sell.length, '개');
  console.log('krx-netbuy.json 저장 완료');
}

main().catch(e => { console.error(e); process.exit(1); });
