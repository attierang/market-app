const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600, stale-while-revalidate=1800'
};

function getDateRange(days) {
  const today = new Date();
  const end = today.toISOString().slice(0,10).replace(/-/g,'');
  const start = new Date(today.getTime() - days * 864e5).toISOString().slice(0,10).replace(/-/g,'');
  return { start, end };
}

async function fetchList(page, start, end, KEY) {
  const url = `https://opendart.fss.or.kr/api/list.json?bgn_de=${start}&end_de=${end}&pblntf_ty=C&page_no=${page}&page_count=40&crtfc_key=${KEY}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  return r.json();
}

async function fetchMajorDetail(rcept_no, KEY) {
  try {
    const url = `https://opendart.fss.or.kr/api/majorstock.json?rcept_no=${rcept_no}&crtfc_key=${KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d.status === '000' && d.list && d.list.length > 0) return d.list[0];
  } catch(e) {}
  return null;
}

async function fetchEleDetail(rcept_no, KEY) {
  try {
    const url = `https://opendart.fss.or.kr/api/elestock.json?rcept_no=${rcept_no}&crtfc_key=${KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d.status === '000' && d.list && d.list.length > 0) return d.list[0];
  } catch(e) {}
  return null;
}

export default async function handler(req) {
  const u = new URL(req.url);
  const type = u.searchParams.get('type') || 'major';
  const KEY = process.env.DART_API_KEY;

  if (!KEY) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'DART_API_KEY가 Vercel 환경변수에 설정되지 않았습니다'
    }), { status: 500, headers: CORS });
  }

  try {
    const { start, end } = getDateRange(90);
    const filings = [];
    let page = 1;
    let totalPage = 1;

    while (page <= totalPage && page <= 5) {
      const data = await fetchList(page, start, end, KEY);
      if (data.status !== '000') break;
      totalPage = data.total_page || 1;

      const npsFiled = (data.list || []).filter(i =>
        i.flr_nm && (i.flr_nm.includes('국민연금') || i.flr_nm.includes('국민연금공단'))
      );

      npsFiled.forEach(item => {
        const rpt = item.report_nm || '';
        if (type === 'major' && rpt.includes('대량보유')) {
          filings.push(item);
        } else if (type === 'ele' && (rpt.includes('주요주주') || rpt.includes('임원·주요주주'))) {
          filings.push(item);
        }
      });

      page++;
    }

    const targets = filings.slice(0, 30);
    const detailPromises = targets.map(item =>
      type === 'major'
        ? fetchMajorDetail(item.rcept_no, KEY)
        : fetchEleDetail(item.rcept_no, KEY)
    );
    const details = await Promise.all(detailPromises);

    const data = targets.map((item, i) => {
      const detail = details[i];
      let ratio = 0, changeRatio = 0, stockCount = 0;

      if (detail) {
        if (type === 'major') {
          ratio       = parseFloat(detail.stkrt || detail.pssesn_ratio || '0');
          changeRatio = parseFloat(detail.stkrt_irds || detail.pssesn_ratio_change || '0');
          stockCount  = parseInt((detail.stkqy_irds || detail.posestn_stock_co_change || '0').replace(/,/g,'')) || 0;
        } else {
          ratio       = parseFloat(detail.sp_stock_lmp_rate || detail.pssesn_ratio || '0');
          changeRatio = parseFloat(detail.sp_stock_lmp_irds_rate || detail.pssesn_ratio_change || '0');
          stockCount  = parseInt((detail.sp_stock_lmp_irds_cnt || detail.posestn_stock_co_change || '0').replace(/,/g,'')) || 0;
        }
      }

      return {
        name:        item.corp_name || '',
        stockCode:   item.stock_code || '',
        reportName:  item.report_nm || '',
        reportDate:  item.rcept_dt || '',
        ratio,
        changeRatio,
        stockCount,
        type:        changeRatio >= 0 ? 'buy' : 'sell'
      };
    });

    return new Response(JSON.stringify({
      ok: true,
      type,
      updatedAt: new Date().toISOString(),
      count: data.length,
      data
    }), { headers: CORS });

  } catch(err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: CORS
    });
  }
}
