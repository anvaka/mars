#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyshp"]
# ///
"""
Converts the official list of named Mars features into two files: a GeoJSON
file with labels for the map, and a JSON file that tells what is known about
every feature. The second one is for the search, and for the card that shows
up when a label is clicked.

The names come from the Gazetteer of Planetary Nomenclature (IAU/USGS):
https://planetarynames.wr.usgs.gov/Page/MARS/target

Download "Center Points" shapefile from "GIS Downloads" there, unzip it, and run:

    uv run tools/build_labels.py data/gazetteer/shp public/data/mars-labels.geojson public/data/mars-features.json

The card also shows a few words and a picture from Wikipedia. Which article
tells about which feature is written in tools/wikipedia_articles.json, see
tools/find_wikipedia_articles.py

Each label knows when to appear: a name shows up when its feature becomes
large enough on the screen, and the largest regions step aside when the map is
zoomed deep into them.
"""
import glob
import json
import math
import os
import re
import sys

import shapefile

# The map is 512 pixels wide at zoom 0, and Mars is 21,339km around the equator
KM_PER_PIXEL_AT_ZOOM_0 = 2 * math.pi * 3396.19 / 512

# How the feature types of the gazetteer are drawn on the map. The first value
# is the width of a feature on the screen (in pixels) at which its name appears.
# The second one is the importance: when two names do not fit together, the
# one with larger `importance * size` stays. Olympus Mons is smaller than the
# cliff around it, yet it is the mountain that everyone is looking for.
CLASSES = {
    'region': (90, 3, ['Terra, terrae', 'Planitia, planitiae', 'Planum, plana', 'Vastitas, vastitates']),
    'mountain': (36, 4, ['Mons, montes', 'Tholus, tholi', 'Patera, paterae']),
    'valley': (60, 1.5, ['Vallis, valles', 'Chasma, chasmata', 'Fossa, fossae', 'Labyrinthus, labyrinthi',
                    'Catena, catenae', 'Chaos, chaoses']),
    'crater': (48, 1, ['Crater, craters']),
    'landform': (90, 0.5, ['Mensa, mensae', 'Dorsum, dorsa', 'Cavus, cavi', 'Rupes, rupēs', 'Collis, colles',
                      'Sulcus, sulci', 'Scopulus, scopuli', 'Labes, labēs', 'Unda, undae', 'Palus, paludes',
                      'Lingula, lingulae', 'Serpens, serpentes', 'Fluctus, fluctūs', 'Macula, maculae']),
}
# Albedo features are bright and dark markings seen through a telescope. They
# do not follow the terrain, so they get no label on the elevation map. Still,
# many of them are well known (Tharsis, Elysium), so they can be searched for.
UNLABELED_TYPES = {'Albedo Feature': 'albedo'}

# Regions that are wider than this many pixels are not labeled anymore
REGION_MAX_WIDTH = 2600

# Spacecraft that reached the surface and worked there.
# [name, year, longitude, latitude, what it is, Wikipedia article, a few words for when Wikipedia is not available]
LANDING_SITES = [
    ['Viking 1', 1976, -47.95, 22.27, 'NASA lander', 'Viking 1',
     'The first spacecraft that worked on the surface of Mars for a long time: it landed in July 1976 '
     'and kept sending data until November 1982.'],
    ['Viking 2', 1976, 134.29, 47.64, 'NASA lander', 'Viking 2',
     'The twin of Viking 1. Landed in September 1976 and worked until April 1980.'],
    ['Pathfinder', 1997, -33.22, 19.13, 'NASA lander', 'Mars Pathfinder',
     'Brought Sojourner, the first rover on Mars. Landed in July 1997 and worked until September 1997.'],
    ['Spirit', 2004, 175.4729, -14.5692, 'NASA rover', 'Spirit (rover)',
     'Landed in January 2004, got stuck in soft soil in 2009, and was last heard from in March 2010.'],
    ['Opportunity', 2004, -5.5266, -1.9462, 'NASA rover', 'Opportunity (rover)',
     'The twin of Spirit. Landed in January 2004 and drove more than 45 kilometers before a dust storm '
     'ended the mission in June 2018.'],
    ['Phoenix', 2008, -125.7492, 68.2188, 'NASA lander', 'Phoenix (spacecraft)',
     'Dug into the ground of the northern plains and found water ice. Landed in May 2008 and worked '
     'until November 2008.'],
    ['Curiosity', 2012, 137.4416, -4.5895, 'NASA rover', 'Curiosity (rover)',
     'Landed in Gale crater in August 2012 to climb Mount Sharp (Aeolis Mons), the mountain in the '
     'middle of the crater.'],
    ['InSight', 2018, 135.6234, 4.5024, 'NASA lander', 'InSight',
     'Listened to marsquakes. Landed in November 2018 and was last heard from in December 2022.'],
    ['Perseverance', 2021, 77.4509, 18.4446, 'NASA rover', 'Perseverance (rover)',
     'Landed in Jezero crater in February 2021, together with Ingenuity, the first helicopter on '
     'another planet.'],
    ['Zhurong', 2021, 109.925, 25.066, 'Chinese rover', 'Zhurong (rover)',
     'Rover of the Tianwen-1 mission. Landed in May 2021 and went into hibernation in May 2022.'],
]

# The rovers whose photos the website can show, and their names in src/lib/rovers.js.
# They are what a visitor can do the most with, so the map marks them brighter.
ROVERS_WITH_PHOTOS = {'Perseverance': 'M20', 'Curiosity': 'MSL', 'Spirit': 'MERA', 'Opportunity': 'MERB'}

ARTICLES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wikipedia_articles.json')

# Two thousand names of the same weight are a sea where nothing can be found.
# So we ask what people look for: tools/count_wikipedia_readers.py counts the
# readers of the Wikipedia article about each feature. A name whose article is
# read this many times a month is a landmark: it is drawn brighter than the others.
READERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wikipedia_readers.json')
LANDMARK_READERS = 100
# A known name also appears earlier than its size allows: Gale is a small
# crater, yet it is where Curiosity drives. Each doubling of the readers gives
# about one more level of zoom, up to this many.
MAX_ZOOM_GAINED_BY_READERS = 2.5


def main():
    if len(sys.argv) != 4:
        sys.exit('usage: build_labels.py <folder with the shapefile> <labels.geojson> <features.json>')
    source_folder, labels_output, features_output = sys.argv[1], sys.argv[2], sys.argv[3]

    class_of_type = dict(UNLABELED_TYPES)
    for class_name, (_, _, types) in CLASSES.items():
        for type_name in types:
            class_of_type[type_name] = class_name

    articles = {}
    if os.path.exists(ARTICLES_FILE):
        with open(ARTICLES_FILE, encoding='utf-8') as file:
            articles = json.load(file)
    else:
        print(f'There is no {ARTICLES_FILE}, the features will have no articles')

    readers = {}
    if os.path.exists(READERS_FILE):
        with open(READERS_FILE, encoding='utf-8') as file:
            readers = json.load(file)
    else:
        print(f'There is no {READERS_FILE}, the map will have no landmarks')

    labels = []
    features = []
    seen = set()
    reader = shapefile.Reader(glob.glob(source_folder + '/*.shp')[0], encoding='utf-8')
    for record in reader.records():
        feature = record.as_dict()
        if feature['type'] not in class_of_type:
            sys.exit(f'Do not know how to draw "{feature["type"]}". Please add it to CLASSES')

        class_name = class_of_type[feature['type']]
        latitude = feature['center_lat']
        longitude = to_map_longitude(feature['center_lon'])
        # "http://planetarynames.wr.usgs.gov/Feature/4453"
        feature_id = int(feature['link'].rsplit('/', 1)[1])
        if feature_id in seen:
            # The gazetteer lists a few features twice
            continue
        seen.add(feature_id)

        features.append(without_empty({
            'id': feature_id,
            'name': feature['name'],
            # "Mons, montes" is the singular and the plural form of the term
            'type': feature['type'].split(',')[0],
            'class': class_name,
            'lon': round(longitude, 4),
            'lat': round(latitude, 4),
            'size': round(feature['diameter'], 1 if feature['diameter'] < 100 else None),
            'box': get_box(feature, longitude),
            'many': is_plural(feature) or None,
            'named': get_name_origin(feature, class_name),
            'wiki': articles.get(str(feature_id)),
        }))

        if feature['type'] in UNLABELED_TYPES:
            continue

        width_to_appear, importance, _ = CLASSES[class_name]
        # How many times the feature is as known as a landmark has to be
        fame = readers.get(str(feature_id), 0) / LANDMARK_READERS
        zoom_gained = min(MAX_ZOOM_GAINED_BY_READERS, math.log2(1 + fame))
        properties = without_empty({
            'id': feature_id,
            'name': feature['name'],
            'class': class_name,
            'rank': round(feature['diameter'] * importance * (1 + fame)),
            'minzoom': round(max(0, get_zoom(feature['diameter'], latitude, width_to_appear) - zoom_gained), 2),
            'landmark': 1 if fame >= 1 else None,
        })
        if class_name == 'region':
            properties['maxzoom'] = get_zoom(feature['diameter'], latitude, REGION_MAX_WIDTH)
        labels.append(make_point(longitude, latitude, properties))

    for name, year, longitude, latitude, kind, article, about in LANDING_SITES:
        site_id = name.lower().replace(' ', '-')
        rover = ROVERS_WITH_PHOTOS.get(name)
        labels.append(make_point(longitude, latitude, without_empty({
            'id': site_id, 'name': name, 'class': 'landing', 'year': year,
            # "NASA rover" is a rover
            'kind': kind.split(' ')[-1], 'rover': rover
        })))
        features.append(without_empty({
            'id': site_id, 'name': name, 'type': kind, 'class': 'landing',
            'lon': longitude, 'lat': latitude, 'year': year, 'wiki': article, 'about': about, 'rover': rover
        }))

    save(labels_output, {'type': 'FeatureCollection', 'features': labels})
    save(features_output, features)

    print(f'Saved {len(labels)} labels to {labels_output}')
    landmarks = [label['properties']['name'] for label in labels if label['properties'].get('landmark')]
    print(f'{len(landmarks)} of them are landmarks:', ', '.join(landmarks))
    print(f'Saved {len(features)} features to {features_output}')
    print('Unicode ranges used by the names:', ' '.join(get_glyph_ranges(labels)))


def save(file_name, content):
    with open(file_name, 'w', encoding='utf-8') as file:
        json.dump(content, file, ensure_ascii=False, separators=(',', ':'))


def without_empty(record):
    return {key: value for key, value in record.items() if value not in (None, '')}


def is_plural(feature):
    """True for "Tharsis Montes": several mountains that share one name"""
    # The type is the singular and the plural form of a Latin term: "Mons, montes"
    forms = feature['type'].split(', ')
    if len(forms) != 2 or forms[0].lower() == forms[1].lower():
        return False
    return forms[1].lower() in feature['name'].lower().split()


def get_name_origin(feature, class_name):
    """
    Tells what the feature is named after, in the words that fit after "Named
    after". Returns nothing when the gazetteer has nothing interesting to say.
    """
    origin = feature['origin'].strip().rstrip('.')
    # A third of the names come from the old telescope maps, and the
    # gazetteer says just that: "Classical albedo feature name".
    if not origin or 'albedo' in origin.lower():
        return None

    # "1865-1945" reads better with a proper dash
    origin = re.sub(r'(\d)-(\d)', '\\1\u2013\\2', origin)

    # Craters are named after people as "Walter F.; Australian astronomer (1865-1945)",
    # and the family name is the name of the crater.
    person = re.match(r'^([^;"]{1,40}); (.+)$', origin)
    if class_name == 'crater' and person:
        return f'{person.group(1)} {feature["name"]}, {person.group(2)}'

    origin = re.sub(r'^(Named for|Named from|From) ', '', origin)
    return origin[0].upper() + origin[1:]


def to_map_longitude(longitude):
    """The gazetteer counts longitude from 0 to 360 degrees, the map from -180 to 180"""
    return longitude - 360 if longitude > 180 else longitude


def get_box(feature, longitude):
    """
    The rectangle that holds the entire feature: [west, south, east, north].
    West is always smaller than east, so for a feature that lies across the
    180th meridian one of them is outside of the -180..180 range.
    """
    width = (feature['max_lon'] - feature['min_lon']) % 360
    to_west = (feature['center_lon'] - feature['min_lon']) % 360
    if width == 0 or to_west > width:
        # The rectangle is either missing, or the center is outside of it
        return None

    west = longitude - to_west
    return [round(west, 3), round(feature['min_lat'], 3), round(west + width, 3), round(feature['max_lat'], 3)]


def get_zoom(diameter_km, latitude, width_in_pixels):
    """Zoom level at which a feature of the given size is that many pixels wide"""
    # mercator stretches everything that is away from the equator
    km_per_pixel = KM_PER_PIXEL_AT_ZOOM_0 * math.cos(math.radians(latitude))
    zoom = math.log2(width_in_pixels * km_per_pixel / max(diameter_km, 0.1))
    return round(max(0, zoom), 2)


def make_point(longitude, latitude, properties):
    return {
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [round(longitude, 4), round(latitude, 4)]},
        'properties': properties
    }


def get_glyph_ranges(features):
    """Font files are split by 256 characters. Tells which of them the labels need"""
    starts = set()
    for feature in features:
        # Regions are rendered in upper case
        name = feature['properties']['name']
        for char in name + name.upper():
            starts.add(ord(char) // 256 * 256)
    return [f'{start}-{start + 255}' for start in sorted(starts)]


if __name__ == '__main__':
    main()
