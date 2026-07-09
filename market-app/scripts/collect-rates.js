const fs = require('fs');
const path = require('path');

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error('FRED_API_KEY 없음'); process.exit(1); }

const FRED = 'https://api.stlouisfed.org/fred/series/observations';

// 재시도 포함 fetch (최대 3회, 지수 백오프)
async function fetchWithRetry(url, retries) {
  retries = retries || 3;
  for (var i = 0; i < retries; i++) {
    try {
      var res = await fetch(url);
      if (res.ok) return res;
      if (res.status !== 500 && res.status !== 502 && res.status !== 503) {
        throw new Error('HTTP ' + res.status);
      }
      console.warn('FRED 일시 오류 (' + res.status + '), ' + (i + 1) + '/' + retries + '회 재시도...');
    } catch (e) {
      if (i === retries - 1) throw e;
      console.warn('네트워크 오류, 재시도: ' + e.message);
    }
    // 지수 백오프: 3초, 9초, 27초
    await new Promise(function(r) { setTimeout(r, 3000 * Math.pow(3, i)); });
  }
  throw new Error('FRED 요청 실패 (재시도 초과)');
}

// 최신 1개 반환
async function fetchFRED(series, limit) {
  limit = limit || 5;
  var url = FRED + '?series_id=' + series + '&api_key=' + KEY + '&sort_order=desc&limit=' + limit + '&file_type=json';
  var res = await fetchWithRetry(url);
  var d = await res.json();
  var obs = (d.observations || []).filter(function(o) { return o.value !== '.'; });
  return obs[0] || null;
}

// 여러 개 반환 (전일/전월 비교용)
async function fetchFREDMulti(series, limit) {
  limit = limit || 40;
  var url = FRED + '?series_id=' + series + '&api_key=' + KEY + '&sort_order=desc&limit=' + limit + '&file_type=json';
  var res = await fetchWithRetry(url);
  var d = await res.json();
  return (d.observations || []).filter(function(o) { return o.value !== '.'; });
}

async function main() {
  try {
    var dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    console.log('FRED API 금리 데이터 수집 중...');

    // 미국 국채 수익률 (다중 관측값 - 전일/전월 비교)
    var us10yObs  = await fetchFREDMulti('DGS10',  40);
    var us3yObs   = await fetchFREDMulti('DGS3',   40);
    var usRealObs = await fetchFREDMulti('DFII10', 40);  // 10년 TIPS 실질금리
    var us2y  = await fetchFRED('DGS2');
    var us5y  = await fetchFRED('DGS5');
    var us30y = await fetchFRED('DGS30');

    // Fed 정책금리
    var fedRate = await fetchFRED('DFF');
    var iorb    = await fetchFRED('IORB');

    // 일본 10년물 (월별 - 전월 비교)
    var jp10yObs = await fetchFREDMulti('IRLTLT01JPM156N', 5);

    // 환율 (FRED 일별)
    var usdkrw = await fetchFREDMulti('DEXKOUS', 5);  // KRW per USD
    var usdjpy = await fetchFREDMulti('DEXJPUS', 5);  // JPY per USD

    // 유동성 지표 (최신 + 전주 비교용 다중 조회)
    var onrrpObs    = await fetchFREDMulti('RRPONTSYD', 10);  // ON RRP 잔고 (십억달러)
    var repoObs     = await fetchFREDMulti('RPONTSYD',  10);  // 레포 거래량 (십억달러)
    var reservesObs = await fetchFREDMulti('WRESBAL',    5);  // 지급준비금 (백만달러)
    var walclObs    = await fetchFREDMulti('WALCL',      5);  // 연준 총자산 (백만달러)
    var wtregenObs  = await fetchFREDMulti('WTREGEN',    5);  // 재무부잔고 TGA (백만달러)
    var m2Obs       = await fetchFREDMulti('M2SL',       5);  // M2 통화량 (십억달러)

    // 미국 10년물 현재/전일/전월
    var us10yVal   = us10yObs.length > 0  ? parseFloat(us10yObs[0].value)  : 0;
    var us10yPrev1 = us10yObs.length > 1  ? parseFloat(us10yObs[1].value)  : us10yVal;
    var us10yPrev1m= us10yObs.length > 20 ? parseFloat(us10yObs[20].value) : us10yVal;
    var us10yChg1d = parseFloat((us10yVal - us10yPrev1).toFixed(3));
    var us10yChg1m = parseFloat((us10yVal - us10yPrev1m).toFixed(3));

    // 미국 실질금리 (10년 TIPS)
    var usRealVal   = usRealObs.length > 0  ? parseFloat(usRealObs[0].value)  : 0;
    var usRealPrev1 = usRealObs.length > 1  ? parseFloat(usRealObs[1].value)  : usRealVal;
    var usRealPrev1m= usRealObs.length > 20 ? parseFloat(usRealObs[20].value) : usRealVal;
    var usRealChg1d = parseFloat((usRealVal - usRealPrev1).toFixed(3));
    var usRealChg1m = parseFloat((usRealVal - usRealPrev1m).toFixed(3));

    // 미국 3년물 현재/전일/전월
    var us3yVal   = us3yObs.length > 0  ? parseFloat(us3yObs[0].value)  : 0;
    var us3yPrev1 = us3yObs.length > 1  ? parseFloat(us3yObs[1].value)  : us3yVal;
    var us3yPrev1m= us3yObs.length > 20 ? parseFloat(us3yObs[20].value) : us3yVal;
    var us3yChg1d = parseFloat((us3yVal - us3yPrev1).toFixed(3));
    var us3yChg1m = parseFloat((us3yVal - us3yPrev1m).toFixed(3));

    // 일본 10년물 현재/전월
    var jp10yVal   = jp10yObs.length > 0 ? parseFloat(jp10yObs[0].value) : 0;
    var jp10yPrev1m= jp10yObs.length > 1 ? parseFloat(jp10yObs[1].value) : jp10yVal;
    var jp10yChg1m = parseFloat((jp10yVal - jp10yPrev1m).toFixed(3));

    // 환율 계산
    var krwVal     = usdkrw.length > 0 ? parseFloat(usdkrw[0].value) : 0;
    var krwPrev    = usdkrw.length > 1 ? parseFloat(usdkrw[1].value) : krwVal;
    var krwChgPct  = krwPrev > 0 ? parseFloat(((krwVal - krwPrev) / krwPrev * 100).toFixed(2)) : 0;

    var jpyVal     = usdjpy.length > 0 ? parseFloat(usdjpy[0].value) : 0;
    var jpyPrev    = usdjpy.length > 1 ? parseFloat(usdjpy[1].value) : jpyVal;
    var jpyChgPct  = jpyPrev > 0 ? parseFloat(((jpyVal - jpyPrev) / jpyPrev * 100).toFixed(2)) : 0;
    // JPY/KRW 크로스 레이트 (1엔 = ?원)
    var jpyKrw     = jpyVal > 0 ? parseFloat((krwVal / jpyVal).toFixed(2)) : 0;

    var us2yVal   = parseFloat(us2y   ? us2y.value   : 0);
    var us5yVal   = parseFloat(us5y   ? us5y.value   : 0);
    var us30yVal  = parseFloat(us30y  ? us30y.value  : 0);
    var fedVal    = parseFloat(fedRate ? fedRate.value : 0);
    var iorbVal   = parseFloat(iorb   ? iorb.value   : 0);
    // 최신값 + 전주값 추출
    var onrrpVal     = onrrpObs.length > 0    ? parseFloat(onrrpObs[0].value)    : 0;  // 십억달러
    var onrrpPrev    = onrrpObs.length > 5    ? parseFloat(onrrpObs[5].value)    : onrrpVal;
    var rpontsydVal  = repoObs.length  > 0    ? parseFloat(repoObs[0].value)     : 0;  // 십억달러
    var rpontsydPrev = repoObs.length  > 5    ? parseFloat(repoObs[5].value)     : rpontsydVal;
    var resVal       = reservesObs.length > 0 ? parseFloat(reservesObs[0].value) / 1000 : 0;  // 백만→십억
    var resPrev      = reservesObs.length > 1 ? parseFloat(reservesObs[1].value) / 1000 : resVal;
    var walclVal     = walclObs.length > 0    ? parseFloat(walclObs[0].value)    : 0;  // 백만달러
    var walclPrev    = walclObs.length > 1    ? parseFloat(walclObs[1].value)    : walclVal;
    var wtregenVal   = wtregenObs.length > 0  ? parseFloat(wtregenObs[0].value)  : 0;  // 백만달러
    var wtregenPrev  = wtregenObs.length > 1  ? parseFloat(wtregenObs[1].value)  : wtregenVal;
    var m2Val        = m2Obs.length > 0       ? parseFloat(m2Obs[0].value)       : 0;  // 십억달러
    var m2Prev       = m2Obs.length > 1       ? parseFloat(m2Obs[1].value)       : m2Val;

    var spread_us_jp = parseFloat((us10yVal - jp10yVal).toFixed(2));
    var spread_2y10y = parseFloat((us10yVal - us2yVal).toFixed(2));

    // 기준금리 범위 (DFF 기준으로 하한/상한 계산: 상단 = DFF + 0.25)
    var fedLo = parseFloat((fedVal - 0.125).toFixed(2));
    var fedHi = parseFloat((fedVal + 0.125).toFixed(2));
    var fedRange = fedLo.toFixed(2) + '~' + fedHi.toFixed(2) + '%';

    var date = us10yObs.length > 0 ? us10yObs[0].date : new Date().toISOString().slice(0, 10);

    var output = {
      updated_at: new Date().toISOString(),
      date: date,
      us2y:  us2yVal,
      us3y:  us3yVal,
      us3y_chg_1d: us3yChg1d,
      us3y_chg_1m: us3yChg1m,
      us_real: usRealVal,
      us_real_chg_1d: usRealChg1d,
      us_real_chg_1m: usRealChg1m,
      us5y:  us5yVal,
      us10y: us10yVal,
      us30y: us30yVal,
      jp10y: jp10yVal,
      jp10y_chg_1m: jp10yChg1m,
      jp10y_date: jp10yObs.length > 0 ? jp10yObs[0].date : '',
      us10y_chg_1d: us10yChg1d,
      us10y_chg_1m: us10yChg1m,
      usdkrw: krwVal,
      usdkrw_chg_pct: krwChgPct,
      usdjpy: jpyVal,
      usdjpy_chg_pct: jpyChgPct,
      jpykrw: jpyKrw,
      fed_rate: fedVal,
      fed_range: fedRange,
      iorb: iorbVal,
      onrrp_rate: parseFloat((fedVal - 0.25).toFixed(2)),
      onrrp_balance: onrrpVal,      // 십억달러
      onrrp_prev: onrrpPrev,        // 십억달러 (5영업일 전)
      rpontsyd: rpontsydVal,        // 십억달러
      rpontsyd_prev: rpontsydPrev,  // 십억달러 (5영업일 전)
      reserves: resVal,             // 십억달러
      reserves_prev: resPrev,       // 십억달러 (전주)
      walcl: walclVal,              // 백만달러
      walcl_prev: walclPrev,        // 백만달러 (전주)
      wtregen: wtregenVal,          // 백만달러
      wtregen_prev: wtregenPrev,    // 백만달러 (전주)
      m2: m2Val,                    // 십억달러
      m2_prev: m2Prev,              // 십억달러 (전월)
      spread_us_jp: spread_us_jp,
      spread_2y10y: spread_2y10y
    };

    fs.writeFileSync(
      path.join(dataDir, 'rates.json'),
      JSON.stringify(output, null, 2),
      'utf8'
    );

    console.log('미국 10년물: ' + us10yVal + '%');
    console.log('미국 2년물:  ' + us2yVal + '%');
    console.log('일본 10년물: ' + jp10yVal + '%');
    console.log('Fed 금리:    ' + fedRange);
    console.log('2Y-10Y 스프레드: ' + (spread_2y10y >= 0 ? '+' : '') + spread_2y10y + '%');
    console.log('미·일 금리차: ' + (spread_us_jp >= 0 ? '+' : '') + spread_us_jp + '%');
    console.log('✅ rates.json 저장 완료!');

  } catch (err) {
    console.error('오류:', err.message);
    process.exit(1);
  }
}

main();
