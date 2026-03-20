# FocusTrace Change Reference

This file is the working reference for future changes to the Chrome extension and related website.

## Production Setup

- Extension folder: [FocusTrace](/Users/n.khorokhorina/Self/FocusTrace)
- Production domain: `https://pdftext2speech.com`
- Public pages:
  - `https://pdftext2speech.com/`
  - `https://pdftext2speech.com/pricing`
  - `https://pdftext2speech.com/support`
  - `https://pdftext2speech.com/privacy`
- Support email: `support@pdftext2speech.com`

## Important Architecture Notes

- The live production API used by the extension is `https://pdftext2speech.com`.
- The extension sends extracted PDF text to the backend for TTS generation.
- The backend uses OpenAI for speech generation.
- The product includes `5` free minutes, then paid listening through Stripe.
- The server currently in real use on Hetzner is the existing backend at `/root/FocusTrace/ai-server`.
- Do not assume `/var/www/Self/FocusTrace/server.js` is the production backend. The extension was aligned to the existing server API instead.

## Current API Contract Used by the Extension

- `GET /me`
- `POST /tts`
- `POST /checkout`
- `POST /portal`

The extension must send a device token with requests:

- Header: `x-device-token`

## Extension Behavior That Must Stay True

- Reads text from PDFs opened in the browser or from local PDF files.
- Sends extracted text to `pdftext2speech.com` for audio generation.
- Uses a stored device token for usage limits and subscription state.
- Shows a free trial limit of `5` minutes, then requires payment.
- Uses Stripe for billing flows.

## Manifest / Review Notes

- Keep permissions minimal.
- `activeTab` was intentionally removed and should not be reintroduced unless there is a real product need.
- Host access is needed for:
  - browser-opened PDF files
  - local PDF files
  - `pdftext2speech.com` API access
- The extension does not use remote code execution.
- Privacy policy URL:
  - `https://pdftext2speech.com/privacy`

## Website Notes

- Static site source is in [site](/Users/n.khorokhorina/Self/FocusTrace/site)
- Files:
  - [index.html](/Users/n.khorokhorina/Self/FocusTrace/site/index.html)
  - [pricing.html](/Users/n.khorokhorina/Self/FocusTrace/site/pricing.html)
  - [support.html](/Users/n.khorokhorina/Self/FocusTrace/site/support.html)
  - [privacy.html](/Users/n.khorokhorina/Self/FocusTrace/site/privacy.html)
  - [site.css](/Users/n.khorokhorina/Self/FocusTrace/site/site.css)
- These files are intended to be served by `nginx` as static pages.

## Before Changing the Extension

Check these first:

1. Does the change affect the live backend contract (`/me`, `/tts`, `/checkout`, `/portal`)?
2. Does the change alter what user data is processed or disclosed?
3. Does the change require new permissions or broader host access?
4. Does the change affect Chrome Web Store listing accuracy?
5. Does the change affect the free `5` minute limit or Stripe paywall behavior?

## After Changing the Extension

Run this checklist:

1. Reload the unpacked extension in `chrome://extensions/`.
2. Test a browser-opened PDF.
3. Test a local PDF file.
4. Confirm TTS still works against `https://pdftext2speech.com`.
5. Confirm paywall and checkout still open correctly.
6. Re-check `https://pdftext2speech.com/privacy` if privacy-related text changed.
7. If store-relevant behavior changed, update listing text and review answers.
