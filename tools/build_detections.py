#!/usr/bin/env python3
"""Transform YOLO detections from original-image pixel space to tile pixel
space, then emit them as the GeoJSON the visor expects.

The detections JSONs in `data/Detecciones/alerts_json/` have `bbox_px`
in coordinates of the ORIGINAL camera photo (9504 × 6336). The visor's
inspector displays the **rectified** tile (output of the engine's
`process_single_photo` pipeline). These two pixel spaces are related
by a 3×3 homography that this script reproduces:

    M = S_post · T_crop · H_pad · S_ds

where:
    S_ds    — downsample of the source to max_edge before the warp
    H_pad   — engine homography (incl. pad translation)
    T_crop  — translation by `-bbox.top_left` after the alpha-bbox crop
    S_post  — final downsample if `max(crop_w, crop_h) > max_edge`

For each detection the four bbox corners are forwarded through `M` and
their axis-aligned bounding rectangle is emitted as `bbox_px = [x, y,
w, h]` — matching the friend's `renderBx()` consumer in
`visor-cliente-v8.html`.

The script also writes a symlink `data/report_vuelo2/crops/` →
`../Detecciones/smart_tiles/` so the visor's `cUrl()` (which resolves
relative to `data/report_<id>/`) can find the chip thumbnails.

Run after every regeneration of the HD KMZ — the transform depends on
`max_edge` (the tile resolution), and a different max_edge would map
the same detection to different tile pixels.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

# Engine is the source of truth for the rectification math. The visor-local
# venv doesn't have it installed; pick it up from the sibling checkout.
PHOTOS_TO_KMZ = Path("/home/alvaro/Documents/RAS_personal/photos-to-kmz")
sys.path.insert(0, str(PHOTOS_TO_KMZ))

from engine.geo import R_CB_CAM, R_MOUNT, homography                       # noqa: E402
from engine.process import (                                                 # noqa: E402
    ProjectionParams, compute_pixel_transform_full, transform_bbox,
)
from engine.render import _required_pad_for_frame                            # noqa: E402
from engine.xmp import read as read_xmp                                      # noqa: E402

PAD_CAP = 5.0  # mirror engine/process.PAD_CAP; rectify_pad cap used here too


# ---------------------------------------------------------------------------
# Per-photo projection chain
# ---------------------------------------------------------------------------

def compute_projection(
    photo_path: Path, max_edge: int,
) -> tuple[np.ndarray, int, int]:
    """Resolve a photo's projection params (the same ones the engine
    would freeze inside `ProjectionParams` during processing) and ask
    the engine for the composed pixel-space homography.

    We can't just import a "ready-made" projection for an arbitrary
    photo — `ProjectionParams` is normally produced as a by-product of
    `engine.render.load_image`, which actually runs the warp. Here we
    only want the math, not the rendered tile, so we reproduce the
    canvas/bbox dims analytically (cheap — no image I/O) and then hand
    them to `engine.process.compute_pixel_transform_full`."""
    m = read_xmp(photo_path)
    orig_w = int(m["width"])
    orig_h = int(m["height"])

    # source-side downsample, same factor Pillow would apply
    ds_scale = (max_edge / max(orig_w, orig_h)
                if max(orig_w, orig_h) > max_edge else 1.0)
    w_ds = max(1, round(orig_w * ds_scale))
    h_ds = max(1, round(orig_h * ds_scale))

    if m["gimbaled"]:
        roll, pitch_dev, mount = m["roll"], m["pitch"] + 90.0, R_CB_CAM
    else:
        roll, pitch_dev, mount = m["roll"], m["pitch"], R_MOUNT
    pad = min(_required_pad_for_frame(m), PAD_CAP)

    # Rectify canvas (incl. pad translation) — same as engine.render.
    H = homography(w_ds, h_ds, roll, pitch_dev, m["focal_35mm"], mount=mount)
    canvas_w, canvas_h = w_ds, h_ds
    if pad != 1.0:
        canvas_w = int(round(pad * w_ds))
        canvas_h = int(round(pad * h_ds))
        tx = (canvas_w - w_ds) / 2.0
        ty = (canvas_h - h_ds) / 2.0
        T_pad = np.array([[1.0, 0.0, tx], [0.0, 1.0, ty], [0.0, 0.0, 1.0]])
        H = T_pad @ H

    # alpha-bbox = AABB of the 4 warped source corners (exact for the
    # pure-rotation warp the engine performs).
    src = np.array([[0, 0, 1], [w_ds, 0, 1],
                    [w_ds, h_ds, 1], [0, h_ds, 1]], dtype=float)
    warped = (H @ src.T).T
    warped = warped[:, :2] / warped[:, 2:3]
    x0 = max(0, int(np.floor(warped[:, 0].min())))
    y0 = max(0, int(np.floor(warped[:, 1].min())))
    x1 = min(canvas_w, int(np.ceil(warped[:, 0].max())))
    y1 = min(canvas_h, int(np.ceil(warped[:, 1].max())))
    crop_w = max(1, x1 - x0)
    crop_h = max(1, y1 - y0)

    # post-crop downsample to fit max_edge.
    if max(crop_w, crop_h) > max_edge:
        post_scale = max_edge / max(crop_w, crop_h)
        tile_w = max(1, round(crop_w * post_scale))
        tile_h = max(1, round(crop_h * post_scale))
    else:
        tile_w, tile_h = crop_w, crop_h

    projection = ProjectionParams(
        canvas_w=canvas_w, canvas_h=canvas_h, bbox=(x0, y0, x1, y1),
        rectify_pad=pad, mode="auto",
    )
    M = compute_pixel_transform_full(m, projection, tile_w, tile_h)
    return M, tile_w, tile_h


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def build(alerts_dir: Path, photos_dir: Path, smart_tiles_dir: Path,
          out_dir: Path, max_edge: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    # Cache per-source-image projection (one homography per photo, reused
    # across all detections that share that source).
    proj_cache: dict[str, tuple[np.ndarray, int, int]] = {}

    # Symlink crops/ → smart_tiles/ so cUrl() finds them.
    crops_link = out_dir / "crops"
    if crops_link.is_symlink() or crops_link.exists():
        crops_link.unlink()
    rel_target = Path("..") / smart_tiles_dir.relative_to(out_dir.parent)
    crops_link.symlink_to(rel_target)

    features: list[dict] = []
    skipped: list[str] = []

    for jpath in sorted(alerts_dir.glob("*.json")):
        try:
            alert = json.loads(jpath.read_text())
        except Exception as e:
            print(f"  skip {jpath.name}: invalid json ({e})")
            skipped.append(jpath.name)
            continue

        src = alert["source_image"]
        bbox = alert.get("bbox_px")
        if not bbox or len(bbox) != 4:
            print(f"  skip {alert['id']}: missing/bad bbox_px")
            skipped.append(jpath.name)
            continue

        if src not in proj_cache:
            photo_path = photos_dir / src
            if not photo_path.exists():
                # Try case variations.
                alt = next((p for p in photos_dir.iterdir()
                            if p.name.lower() == src.lower()), None)
                if alt is None:
                    print(f"  skip {alert['id']}: source photo "
                          f"{src} not found in {photos_dir}")
                    skipped.append(jpath.name)
                    continue
                photo_path = alt
            proj_cache[src] = compute_projection(photo_path, max_edge)

        M, tile_w, tile_h = proj_cache[src]
        new_bbox = transform_bbox(M, bbox)

        # Crop filename in the smart_tiles dir (same stem as the alert id).
        crop_stem = jpath.stem
        crop_candidates = list(smart_tiles_dir.glob(f"{crop_stem}.*"))
        crop_path = (f"crops/{crop_candidates[0].name}"
                     if crop_candidates else None)

        gps = alert.get("gps") or {}
        coords = [gps.get("lon"), gps.get("lat")] if gps else None

        # The visor keys photos by the manifest entry name, which has no
        # extension ("RAS_00083"). Emit `source_image` in the same shape
        # so the visor's strict-equality filter matches; keep the
        # original (with extension) for traceability.
        src_no_ext = Path(src).stem
        features.append({
            "type": "Feature",
            "geometry": ({"type": "Point", "coordinates": coords}
                         if coords and None not in coords else None),
            "properties": {
                "id": alert["id"],
                "source_image": src_no_ext,
                "source_image_file": src,           # original (with .JPG)
                "class": alert["class"],
                "confidence": alert.get("confidence"),
                "bbox_px": new_bbox,                # [x, y, w, h] in tile-pixel space
                "bbox_px_original": bbox,           # untransformed, for debugging
                "tile_dims": [tile_w, tile_h],      # what bbox_px is relative to
                "crop": crop_path,
                "timestamp": alert.get("timestamp"),
            },
        })

    out = {"type": "FeatureCollection", "features": features}
    target = out_dir / "detections.geojson"
    target.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nwrote {target}  ({len(features)} features, "
          f"{len(skipped)} skipped, {len(proj_cache)} unique source images)")
    print(f"crops symlink: {crops_link} → {rel_target}")


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--alerts-dir", type=Path,
                   default=Path("data/Detecciones/alerts_json"),
                   help="folder of per-detection JSON files")
    p.add_argument("--photos-dir", type=Path,
                   default=PHOTOS_TO_KMZ / "data/TGP_half",
                   help="folder of original (untouched) JPGs — needs the "
                        "XMP-drone-dji metadata to reproduce the warp")
    p.add_argument("--smart-tiles-dir", type=Path,
                   default=Path("data/Detecciones/smart_tiles"),
                   help="folder of chip thumbnails (one per alert)")
    p.add_argument("--out-dir", type=Path,
                   default=Path("data/report_vuelo2"),
                   help="report dir where detections.geojson will land")
    p.add_argument("--max-edge", type=int, default=9504,
                   help="tile max-edge used by the *_hd* photos in the "
                        "visor (default 9504 = native). MUST match the "
                        "max-edge the photos_hd were rendered at, otherwise "
                        "bboxes will be off by the resolution ratio.")
    args = p.parse_args()
    build(args.alerts_dir, args.photos_dir,
          args.smart_tiles_dir, args.out_dir, args.max_edge)


if __name__ == "__main__":
    main()
