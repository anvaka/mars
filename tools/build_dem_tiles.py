#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "rasterio", "pillow", "pmtiles"]
# ///
"""
Converts the Mars elevation model into a single PMTiles file that the website
can read directly from a static file hosting.

The source is the HRSC/MOLA blended DEM published by USGS:
https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m

    uv run tools/build_dem_tiles.py data/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif data/mars-dem.pmtiles

Every tile is a 256x256 image with "terrarium" encoded elevation:

    elevation = red * 256 + green + blue / 256 - 32768

The source has one meter of vertical resolution, so blue is always zero.

How it works: the source is a plain longitude/latitude grid. We resample it
into web mercator rows at the zoom level that matches the source resolution,
one row of tiles at a time. Each row is cut into tiles, and it is also squeezed
in half to become a part of the row at the previous zoom level, and so on until
the entire planet fits into one tile.
"""
import argparse
import io
import math
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import rasterio
from rasterio.fill import fillnodata
from rasterio.windows import Window
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

TILE_SIZE = 256
# Tiles are encoded in batches, to keep the processes busy with work, not with
# passing arrays around:
BATCH_SIZE = 32
MAX_MERCATOR_LATITUDE = 85.0511287798


def main():
    args = parse_arguments()
    started = time.time()

    with rasterio.open(args.source) as source:
        check_source(source)
        native_zoom = get_native_zoom(source.width)
        max_zoom = native_zoom if args.max_zoom is None else args.max_zoom
        if max_zoom > native_zoom:
            sys.exit(f'The source has no detail beyond zoom {native_zoom}')

        print(f'Source: {source.width}x{source.height}, native zoom is {native_zoom}')
        print(f'Writing zoom levels 0..{max_zoom} as {args.format} into {args.output}')

        tiles = {}
        stats = Stats()
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            pyramid = Pyramid(native_zoom, max_zoom, args.format, pool, tiles)
            rows_count = 2 ** native_zoom
            for tile_y in range(rows_count):
                row = resample_tiles_row(source, native_zoom, tile_y, stats)
                pyramid.add_row(native_zoom, row)
                report_progress(tile_y + 1, rows_count, started, len(tiles))
            pyramid.finish()

    print(f'\nElevation range: {stats.min:.0f}m .. {stats.max:.0f}m')
    if stats.nodata:
        print(f'{stats.nodata} samples had no data, they were filled from their neighbours')

    size = write_archive(args.output, tiles, max_zoom, args.format, stats)
    print(f'Saved {len(tiles)} tiles, {size / 1e9:.2f}GB in {time.time() - started:.0f}s')


def parse_arguments():
    parser = argparse.ArgumentParser(description='Converts Mars DEM into PMTiles with terrarium tiles')
    parser.add_argument('source', help='path to the GeoTIFF with the elevation model')
    parser.add_argument('output', help='where to save the .pmtiles file')
    parser.add_argument('--max-zoom', type=int, default=None,
                        help='deepest zoom level to write. Default: the one that matches the source resolution')
    parser.add_argument('--format', choices=['webp', 'png'], default='webp',
                        help='image format of the tiles, both are lossless')
    parser.add_argument('--workers', type=int, default=None, help='number of processes that encode tiles')
    return parser.parse_args()


def check_source(source):
    # The math below assumes plain grid of degrees that covers the entire planet
    if not source.crs.is_geographic:
        sys.exit('Expected the source in geographic (longitude/latitude) coordinates')
    bounds = source.bounds
    covers_planet = (abs(bounds.left + 180) < 0.01 and abs(bounds.right - 180) < 0.01 and
                     abs(bounds.top - 90) < 0.01 and abs(bounds.bottom + 90) < 0.01)
    if not covers_planet:
        sys.exit(f'Expected the source to cover the entire planet, got {bounds}')


def get_native_zoom(source_width):
    """First zoom level where tiles have at least as many pixels as the source"""
    return math.ceil(math.log2(source_width / TILE_SIZE))


class Stats:
    def __init__(self):
        self.min = math.inf
        self.max = -math.inf
        self.nodata = 0


def resample_tiles_row(source, zoom, tile_y, stats):
    """
    Returns elevation of one row of web mercator tiles as float32 array of
    [TILE_SIZE, TILE_SIZE * 2^zoom] shape. Uses bilinear interpolation.
    """
    world_size = TILE_SIZE * 2 ** zoom

    # Centers of the output pixels in the source pixel coordinates. Longitude
    # is linear in both projections:
    x = (np.arange(world_size) + 0.5) * source.width / world_size - 0.5
    # Latitude is not:
    mercator_y = (tile_y * TILE_SIZE + np.arange(TILE_SIZE) + 0.5) / world_size
    latitude = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * mercator_y))))
    y = (90 - latitude) * source.height / 180 - 0.5

    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    weight_x = (x - x0).astype(np.float32)[np.newaxis, :]
    weight_y = (y - y0).astype(np.float32)[:, np.newaxis]

    # The planet is round, so the columns wrap around. The rows do not:
    x1 = (x0 + 1) % source.width
    x0 = x0 % source.width
    y1 = np.clip(y0 + 1, 0, source.height - 1)
    y0 = np.clip(y0, 0, source.height - 1)

    first_row = int(y0.min())
    rows_count = int(y1.max()) - first_row + 1
    window = Window(0, first_row, source.width, rows_count)
    data = source.read(1, window=window).astype(np.float32)

    if source.nodata is not None:
        missing = data == source.nodata
        missing_count = int(missing.sum())
        if missing_count:
            # A hole in the data would become a 30km deep pit on the map
            stats.nodata += missing_count
            data = fillnodata(data, mask=~missing, max_search_distance=200)

    stats.min = min(stats.min, float(data.min()))
    stats.max = max(stats.max, float(data.max()))

    y0 = (y0 - first_row)[:, np.newaxis]
    y1 = (y1 - first_row)[:, np.newaxis]
    x0 = x0[np.newaxis, :]
    x1 = x1[np.newaxis, :]

    top = data[y0, x0] * (1 - weight_x) + data[y0, x1] * weight_x
    bottom = data[y1, x0] * (1 - weight_x) + data[y1, x1] * weight_x
    return top * (1 - weight_y) + bottom * weight_y


class Pyramid:
    """
    Receives rows of tiles at the deepest zoom level, and produces tiles for
    that level and for all the levels above it.
    """

    def __init__(self, native_zoom, max_zoom, image_format, pool, tiles):
        self.max_zoom = max_zoom
        self.image_format = image_format
        self.pool = pool
        self.tiles = tiles
        # Next row index at each zoom level
        self.next_row = [0] * (native_zoom + 1)
        # Upper half of a row that waits for its lower half
        self.pending_half = [None] * (native_zoom + 1)
        self.jobs = []

    def add_row(self, zoom, row):
        tile_y = self.next_row[zoom]
        self.next_row[zoom] += 1

        if zoom <= self.max_zoom:
            self.encode_row(zoom, tile_y, row)
        if zoom == 0:
            return

        # Each pixel of the level above is an average of four pixels here:
        height, width = row.shape
        half = row.reshape(height // 2, 2, width // 2, 2).mean(axis=(1, 3))

        upper_half = self.pending_half[zoom]
        if upper_half is None:
            self.pending_half[zoom] = half
        else:
            self.pending_half[zoom] = None
            self.add_row(zoom - 1, np.vstack((upper_half, half)))

    def encode_row(self, zoom, tile_y, row):
        tiles_count = 2 ** zoom
        for first_x in range(0, tiles_count, BATCH_SIZE):
            last_x = min(first_x + BATCH_SIZE, tiles_count)
            batch = row[:, first_x * TILE_SIZE:last_x * TILE_SIZE]
            job = self.pool.submit(encode_batch, batch, self.image_format)
            self.jobs.append((zoom, tile_y, first_x, job))
        self.collect(wait=len(self.jobs) > 256)

    def collect(self, wait=False):
        """Moves encoded tiles from the finished jobs into the tiles dictionary"""
        remaining = []
        for zoom, tile_y, first_x, job in self.jobs:
            if not wait and not job.done():
                remaining.append((zoom, tile_y, first_x, job))
                continue
            for offset, image in enumerate(job.result()):
                self.tiles[zxy_to_tileid(zoom, first_x + offset, tile_y)] = image
        self.jobs = remaining

    def finish(self):
        self.collect(wait=True)


def encode_batch(batch, image_format):
    """Turns [TILE_SIZE, TILE_SIZE * n] array of elevations into n encoded tiles"""
    tiles_count = batch.shape[1] // TILE_SIZE
    value = np.clip(np.rint(batch) + 32768, 0, 65535).astype(np.uint16)

    rgb = np.zeros((TILE_SIZE, batch.shape[1], 3), dtype=np.uint8)
    rgb[:, :, 0] = value >> 8
    rgb[:, :, 1] = value & 255

    result = []
    for i in range(tiles_count):
        image = Image.fromarray(rgb[:, i * TILE_SIZE:(i + 1) * TILE_SIZE])
        buffer = io.BytesIO()
        if image_format == 'webp':
            image.save(buffer, 'WEBP', lossless=True, quality=100, method=4, exact=True)
        else:
            image.save(buffer, 'PNG', optimize=True)
        result.append(buffer.getvalue())
    return result


def write_archive(output, tiles, max_zoom, image_format, stats):
    header = {
        'tile_type': TileType.WEBP if image_format == 'webp' else TileType.PNG,
        'tile_compression': Compression.NONE,
        'min_zoom': 0,
        'max_zoom': max_zoom,
        'min_lon_e7': int(-180 * 1e7),
        'min_lat_e7': int(-MAX_MERCATOR_LATITUDE * 1e7),
        'max_lon_e7': int(180 * 1e7),
        'max_lat_e7': int(MAX_MERCATOR_LATITUDE * 1e7),
        'center_zoom': 2,
        'center_lon_e7': 0,
        'center_lat_e7': 0,
    }
    metadata = {
        'name': 'Mars elevation',
        'description': 'Mars MGS MOLA - MEX HRSC Blended DEM Global 200m v2',
        'attribution': 'USGS Astrogeology Science Center, NASA, ESA, DLR, FU Berlin',
        'encoding': 'terrarium',
        'tileSize': TILE_SIZE,
        'minElevation': stats.min,
        'maxElevation': stats.max,
    }

    with open(output, 'wb') as file:
        writer = Writer(file)
        # Tiles that are close on the map should be close in the file too:
        for tile_id in sorted(tiles):
            writer.write_tile(tile_id, tiles[tile_id])
        writer.finalize(header, metadata)
        return file.tell()


def report_progress(done, total, started, tiles_count):
    elapsed = time.time() - started
    remaining = elapsed / done * (total - done)
    sys.stdout.write(f'\rRow {done} of {total}, {tiles_count} tiles encoded, {remaining:.0f}s left   ')
    sys.stdout.flush()


if __name__ == '__main__':
    main()
