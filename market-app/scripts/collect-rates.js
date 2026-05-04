const fs = require('fs');
const path = require('path');

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error('FRED_API_KEY 없음'); process.exit(1); }

const FRED = 'https://api.stlouisfed.org/fred/series/observations';

// 최신 1개 반환
async function fetchFRED(series, limit) {
  limit = limit || 5;
  var url = FRED + '?series_id=' + series + '&api_key=' + KEY + '&sort_order=desc&limit=' + limit + '&file_type=json';
  var res = await fetch(url);
  if (!res.ok) throw new Error('FRED 오류 ' + series + ': ' + res.status);
  var d = await res.json();
  var obs = (d.observations || []).filter(function(o) { return o.value !== '.'; });
  return obs[0] || null;
}

// 여러 개 반환 (전일/전월 비교용)
async function fetchFREDMulti(series, limit) {
  limit = limit || 40;
  var url = FRED + '?series_id=' + series + '&api_key=' + KEY + '&sort_order=desc&limit=' + limit + '&file_type=json';
  var res = await fetch(url);
  if (!res.ok) throw new Error('FRED 오류 ' + series + ': ' + res.status);
  var d = await res.json();
  return (d.observations || []).filter(function(o) { return o.value !== '.'; });
}

async function main() {
  try {
    var dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    console.log('FRED API 금리 데이터 수집 중...');

    // 미국 국채 수익률 (다중 관측값 - 전일/전월 비교)
    var us10yObs = await fetchFREDMulti('DGS10', 40);
    var us2y  = await fetchFRED('DGS2');
    var us3y  = await fetchFRED('DGS3');
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

    // 유동성 지표
    var onrrp    = await fetchFRED('RRPONTSYD');   // ON RRP 잔고 (십억달러)
    var rpontsyd = await fetchFRED('RPONTSYD');    // 레포 거래량 (십억달러)
    var reserves = await fetchFRED('WRESBAL');      // 지급준비금 (십억달러)
    var walcl    = await fetchFRED('WALCL');        // 연준 총자산 (백만달러)
    var wtregen  = await fetchFRED('WTREGEN');      // 재무부잔고 TGA (백만달러)
    var m2       = await fetchFRED('M2SL');         // M2 통화량 (십억달러)

    // 미국 10년물 현재/전일/전월
    var us10yVal   = us10yObs.length > 0  ? parseFloat(us10yObs[0].value)  : 0;
    var us10yPrev1 = us10yObs.length > 1  ? parseFloat(us10yObs[1].value)  : us10yVal;
    var us10yPrev1m= us10yObs.length > 20 ? parseFloat(us10yObs[20].value) : us10yVal;
    var us10yChg1d = parseFloat((us10yVal - us10yPrev1).toFixed(3));
    var us10yChg1m = parseFloat((us10yVal - us10yPrev1m).toFixed(3));

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
    var us3yVal   = parseFloat(us3y   ? us3y.value   : 0);
    var us5yVal   = parseFloat(us5y   ? us5y.value   : 0);
    var us30yVal  = parseFloat(us30y  ? us30y.value  : 0);
    var fedVal    = parseFloat(fedRate ? fedRate.value : 0);
    var iorbVal   = parseFloat(iorb   ? iorb.value   : 0);
    var onrrpVal    = parseFloat(onrrp    ? onrrp.value    : 0);   // 십억달러
    var rpontsydVal = parseFloat(rpontsyd ? rpontsyd.value : 0);  // 십억달러
    var resVal     = parseFloat(reserves ? reserves.value : 0) / 1000;  // 백만달러 → 십억달러
    var walclVal   = parseFloat(walcl    ? walcl.value    : 0);   // 백만달러 → /1e6 → 조
    var wtregenVal = parseFloat(wtregen  ? wtregen.value  : 0);   // 백만달러
    var m2Val      = parseFloat(m2       ? m2.value       : 0);   // 십억달러

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
      rpontsyd: rpontsydVal,        // 십억달러
      reserves: resVal,             // 십억달러
      walcl: walclVal,              // 백만달러
      wtregen: wtregenVal,          // 백만달러
      m2: m2Val,                    // 십억달러
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
