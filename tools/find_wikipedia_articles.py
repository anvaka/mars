#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyshp"]
# ///
"""
Finds Wikipedia articles about the named features of Mars, so that the map
can show a few words and a picture of a feature when its name is clicked.

    uv run tools/find_wikipedia_articles.py data/gazetteer/shp tools/wikipedia_articles.json

The result maps the number of a feature in the Gazetteer of Planetary
Nomenclature to the title of its article. There are two ways to find one:

1. Wikidata knows the gazetteer number of many features (property P2824),
   and the article that describes each of them. This is the reliable way.
2. For the rest we try the titles that such an article would have ("Gale
   (crater)"), and take it only when there is an article with exactly this
   title, and Wikipedia itself says that it is about something on Mars.
"""
import glob
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import shapefile

USER_AGENT = 'mars-map-build/1.0 (script that builds a static map of Mars)'
WIKIDATA = 'https://query.wikidata.org/sparql'
WIKIPEDIA = 'https://en.wikipedia.org/w/api.php'
KNOWN_ARTICLES = '''
SELECT ?id ?title WHERE {
  ?item wdt:P2824 ?id .
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title .
}'''
# Wikipedia tells about this many titles per request
TITLES_PER_REQUEST = 50
ABOUT_MARS = re.compile(r'\b(Mars|Martian)\b', re.IGNORECASE)


def main():
    if len(sys.argv) != 3:
        sys.exit('usage: find_wikipedia_articles.py <folder with the shapefile> <output.json>')
    source_folder, output = sys.argv[1], sys.argv[2]

    features = {}
    reader = shapefile.Reader(glob.glob(source_folder + '/*.shp')[0], encoding='utf-8')
    for record in reader.records():
        feature = record.as_dict()
        features[feature['link'].rsplit('/', 1)[1]] = feature

    articles = {}
    known = load_json(WIKIDATA + '?' + urllib.parse.urlencode({'query': KNOWN_ARTICLES, 'format': 'json'}))
    for row in known['results']['bindings']:
        feature_id = row['id']['value']
        if feature_id in features:
            articles[feature_id] = row['title']['value']
    print(f'Wikidata knows articles of {len(articles)} features out of {len(features)}')

    candidates = {}
    for feature_id, feature in features.items():
        if feature_id in articles:
            continue
        name = feature['name']
        titles = [f'{name} (Martian crater)', f'{name} (crater)'] if feature['type'].startswith('Crater') else [name]
        for title in titles:
            candidates[title] = feature_id

    about_mars = find_articles_about_mars(list(candidates))
    guessed = 0
    # The more specific titles go first, so they win
    for title, feature_id in candidates.items():
        if title in about_mars and feature_id not in articles:
            articles[feature_id] = about_mars[title]
            guessed += 1
    print(f'Found {guessed} more by their titles')

    by_number = dict(sorted(articles.items(), key=lambda pair: int(pair[0])))
    with open(output, 'w', encoding='utf-8') as file:
        json.dump(by_number, file, ensure_ascii=False, indent=0)
    print(f'Saved {len(by_number)} articles to {output}')


def find_articles_about_mars(titles):
    """Maps those of the given titles that are articles about Mars to the real titles of the articles"""
    found = {}
    for start in range(0, len(titles), TITLES_PER_REQUEST):
        asked = titles[start:start + TITLES_PER_REQUEST]
        answer = load_json(WIKIPEDIA + '?' + urllib.parse.urlencode({
            'action': 'query', 'format': 'json', 'formatversion': 2, 'redirects': 1,
            'prop': 'description|pageprops', 'ppprop': 'disambiguation',
            'titles': '|'.join(asked)
        }))['query']

        # Wikipedia may fix the spelling of a title
        spelled = {change['from']: change['to'] for change in answer.get('normalized', [])}
        final_title = {title: spelled.get(title, title) for title in asked}
        # A title that leads to another article is not what we look for: "Lunae
        # Planum" takes to the article about the map sheet it is on, and the
        # craters without an article - to the list of all craters.
        redirected = {change['from'] for change in answer.get('redirects', [])}

        pages = {page['title']: page for page in answer.get('pages', [])}
        for title, now in final_title.items():
            page = pages.get(now)
            if now in redirected or not page or page.get('missing') or 'disambiguation' in page.get('pageprops', {}):
                continue
            if ABOUT_MARS.search(page.get('description', '')):
                found[title] = now
        time.sleep(1)
    return found


def load_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
    pause = 5
    while True:
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # "Too many requests": the server asks to slow down
            if error.code != 429 or pause > 300:
                raise
            wait = int(error.headers.get('Retry-After') or pause)
            print(f'{urllib.parse.urlsplit(url).netloc} asks to wait, trying again in {wait} seconds')
            time.sleep(wait)
            pause *= 2


if __name__ == '__main__':
    main()
