#!/usr/bin/env python3
# KRX 비차익 프로그램 매매 현황 수집
# KIS API 없이 KRX 공개 데이터 직접 조회 → 토큰 발급 0회, 알람 0회

import requests, json, os, sys, time
from datetime import datetime, timedelta

BASE_URL = 'https://data.krx.co.kr'
POST_URL = BASE_URL + '/comm/bldAttendant/getJsonData.cmd'

session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Origin':  BASE_URL,
    'X-Requested-With': 'XMLHttpRequest',
})

def get_session():
    """KRX 세션 쿠키 획득 - 메인 페이지 → 해당 메뉴 순서로 방문"""
    # 1단계: 메인 페이지 방문
    session.headers.update({'Referer': BASE_URL + '/'})
    session.get(BASE_URL + '/', timeout=10)
    time.sleep(0.5)

    # 2단계: 프로그램 매매 메뉴 방문
    menu_url = BASE_URL + '/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC020205'
    session.headers.update({'Referer': BASE_URL + '/'})
    session.get(menu_url, timeout=10)
    time.sleep(0.5)

    # 이후 요청에 사용할 Referer 설정
    session.headers.update({'Referer': menu_url})

def get_recent_trading_date():
    """가장 최근 영업일 반환 (주말 제외)"""
    d = datetime.utcnow()
    # 장 마감 전(15:30 KST = 06:30 UTC)이면 전날 사용
    if d.hour < 7:
        d -= timedelta(days=1)
    while d.weekday() >= 5:  # 토(5), 일(6)
        d -= timedelta(days=1)
    return d.strftime('%Y%m%d')

def fetch_program_trading(trd_dd):
    """KRX 프로그램매매 현황 조회 (bld: MDCSTAT03502)"""
    res = session.post(
        POST_URL,
        data={
            'bld':          'dbms/MDC/STAT/standard/MDCSTAT03502',
            'locale':       'ko_KR',
            'trdDd':        trd_dd,
            'share':        '1',
            'money':        '1',
            'csvxls_isNo':  'false',
        },
        timeout=15
    )
    text = res.text.strip()
    if not res.ok or text in ('LOGOUT', ''):
        raise Exception(f'KRX 응답 오류: {res.status_code} / {text[:100]}')
    return res.json()

def parse_market(data, market_name):
    """output 배열에서 비차익 항목 추출"""
    rows = data.get('output', [])
    for row in rows:
        nm = row.get('SECT_TP_NM', '') or row.get('mktNm', '')
        if market_name in nm:
            buy  = int((row.get('NABT_SHNU_TR_PBMN') or row.get('nAbtShnuTrPbmn') or '0').replace(',',''))
            sell = int((row.get('NABT_SELN_TR_PBMN') or row.get('nAbtSelnTrPbmn') or '0').replace(',',''))
            net  = int((row.get('NABT_NTBY_TR_PBMN') or row.get('nAbtNtbyTrPbmn') or '0').replace(',',''))
            return {'buyAmt': buy, 'sellAmt': sell, 'netAmt': net}
    # 필드 구조 확인용 (첫 행 키 출력)
    if rows:
        print('KRX 응답 키:', list(rows[0].keys())[:15])
        print('KRX 응답 샘플:', json.dumps(rows[0], ensure_ascii=False)[:200])
    return None

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir   = os.path.join(script_dir, '../data')
    out_file   = os.path.join(data_dir, 'program-trading.json')
    os.makedirs(data_dir, exist_ok=True)

    trd_dd = get_recent_trading_date()
    print(f'KRX 비차익 프로그램 매매 수집 중... (기준일: {trd_dd})')

    try:
        get_session()
        data = fetch_program_trading(trd_dd)

        print('KRX 응답 샘플:', json.dumps(data.get('output', [{}])[0], ensure_ascii=False)[:200])

        kospi  = parse_market(data, '코스피') or parse_market(data, 'KOSPI')
        kosdaq = parse_market(data, '코스닥') or parse_market(data, 'KOSDAQ')

        if not kospi and not kosdaq:
            print('파싱 실패: 필드명 확인 필요')
            print(json.dumps(data.get('output', [])[:2], ensure_ascii=False, indent=2))
            sys.exit(1)

        output = {
            'updated_at': datetime.utcnow().isoformat() + 'Z',
            'date':       trd_dd,
            'kospi':  {'market': 'KOSPI',  **(kospi  or {'buyAmt':0,'sellAmt':0,'netAmt':0})},
            'kosdaq': {'market': 'KOSDAQ', **(kosdaq or {'buyAmt':0,'sellAmt':0,'netAmt':0})},
        }

        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"KOSPI  비차익 순매수: {(output['kospi']['netAmt']  / 100):,.0f}억원")
        print(f"KOSDAQ 비차익 순매수: {(output['kosdaq']['netAmt'] / 100):,.0f}억원")
        print('✅ program-trading.json 저장 완료')

    except Exception as e:
        print(f'오류: {e}')
        sys.exit(1)

if __name__ == '__main__':
    main()
