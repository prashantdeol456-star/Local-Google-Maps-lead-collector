// Every Google Maps DOM selector and text marker lives here. When Maps changes its
// layout, this is the file to update. Prefer stable hooks (roles, aria-labels,
// data-item-id) over generated class names.
// Verified against google.com/maps (English UI) on 2026-10-05.

export const SELECTORS = {
  /** Scrollable results list. */
  resultsFeed: 'div[role="feed"]',
  /** One link per result card; aria-label = business name, href = place URL. */
  resultLink: 'a[href*="/maps/place/"]',

  /** Detail panel of an opened place; aria-label = business name. */
  detailPanel: 'div[role="main"][aria-label]',
  detailName: "h1",
  detailCategory: 'button[jsaction*="category"]',
  /** e.g. aria-label "4.2 stars " */
  detailRating: '[role="img"][aria-label*="star" i]',
  /** e.g. aria-label "1,262 reviews", text "(1,262)" */
  detailReviews: '[role="img"][aria-label*="review" i]',
  detailAddress: '[data-item-id="address"]',
  /** data-item-id "phone:tel:08957926677" */
  detailPhone: '[data-item-id^="phone:tel:"]',
  /** Only the business's own website ("authority"), not WhatsApp/booking links. */
  detailWebsite: 'a[data-item-id="authority"]',

  backButton: 'button[aria-label="Back"]',

  /** Search box (its id was removed by Maps in 2026; the name is stable). Verified 2026-10-06. */
  searchBox: 'input[name="q"]',
  /** Page chrome the AI must never see or click: the Google bar (account, apps) and the map footer. */
  aiExcludedRegions: '#gb, [role="contentinfo"], form[action*="consent"], iframe',

  /** Security challenges */
  recaptchaFrame: 'iframe[src*="recaptcha"], iframe[title*="reCAPTCHA" i]',
  consentForm: 'form[action*="consent.google"]',
} as const;

export const TEXT_MARKERS = {
  endOfList: ["You've reached the end of the list"],
  /** Shown to signed-out users; Maps then stops loading more results. */
  limitedView: ["You're seeing a limited view of Google Maps"],
  unusualTraffic: ["unusual traffic from your computer network", "Our systems have detected unusual traffic"],
} as const;

/** Parts of a place URL: /data=!...!1s<featureId>!...!3d<lat>!4d<lng>!...!19s<placeId> */
export const PLACE_URL_PATTERNS = {
  featureId: /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i,
  latitude: /!3d(-?\d+(?:\.\d+)?)/,
  longitude: /!4d(-?\d+(?:\.\d+)?)/,
  placeId: /!19s(ChIJ[A-Za-z0-9_-]+)/,
} as const;
