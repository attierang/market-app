#!/usr/bin/env python3
# KOSPI 시장 전체 외국인+기관 일별 순매수 수집 (네이버 금융)
# 소스: finance.naver.com/sise/investorDealTrendDay.naver?bizdate=YYYYMMDD&sosok=
# 출력: market-app/data/major-flow.json (days 배열 업데이트)

import requests, json, os, re, sys
from datetime import datetime, timedelta, date
from calendar import monthrange

BASE = 'https://finance.naver.com'
DAY_URL = BASE + '/sise/investorDealTrendDay.naver'

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer':    BASE + '/sise/sise_trans_style.naver',
    'Accept':     'text/html,*/*',
    'Accept-Language': 'ko-KR,ko;q=0.9',
})


def fetch_daily(bizdate_str):
    """
    bizdate_str: 'YYYYMMDD'
    반환: [{'date': 'MM-DD', 'year': int, 'foreign': int, 'institution': int, 'total': int}]
    네이버는 한 요청에 최근 10 거래일을 반환한다.
    """
    SESSION.get(BASE + '/', timeout=10)
    r = SESSION.get(DAY_URL, params={'bizdate': bizdate_str, 'sosok': ''}, timeout=15)
    if not r.ok:
        raise Exception(f'HTTP {r.status_code}')
    content = r.content.decode('euc-kr', errors='replace')

    rows = re.findall(
        r'<td class="date2">(\d{2})\.(\d{2})\.(\d{2})</td>\s*'
        r'<td[^>]*>([-\d,]+)</td>\s*'  # 개인
        r'<td[^>]*>([-\d,]+)</td>\s*'  # 외국인
        r'<td[^>]*>([-\d,]+)</td>',    # 기관계
        content
    )

    result = []
    for yy, mm, dd, _, foreign_str, inst_str in rows:
        year = int('20' + yy)
        f = int(foreign_str.replace(',', ''))
        i = int(inst_str.replace(',', ''))
        result.append({
            'date': f'{mm}-{dd}',
            'year': year,
            'foreign': f,
            'institution': i,
            'total': f + i,
        })
    return result


def prev_weekday(d):
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def get_bizdates_for_month(year, month):
    """한 달의 전체 거래일을 커버하기 위해 월중순 + 월말 두 기준일 반환"""
    # 15일 근처
    mid = prev_weekday(date(year, month, 15))
    # 말일
    last_day_num = monthrange(year, month)[1]
    end = prev_weekday(date(year, month, last_day_num))
    return [mid.strftime('%Y%m%d'), end.strftime('%Y%m%d')]


def collect_months(months_back=3):
    today = date.today()
    all_days = {}  # 'YYYY-MM' → {'MM-DD': entry}

    months = []
    for m in range(months_back + 1):
        year = today.year
        month = today.month - m
        while month <= 0:
            month += 12
            year -= 1
        months.append((year, month))

    for year, month in months:
        mkey = f'{year}-{month:02d}'
        bizdates = get_bizdates_for_month(year, month)
        print(f'\n[{mkey}] 기준일: {bizdates}')

        for bizdate in bizdates:
            # 미래 날짜는 스킵
            if int(bizdate) > int(today.strftime('%Y%m%d')):
                continue
            try:
                days = fetch_daily(bizdate)
                for entry in days:
                    if entry['year'] == year and entry['date'][:2] == f'{month:02d}':
                        if mkey not in all_days:
                            all_days[mkey] = {}
                        all_days[mkey][entry['date']] = {
                            'date': entry['date'],
                            'foreign': entry['foreign'],
                            'institution': entry['institution'],
                            'total': entry['total'],
                        }
            except Exception as e:
                print(f'  오류 ({bizdate}): {e}')

        count = len(all_days.get(mkey, {}))
        print(f'  → {count}거래일 수집')

    return all_days


def make_period_str(year, month, day_keys):
    if not day_keys:
        return f'{year}-{month:02d}-01 ~ {year}-{month:02d}-{monthrange(year, month)[1]:02d}'
    sorted_days = sorted(day_keys)
    first = f'{year}-{sorted_days[0]}'
    last  = f'{year}-{sorted_days[-1]}'
    return f'{first} ~ {last}'


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir   = os.path.join(script_dir, '../data')
    out_file   = os.path.join(data_dir, 'major-flow.json')

    with open(out_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    rows_by_month = {row['month']: row for row in data['rows']}

    all_days = collect_months(months_back=3)

    updated = 0
    for mkey, day_dict in all_days.items():
        year  = int(mkey[:4])
        month = int(mkey[5:7])

        # rows에 없으면 신규 생성
        if mkey not in rows_by_month:
            rows_by_month[mkey] = {
                'month': mkey,
                'period': '',
                'chg': 0.0,
                'foreign': 0,
                'institution': 0,
                'total': 0,
                'cumulative': 0,
                'water_level': 0.0,
            }
            print(f'  {mkey}: 신규 row 생성')

        row = rows_by_month[mkey]
        sorted_days = sorted(day_dict.values(), key=lambda x: x['date'])
        row['days'] = sorted_days

        # 합계 재계산
        total_foreign = sum(d['foreign'] for d in sorted_days)
        total_inst    = sum(d['institution'] for d in sorted_days)
        row['foreign']     = total_foreign
        row['institution'] = total_inst
        row['total']       = total_foreign + total_inst

        # period 갱신
        day_keys = [d['date'] for d in sorted_days]
        row['period'] = make_period_str(year, month, day_keys)

        print(f'  {mkey}: {len(sorted_days)}거래일 → 외국인 {total_foreign:,}, 기관 {total_inst:,}, 합 {row["total"]:,}')
        updated += 1

    # 날짜순 정렬 유지
    data['updated_at'] = date.today().strftime('%Y-%m-%d')
    data['rows'] = sorted(rows_by_month.values(), key=lambda r: r['month'])

    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f'\n✅ major-flow.json 저장 완료 ({updated}개 월 업데이트)')


if __name__ == '__main__':
    main()
