/**
 * Lets a visitor order a print of a picture that was drawn in their browser.
 *
 * The prints are made by Zazzle. A product there can be a template: one of
 * its images is replaced by the picture that a link to the product names. So
 * we store the picture where Zazzle can read it, and send the visitor to the
 * product with the address of the picture in the link. Zazzle prints it,
 * takes the payment and ships the print.
 */

// Stores a picture and tells its address
const UPLOAD_URL = 'https://edi6jgnosf.execute-api.us-west-2.amazonaws.com/Stage/put_image';
// Tells Zazzle who has sent the customer
const ASSOCIATE = '238058511445368984';
// The poster is 18 by 24 inches, the same shape as our picture. The customer
// can choose another size, the paper and a frame on the page of the product.
const POSTER = {
  product: '256889621547455028',
  // The name that the image has in the template
  image: 'image1'
};
// At this quality an eye cannot tell the picture from the PNG, even when it
// is magnified, and it is six times smaller: about 1 MB. The place that
// stores the pictures takes at most a few megabytes, a PNG does not fit.
const JPEG_QUALITY = 0.95;

/**
 * Resolves with the address of the page where the picture on the canvas can
 * be ordered as a poster.
 */
export function getPosterPrintLink(canvas) {
  const picture = canvas.toDataURL('image/jpeg', JPEG_QUALITY).replace(/^data:image\/jpeg;base64,/, '');
  const form = new FormData();
  form.append('image', picture);

  return fetch(UPLOAD_URL, { method: 'POST', body: form }).then(response => {
    if (!response.ok) throw new Error('Could not store the picture: ' + response.status);
    return response.json();
  }).then(answer => {
    if (!answer || !answer.success || !answer.data || !answer.data.link) throw new Error('Could not store the picture');
    return getProductLink(POSTER, answer.data.link);
  });
}

function getProductLink(product, pictureUrl) {
  const picture = encodeURIComponent(pictureUrl);
  return `https://www.zazzle.com/api/create/at-${ASSOCIATE}?rf=${ASSOCIATE}&ax=Linkover&pd=${product.product}` +
    `&ed=true&tc=&ic=&t_${product.image}_iid=${picture}`;
}
