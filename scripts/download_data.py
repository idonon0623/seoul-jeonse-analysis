"""Download official Seoul annual archives, without an API key."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import zipfile
import requests

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://data.seoul.go.kr/dataList/OA-21276/S/1/datasetView.do"
ENDPOINT = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false"
FILES = {2021: 34, 2022: 36, 2023: 38, 2024: 39, 2025: 40}

def download(item):
    year, seq = item
    target = ROOT / "data" / "raw" / f"seoul_rent_{year}.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        response = requests.post(ENDPOINT, data={"infId": "OA-21276", "seq": str(seq), "seqNo": "", "infSeq": "3"}, headers={"Referer": SOURCE}, timeout=180)
        response.raise_for_status()
        if not response.content.startswith(b"PK"):
            raise RuntimeError(f"{year}: expected ZIP, received {response.headers.get('Content-Type')}")
        target.write_bytes(response.content)
    with zipfile.ZipFile(target) as archive:
        print(year, [(f.filename, f.file_size) for f in archive.infolist()], flush=True)
    return {"year": year, "sequence": seq, "file": target.name, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "bytes": target.stat().st_size}

if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=3) as pool:
        files = list(pool.map(download, FILES.items()))
    (ROOT / "data" / "sources.json").write_text(json.dumps({"source": SOURCE, "license": "공공누리 제1유형 (출처표시)", "files": files}, ensure_ascii=False, indent=2), encoding="utf-8")
