"""Build data/runways.json from the OurAirports CSVs.

Usage: python3 scripts/build_runways.py airports.csv runways.csv

Source: OurAirports (https://ourairports.com/data/), GitHub mirror
davidmegginson/ourairports-data, public domain.

Included: open runways at open aerodromes with coordinates for both runway
ends. Any surface type is accepted (the OLS and OFS/OES do not depend on
surface). Excluded: heliports, seaplane bases and closed aerodromes, water
runways, and helipad rows (ident H, H1, H2 and so on).
"""
import csv
import json
import re
import sys

EXCLUDED_TYPES = {"heliport", "seaplane_base", "balloonport", "closed"}
WATER = re.compile(r"WAT", re.I)
HELIPAD = re.compile(r"^H\d*$", re.I)

FIELDS = ["icao", "le", "he", "le_lat", "le_lon", "le_elev_ft", "le_dthr_ft",
          "he_lat", "he_lon", "he_elev_ft", "he_dthr_ft", "len_ft", "wid_ft", "surf"]


def num(v):
    return float(v) if v not in ("", None) else None


def main(airports_csv, runways_csv, out="data/runways.json"):
    airports = {a["ident"]: a for a in csv.DictReader(open(airports_csv, encoding="utf-8"))}
    rows, used = [], {}
    for r in csv.DictReader(open(runways_csv, encoding="utf-8")):
        a = airports.get(r["airport_ident"])
        if not a or a["type"] in EXCLUDED_TYPES or r["closed"] != "0":
            continue
        if not (r["le_latitude_deg"] and r["le_longitude_deg"] and r["he_latitude_deg"] and r["he_longitude_deg"]):
            continue
        if WATER.search(r["surface"]) or HELIPAD.match(r["le_ident"]) or HELIPAD.match(r["he_ident"]):
            continue
        rows.append([
            r["airport_ident"], r["le_ident"], r["he_ident"],
            round(float(r["le_latitude_deg"]), 6), round(float(r["le_longitude_deg"]), 6), num(r["le_elevation_ft"]),
            num(r["le_displaced_threshold_ft"]) or 0,
            round(float(r["he_latitude_deg"]), 6), round(float(r["he_longitude_deg"]), 6), num(r["he_elevation_ft"]),
            num(r["he_displaced_threshold_ft"]) or 0,
            num(r["length_ft"]), num(r["width_ft"]), r["surface"],
        ])
        used[a["ident"]] = [a["name"], num(a["elevation_ft"]), a["iso_country"]]
    rows.sort(key=lambda x: (x[0], x[1]))
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"fields": FIELDS, "rows": rows, "airports": used}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(rows)} runways at {len(used)} aerodromes -> {out}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
