"""Reproducible 2021–2025 Seoul jeonse analysis and Plotly HTML exports.

Run download_data.py first. Public outputs contain aggregates, never addresses.
"""
from pathlib import Path
import io
import json
import hashlib
import zipfile
from datetime import datetime, timezone
import pandas as pd
import plotly
import plotly.express as px
from plotly.offline import get_plotlyjs

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
YEARS = list(range(2021, 2026))
TYPES = ["아파트", "연립다세대", "단독다가구", "오피스텔"]
DISTRICTS = ["강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"]
NUMERIC = ["본번", "부번", "층", "임대면적", "보증금(만원)", "임대료(만원)", "건축년도", "종전보증금", "종전임대료"]


def load_transactions():
    """Chunk input; remove exact normalized cross-file copies, preserve same-file rows.

    No transaction ID exists. Identical rows within one source can be distinct
    contracts; therefore no within-file deduplication or arbitrary outlier trim.
    """
    seen, frames, audit = set(), [], []
    provenance = json.loads((ROOT / "data/sources.json").read_text(encoding="utf-8"))
    for item in provenance["files"]:
        path = ROOT / "data/raw" / item["file"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"], f"Source checksum mismatch: {path.name}"
        counts = dict(file=path.name, rows=0, cross_file_duplicates=0, not_jeonse=0, invalid_date_or_outside_period=0, invalid_price_or_area=0, invalid_district_or_type=0, included=0)
        current_hashes = set()
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith((".csv", ".txt"))]
            assert len(names) == 1
            with archive.open(names[0]) as sample:
                head = sample.read(4096)
            encoding = "utf-8-sig" if head.startswith(b"\xef\xbb\xbf") else "cp949"
            with archive.open(names[0]) as source:
                for raw in pd.read_csv(source, encoding=encoding, dtype=str, keep_default_na=False, chunksize=100000):
                    raw.columns = raw.columns.str.strip()
                    raw = raw.apply(lambda col: col.str.strip())
                    counts["rows"] += len(raw)
                    normalized = raw.copy()
                    for col in NUMERIC:
                        if col in normalized:
                            normalized[col] = pd.to_numeric(normalized[col].str.replace(",", "", regex=False), errors="coerce").astype("float64")
                    hashes = pd.util.hash_pandas_object(normalized.reindex(sorted(normalized.columns), axis=1), index=False)
                    duplicate = hashes.isin(seen)
                    current_hashes.update(hashes.tolist())
                    counts["cross_file_duplicates"] += int(duplicate.sum())
                    df = raw.loc[~duplicate].copy()
                    mask = df["전월세구분"].eq("전세")
                    counts["not_jeonse"] += int((~mask).sum())
                    df = df.loc[mask].copy()
                    day = pd.to_datetime(df["계약일"], format="%Y%m%d", errors="coerce")
                    mask = day.between("2021-01-01", "2025-12-31")
                    counts["invalid_date_or_outside_period"] += int((~mask).sum())
                    df, day = df.loc[mask].copy(), day.loc[mask]
                    df["year"] = day.dt.year
                    df["month"] = day.dt.strftime("%Y-%m")
                    for src, dst in [("보증금(만원)", "deposit"), ("임대면적", "area"), ("임대료(만원)", "rent")]:
                        df[dst] = pd.to_numeric(df[src].str.replace(",", "", regex=False), errors="coerce")
                    mask = df["deposit"].gt(0) & df["area"].gt(0) & df["rent"].eq(0)
                    counts["invalid_price_or_area"] += int((~mask).sum())
                    df = df.loc[mask].copy()
                    mask = df["자치구명"].isin(DISTRICTS) & df["건물용도"].isin(TYPES)
                    counts["invalid_district_or_type"] += int((~mask).sum())
                    df = df.loc[mask].copy()
                    df["per_m2"] = df["deposit"] / df["area"]
                    df = df.rename(columns={"자치구명": "district", "건물용도": "type"})
                    frames.append(df[["year", "month", "district", "type", "deposit", "area", "per_m2"]])
                    counts["included"] += len(df)
        seen.update(current_hashes)
        assert counts["rows"] == sum(v for k, v in counts.items() if k not in ("file", "rows"))
        audit.append(counts)
        print(json.dumps(counts, ensure_ascii=False), flush=True)
    return pd.concat(frames, ignore_index=True), audit, provenance


def aggregate(df, time_key):
    """Calculate each median from individual contracts, not subgroup medians."""
    results = []
    for region in ["서울 전체"] + DISTRICTS:
        regional = df if region == "서울 전체" else df[df.district == region]
        for usage in ["전체 유형"] + TYPES:
            subset = regional if usage == "전체 유형" else regional[regional.type == usage]
            grouped = subset.groupby(time_key).agg(
                n=("deposit", "size"), median_m2=("per_m2", "median"), mean_m2=("per_m2", "mean"),
                median_deposit=("deposit", "median"), mean_deposit=("deposit", "mean"),
                q25_m2=("per_m2", lambda s: s.quantile(.25)), q75_m2=("per_m2", lambda s: s.quantile(.75)),
            ).reset_index()
            grouped["district"], grouped["type"] = region, usage
            results.append(grouped)
    return pd.concat(results, ignore_index=True).round(4)


def findings(yearly, monthly):
    city = yearly[(yearly.district == "서울 전체") & (yearly.type == "전체 유형")].set_index("year")
    base, end = city.loc[2021], city.loc[2025]
    change = (end.median_m2 / base.median_m2 - 1) * 100
    annual_changes = city.median_m2.pct_change().dropna() * 100
    districts = yearly[(yearly.district != "서울 전체") & (yearly.type == "전체 유형")].pivot(index="district", columns="year", values="median_m2")
    district_changes = (districts[2025] / districts[2021] - 1) * 100
    types = yearly[(yearly.district == "서울 전체") & (yearly.type != "전체 유형")].pivot(index="type", columns="year", values="median_m2")
    type_changes = (types[2025] / types[2021] - 1) * 100
    apartments = yearly[(yearly.district == "서울 전체") & (yearly.type == "아파트")].set_index("year")
    share_start = apartments.loc[2021, "n"] / base.n * 100
    share_end = apartments.loc[2025, "n"] / end.n * 100
    month = monthly[(monthly.district == "서울 전체") & (monthly.type == "전체 유형")]
    peak, trough = month.loc[month.median_m2.idxmax()], month.loc[month.median_m2.idxmin()]
    return [
        {"title": "5년의 양 끝을 비교하면", "text": f"서울 전체 ㎡당 전세보증금 중앙값은 2021년 {base.median_m2:,.1f}만원에서 2025년 {end.median_m2:,.1f}만원으로 {change:+.1f}% 변했습니다. 연간 중앙값 기준이며, 5개 연도 사이의 경과기간은 4년입니다."},
        {"title": "연도별 흐름은 같지 않습니다", "text": f"전년 대비 변화율은 " + ", ".join(f"{int(y)}년 {v:+.1f}%" for y, v in annual_changes.items()) + f"입니다. 월별 중앙값의 최댓값은 {peak['month']}({peak.median_m2:,.1f}만원/㎡), 최솟값은 {trough['month']}({trough.median_m2:,.1f}만원/㎡)입니다. 월별 거래 구성에도 영향을 받습니다."},
        {"title": "자치구별 변화 폭의 차이", "text": f"전체 유형을 합친 2021→2025년 변화율은 {district_changes.idxmax()} {district_changes.max():+.1f}%로 가장 높고, {district_changes.idxmin()} {district_changes.min():+.1f}%로 가장 낮습니다. 이는 해당 구에서 신고된 전세 계약 구성까지 반영한 결과이며, 같은 주택의 가격 상승률은 아닙니다."},
        {"title": "주택유형을 나누어 보면", "text": "유형별 ㎡당 중앙값의 2021→2025년 변화율은 " + ", ".join(f"{t} {type_changes[t]:+.1f}%" for t in TYPES) + f"입니다. 분석 자료의 아파트 계약 비중도 {share_start:.1f}%에서 {share_end:.1f}%로 높아졌습니다. 전체 지표에는 유형 내 가격 변화와 거래 구성 변화가 함께 반영되며, 각각의 기여도는 이 분석만으로 분리할 수 없습니다."},
    ]


def export_plotly(yearly, monthly):
    out = PUBLIC / "charts"
    out.mkdir(parents=True, exist_ok=True)
    city = monthly[(monthly.district == "서울 전체") & (monthly.type == "전체 유형")]
    district = yearly[(yearly.district != "서울 전체") & (yearly.type == "전체 유형")].pivot(index="district", columns="year", values="median_m2")
    change = ((district[2025] / district[2021] - 1) * 100).sort_values().rename("change").reset_index()
    by_type = yearly[(yearly.district == "서울 전체") & (yearly.type != "전체 유형")]
    figures = {
        "monthly": px.line(city, x="month", y="median_m2", markers=True, hover_data=["n", "mean_m2"], title="서울 전세가격의 월별 변화 · 2021–2025", labels={"month": "계약월", "median_m2": "㎡당 보증금 중앙값 (만원/㎡)", "n": "전세 계약 건수", "mean_m2": "㎡당 보증금 평균"}),
        "districts": px.bar(change, x="change", y="district", orientation="h", title="자치구별 ㎡당 전세보증금 중앙값 변화율 · 2021→2025", labels={"change": "변화율 (%)", "district": "자치구"}, color="change", color_continuous_scale="Tealrose_r", color_continuous_midpoint=0),
        "types": px.line(by_type, x="year", y="median_m2", color="type", markers=True, hover_data=["n"], title="주택유형별 ㎡당 전세보증금 중앙값 · 2021–2025", labels={"year": "계약연도", "median_m2": "만원/㎡", "type": "주택유형", "n": "전세 계약 건수"}),
    }
    for name, fig in figures.items():
        fig.update_layout(template="plotly_white", font=dict(family="Malgun Gothic, sans-serif"), height=800 if name == "districts" else 520, margin=dict(t=80, b=65))
        if name == "types":
            fig.update_xaxes(dtick=1)
        fig.write_html(out / f"{name}.html", include_plotlyjs="../vendor/plotly.min.js", full_html=True, config={"responsive": True, "displaylogo": False, "showSendToCloud": False})
    (PUBLIC / "vendor").mkdir(exist_ok=True)
    (PUBLIC / "vendor/plotly.min.js").write_text(get_plotlyjs(), encoding="utf-8")


def main():
    PUBLIC.mkdir(exist_ok=True)
    (PUBLIC / "data").mkdir(exist_ok=True)
    df, audit, provenance = load_transactions()
    assert sorted(df.year.unique()) == YEARS
    assert len(df.month.unique()) == 60
    assert sorted(df.district.unique()) == sorted(DISTRICTS)
    yearly, monthly = aggregate(df, "year"), aggregate(df, "month")
    city = yearly[(yearly.district == "서울 전체") & (yearly.type == "전체 유형")]
    assert int(city.n.sum()) == len(df)
    for year in YEARS:
        expected = df[df.year == year].per_m2.median()
        assert abs(city.loc[city.year == year, "median_m2"].iloc[0] - expected) < .0001
    for period, table in [("year", yearly), ("month", monthly)]:
        for usage in ["전체 유형"] + TYPES:
            part = table[table.type == usage]
            a = part[part.district == "서울 전체"].set_index(period).n
            b = part[part.district != "서울 전체"].groupby(period).n.sum()
            assert a.equals(b)
    insights = findings(yearly, monthly)
    payload = {"years": YEARS, "districts": DISTRICTS, "types": TYPES, "count": len(df), "source_downloaded": "2026-09-28", "generated_utc": datetime.now(timezone.utc).isoformat(), "versions": {"pandas": pd.__version__, "plotly": plotly.__version__}, "source": provenance["source"], "license": provenance["license"], "audit": audit, "findings": insights, "annual": json.loads(yearly.to_json(orient="records", force_ascii=False)), "monthly": json.loads(monthly.to_json(orient="records", force_ascii=False))}
    (PUBLIC / "data/analysis.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    yearly.to_csv(PUBLIC / "data/annual.csv", index=False, encoding="utf-8-sig")
    monthly.to_csv(PUBLIC / "data/monthly.csv", index=False, encoding="utf-8-sig")
    (PUBLIC / "data/sources.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")
    export_plotly(yearly, monthly)
    report = "# 서울시 전세가격 변화 분석 (2021–2025)\n\n" + "\n\n".join(f"## {i['title']}\n\n{i['text']}" for i in insights)
    report += f"\n\n분석에 포함한 전세 계약: {len(df):,}건. 원자료 내려받기: 2026-09-28.\n\n출처: {provenance['source']}\n\n방법과 한계는 README.md와 공개 웹앱의 방법론을 참고하세요.\n"
    (ROOT / "ANALYSIS.md").write_text(report, encoding="utf-8")
    print(city.to_string(index=False), flush=True)
    print(f"Validated {len(df):,} transactions, 60 months, 25 districts. Exported three Plotly Express charts.", flush=True)


if __name__ == "__main__":
    main()
