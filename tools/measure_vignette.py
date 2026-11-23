# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow"]
# ///
"""
Measures how much the lens of a rover's navigation camera darkens a picture
away from its center.

Neighbor shots of a panorama overlap: the same rock is near the edge of one
picture and closer to the center of the other. The rock did not change, so
the difference in its brightness is made by the lens (and by the exposure of
each shot, which we find too). If `r` is the distance from the center of the
picture (1 in its corner), we look for `a`, `b` and `c` of

    brightness = true brightness * exp(-(a * r^2 + b * r^4 + c * r^6))

These three numbers are the `vignette` of a feed in src/ground/loadRoverPhotos.js

The photos and their camera models come from the archive made by
tools/build_rover_archive.py:

    uv run tools/measure_vignette.py public/data/rovers/MERA-photos.json data/mer/browse

The second argument is the folder where the downloaded pictures are kept.

Curiosity has no archive of ours, its photos are listed by NASA day by day.
Name the days (sols) to look at instead of the archive:

    uv run tools/measure_vignette.py msl:650,1100,1700,2300,2900,3400 data/msl/browse
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

# Shots that look closer than this (in degrees) show the same pixels at the
# same distance from the center, and tell nothing. Those that look farther
# apart do not overlap.
MIN_ANGLE = 8
MAX_ANGLE = 40
# How many points along each side of a picture are compared
GRID = 28
# A point is the average of the pixels around it: the two shots are taken
# from slightly different places, and the pictures are compressed. This is
# how far the average reaches, as a part of the width of the picture.
PATCH = 1 / 128
# The camera sits at the side of the mast, and moves by a dozen centimeters
# when the mast turns. The land near the rover is then seen at a different
# angle. When the model tells where the camera was, we count the land as a
# plane under the wheels: in the frame of a rover Z looks down, and the
# wheels stand at zero. Rays that look less than this much down go far away.
SMALLEST_SLOPE = 0.02
# What is close to the rover cannot be compared anyway: the two shots see
# different sides of the rocks, and the rover itself is in the way. Only the
# rays that look less than this much down are used (0.3 is 17 degrees, the
# land farther than six meters).
LARGEST_SLOPE = 0.3
# Pixels at the very edge of the picture are not reliable
MARGIN = 0.04
# Too dark to compare, or burnt out
DARKEST = 16
BRIGHTEST = 238
# The Sun moves, and so do the shadows: shots taken long apart are not compared
MAX_SECONDS_APART = 1200
MIN_POINTS_IN_PAIR = 40
ATTEMPTS = 4
MSL_PREFIX = 'msl:'
MSL_API = ('https://mars.nasa.gov/api/v1/raw_image_items/?order=sol+asc&per_page=100&page={page}&condition_1=msl:mission'
           '&condition_2={sol}:sol:gte&condition_3={sol}:sol:lte&search=NAV_LEFT_A%7CNAV_LEFT_B'
           '&extended=thumbnail::sample_type::noteq')
MSL_SENSOR = 1024
MSL_PAGES = 5


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('archive', help='the list of photos, for example public/data/rovers/MERA-photos.json, ' +
                        'or "msl:" with the sols of Curiosity to look at')
    parser.add_argument('cache', help='the folder to keep the downloaded pictures in')
    parser.add_argument('--places', type=int, default=14, help='how many stops of the rover to look at')
    parser.add_argument('--min-photos', type=int, default=8, help='only the stops with this many photos are used')
    args = parser.parse_args()

    cache = Path(args.cache)
    if args.archive.startswith(MSL_PREFIX):
        archive = load_curiosity_photos([int(sol) for sol in args.archive[len(MSL_PREFIX):].split(',')])
    else:
        archive = json.loads(Path(args.archive).read_text())
    size = archive['size']

    # The stops are taken evenly from the entire route
    rich = [key for key, photos in archive['places'].items() if len(photos) >= args.min_photos]
    step = max(1, len(rich) // args.places)
    chosen = rich[::step][:args.places]
    print(f'{len(rich)} stops have at least {args.min_photos} photos, looking at {len(chosen)} of them')

    rows = []
    for key in chosen:
        photos = archive['places'][key]
        shots = []
        for photo in photos:
            url = photo['file'] if photo['file'].startswith('http') else archive['images'] + photo['file'] + '.jpg'
            picture = load_picture(url, cache, size)
            if picture is None:
                continue
            shots.append({
                'picture': picture,
                'camera': parse_camera(photo['camera']),
                'time': parse_time(photo['time'])
            })

        before = len(rows)
        pairs = 0
        for i, first in enumerate(shots):
            for second in shots[i + 1:]:
                found = compare(first, second, size)
                if len(found) >= MIN_POINTS_IN_PAIR:
                    rows.append(found)
                    pairs += 1
        print(f'  stop {key}: {len(shots)} photos, {pairs} pairs, {sum(len(r) for r in rows[before:])} points')

    if not rows:
        sys.exit('No overlapping shots were found')
    coefficients, spread, kept = fit(rows)
    report(coefficients, spread, kept, sum(len(r) for r in rows), len(rows))


def load_curiosity_photos(sols):
    """
    Asks NASA for the photos that the left navigation camera of Curiosity took
    on the given sols, and lists them the way our archives do. Only the shots
    of the entire sensor are taken.
    """
    places = {}
    for sol in sols:
        for page in range(MSL_PAGES):
            result = subprocess.run(
                ['curl', '-sS', '-f', '-L', '--max-time', '60', '-A', 'mars-map-tools', MSL_API.format(sol=sol, page=page)],
                capture_output=True, text=True)
            if result.returncode != 0:
                print(f'  could not list the photos of sol {sol}: {result.stderr.strip()}')
                break
            answer = json.loads(result.stdout)
            for image in answer.get('items', []):
                is_full = (image.get('extended') or {}).get('sample_type') == 'full'
                rect = (image.get('subframe_rect') or '').replace(' ', '')
                is_entire = rect == f'(1,1,{MSL_SENSOR},{MSL_SENSOR})' and float(image.get('scale_factor') or 1) == 1
                if not (is_full and is_entire and image.get('camera_model_component_list')):
                    continue
                # The rover does not move between the shots of one place, so the
                # cameras can be compared in the frame of the rover.
                places.setdefault(f"{image['site']}_{image['drive']}", []).append({
                    'file': image['https_url'],
                    'time': image['date_taken'],
                    'camera': image['camera_model_component_list']
                })
            if not answer.get('more'):
                break
    return {'images': '', 'size': MSL_SENSOR, 'places': places}


def compare(first, second, size):
    """
    Finds the points that both shots see. Returns rows of
    `[r^2 in the first shot, r^2 in the second one, log of the ratio of brightness]`.
    """
    if abs(first['time'] - second['time']) > MAX_SECONDS_APART:
        return np.empty((0, 3))
    cosine = float(np.dot(first['camera']['a'], second['camera']['a']))
    angle = np.degrees(np.arccos(np.clip(cosine, -1, 1)))
    if angle < MIN_ANGLE or angle > MAX_ANGLE:
        return np.empty((0, 3))

    patch = max(1, round(PATCH * size))
    edge = MARGIN * size + patch
    steps = np.linspace(edge, size - 1 - edge, GRID)
    x, y = [grid.ravel() for grid in np.meshgrid(steps, steps)]
    directions = get_directions(first['camera'], x, y)
    x2, y2, is_ahead = project(second['camera'], see_from(first['camera'], second['camera'], directions))
    is_ahead &= directions[:, 2] < LARGEST_SLOPE
    is_inside = is_ahead & (x2 > edge) & (x2 < size - 1 - edge) & (y2 > edge) & (y2 < size - 1 - edge)
    if not is_inside.any():
        return np.empty((0, 3))

    x, y, x2, y2 = x[is_inside], y[is_inside], x2[is_inside], y2[is_inside]
    brightness = sample(first['picture'], x, y, patch)
    brightness2 = sample(second['picture'], x2, y2, patch)
    is_good = (brightness > DARKEST) & (brightness < BRIGHTEST) & (brightness2 > DARKEST) & (brightness2 < BRIGHTEST)
    brightness, brightness2 = np.maximum(brightness, 1), np.maximum(brightness2, 1)

    center = (size - 1) / 2
    corner = np.hypot(center, center)
    r = np.hypot(x - center, y - center) / corner
    r2 = np.hypot(x2 - center, y2 - center) / corner
    found = np.column_stack([r * r, r2 * r2, np.log(brightness / brightness2)])
    return found[is_good]


def fit(rows):
    """
    Solves for the three coefficients of the lens, and for the difference of
    exposure of every pair. Points that do not agree with the rest (a shadow
    that moved, a part of the rover) are dropped, and it is solved again.
    """
    pair_index = np.concatenate([np.full(len(found), i) for i, found in enumerate(rows)])
    data = np.vstack(rows)
    q1, q2, ratio = data[:, 0], data[:, 1], data[:, 2]
    # log(first / second) = exposure - (V(r1) - V(r2))
    lens = -np.column_stack([q1 - q2, q1 ** 2 - q2 ** 2, q1 ** 3 - q2 ** 3])
    exposure = np.zeros((len(data), len(rows)))
    exposure[np.arange(len(data)), pair_index] = 1
    matrix = np.hstack([lens, exposure])

    is_kept = np.ones(len(data), dtype=bool)
    for _ in range(6):
        solution, *_ = np.linalg.lstsq(matrix[is_kept], ratio[is_kept], rcond=None)
        error = ratio - matrix @ solution
        spread = error[is_kept].std()
        is_kept = np.abs(error) < 2.5 * spread
    return solution[:3], spread, int(is_kept.sum())


def report(coefficients, spread, kept, total, pairs):
    a, b, c = coefficients
    print(f'\n{pairs} pairs, {kept} of {total} points agree, they differ from the model by {100 * (np.exp(spread) - 1):.1f}%')
    print(f'vignette: [{a:.3f}, {b:.3f}, {c:.3f}]')
    half = (1 / np.sqrt(2)) ** 2
    for name, q in [('half way to the side', half / 4), ('at the side', half), ('in the corner', 1.0)]:
        left = np.exp(-(a * q + b * q ** 2 + c * q ** 3))
        print(f'  {name}: {100 * left:.0f}% of the brightness is left')


def get_directions(camera, x, y):
    """
    Unit vectors of where the pixels look at. This is `getPixelDirection()`
    of src/ground/cameraModel.js for many pixels at once.
    """
    a, h, v, o, r = (camera[name] for name in 'ahvor')
    ideal = np.cross(v - np.outer(y, a), h - np.outer(x, a))
    if np.dot(a, np.cross(v, h)) < 0:
        ideal = -ideal

    along = ideal @ o
    across = ideal - np.outer(along, o)
    across_length = np.linalg.norm(across, axis=1)
    distorted = across_length / along
    tangent = distorted.copy()
    for _ in range(20):
        t2 = tangent * tangent
        value = (1 + r[0]) * tangent + r[1] * tangent * t2 + r[2] * tangent * t2 * t2 - distorted
        derivative = (1 + r[0]) + 3 * r[1] * t2 + 5 * r[2] * t2 * t2
        tangent = tangent - value / derivative
    angle = np.arctan(tangent)

    scale = np.where(across_length > 1e-12, np.sin(angle) / np.maximum(across_length, 1e-12), 0)
    direction = across * scale[:, None] + np.outer(np.cos(angle), o)
    return direction / np.linalg.norm(direction, axis=1)[:, None]


def see_from(first, second, directions):
    """
    The first camera sees something in the given directions. Returns the
    directions in which the second camera sees the same.
    """
    height = -first['c'][2]
    if not np.any(first['c']) or height <= 0:
        # Nobody knows where the cameras were, see tools/build_rover_archive.py
        return directions

    down = directions[:, 2]
    is_near = down > SMALLEST_SLOPE
    distance = height / np.where(is_near, down, 1)
    points = first['c'] + directions * distance[:, None] - second['c']
    seen = points / np.linalg.norm(points, axis=1)[:, None]
    return np.where(is_near[:, None], seen, directions)


def project(camera, directions):
    """
    Where the camera sees the far points that lie in the given directions:
    `x`, `y` and the flags of those that are in front of the camera.
    """
    a, h, v, o, r = (camera[name] for name in 'ahvor')
    omega = directions @ o
    is_ahead = omega > 1e-6
    omega = np.where(is_ahead, omega, 1)
    across = directions - np.outer(omega, o)
    tau = np.sum(across * across, axis=1) / (omega * omega)
    mu = r[0] + r[1] * tau + r[2] * tau * tau
    moved = directions + across * mu[:, None]
    alpha = moved @ a
    is_ahead &= alpha > 1e-6
    alpha = np.where(is_ahead, alpha, 1)
    return (moved @ h) / alpha, (moved @ v) / alpha, is_ahead


def sample(picture, x, y, patch):
    """Average brightness of the small squares around the points."""
    total = picture.cumsum(axis=0).cumsum(axis=1)
    total = np.pad(total, ((1, 0), (1, 0)))
    left = np.rint(x).astype(int) - patch
    top = np.rint(y).astype(int) - patch
    right = left + 2 * patch + 1
    bottom = top + 2 * patch + 1
    area = (2 * patch + 1) ** 2
    return (total[bottom, right] - total[top, right] - total[bottom, left] + total[top, left]) / area


def parse_camera(text):
    c, a, h, v, o, r = [np.array([float(n) for n in part.strip('()').split(',')]) for part in text.split(';')[:6]]
    return {'c': c, 'a': a, 'h': h, 'v': v, 'o': o, 'r': r}


def parse_time(text):
    return time.mktime(time.strptime(text[:19], '%Y-%m-%dT%H:%M:%S'))


def load_picture(url, cache, size):
    """
    Brightness of every pixel of the picture, or None if it cannot be loaded.
    The camera models of the archive are made for the pictures `size` pixels
    wide, and the archive may hold a larger copy.
    """
    path = cache / (url.split('/browse/')[-1].replace('/', '_') if '/browse/' in url else url.split('/')[-1])
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        if not download(url, path):
            return None
    try:
        picture = Image.open(path).convert('L')
        if picture.width != picture.height:
            return None
        if picture.width != size:
            picture = picture.resize((size, size), Image.BOX)
        return np.asarray(picture, dtype=np.float64)
    except OSError:
        path.unlink(missing_ok=True)
        return None


def download(url, path):
    # The archive is often too busy to answer, and asks to come later
    for attempt in range(ATTEMPTS):
        result = subprocess.run(
            ['curl', '-sS', '-f', '-L', '--max-time', '60', '-A', 'mars-map-tools', '-o', str(path), url],
            capture_output=True, text=True)
        if result.returncode == 0:
            return True
        path.unlink(missing_ok=True)
        time.sleep(2 * (attempt + 1))
    print(f'    could not load {url}: {result.stderr.strip()}')
    return False


if __name__ == '__main__':
    main()
