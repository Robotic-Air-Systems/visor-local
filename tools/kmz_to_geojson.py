#!/usr/bin/env python3
"""Split a TGP infrastructure KMZ into the three GeoJSONs the visor wants:

  ductos.geojson      LineString features (the pipeline trace)
  estaciones.geojson  Point features  (named stations)
  postes.geojson      Point features  (km markers, properties.km parsed
                                       from the placemark name)

The KMZ shape we target:
  <Document>
    <Placemark><MultiGeometry><LineString>...</LineString></MultiGeometry></Placemark>
    <Placemark><LineString>...</LineString></Placemark>          ← outside folders → ducto
    <Folder><name>Estaciones</name><Placemark><Point>…</Point></Placemark>…</Folder>
    <Folder><name>Postes kilometricos</name>…</Folder>
  </Document>

Anything else (different folder names, polygons, …) is skipped with a
warning so the rest of the pipeline still runs."""
from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = {"k": "http://www.opengis.net/kml/2.2"}


def parse_coords(text: str) -> list[list[float]]:
    """KML <coordinates> body → list of [lon, lat] (we drop altitude)."""
    pts = []
    for triple in text.split():
        parts = triple.split(",")
        if len(parts) < 2:
            continue
        pts.append([float(parts[0]), float(parts[1])])
    return pts


def line_geometries(placemark: ET.Element) -> list[list[list[float]]]:
    """Collect every <LineString> under a placemark (handles plain
    LineString AND LineStrings inside MultiGeometry)."""
    lines: list[list[list[float]]] = []
    for ls in placemark.iter("{http://www.opengis.net/kml/2.2}LineString"):
        coords_el = ls.find("k:coordinates", NS)
        if coords_el is None or not coords_el.text:
            continue
        pts = parse_coords(coords_el.text)
        if len(pts) >= 2:
            lines.append(pts)
    return lines


def point_geometry(placemark: ET.Element) -> list[float] | None:
    for pt in placemark.iter("{http://www.opengis.net/kml/2.2}Point"):
        coords_el = pt.find("k:coordinates", NS)
        if coords_el is None or not coords_el.text:
            continue
        pts = parse_coords(coords_el.text)
        if pts:
            return pts[0]
    return None


def pm_name(placemark: ET.Element) -> str:
    n = placemark.find("k:name", NS)
    return (n.text or "").strip() if n is not None else ""


def folder_name(folder: ET.Element) -> str:
    n = folder.find("k:name", NS)
    return (n.text or "").strip() if n is not None else ""


def parse_km(name: str) -> str | None:
    """Pull a 'KM 12+550' / '12+550' / 'KP12.5' label out of a poste name.
    Keep it as a string — the visor compares it as a label, not a number."""
    if not name:
        return None
    m = re.search(r"\d+\+\d+", name)
    if m:
        return m.group(0)
    m = re.search(r"\bK[PMm][\s.]?(\d+(?:\.\d+)?)", name)
    if m:
        return m.group(1)
    # Fallback: keep the entire name as label.
    return name


def feature(geom: dict, props: dict) -> dict:
    return {"type": "Feature", "properties": props, "geometry": geom}


def fc(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def split(kmz_path: Path, out_dir: Path) -> None:
    with zipfile.ZipFile(kmz_path) as z:
        kml_name = next((n for n in z.namelist() if n.endswith(".kml")), None)
        if kml_name is None:
            raise SystemExit(f"no .kml in {kmz_path}")
        kml_text = z.read(kml_name).decode("utf-8", errors="ignore")

    # Some KMZ writers (ArcGIS / Global Mapper) emit `xsi:schemaLocation=`
    # on the root <Document> without declaring the xsi namespace, which
    # makes ElementTree balk. Strip those attributes before parsing —
    # we only care about geometry, not schema validation.
    kml_text = re.sub(r"\sxsi:[^=]+=\"[^\"]*\"", "", kml_text)
    root = ET.fromstring(kml_text)

    # 1. Find the top-level Document.
    doc = root.find("k:Document", NS)
    if doc is None:
        raise SystemExit("KML has no <Document>")

    # 2. Index folders by name, collect direct-child Placemarks of the
    #    Document (those are the ductos).
    folders: dict[str, ET.Element] = {}
    direct_placemarks: list[ET.Element] = []
    for child in doc:
        tag = child.tag.split("}", 1)[-1]
        if tag == "Folder":
            folders[folder_name(child)] = child
        elif tag == "Placemark":
            direct_placemarks.append(child)

    # 3. Ductos: every LineString from direct-child placemarks.
    ducto_feats: list[dict] = []
    for pm in direct_placemarks:
        name = pm_name(pm) or "Ducto"
        for ln_idx, line in enumerate(line_geometries(pm), 1):
            ducto_feats.append(feature(
                {"type": "LineString", "coordinates": line},
                {"name": name, "segment": ln_idx},
            ))
    # Sanity: if no direct-child LineStrings, fall back to scanning
    # everywhere (unusual KMZ structure).
    if not ducto_feats:
        for pm in doc.iter("{http://www.opengis.net/kml/2.2}Placemark"):
            for line in line_geometries(pm):
                ducto_feats.append(feature(
                    {"type": "LineString", "coordinates": line},
                    {"name": pm_name(pm) or "Ducto"},
                ))

    # 4. Estaciones folder.
    est_feats: list[dict] = []
    for folder_label in ("Estaciones", "Estaciones de Válvulas",
                          "Stations", "Estación"):
        f = folders.get(folder_label)
        if f is None:
            continue
        for pm in f.iter("{http://www.opengis.net/kml/2.2}Placemark"):
            pt = point_geometry(pm)
            if pt is None:
                continue
            est_feats.append(feature(
                {"type": "Point", "coordinates": pt},
                {"name": pm_name(pm)},
            ))
        break

    # 5. Postes folder.
    pos_feats: list[dict] = []
    for folder_label in ("Postes kilometricos", "Postes Kilométricos",
                          "Postes Kilometricos", "Postes", "KM markers"):
        f = folders.get(folder_label)
        if f is None:
            continue
        for pm in f.iter("{http://www.opengis.net/kml/2.2}Placemark"):
            pt = point_geometry(pm)
            if pt is None:
                continue
            name = pm_name(pm)
            km = parse_km(name)
            pos_feats.append(feature(
                {"type": "Point", "coordinates": pt},
                {"name": name, "km": km},
            ))
        break

    # 6. Warn about anything else.
    handled = {"Estaciones", "Postes kilometricos", "Postes Kilométricos",
               "Postes Kilometricos", "Postes", "KM markers", "Stations",
               "Estación", "Estaciones de Válvulas"}
    for name in folders:
        if name not in handled:
            print(f"  WARN: skipped folder {name!r} "
                  f"({len(list(folders[name].iter('{http://www.opengis.net/kml/2.2}Placemark')))} placemarks)")

    # 7. Write.
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "ductos.geojson").write_text(
        json.dumps(fc(ducto_feats)), encoding="utf-8",
    )
    (out_dir / "estaciones.geojson").write_text(
        json.dumps(fc(est_feats)), encoding="utf-8",
    )
    (out_dir / "postes.geojson").write_text(
        json.dumps(fc(pos_feats)), encoding="utf-8",
    )

    print(f"ductos:     {len(ducto_feats):4d} LineString features  → ductos.geojson")
    print(f"estaciones: {len(est_feats):4d} Point features        → estaciones.geojson")
    print(f"postes:     {len(pos_feats):4d} Point features        → postes.geojson")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("kmz", type=Path, help="input infrastructure KMZ")
    p.add_argument("-o", "--out-dir", type=Path, required=True,
                   help="output dir (visor-local/data/)")
    split(p.parse_args().kmz, p.parse_args().out_dir)


if __name__ == "__main__":
    main()
