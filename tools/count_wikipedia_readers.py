#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Counts how many times a month the Wikipedia articles about the features of
Mars are read. The map has two thousand names, and this is
how it tells Olympus Mons from a ridge that nobody has heard of: the names
that people read about are drawn brighter, and appear earlier.

    uv run tools/count_wikipedia_readers.py tools/wikipedia_articles.json tools/wikipedia_readers.json

The first file is made by tools/find_wikipedia_articles.py. The result maps
the number of a feature in the gazetteer to the number of readers, and it is
used by tools/build_labels.py
"""
import json
import statistics
import subprocess
import sys
import time
import urllib.parse

WIKIPEDIA = 'https://en.wikipedia.org/w/api.php'
# Wikipedia tells about this many titles per request
TITLES_PER_REQUEST = 50
# The readers are counted over this many last days
DAYS = 60
# Wikipedia turns away those who ask too often
SECONDS_BETWEEN_REQUESTS = 1
SECONDS_TO_WAIT_WHEN_REFUSED = [10, 30, 60, 120]


def main():
    if len(sys.argv) != 3:
        sys.exit('usage: count_wikipedia_readers.py <wikipedia_articles.json> <output.json>')
    with open(sys.argv[1], encoding='utf-8') as file:
        articles = json.load(file)

    titles = sorted(set(articles.values()))
    readers = {}
    for start in range(0, len(titles), TITLES_PER_REQUEST):
        readers.update(count_readers(titles[start:start + TITLES_PER_REQUEST]))
        print(f'{min(start + TITLES_PER_REQUEST, len(titles))} of {len(titles)} articles', flush=True)

    result = {feature_id: readers.get(title, 0) for feature_id, title in articles.items()}
    with open(sys.argv[2], 'w', encoding='utf-8') as file:
        json.dump(result, file, indent=0, sort_keys=True)

    known = sum(1 for count in result.values() if count)
    print(f'Saved the readers of {known} articles to {sys.argv[2]}')
    by_readers = sorted(articles.items(), key=lambda item: -result[item[0]])
    print('The most read:', ', '.join(f'{title} ({result[feature_id]})' for feature_id, title in by_readers[:15]))


def count_readers(titles):
    """Returns `{title: readers per month}` for the given titles"""
    query = {
        'action': 'query', 'prop': 'pageviews', 'pvipdays': DAYS, 'titles': '|'.join(titles),
        # A title may have moved since we have found it
        'redirects': 1, 'format': 'json', 'formatversion': 2
    }
    days_of = {}
    # Where the titles that we have asked about have ended up
    moved = {}
    # A small crater often has no article of its own: its title leads to a
    # line in a list of craters, and the readers of the list are not its readers.
    parts_of_other_articles = set()
    while True:
        answer = load_json(WIKIPEDIA + '?' + urllib.parse.urlencode(query))
        for record in answer['query'].get('normalized', []):
            moved[record['from']] = record['to']
        for record in answer['query'].get('redirects', []):
            moved[record['from']] = record['to']
            if record.get('tofragment'):
                parts_of_other_articles.add(record['from'])
        for page in answer['query'].get('pages', []):
            if page.get('pageviews'):
                days_of[page['title']] = page['pageviews']

        # Wikipedia may give the counts in several pieces
        if 'continue' not in answer:
            break
        query.update(answer['continue'])

    result = {}
    for title in titles:
        final = title
        is_own_article = True
        while final in moved:
            is_own_article = is_own_article and final not in parts_of_other_articles
            final = moved[final]
        result[title] = get_readers_per_month(days_of.get(final, {})) if is_own_article else 0
    return result


def get_readers_per_month(days):
    """
    The `days` maps a date to the number of readers. A crawler may read an
    article thousands of times in one day, so we count from the median day.
    """
    counts = [count for count in days.values() if count is not None]
    return round(statistics.median(counts) * 30) if counts else 0


def load_json(url):
    for pause in SECONDS_TO_WAIT_WHEN_REFUSED + [None]:
        time.sleep(SECONDS_BETWEEN_REQUESTS)
        result = subprocess.run(
            ['curl', '-sS', '-f', '-L', '--max-time', '60', '-A', 'mars-map-tools', url],
            capture_output=True, check=False
        )
        if result.returncode == 0:
            return json.loads(result.stdout)
        if pause is None:
            sys.exit(f'Could not load {url}: {result.stderr.decode().strip()}')
        time.sleep(pause)


if __name__ == '__main__':
    main()
