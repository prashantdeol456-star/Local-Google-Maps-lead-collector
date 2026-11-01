# Lead Platform – working rules

## Keep the user guide in step with every feature

The admin panel has a Guide page (`/admin/guide`, PDFs in `admin/public/guide`) and a
"📘 Guide" button on every page that opens that page's section. Whenever a feature is added
or changed, in the same change:

1. Update `admin/src/guide/content.ts`: add or edit the section that explains it, and list the
   menu path(s) it explains in `pages` (new menu items live in `admin/src/components/nav.ts`).
   Customer features use `audience: "all"`, super-admin-only ones `audience: "admin"`.
2. New screen worth showing? Reference it with `img("NN-name", "caption")` and add the same
   name to `SHOTS`/`shoot()` in `scripts/guide/build.mjs` (with any demo data it needs in `seed()`).
3. Run `npm run guide:build` (needs Chrome) to retake all screenshots and print both PDFs from a
   throw-away demo database, then commit `admin/public/guide`.
4. Update the "remaining work" table (section `admin-roadmap`) when something there is done or new
   work is agreed.

`npm test -w admin` (tests/guide.test.ts) fails when a menu page has no guide section or a section
points to a screenshot that does not exist.

## Other rules

- Replies to the project owner are in Hinglish.
- Never commit `.env`; never put API keys or passwords in code, chat or the extensions.
- Pushing does not deploy: trigger a deploy of the Render service after pushing.
- Stop the local dev server before running migrations against the local SQLite database.
