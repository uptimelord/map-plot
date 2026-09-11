# LotLens deployment and release notes

This revision is a hardened pilot, not a production-certified land-survey system. Do not promise that an automatically accepted result establishes a legal boundary. The current Google path is implemented and tested with mocked responses; it still needs credentials and evaluation against real, consented Philippine documents.

## Current parsing mode (2026-09-12)

Gemini-only parsing is the default paid path, using exact model `gemini-3.5-flash-lite` and a required JSON output schema. Google Vision is optional: setting `GOOGLE_VISION_API_KEY` adds independent OCR cross-checking. Without that key, schema, completeness, ambiguity, datum, geography, polygon, closure and stated-area checks still apply, but cannot detect every confidently misread number. Results explicitly report single-model verification. Do not represent these as independently verified coordinates.

The local `.env` contains the supplied Gemini credential and generated helper/session secrets and is ignored by Git. Live testing attempted a synthetic document; Google returned HTTP 429 RESOURCE_EXHAUSTED because project prepayment credits are depleted. No successful live extraction has been verified. Add credits in AI Studio and rerun the synthetic and real-document validation. Do not paste credentials into the browser UI.

## What is automatic

- A photo starts reading immediately. Supported uploads: JPG, PNG, WEBP, up to 15 MB and 40 megapixels. Minimum short dimension: 600 pixels.
- Free browser reading prepares original and contrast-enhanced images, runs OCR twice, and compares coordinates. Numeric OCR confidence must pass, WGS 84 must be printed, the row count must be explicit or closed, and polygon checks must pass. Agreement is a heuristic, not a calibrated correctness probability.
- Optional Google mode independently sends the image to Cloud Vision DOCUMENT_TEXT_DETECTION and Gemini Flash-Lite. Gemini extracts structured document fields. Code validates their types, checks OCR agreement, printed datum, completeness, multiple-lot flags, numeric confidence, geometry and stated area when present. Neither provider gets the other's answer.
- Bearings can produce a shape without a geographic location. The tool does not invent BLLM coordinates, treat a tie line as a boundary course, or substitute the owner's current GPS position. PRS92, Luzon 1911 and local grids require verified datum/zone/reference conversion. This conversion and a verified control-point registry are not implemented.
- Ambiguous results do not export KML or replace a missing location with guessed coordinates. Helper details can be downloaded locally. Oversized, unsupported and malformed inputs receive readable errors.

## Private server setup

1. Use Node 22 or later and `npm ci`. Copy `.env.example` to `.env` privately; the file is ignored by Git.
2. In Google Cloud, enable Cloud Vision API and create an API-restricted server key for it. Set `GOOGLE_VISION_API_KEY`. Vision is optional and may be left blank. Configure a Gemini server key as `GEMINI_API_KEY` in a billing-enabled project. Do not use Gemini's unpaid service for personal titles. Do not paste credentials into chat or the application.
3. Set a strong `APP_ACCESS_CODE` (at least 12 characters) and random `SESSION_SECRET` (at least 32 characters). A trusted helper unlocks Google reading on each device for 12 hours. API keys never leave the server.
4. Set `APP_ORIGIN` to the exact public HTTPS origin, `NODE_ENV=production`, and a suitable `HOST`/`PORT`. Terminate HTTPS at a trusted reverse proxy with upload limits and rate limiting. For local development the defaults are `http://127.0.0.1:5173`.
5. Start with `npm start`. `/healthz` checks the process. `/api/config` reports only availability and authentication state, never secret values. All API responses are no-store.
6. The helper enables "Use Google to read my document" before uploading. Google receives the photo; LotLens does not persist the photo or OCR results on its server. Review provider retention and data terms with the owner.

## Hosting compatibility

The existing Site identity is preserved. `npm run build` creates a Worker-compatible bundle at `dist/server/index.js`, embeds only public assets, and copies the hosting manifest and schema-only migrations to `dist/.openai`. The manifest requests D1 binding `DB`. Native Sharp is used only by the alternate Node backend; the Worker receives a browser-prepared PNG and validates its dimensions and framing before Google decodes it.

For Sites, configure server-side `GEMINI_API_KEY`, `GOOGLE_VISION_API_KEY`, and a random `QUOTA_SALT` of at least 32 characters, plus optional `DAILY_SCAN_LIMIT` and `GEMINI_MODEL`. Provision the D1 binding and apply the included migrations through Sites deployment. Sites uses ChatGPT sign-in; do not expose this Worker through a route bypassing the Sites dispatcher, because identity headers are trusted only there. No secret belongs in browser JavaScript. Keep access private while evaluating documents.

The Sites backend has durable, atomic D1 limits: six attempts per user per minute, two concurrent paid scans, and a shared daily scan allowance (100 by default), surviving Worker restarts. Expiring leases recover from interrupted executions. D1 stores salted user hashes, counters and expiry times, never photos or extracted text. The Node server above remains an alternative for local testing or a separately managed host. No new version has been published by this revision.

## Usage controls and privacy

- For the alternate Node server: two simultaneous scans per process; six scans/minute/session; five login attempts per ten minutes per remote connection address; 100 scans/day/process by default (`DAILY_SCAN_LIMIT`). Each scan invokes two services, with at most one retry each for explicit transient responses. These are request caps, not dollar caps.
- Node sessions and counters are in memory: a restart invalidates sessions and resets counters. Run one instance initially. Multiple instances require shared durable session/rate/quota storage or gateway enforcement. Set Google-side quotas and billing alerts before activation; alerts alone do not impose a spending cap.
- 15 MB streamed request limit, 40 MP decoded image limit, supported image decoder formats, 60-second provider deadline, client cancellation, strict same-origin requests, HttpOnly SameSite cookies (Secure in production), and no cross-origin API access.
- Logs are off by default. Optional logs contain request ID, route class, status, duration; never bodies, photos, model output, keys, cookies or query strings. Do not enable request-body capture at your host or proxy.
- MapLibre and browser OCR currently load pinned major/specific versions from CDNs; Google font files, OCR language files, and map tiles require internet access. Vendor and pin exact tested browser/OCR assets before a public release. Obtain a production tile provider agreement or provision your own tiles; this pilot uses Esri imagery and the public OSM tile endpoint.

## Required release validation

Run `npm test` and `npm audit`. Live paid-provider extraction is blocked by depleted prepayment credits. Validate with licensed geodetic engineering input using a consented, redacted corpus of representative Philippine titles: WGS84 tables, PRS92/Luzon/grid documents, BLLM ties, multi-page descriptions, faint photocopies, skew, glare, rotation, incomplete pages, multiple lots, handwriting, OCR digit/hemisphere/sign errors and intentionally misleading text. Record false acceptance, coordinate accuracy, abstention, latency and cost. Set acceptance thresholds from this evidence, not the model's self-reported confidence. Establish who handles unresolved documents.

Test older Android and iPhone devices and low-vision users, including camera capture, browser zoom, screen readers, text scaling, cancellation and slow/offline connections. Current UI has large controls, 18 px base text, optional speech, mobile upload-first layout and helper-only detailed fields. Real-device camera and screen-reader checks are still required. Multi-page merging, PDFs, offline maps and HEIC conversion are not implemented.

## Verification on 2026-09-12

Automated geometry, extraction, HTTP authentication and consent, provider failure, malformed input, and SQLite-backed quota tests pass. Browser testing successfully read a synthetic photo and withheld mapping because numeric confidence did not meet the threshold. This is evidence of abstention behavior, not evidence of OCR accuracy on real titles. Live Google calls, the deployed Worker/D1 integration, and real-device camera testing remain outstanding.

## Provider references (checked 2026-09-11)

- Cloud Vision pricing: https://cloud.google.com/vision/pricing — Document Text Detection first 1,000 units/month free; $1.50/1,000 for the next pricing band, excluding other hosting costs.
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing — model configurable; historical pilot model `gemini-2.5-flash-lite` was $0.10/million text/image input tokens and $0.40/million output tokens; these figures do not describe the current 3.5 model. OCR/page cost varies by resolution, output, retries and number of provider calls.
- Gemini terms: https://ai.google.dev/gemini-api/terms — unpaid-services data terms are unsuitable for confidential/personal title uploads; review paid-service and regional terms.
- Philippine reference systems: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/48061 and https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/49164 .
