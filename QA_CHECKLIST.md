# PDF Text to Speech QA Checklist

Use this checklist after any change to `pdf text to speech`, especially when touching:
- pricing
- trial limits
- auth
- checkout
- billing portal
- playback flow
- PDF parsing

## Release Gate

Do not ship if any of these fail:
- sign-in flow does not return cleanly
- checkout does not open or returns to the wrong page
- paid users can start a second duplicate subscription
- billing portal opens but cannot manage the subscription
- trial copy, site copy, and live limit values disagree
- first playback is broken or noticeably worse than before
- saved sections / recent PDFs disappear from the UI

## Pricing

Verify all pricing surfaces match the live Stripe configuration:
- backend `/plans` returns the expected monthly and yearly prices
- popup paywall shows the same prices
- standalone paywall shows the same prices
- site pricing page shows the same prices
- billing notes match the correct interval:
  - monthly -> `Billed monthly ... / month`
  - yearly -> `Billed annually ... / year`

Files to check when pricing changes:
- [server.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/server.js)
- [background.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/background.js)
- [popup.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/popup.js)
- [paywall.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/paywall.js)
- [site/pricing.html](/Users/n.khorokhorina/pdf%20text%20to%20speech/site/pricing.html)

## Trial

Verify trial behavior:
- guest user sees the correct daily free limit
- trial-ended copy matches the real product policy
- last free seconds do not reappear after reopening the extension
- paid users do not see trial-ended messaging
- site copy matches the actual limit

Check:
- [popup.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/popup.js)
- [background.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/background.js)
- [server.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/server.js)
- [site/index.html](/Users/n.khorokhorina/pdf%20text%20to%20speech/site/index.html)
- [site/pricing.html](/Users/n.khorokhorina/pdf%20text%20to%20speech/site/pricing.html)

## Auth

Verify sign-in flow:
- sign-in starts from popup paywall
- Google auth opens correctly
- success page appears after login
- return goes back to the page the user came from
- signed-in state refreshes in the extension without stale loading UI

Check:
- [popup.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/popup.js)
- [background.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/background.js)
- [server.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/server.js)

## Checkout

Verify checkout behavior:
- signed-out user is asked to sign in first
- signed-in unpaid user can open Stripe Checkout
- paid user cannot create a second active subscription
- checkout success page appears
- return goes back to the expected page

Check:
- [popup.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/popup.js)
- [background.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/background.js)
- [server.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/server.js)

## Billing Portal

Verify subscription management:
- paid user can open billing portal
- `Change plan` opens the portal
- `Cancel subscription` opens the portal
- portal return page shows the correct status
- canceled subscriptions show:
  - active until period end
  - no misleading paid copy

Check:
- [popup.html](/Users/n.khorokhorina/pdf%20text%20to%20speech/popup.html)
- [popup.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/popup.js)
- [background.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/background.js)
- [server.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/server.js)

## Playback

Verify playback flow:
- first playback starts within an acceptable time on a normal PDF
- reopening the popup does not lose active state unexpectedly
- pause, resume, and stop all work
- playback usage is flushed correctly
- paid and free quotas update correctly after listening

Check:
- [popup.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/popup.js)
- [background.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/background.js)
- [server.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/server.js)

## PDF Parsing

Verify text extraction quality:
- normal single-column PDFs read in the right order
- two-column PDFs do not jump between columns every few lines
- long PDFs still begin playback acceptably fast
- complex PDFs do not lose recent document state

Check with at least:
- one simple PDF
- one long PDF
- one two-column PDF

## Library And Saved Sections

Verify library behavior:
- recent PDF remains visible after closing and reopening
- saved sections remain accessible after opening another PDF
- `Open PDF` on saved/recent items works
- resume card works when resume data exists

Check:
- [popup.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/popup.js)

## Analytics

Verify analytics integrity:
- `purchase` is emitted once per real payment
- no client-side duplicate purchase event remains
- trial and paywall events still fire

Check:
- [server.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/server.js)
- [popup.js](/Users/n.khorokhorina/pdf%20text%20to%20speech/popup.js)

## Store Package

Before packaging:
- bump `manifest.json` version if this is a new store upload
- verify runtime files only
- exclude:
  - `server.js`
  - `site/` unless explicitly needed for the package
  - docs
  - env files
  - scripts

## Minimum Manual Test Pass

Run this every time before release:
1. Load unpacked extension.
2. Test guest flow with free listening.
3. Exhaust trial and open paywall.
4. Test sign-in from paywall.
5. Test checkout open.
6. Test paid state.
7. Test billing portal open.
8. Test one simple PDF playback.
9. Test one large PDF playback.
10. Test one two-column PDF.
11. Test saved sections after switching PDFs.
