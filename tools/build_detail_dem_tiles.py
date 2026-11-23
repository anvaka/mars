#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "rasterio", "pillow", "pmtiles", "scipy"]
# ///
"""
Makes detailed elevation tiles for a small part of Mars, where an elevation
model much better than the global one exists. Today these are the places
where the rovers drive:

    uv run tools/build_detail_dem_tiles.py data/mars-gale-v1.pmtiles \\
        --name 'Gale crater' \\
        --base data/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif \\
        --detail data/hirise/MSL_Gale_DEM_Mosaic_1m_v3.tif

    uv run tools/build_detail_dem_tiles.py data/mars-jezero-v2.pmtiles \\
        --name 'Jezero crater' \\
        --base data/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif \\
        --detail data/hirise/JEZ_ctx_DTM_20m.tif \\
        --detail data/hirise/JEZ_hirise_DTM_1m.tif

The models come from USGS:

    https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m
    https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic
    https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic

The tiles continue the tiles of tools/build_dem_tiles.py: the same web
mercator grid, the same "terrarium" encoding, deeper zoom levels. There are
three differences:

* A tile is 512 pixels wide, to ask the server four times less often. So a
  tile of zoom 14 has a pixel every 2.5 meters.
* The blue channel is used. It holds parts of a meter, in steps of 1/16.
* Only a rectangle around the detailed model is covered. The rectangle is
  made of entire tiles of the first zoom level, and every pixel of it has
  elevation: where the detailed model has nothing to say, the global one is
  used. The models do not agree with each other exactly, so each one fades
  into the one below it along its edges.

How it works: the entire rectangle is kept in memory at the deepest zoom level
(a few gigabytes). The global model is drawn first, then each detailed model
from the first to the last one. Then the rectangle is cut into tiles, squeezed
in half, cut again, and so on.
"""
import argparse
import io
import math
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.fill import fillnodata
from rasterio.transform import Affine
from rasterio.warp import reproject, Resampling
from scipy import ndimage
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

TILE_SIZE = 512
MIN_ZOOM = 10
MAX_ZOOM = 14
MARS_RADIUS = 3396190
MERCATOR = CRS.from_proj4(f'+proj=merc +R={MARS_RADIUS} +lon_0=0 +x_0=0 +y_0=0 +units=m +no_defs')
WORLD_METERS = 2 * math.pi * MARS_RADIUS

# A detailed model fades into what is below it over this many meters from
# its edge.
FADE_METERS = 500
# The distance to the edge is measured on a picture this many times smaller
MASK_SCALE = 8
# Holes smaller than this many pixels are closed from their sides
SMALL_HOLE = 6
# How many parts of a meter the tiles tell apart
STEPS_IN_METER = 16
# Tiles are encoded in batches, to keep the processes busy with work
BATCH_SIZE = 8


def main():
    args = parse_arguments()
    started = time.time()

    area = get_area(args.detail)
    print(f'{area.columns}x{area.rows} tiles of zoom {MIN_ZOOM}: '
          f'{area.width}x{area.height} pixels of {area.pixel_meters:.2f}m at zoom {MAX_ZOOM}')
    print('Covers longitude %.4f..%.4f, latitude %.4f..%.4f' % area.bounds)

    print(f'Drawing {args.base}')
    elevation = draw(args.base, area)
    if not np.isfinite(elevation).all():
        sys.exit('The global model does not cover the area')

    for path in args.detail:
        print(f'Drawing {path}')
        detail = draw(path, area)
        close_small_holes(detail)
        weight = get_weight(detail, area)
        known = weight > 0
        difference = detail[known] - elevation[known]
        print(f'  covers {known.mean() * 100:.1f}% of the area, it is {np.median(difference):+.1f}m '
              f'away from what was there (median), {np.percentile(np.abs(difference), 95):.1f}m at most (95%)')
        elevation[known] = elevation[known] * (1 - weight[known]) + detail[known] * weight[known]
        del detail, weight, known, difference

    lowest, highest = float(elevation.min()), float(elevation.max())
    print(f'Elevation range: {lowest:.1f}m .. {highest:.1f}m')

    tiles = {}
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        jobs = []
        for zoom in range(MAX_ZOOM, MIN_ZOOM - 1, -1):
            jobs += cut_into_tiles(elevation, area, zoom, pool)
            if zoom > MIN_ZOOM:
                # Each pixel of the level above is an average of four pixels here
                height, width = elevation.shape
                elevation = elevation.reshape(height // 2, 2, width // 2, 2).mean(axis=(1, 3))
        for index, (zoom, x, y, job) in enumerate(jobs):
            for offset, image in enumerate(job.result()):
                tiles[zxy_to_tileid(zoom, x + offset, y)] = image
            sys.stdout.write(f'\rEncoded {index + 1} of {len(jobs)} batches   ')
            sys.stdout.flush()

    size = write_archive(args.output, tiles, area, args, lowest, highest)
    print(f'\nSaved {len(tiles)} tiles, {size / 1e6:.0f}MB in {time.time() - started:.0f}s')


def parse_arguments():
    parser = argparse.ArgumentParser(description='Makes detailed elevation tiles for a part of Mars')
    parser.add_argument('output', help='where to save the .pmtiles file')
    parser.add_argument('--base', required=True, help='GeoTIFF with the global elevation model')
    parser.add_argument('--detail', required=True, action='append',
                        help='GeoTIFF with a detailed model. Can be repeated, the last one is drawn on top')
    parser.add_argument('--name', default='Mars detailed elevation', help='how to call the place')
    parser.add_argument('--attribution', default='NASA/JPL/University of Arizona/USGS')
    parser.add_argument('--workers', type=int, default=None, help='number of processes that encode tiles')
    return parser.parse_args()


class Area:
    """The rectangle of the web mercator map that the tiles cover"""

    def __init__(self, first_x, first_y, columns, rows):
        self.first_x = first_x
        self.first_y = first_y
        self.columns = columns
        self.rows = rows
        deepest = 2 ** (MAX_ZOOM - MIN_ZOOM) * TILE_SIZE
        self.width = columns * deepest
        self.height = rows * deepest
        self.pixel_meters = WORLD_METERS / (TILE_SIZE * 2 ** MAX_ZOOM)

        tile_meters = WORLD_METERS / 2 ** MIN_ZOOM
        self.left = -WORLD_METERS / 2 + first_x * tile_meters
        self.top = WORLD_METERS / 2 - first_y * tile_meters
        self.transform = Affine(self.pixel_meters, 0, self.left, 0, -self.pixel_meters, self.top)
        self.bounds = (
            to_longitude(self.left), to_longitude(self.left + columns * tile_meters),
            to_latitude(self.top - rows * tile_meters), to_latitude(self.top)
        )


def get_area(paths):
    """Finds the tiles of the first zoom level that hold all the detailed models"""
    west, south, east, north = math.inf, math.inf, -math.inf, -math.inf
    for path in paths:
        with rasterio.open(path) as source:
            left, bottom, right, top = rasterio.warp.transform_bounds(source.crs, MERCATOR, *source.bounds)
            west, south, east, north = min(west, left), min(south, bottom), max(east, right), max(north, top)

    tile_meters = WORLD_METERS / 2 ** MIN_ZOOM
    first_x = math.floor((west + WORLD_METERS / 2) / tile_meters)
    last_x = math.floor((east + WORLD_METERS / 2) / tile_meters)
    first_y = math.floor((WORLD_METERS / 2 - north) / tile_meters)
    last_y = math.floor((WORLD_METERS / 2 - south) / tile_meters)
    return Area(first_x, first_y, last_x - first_x + 1, last_y - first_y + 1)


def to_longitude(x):
    return math.degrees(x / MARS_RADIUS)


def to_latitude(y):
    return math.degrees(2 * math.atan(math.exp(y / MARS_RADIUS)) - math.pi / 2)


def draw(path, area):
    """Returns the model as seen on the area. Places that it does not know are NaN."""
    result = np.full((area.height, area.width), np.nan, dtype=np.float32)
    with rasterio.open(path) as source:
        pixel = abs(source.res[0])
        if source.crs.is_geographic:
            pixel = math.radians(pixel) * MARS_RADIUS
        # A model with small pixels is averaged, the one with large pixels is
        # smoothed: otherwise each of its pixels becomes a flat square step.
        is_coarse = pixel > area.pixel_meters
        reproject(
            source=rasterio.band(source, 1),
            destination=result,
            dst_transform=area.transform,
            dst_crs=MERCATOR,
            dst_nodata=np.nan,
            resampling=Resampling.cubic if is_coarse else Resampling.average,
            num_threads=8,
            warp_mem_limit=4096,
        )
    # Some models mark the unknown with a huge number, and say nothing about it
    result[np.abs(result) > 1e5] = np.nan
    return result


def close_small_holes(detail):
    """Single lost pixels should not become holes of the global model"""
    known = np.isfinite(detail)
    if known.all():
        return
    # It also grows the model a few pixels outwards, which does no harm:
    # nothing is taken from the very edge of a model.
    fillnodata(detail, mask=known, max_search_distance=SMALL_HOLE)


def get_weight(detail, area):
    """
    For every pixel tells how much of the detailed model to take: nothing
    where it has no data, and everything far enough from such places.
    """
    known = np.isfinite(detail)
    height, width = known.shape
    # A small pixel is known when every pixel below it is
    small = known.reshape(height // MASK_SCALE, MASK_SCALE, width // MASK_SCALE, MASK_SCALE).all(axis=(1, 3))
    # The edge of the area is not the edge of the model, unless the model ends there
    distance = ndimage.distance_transform_edt(np.pad(small, 1, constant_values=True))[1:-1, 1:-1]
    # One more small pixel is kept empty: the enlarged picture is smooth, and
    # would give a bit of weight to the pixels that have no data.
    meters = (distance - 2) * MASK_SCALE * area.pixel_meters
    share = np.clip(meters / FADE_METERS, 0, 1)
    share = (share * share * (3 - 2 * share)).astype(np.float32)

    weight = ndimage.zoom(share, MASK_SCALE, order=1, mode='nearest', grid_mode=True)
    weight[~known] = 0
    return weight


def cut_into_tiles(elevation, area, zoom, pool):
    scale = 2 ** (zoom - MIN_ZOOM)
    jobs = []
    for row in range(area.rows * scale):
        band = elevation[row * TILE_SIZE:(row + 1) * TILE_SIZE]
        for column in range(0, area.columns * scale, BATCH_SIZE):
            last = min(column + BATCH_SIZE, area.columns * scale)
            # The copy lets the big array go when it is squeezed
            batch = band[:, column * TILE_SIZE:last * TILE_SIZE].copy()
            jobs.append((zoom, area.first_x * scale + column, area.first_y * scale + row,
                         pool.submit(encode_batch, batch)))
    return jobs


def encode_batch(batch):
    """Turns [TILE_SIZE, TILE_SIZE * n] array of elevations into n encoded tiles"""
    steps = np.clip(np.rint((batch.astype(np.float64) + 32768) * STEPS_IN_METER), 0, 65536 * STEPS_IN_METER - 1)
    steps = steps.astype(np.uint32)
    meters = steps // STEPS_IN_METER

    rgb = np.zeros((TILE_SIZE, batch.shape[1], 3), dtype=np.uint8)
    rgb[:, :, 0] = meters >> 8
    rgb[:, :, 1] = meters & 255
    rgb[:, :, 2] = (steps % STEPS_IN_METER) * (256 // STEPS_IN_METER)

    result = []
    for i in range(batch.shape[1] // TILE_SIZE):
        image = Image.fromarray(rgb[:, i * TILE_SIZE:(i + 1) * TILE_SIZE])
        buffer = io.BytesIO()
        image.save(buffer, 'WEBP', lossless=True, quality=100, method=4, exact=True)
        result.append(buffer.getvalue())
    return result


def write_archive(output, tiles, area, args, lowest, highest):
    west, east, south, north = area.bounds
    header = {
        'tile_type': TileType.WEBP,
        'tile_compression': Compression.NONE,
        'min_zoom': MIN_ZOOM,
        'max_zoom': MAX_ZOOM,
        'min_lon_e7': int(round(west * 1e7)),
        'min_lat_e7': int(round(south * 1e7)),
        'max_lon_e7': int(round(east * 1e7)),
        'max_lat_e7': int(round(north * 1e7)),
        'center_zoom': MIN_ZOOM,
        'center_lon_e7': int(round((west + east) / 2 * 1e7)),
        'center_lat_e7': int(round((south + north) / 2 * 1e7)),
    }
    metadata = {
        'name': args.name,
        'description': 'Detailed elevation of ' + args.name + ', over the global elevation model',
        'attribution': args.attribution,
        'encoding': 'terrarium',
        'tileSize': TILE_SIZE,
        'minElevation': lowest,
        'maxElevation': highest,
    }

    with open(output, 'wb') as file:
        writer = Writer(file)
        # Tiles that are close on the map should be close in the file too:
        for tile_id in sorted(tiles):
            writer.write_tile(tile_id, tiles[tile_id])
        writer.finalize(header, metadata)
        return file.tell()


if __name__ == '__main__':
    main()
