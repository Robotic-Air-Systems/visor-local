#!/usr/bin/env python3
"""Build the visor's manifest.json + extract photo tiles from a KMZ.

The visor (visor-cliente-v8.html) expects:
  data/report_<MAP_ID>/manifest.json
  data/report_<MAP_ID>/photos/<name>.webp           (lowercase name)
  data/report_<MAP_ID>/photos_hd/<name>.webp        (lowercase name)
  data/report_<MAP_ID>/footprints.geojson           (built from manifest at runtime, stub here)
  data/report_<MAP_ID>/flight_path.geojson          (optional)
  data/report_<MAP_ID>/detections.geojson           (optional, used by the alerts feature)

manifest.json shape (minimum needed):
  {
    "name": "<flight name>",
    "date": "YYYY-MM-DD",
    "bounds": [[lonW, latS], [lonE, latN]],
    "image_overlays": {
      "<photo-name>": { "footprint": [[lon,lat],[lon,lat],[lon,lat],[lon,lat]] },
      ...
    }
  }

The 4 footprint points match the engine's emission order (LL, LR, UR, UL in
image space) — same as the frontend's homography assumes."""
from __future__ import annotations

import argparse
import json
import re
import shutil
import zipfile
from pathlib import Path


def parse_kml(kml_text: str) -> list[dict]:
    """Pull out every <GroundOverlay> as {name, footprint, href}.

    The KMZ engine writes a compact KML; regex is enough here (and avoids
    pulling lxml as a dep)."""
    items = []
    # Each <GroundOverlay> block: name, Icon href, gx:LatLonQuad coordinates.
    for m in re.finditer(
        r"<GroundOverlay>(.*?)</GroundOverlay>", kml_text, re.S,
    ):
        block = m.group(1)
        name_m = re.search(r"<name>([^<]+)</name>", block)
        href_m = re.search(r"<href>([^<]+)</href>", block)
        coords_m = re.search(
            r"<gx:LatLonQuad>\s*<coordinates>([^<]+)</coordinates>",
            block, re.S,
        )
        if not (name_m and href_m and coords_m):
            continue
        # coords: "lon,lat,alt lon,lat,alt lon,lat,alt lon,lat,alt"
        pts = []
        for triple in coords_m.group(1).split():
            parts = triple.split(",")
            pts.append([float(parts[0]), float(parts[1])])
        if len(pts) != 4:
            continue
        items.append({
            "name": name_m.group(1).strip(),
            "footprint": pts,
            "href": href_m.group(1).strip(),
        })
    return items


def compute_bounds(items: list[dict]) -> list[list[float]]:
    """Bounding box [[lonW,latS],[lonE,latN]] over every footprint."""
    lons = [pt[0] for it in items for pt in it["footprint"]]
    lats = [pt[1] for it in items for pt in it["footprint"]]
    return [[min(lons), min(lats)], [max(lons), max(lats)]]


def build(args: argparse.Namespace) -> None:
    out_root = args.out_dir
    photos_dir = out_root / "photos"
    photos_hd_dir = out_root / "photos_hd"
    photos_dir.mkdir(parents=True, exist_ok=True)
    photos_hd_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(args.kmz) as z:
        # Find the KML file (usually doc.kml).
        kml_names = [n for n in z.namelist() if n.endswith(".kml")]
        if not kml_names:
            raise SystemExit(f"no .kml in {args.kmz}")
        kml_text = z.read(kml_names[0]).decode("utf-8", errors="ignore")

        items = parse_kml(kml_text)
        if not items:
            raise SystemExit("no <GroundOverlay> entries found in KML")
        print(f"parsed {len(items)} overlays from {kml_names[0]}")

        # Extract photos. Frontend lowercases the name → photos/<name>.webp.
        for it in items:
            try:
                src_data = z.read(it["href"])
            except KeyError:
                print(f"  WARN: {it['href']} listed in KML but missing in KMZ")
                continue
            stem = it["name"].lower()
            # Trust the KMZ's extension (engine emits .webp by default).
            ext = Path(it["href"]).suffix.lower() or ".webp"
            (photos_dir / f"{stem}{ext}").write_bytes(src_data)
            (photos_hd_dir / f"{stem}{ext}").write_bytes(src_data)

    # Build manifest.
    bounds = compute_bounds(items)
    manifest = {
        "name": args.name,
        "date": args.date,
        "bounds": bounds,
        "image_overlays": {
            it["name"]: {"footprint": it["footprint"]} for it in items
        },
    }
    (out_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8",
    )

    # footprints.geojson — frontend rebuilds from manifest.image_overlays
    # at runtime; serve an empty FC so the fetch doesn't 404.
    stub = {"type": "FeatureCollection", "features": []}
    (out_root / "footprints.geojson").write_text(
        json.dumps(stub), encoding="utf-8",
    )
    # detections.geojson — empty until the alerts feature is wired in.
    (out_root / "detections.geojson").write_text(
        json.dumps(stub), encoding="utf-8",
    )

    # flight_path.geojson — LineString through the photo centroids. The
    # visor's "ruta de vuelo" layer renders this; absent it the toggle
    # is a no-op.
    centroids = [
        [
            sum(p[0] for p in it["footprint"]) / 4,
            sum(p[1] for p in it["footprint"]) / 4,
        ]
        for it in items
    ]
    flight_path = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"name": args.name},
            "geometry": {
                "type": "LineString",
                "coordinates": centroids,
            },
        }],
    }
    (out_root / "flight_path.geojson").write_text(
        json.dumps(flight_path), encoding="utf-8",
    )

    photo_bytes = sum(
        (photos_dir / p.name).stat().st_size
        for p in photos_dir.iterdir() if p.is_file()
    )
    print(f"wrote {out_root}/manifest.json  "
          f"({len(items)} overlays, {photo_bytes / 1e6:.1f} MB photos)")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("kmz", type=Path, help="input KMZ from photos_to_kmz.py")
    p.add_argument("-o", "--out-dir", type=Path, required=True,
                   help="output report dir, e.g. data/report_vuelo2/")
    p.add_argument("--name", default="Vuelo TGP",
                   help="display name in the manifest")
    p.add_argument("--date", default="",
                   help="ISO date in the manifest (e.g. 2026-05-13)")
    build(p.parse_args())


if __name__ == "__main__":
    main()
