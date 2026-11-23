#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""
Makes the routes and the lists of photos of the rovers that are not working
anymore: Spirit and Opportunity. NASA has no live feeds for them, the data
lives in the archives of the Planetary Data System:

* The routes are the tables of the MER Analyst's Notebook:
  https://an.rsl.wustl.edu/mera/AN/pages/mer/mer_traverse.htm
* The photos are described by the index of the navigation camera archive
  (`index/edrindex.tab`), one line per picture:
  https://pds-imaging.jpl.nasa.gov/data/mer/spirit/mer2no_0xxx/
  https://pds-imaging.jpl.nasa.gov/data/mer/opportunity/mer1no_0xxx/

    uv run tools/build_rover_archive.py data/mer public/data/rovers

The first folder is where the downloaded tables are kept (they are downloaded
when missing), the second one gets two files per rover:

* `MERA.json` - the route, and the places where the rover looked around
* `MERA-photos.json` - the photos taken at each of those places, with the
  description of the camera for every photo. The website loads it when a
  place is opened.

The pictures themselves stay in the archive, the website shows its "browse"
copies (512 pixels wide).

How the camera is described: the index tells where each photo looks, as two
angles relative to the rover and two angles relative to the land. The full
description of the camera (the CAHVOR model, see src/ground/cameraModel.js) is
only in the header of every image file. Instead of reading thousands of
headers, we read one, and turn its camera the way the index says:

* The camera sits on a mast that turns left-right and up-down. So the camera
  of any photo is the camera of the known photo, turned by the difference of
  their angles relative to the rover.
* How the rover itself was tilted at a place is found by comparing the angles
  relative to the rover with the angles relative to the land, for all the
  photos taken there.

Run with `--check 30` to compare the result with the real headers of that
many random photos.
"""
import argparse
import csv
import json
import math
import os
import random
import re
import subprocess
from collections import defaultdict

import numpy as np

MARS_RADIUS = 3396190
METERS_PER_DEGREE = math.radians(1) * MARS_RADIUS
# The website shows a copy of this many pixels, the camera has 1024
BROWSE_SIZE = 512
SENSOR_SIZE = 1024
# A place is worth showing when the rover took at least this many photos there
MIN_PHOTOS = 3
# The tilt of the rover can be found when the photos look in directions that
# are at least this many degrees apart
MIN_SPREAD = 25
# And the photos of a place agree about the tilt within this many degrees
MAX_DISAGREEMENT = 0.5
HEADER_BYTES = 30000

ARCHIVE = 'https://pds-imaging.jpl.nasa.gov/data/mer/'
NOTEBOOK = 'https://an.rsl.wustl.edu/mera/AN/meri/MER/traverse/'

ROVERS = {
    'MERA': {
        'name': 'Spirit',
        'volume': 'spirit/mer2no_0xxx',
        'traverse': 'MERA_traverse.csv',
        # The table is in meters of the equirectangular projection centered here
        'to_place': lambda x, y: (175.5 + x / METERS_PER_DEGREE, y / METERS_PER_DEGREE),
    },
    'MERB': {
        'name': 'Opportunity',
        'volume': 'opportunity/mer1no_0xxx',
        'traverse': 'MERB_traverse_5130.csv',
        # The table is in meters to the east and to the north of the place
        # where the rover landed: 1.9462S 354.4734E. On the photos from the
        # orbit that the website shows that place is about 150 meters to the
        # south-east: this is where the route goes along the rim of Victoria
        # crater, and not next to it.
        'to_place': lambda x, y: (
            -5.5247 + x / (METERS_PER_DEGREE * math.cos(math.radians(1.9462))),
            -1.9477 + y / METERS_PER_DEGREE),
    },
}

# Columns of the index that we need, counted from zero. The index has no
# header; its columns are listed in `index/edrindex.lbl`.
COLUMNS = {
    'path': 4, 'file': 5, 'sol': 11, 'time': 12, 'local_time': 20, 'lines': 21, 'samples': 22,
    'image_type': 31, 'frame': 36, 'site_azimuth': 40, 'site_elevation': 41,
    'rover_azimuth': 42, 'rover_elevation': 43, 'site': 50, 'drive': 51,
}


def main():
    parser = argparse.ArgumentParser(description='Makes routes and lists of photos of Spirit and Opportunity')
    parser.add_argument('source', help='folder with the downloaded tables')
    parser.add_argument('output', help='where to save the files for the website')
    parser.add_argument('--check', type=int, default=0, help='compare this many photos with their real headers')
    args = parser.parse_args()
    os.makedirs(args.source, exist_ok=True)
    os.makedirs(args.output, exist_ok=True)

    for rover_id, rover in ROVERS.items():
        print(f'{rover["name"]}:')
        photos = read_index(args.source, rover_id, rover)
        camera = get_known_camera(args.source, rover_id, rover, photos)
        places = get_places(photos, camera)
        if args.check:
            check(rover, places, args.check)

        track, positions = read_traverse(args.source, rover)
        stops = get_stops(places, positions)
        print(f'  {len(track)} points of the route, {len(stops)} places with '
              f'{sum(len(places[(stop["site"], stop["drive"])]["photos"]) for stop in stops)} photos')

        save(os.path.join(args.output, rover_id + '.json'), {
            'id': rover_id,
            'name': rover['name'],
            'track': track,
            'stops': stops,
        })
        save(os.path.join(args.output, rover_id + '-photos.json'), {
            'images': ARCHIVE.replace('pds-imaging.jpl.nasa.gov/data', 'planetarydata.jpl.nasa.gov/img/data') +
                      rover['volume'] + '/browse/',
            'pages': ARCHIVE + rover['volume'] + '/data/',
            'size': BROWSE_SIZE,
            'places': {
                f'{stop["site"]}_{stop["drive"]}': [describe(photo) for photo in places[(stop['site'], stop['drive'])]['photos']]
                for stop in stops
            },
        })


def fetch(address, first_bytes=None):
    """Downloads with curl: it knows the certificates of this computer"""
    command = ['curl', '--silent', '--show-error', '--fail', '--location', '--max-time', '900']
    if first_bytes:
        command += ['--range', f'0-{first_bytes}']
    return subprocess.run(command + [address], check=True, capture_output=True).stdout


def download(folder, name, address):
    path = os.path.join(folder, name)
    if not os.path.exists(path):
        print(f'  downloading {address}')
        with open(path, 'wb') as file:
            file.write(fetch(address))
    return path


def read_index(folder, rover_id, rover):
    """Returns the full pictures of the left camera: the ones that make panoramas"""
    path = download(folder, rover_id + '_navcam_edrindex.tab', ARCHIVE + rover['volume'] + '/index/edrindex.tab')
    photos = []
    with open(path, newline='') as file:
        for row in csv.reader(file, delimiter='\t', quotechar=None):
            row = [cell.strip().strip('"').strip() for cell in row]
            get = lambda name: row[COLUMNS[name]]
            is_full = (get('frame') == 'LEFT' and get('image_type') == 'REGULAR' and
                       int(get('lines')) == SENSOR_SIZE and int(get('samples')) == SENSOR_SIZE)
            if not is_full:
                continue
            photos.append({
                'path': get('path').split('/data/')[1] + get('file'),
                'sol': int(get('sol')),
                'time': get('time'),
                'local_time': get('local_time'),
                'site': int(get('site')),
                'drive': int(get('drive')),
                'rover_angles': (float(get('rover_azimuth')), float(get('rover_elevation'))),
                'site_angles': (float(get('site_azimuth')), float(get('site_elevation'))),
            })
    print(f'  {len(photos)} full photos of the left navigation camera')
    return photos


def read_header(rover, photo):
    """Reads the camera and the tilt of the rover from the header of an image file"""
    text = fetch(ARCHIVE + rover['volume'] + '/data/' + photo['path'], HEADER_BYTES).decode('latin-1')

    def group(name):
        return re.search(r'GROUP\s*=\s*' + name + r'\b(.*?)END_GROUP', text, re.S).group(1)

    def vector(text, name):
        numbers = re.search(name + r'\s*=\s*\(([^)]*)\)', text).group(1)
        return np.array([float(number) for number in numbers.split(',')])

    model = group('GEOMETRIC_CAMERA_MODEL')
    camera = {key: vector(model, f'MODEL_COMPONENT_{index + 1}') for index, key in enumerate('cahvor')}
    return camera, vector(group('ROVER_COORDINATE_SYSTEM'), 'ORIGIN_ROTATION_QUATERNION')


def get_known_camera(folder, rover_id, rover, photos):
    """
    Returns the camera as it would be when the mast looks straight ahead:
    the camera of one photo, turned back by the angles of that photo.
    """
    path = os.path.join(folder, rover_id + '_camera.json')
    if os.path.exists(path):
        with open(path) as file:
            return {key: np.array(value) for key, value in json.load(file).items()}

    # A photo from the middle of the mission, when everything was calibrated
    photo = photos[len(photos) // 2]
    print(f'  reading the camera from the header of {photo["path"]}')
    camera, _ = read_header(rover, photo)
    back = turn_mast(*photo['rover_angles']).T
    ahead = {key: back @ camera[key] for key in 'ahvo'}
    ahead['r'] = camera['r']
    with open(path, 'w') as file:
        json.dump({key: value.tolist() for key, value in ahead.items()}, file)
    return ahead


def turn_mast(azimuth, elevation):
    """
    Rotation that turns "straight ahead" into the direction given by the two
    angles, in degrees. The axes are those of the rovers: x is forward, y is
    to the right, z is down. The azimuth is counted clockwise when seen from
    above, the elevation is positive above the horizon.
    """
    a, e = math.radians(azimuth), math.radians(elevation)
    around = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    up = np.array([[math.cos(e), 0, math.sin(e)], [0, 1, 0], [-math.sin(e), 0, math.cos(e)]])
    return around @ up


def get_direction(azimuth, elevation):
    return turn_mast(azimuth, elevation) @ np.array([1.0, 0, 0])


def get_places(photos, camera):
    """
    Groups the photos by the place where they were taken, and finds the camera
    of every photo relative to the land. Returns {(site, drive): {photos, tilt}}
    """
    groups = defaultdict(list)
    for photo in photos:
        groups[(photo['site'], photo['drive'])].append(photo)

    places = {}
    skipped = defaultdict(int)
    for key, group in groups.items():
        if len(group) < MIN_PHOTOS:
            skipped['too few photos'] += 1
            continue

        seen_from_rover = np.array([get_direction(*photo['rover_angles']) for photo in group])
        seen_from_land = np.array([get_direction(*photo['site_angles']) for photo in group])
        if spread(seen_from_rover) < MIN_SPREAD:
            skipped['photos look the same way'] += 1
            continue

        tilt = find_rotation(seen_from_rover, seen_from_land)
        disagreement = np.degrees(np.arccos(np.clip(
            np.sum((seen_from_rover @ tilt.T) * seen_from_land, axis=1), -1, 1)))
        # The rover could have turned in place between two days. Then the
        # photos of the largest group that agrees are kept.
        agree = disagreement < MAX_DISAGREEMENT
        if agree.sum() < len(group):
            largest = largest_agreeing(group, seen_from_rover, seen_from_land)
            if largest is None:
                skipped['photos disagree about the tilt'] += 1
                continue
            group, tilt = largest

        for photo in group:
            turn = tilt @ turn_mast(*photo['rover_angles'])
            photo['camera'] = {key: turn @ camera[key] for key in 'ahvo'}
            photo['camera']['r'] = camera['r']
        places[key] = {'photos': sorted(group, key=lambda photo: photo['time']), 'tilt': tilt}

    print(f'  {len(places)} places with photos; skipped: {dict(skipped)}')
    return places


def spread(directions):
    """The largest angle between the first direction and the others, in degrees"""
    return float(np.degrees(np.arccos(np.clip(directions @ directions[0], -1, 1))).max())


def find_rotation(before, after):
    """The rotation that turns the `before` directions into the `after` ones (Kabsch algorithm)"""
    u, _, vt = np.linalg.svd(before.T @ after)
    flip = np.diag([1, 1, np.sign(np.linalg.det(vt.T @ u.T))])
    return vt.T @ flip @ u.T


def largest_agreeing(group, seen_from_rover, seen_from_land):
    """Splits the photos by the day, and returns those of the best day with their tilt"""
    best = None
    for sol in sorted({photo['sol'] for photo in group}):
        index = [i for i, photo in enumerate(group) if photo['sol'] == sol]
        if len(index) < MIN_PHOTOS or spread(seen_from_rover[index]) < MIN_SPREAD:
            continue
        tilt = find_rotation(seen_from_rover[index], seen_from_land[index])
        disagreement = np.degrees(np.arccos(np.clip(
            np.sum((seen_from_rover[index] @ tilt.T) * seen_from_land[index], axis=1), -1, 1)))
        if disagreement.max() < MAX_DISAGREEMENT and (best is None or len(index) > len(best[0])):
            best = ([group[i] for i in index], tilt)
    return best


def check(rover, places, count):
    """Compares our cameras with the ones in the headers of the image files"""
    random.seed(1)
    photos = [photo for place in places.values() for photo in place['photos']]
    worst = 0
    errors = []
    for photo in random.sample(photos, count):
        real, quaternion = read_header(rover, photo)
        to_land = quaternion_to_matrix(quaternion)
        ours = photo['camera']
        error = 0
        # Compare where the corners and the center of the picture look
        for x in (0, 512, 1023):
            for y in (0, 512, 1023):
                expected = to_land @ pixel_direction(real, x, y)
                got = pixel_direction(ours, x, y)
                error = max(error, math.degrees(math.acos(min(1, float(expected @ got)))))
        errors.append(error)
        worst = max(worst, error)
    errors.sort()
    print(f'  checked {count} photos against their headers: the pixels look {errors[len(errors) // 2]:.3f} degrees '
          f'away from where they should (median), {worst:.3f} at most')


def quaternion_to_matrix(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def pixel_direction(camera, x, y):
    """The same math as getPixelDirection() of src/ground/cameraModel.js"""
    a, h, v, o, r = (camera[key] for key in 'ahvor')
    direction = np.cross(v - a * y, h - a * x)
    if np.dot(a, np.cross(v, h)) < 0:
        direction = -direction

    along = np.dot(direction, o)
    across = direction - o * along
    across_length = np.linalg.norm(across)
    distorted = across_length / along
    if not distorted > 1e-8:
        return o / np.linalg.norm(o)

    # The lens moves pixels away from the axis. Find where the pixel was before that.
    tangent = distorted
    for _ in range(20):
        t2 = tangent * tangent
        value = (1 + r[0]) * tangent + r[1] * tangent * t2 + r[2] * tangent * t2 * t2 - distorted
        tangent -= value / ((1 + r[0]) + 3 * r[1] * t2 + 5 * r[2] * t2 * t2)
    angle = math.atan(tangent)
    result = across * math.sin(angle) / across_length + o * math.cos(angle)
    return result / np.linalg.norm(result)


def read_traverse(folder, rover):
    """Returns the line of the route, and the position of every (site, drive)"""
    path = download(folder, rover['traverse'], NOTEBOOK + rover['traverse'])
    track = []
    positions = {}
    with open(path, newline='') as file:
        for row in csv.DictReader(file):
            longitude, latitude = rover['to_place'](float(row['CORRECTED_X']), float(row['CORRECTED_Y']))
            point = [round(longitude, 6), round(latitude, 6)]
            if not track or track[-1] != point:
                track.append(point)
            key = (int(row['SITE']), int(row['DRIVE']))
            # The rover may stay for many days, each has its own line
            position = positions.setdefault(key, {'sol': int(row['START_SOL']), 'point': point})
            position['last_sol'] = int(row['END_SOL'])
    return track, positions


def get_stops(places, positions):
    """Places where the rover looked around, in the order it visited them"""
    by_site = defaultdict(list)
    for (site, drive) in positions:
        by_site[site].append(drive)
    for drives in by_site.values():
        drives.sort()

    stops = []
    for (site, drive), place in sorted(places.items()):
        # The table of the route may not have this very moment of the drive.
        # Then the rover was where the table saw it the last time before that.
        known = [other for other in by_site.get(site, []) if other <= drive]
        if not known:
            continue
        position = positions[(site, known[-1])]
        sols = [photo['sol'] for photo in place['photos']]
        stops.append({
            'site': site,
            'drive': drive,
            'sol': min(sols),
            'lastSol': max(max(sols), position['last_sol']),
            'lon': position['point'][0],
            'lat': position['point'][1],
        })
    return stops


def describe(photo):
    """A compact record of a photo for the website"""
    camera = photo['camera']
    # The website shows a smaller copy of the picture. A camera that takes
    # such pictures has shorter H and V vectors.
    scale = BROWSE_SIZE / SENSOR_SIZE
    vectors = [
        [0, 0, 0],
        camera['a'], camera['h'] * scale, camera['v'] * scale, camera['o'], camera['r'],
    ]
    return {
        # sol0605/edr/2n180079435effaem9p0725l0m1.img
        'file': photo['path'],
        'sol': photo['sol'],
        'time': photo['time'],
        'localTime': photo['local_time'],
        'camera': ';'.join('(' + ','.join(f'{value:.6g}' for value in vector) + ')' for vector in vectors),
    }


def save(path, data):
    with open(path, 'w') as file:
        json.dump(data, file, separators=(',', ':'))
    print(f'  saved {path}, {os.path.getsize(path) / 1e6:.1f}MB')


if __name__ == '__main__':
    main()
