# Nanny Tracker mobile and family-management audit

22 October 2026 · repository `TechCorp25/nanny-tracker`
Base inspected: `2227b5f5066da8653fee28d49c3cae262b27ccad`
Branch: `fix/family-editing-mobile`

## Delivery status

Implemented and tested locally; prepared for publication on the review branch `fix/family-editing-mobile`. Authenticated GitHub connector access was recovered after correcting the account routing identifier. No production deployment or production database changes were performed.

## Findings and changes

| Finding | Resolution |
|---|---|
| New segmented shifts competed with an exposed legacy single-rate form. Guidance told users to create separate shifts for service changes. | One segmented form supports both current child-specific profiles and older multi-service profiles. Updated guidance. |
| Two rate creation forms, a separate child-add workflow and duplicated table/cards made Families & Rates confusing. | One rate creation form, one rate-history card view, and family editing as the single child-management workflow. Old API routes remain for compatibility; legacy UI is removed. |
| Families and children had creation endpoints only. Name snapshots made correction difficult. | Edit actions from the list and expanded details. Correct names, add children, remove accidental additions, archive linked children, and restore. Current rate views resolve names from current child/family records. |
| Grid children, native controls and nowrap tables could force overflow. The mobile shift presentation stopped at 680px, excluding 812px landscape. | Explicit minimum-width constraints, wrapping, 16px input text, 44px controls, stacked table rows through 840px, portrait navigation, and a two-column short-landscape shift layout. |
| Fixed notices could cover content; viewport metadata omitted safe areas. | In-flow notices, safe-area padding, viewport-fit=cover, scrollable dynamic-height dialogs, no fixed action overlays. |
| Sign out rendered white text on a white button. | Explicit high-contrast header button styling. |
| Tab state did not support browser navigation or direct links. | Stable hashes for Overview, Work Log, Expenses and Families & Rates, including back/forward handling. Form DOM remains mounted when switching tabs or rotating. |
| Mobile Recent Shifts omitted the desktop delete control. | Same delete action available on mobile cards, retaining the existing confirmation. |

No separate unused HTML screens were present: the public application is a single-page document with four primary views. CSV exports, receipts, reports and payment status remain available.

## Data integrity

Family changes are committed atomically using a MongoDB transaction. Revision checks reject stale edits; duplicate and invalid names are validated. The server checks references in rate profiles and historical shifts when choosing removal versus archive semantics.

Unlinked removal hides the child but deliberately retains its identity as a tombstone. Linked removal archives it, preserving all references. Archived children are excluded from new rate combinations; profiles containing them are excluded from new shift choices and rejected by the shift endpoint. Existing profiles remain visible in history. Restore makes them available again. Removed/archived names remain reserved to prevent accidental duplicate identities.

Family editing writes only family/child metadata. Existing rate documents, saved Rate IDs, shift snapshots, expense documents, payment records and earnings are not rewritten. New shifts snapshot corrected current names. Old unnamed profiles cannot be reliably attributed to a child and remain available through the unified form.

MongoDB transactions require a replica set; the existing Atlas configuration supports this. No migration or new production secret is required.

## Verification performed

`npm test`: **20 passing tests**, plus syntax checks of all application modules.

`npm run test:browser`: **passed** using headless Chromium 134, the actual Express application, authenticated sessions and a disposable MongoDB 7.0.14 replica set. All screenshot data is synthetic. No production database was accessed.

| Emulated viewport | Coverage and result |
|---|---|
| 375 × 812, DPR 3, touch/mobile | All four views, family editor, controls, rate selection, expense form and receipt input; no page overflow. |
| 812 × 375 | All four views and dialog, two-column shift layout; no page overflow. Family draft preserved through rotation. |
| 375 × 390 | Reduced-height stress test for scrolling and reachable dialog actions; no page overflow. This does not emulate the actual iOS keyboard. |
| 1440 × 900 | All four views, tables, forms and dialog remain usable; no page overflow. |

Browser integration covered:

- Name correction, unlinked removal, archive, restore and rejected stale edits.
- Archived-profile rejection when creating a shift.
- Invalid duplicate child names rejected without changing the family.
- Exact before/after equality of stored rate, shift and expense documents across family edits; unchanged dashboard totals.
- Cancel leaves the saved family unchanged.
- Child addition and creation of a two-child combination rate.
- Saving a child-specific shift and a two-segment legacy shift with different services ($32.50 expected total).
- Receipt image selection through the camera input and storage through the actual upload endpoint; expense editing and category reporting.
- CSV export returns successfully.
- No JavaScript page errors.
- Invalid sign-in displays a visible error while leaving the application hidden.
- Five concurrent archive/shift races serialize on the family revision; new shifts are rejected if archival commits first, and a shift that commits first is timestamped before the archive.

The iPhone 13 mini CSS viewport was cross-checked against the browser-emulation vendor's device reference: [Blisk iPhone 13 mini](https://blisk.io/devices/details/iphone-13-mini), 375 × 812 CSS px, DPR 3. Landscape uses 812 × 375. Browser controls reduce the usable visual viewport; hardware pixel dimensions should not be substituted for CSS dimensions.

## Screenshots

Full-page screenshots capture scrollable content beyond one screen. The family editor has separate top and action-area captures.

- [Portrait families and rates](screenshots/chromium-portrait-profiles.png)
- [Family editor](screenshots/chromium-family-editor.png)
- [Family editor Save and Cancel](screenshots/chromium-family-editor-actions.png)
- [Portrait shift entry and recent shifts](screenshots/chromium-portrait-work.png)
- [Landscape shift entry and recent shifts](screenshots/chromium-landscape-work.png)
- [Portrait expenses and receipt input](screenshots/chromium-portrait-expenses.png)
- [Desktop expenses](screenshots/chromium-desktop-expenses.png)
- [Portrait overview](screenshots/chromium-portrait-dashboard.png)

The screenshots folder also contains the other views in landscape and desktop sizes. `verification.json` records the successful automated checks. The CI workflow now reruns the browser checks and uploads screenshots.

## Codex review follow-up

Two valid findings were addressed before merge. The shared notice now renders outside the authenticated app so sign-in errors remain visible. Segmented shift validation and insertion now run in a MongoDB transaction that writes the same family revision as family edits, forcing concurrent archive/shift operations to serialize and retry against committed child status. The integration test now exercises this race five times.

## Remaining checks and limitations

- These are **Chromium emulation checks, not physical iPhone testing**. Safari/WebKit execution was unavailable because the environment lacks its native runtime libraries. The attempted dependency installation was denied by the environment.
- Verify Safari on the user's iPhone 13 mini with expanded/collapsed browser chrome, the keyboard open, landscape safe-area insets, rotation while editing, and real camera capture. Reduced-height emulation cannot prove those behaviours.
- Actual camera permissions and image encoding were not exercised. Existing PDF/JPG/PNG and 8 MB receipt limits remain; unsupported image types receive the existing validation message.
- Production deployment remains pending review and merge. The review package includes the source, a Git patch, screenshots and this report.
