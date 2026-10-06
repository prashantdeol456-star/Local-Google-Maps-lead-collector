// Meta WhatsApp error codes that change what we do next
// (developers.facebook.com → WhatsApp → Support → Error codes, checked 2026-10-06).

/**
 * Caused by the account or the template, not by one recipient: sending to the next lead
 * would fail the same way, so the campaign is paused instead.
 * 190 token · 368/131031 account restricted · 131042 billing · 131048 spam restriction ·
 * 132000/132012/132018 parameters don't match the template · 132001 template missing or
 * not approved · 132005/132007 template text · 132015/132016 template paused/disabled ·
 * 133010 phone number not registered.
 */
export const SETUP_ERROR_CODES = new Set([190, 368, 131031, 131042, 131048, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 132018, 133010]);

/** The recipient stopped marketing messages from this business: do not message them again. */
export const STOPPED_MARKETING = 131050;
