// DART 국민연금 공시 자동 수집 스크립트
// GitHub Actions에서 매일 실행

const fs = require('fs');
const path = require('path');

const KEY = process.env.DART_API_KEY;
const OUTPUT_DIR = path.join(__dirname, '../data');

if (!KEY) {
  console.error('DART_API_KEY 환경변수가 없습니다');
  process.exit(1);
}

// 날짜 범위 계산
function getDateRange(days) {
  const today = new Date();
  const end = today.toISOString().slice(0,10).replace(/-/g,'');
  const start = new Date(today.getTime() - days * 864e5).toISOString().slice(0,10).replace(/-/g,'');
  return { start, end };
}

// DART API 호출
async function dartFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// 전체 공시 목록에서 국민연금 필터링
async function collectMajorStock() {
  const { start, end } = getDateRange(90);
  const results = [];
  let page = 1;
  let totalPage = 1;

  console.log('대량보유 공시 수집 시작...');

  while (page <= totalPage && page <= 20) {
    const url = `https://opendart.fss.or.kr/api/list.json?bgn_de=${start}&end_de=${end}&pblntf_ty=D&page_no=${page}&page_count=100&crtfc_key=${KEY}`;
    const data = await dartFetch(url);

    if (data.status !== '000') {
      console.log('오류:', data.message);
      break;
    }

    totalPage = data.total_page;
    const list = data.list || [];

    // 국민연금이 제출한 대량보유 공시 필터링
    const npsItems = list.filter(item =>
      item.flr_nm && (
        item.flr_nm.includes('국민연금') ||
        item.flr_nm.includes('NPS')
      ) &&
      item.report_nm && (
        item.report_nm.includes('대량보유') ||
        item.report_nm.includes('주요주주')
      )
    );

    results.push(...npsItems);
    console.log(`페이지 ${page}/${totalPage} 완료, 국민연금 공시 ${npsItems.length}건`);
    page++;

    // API 부하 방지
    await new Promise(r => setTimeout(r, 300));
  }

  return results;
}

// 공시 상세 정보 수집
async function getReportDetail(rcept_no) {
  try {
    const url = `https://opendart.fss.or.kr/api/majorstock.json?rcept_no=${rcept_no}&crtfc_key=${KEY}`;
    const data = await dartFetch(url);
    if (data.status === '000' && data.list && data.list.length > 0) {
      return data.list[0];
    }
  } catch(e) {
    console.log('상세 조회 실패:', rcept_no);
  }
  return null;
}

async function main() {
  try {
    // 출력 디렉토리 생성
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // 공시 목록 수집
    const majorList = await collectMajorStock();
    console.log(`총 ${majorList.length}건의 국민연금 공시 발견`);

    // 상세 정보 수집
    const detailed = [];
    for (const item of majorList.slice(0, 50)) { // 최대 50건
      const detail = await getReportDetail(item.rcept_no);
      detailed.push({
        corp_name: item.corp_name,
        stock_code: item.stock_code,
        report_nm: item.report_nm,
        rcept_dt: item.rcept_dt,
        rcept_no: item.rcept_no,
        flr_nm: item.flr_nm,
        detail: detail
      });
      await new Promise(r => setTimeout(r, 200));
    }

    // 결과 저장
    const output = {
      updated_at: new Date().toISOString(),
      count: detailed.length,
      data: detailed
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'nps-major.json'),
      JSON.stringify(output, null, 2),
      'utf8'
    );

    console.log(`✅ 완료! ${detailed.length}건 저장됨`);
    console.log('저장 위치: market-app/data/nps-major.json');

  } catch(err) {
    console.error('수집 실패:', err.message);
    process.exit(1);
  }
}

main();
