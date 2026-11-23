/**
 * Gets a few words and a picture of a Wikipedia article.
 *
 * https://en.wikipedia.org/api/rest_v1/#/Page%20content/get_page_summary__title_
 */
const SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
// Wikipedia resizes pictures only to a few sizes. This one is enough for the
// card on a screen of any density.
const IMAGE_WIDTH = 960;

const summaries = new Map();

/**
 * Resolves with `{text, image, smallImage, link}` of the article with the
 * given title. `image` may be missing. Rejects when there is no such article,
 * or Wikipedia cannot be reached.
 */
export function loadSummary(title) {
  let summary = summaries.get(title);
  if (!summary) {
    const url = SUMMARY_URL + encodeURIComponent(title.replace(/ /g, '_'));
    summary = fetch(url).then(response => {
      if (!response.ok) throw new Error('Wikipedia has no summary of ' + title);
      return response.json();
    }).then(page => {
      if (page.type !== 'standard' || !page.extract) throw new Error('Not an article: ' + title);
      return {
        text: tidy(page.extract),
        image: getImage(page),
        smallImage: page.thumbnail && page.thumbnail.source,
        link: page.content_urls.desktop.page
      };
    });
    summary.catch(() => summaries.delete(title));
    summaries.set(title, summary);
  }
  return summary;
}

function getImage(page) {
  if (!page.thumbnail || !page.originalimage) return null;

  // The original may be a hundred megabytes large, but when it is small
  // there is nothing to resize.
  const original = page.originalimage;
  if (original.width <= IMAGE_WIDTH && !/\.svg/i.test(original.source)) return original.source;
  // ".../330px-Olympus_Mons.jpg" is the same picture, 330 pixels wide
  return page.thumbnail.source.replace(/\/\d+px-/, `/${IMAGE_WIDTH}px-`);
}

function tidy(text) {
  // Articles about the features of Mars like to cite their number in the
  // catalog, which tells nothing to a reader.
  return text.split(/(?<=[.!?])\s+/)
    .filter(sentence => !/Gazetteer of Planetary Nomenclature/i.test(sentence))
    .join(' ').trim();
}
