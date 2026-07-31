# PDF Text to Speech Regression Checklist

## Core

1. Open a small PDF.
2. Verify the file is recognized.
3. Start listening.
4. Verify first audio starts quickly enough and does not re-import the same browser PDF on every `Play`.
5. Pause.
6. Resume.
7. Use `Start over` and verify playback restarts from the beginning.
8. Start from a specific page.
9. Verify `Page X of Y` stays in sync with playback.
10. Verify `Jump to current page` moves the viewer to the current page.

## Open Paths

1. Upload a local PDF through the extension.
2. Verify the controlled preview tab opens.
3. Open a local `file://` PDF directly in Chrome.
4. Verify the extension detects it as `PDF in current tab`.
5. Switch from the current document to that tab PDF.
6. Verify playback starts on the switched PDF.
7. Disable `Allow access to file URLs`.
8. Open a local `file://` PDF again.
9. Verify the extension shows file-access guidance and keeps it visible until access is actually granted.

## Trial

1. Verify daily limit is shown correctly.
2. Verify there is no paid warning on the first screen before trial is exhausted.
3. Exhaust the limit.
4. Verify trial-ended message is clear.
5. Verify the message explains:
   - return tomorrow
6. Verify free listening allows up to `10 minutes each day`.
   - or upgrade now

## Billing

1. Signed-out paywall state.
2. Signed-in unpaid paywall state.
3. Paid state in drawer.
4. Verify `Change plan` opens Stripe Billing Portal.
5. Verify `Cancel subscription` opens Stripe Billing Portal.
6. Verify return page after portal is correct.
7. Verify paid state shows:
   - `Renews on ...`
   - or `Ends on ...`

## PDF-specific Regression Risks

1. Large PDF first start is still acceptable.
2. Reopening saved PDF still works.
3. Saved sections still appear after switching to another PDF.
4. Two-column PDFs still read in a sane order.
5. Reading language override changes playback language without breaking start/resume.
6. Language list includes the main active-market options:
   - English
   - Spanish
   - Russian
   - German
   - Portuguese (Brazil)
   - Turkish
   - Japanese
   - Korean
   - Hindi
   - Bengali
   - Chinese (Simplified)
   - Chinese (Traditional)
   - Thai
   - Danish
7. `Reading sounds wrong?` opens the structured picker and sends analytics without opening mail.
8. Uploaded PDF preview keeps page jumps working.

## Release Gate

Do not publish if any of these is true:

- Main CTA is disabled without explanation.
- First playback hangs in `Preparing...` without a clear error.
- Local `file://` PDFs fail silently instead of showing file-access guidance.
- `Play from page` changes audio position but not the preview page.
- `Jump to current page` does not move the preview.
- Viewer switching stops the current document without starting the selected one.
- Paywall copy does not match the actual daily limit.
