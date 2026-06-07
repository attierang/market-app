#!/usr/bin/env python3
# 종목별 외국인/기관 순매수 상위 수집 (네이버 금융)
# KRX data.krx.co.kr은 2025년부터 로그인 필수로 변경됨 → 네이버 금융 대체
#
# 소스: finance.naver.com/sise/sise_deal_rank.naver
#   investor_gubun=9000 → 외국인 순매수 KOSPI 상위
#   investor_gubun=1000 → 기관 순매수 KOSPI 상위
# 출력: market-app/data/krx-netbuy.json

import requests, json, os, re, sys
from datetime import datetime, timedelta

BASE  = 'https://finance.naver.com'
RANK_URL = BASE + '/sise/sise_deal_rank.naver'

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer':    BASE + '/sise/',
    'Accept':     'text/html,application/xhtml+xml,*/*',
    'Accept-Language': 'ko-KR,ko;q=0.9',
})


def get_recent_trading_date():
    d = datetime.utcnow()
    if d.hour < 7:
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.strftime('%Y%m%d')


def fetch_rank(investor_gubun, top_n=20):
    """
    investor_gubun: '9000' = 외국인, '1000' = 기관
    반환: [{rank, name, code, price, direction}, ...]
    """
    r = SESSION.get(RANK_URL, params={'investor_gubun': investor_gubun, 'sosok': '0'}, timeout=15)
    if not r.ok:
        raise Exception(f'Naver 응답 오류: {r.status_code}')

    content = r.content.decode('euc-kr', errors='ignore')

    # 패턴: code=XXXXXX">종목명</a> ... class="number">가격 ... alt="up|down"
    rows = re.findall(
        r'code=(\d{6})[^>]*>([^<]+)</a>.*?class=["\']number["\']>([^<]+)</td>.*?alt="(up|down)',
        content, re.DOTALL
    )

    result = []
    seen = set()
    for code, name, price_str, ud in rows:
        if code in seen:
            continue
        seen.add(code)
        result.append({
            'rank':      len(result) + 1,
            'code':      code,
            'name':      name.strip(),
            'price':     price_str.strip(),
            'direction': ud,
        })
        if len(result) >= top_n:
            break

    return result


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir   = os.path.join(script_dir, '../data')
    out_file   = os.path.join(data_dir, 'krx-netbuy.json')
    os.makedirs(data_dir, exist_ok=True)

    date = get_recent_trading_date()
    print(f'네이버 금융 외국인/기관 순매수 상위 수집... (기준일: {date})')

    try:
        print('[ 외국인 KOSPI 순매수 상위 ]')
        forn_kospi = fetch_rank('9000', top_n=20)
        print(f'  수집: {len(forn_kospi)}개')
        for s in forn_kospi[:3]:
            print(f'  {s["rank"]}. {s["name"]} ({s["code"]}) 현재가 {s["price"]}')

        print('[ 기관 KOSPI 순매수 상위 ]')
        inst_kospi = fetch_rank('1000', top_n=20)
        print(f'  수집: {len(inst_kospi)}개')
        for s in inst_kospi[:3]:
            print(f'  {s["rank"]}. {s["name"]} ({s["code"]}) 현재가 {s["price"]}')

        if not forn_kospi and not inst_kospi:
            print('⚠️  데이터 없음 — 파싱 실패')
            sys.exit(1)

        output = {
            'updated_at': datetime.utcnow().isoformat() + 'Z',
            'date':       date,
            'source':     '네이버금융',
            'note':       '외국인/기관 순매수 순위 (현재가 표시, KOSPI만)',
            # KOSPI: 외국인/기관 별도 제공
            'kospi_foreigner': forn_kospi,
            'kospi_institute': inst_kospi,
            # KOSDAQ: 데이터 미제공 (Naver Finance 미지원)
            'kospi':  forn_kospi,   # 하위호환 (기존 필드 유지)
            'kosdaq': [],
        }

        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f'\n✅ krx-netbuy.json 저장 완료 (외국인 {len(forn_kospi)}개, 기관 {len(inst_kospi)}개)')

    except Exception as e:
        print(f'오류: {e}')
        import traceback; traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
