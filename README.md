# Nanny Tracker — Care Ledger

Private browser-based tracking of nanny shifts, family-specific age/child-count rate profiles, receipts, reimbursable expenses, and weekly/monthly pay. Runs as a Node/Express web service on Render with MongoDB Atlas.

## Configure

Set the following **on the Render web service** under Environment (not only in GitHub repository secrets):

- `MONGODB_URI`: complete Atlas URI containing a URL-encoded MongoDB username/password, with database `nanny_wage_tracker`.
- `MONGODB_DB`: `nanny_wage_tracker`.
- `ADMIN_EMAIL`: your sign-in email.
- `ADMIN_PASSWORD_HASH`: bcrypt hash (produce using `npm run hash-password`).
- `SESSION_SECRET`: secure random string of 32+ characters.
- `NODE_ENV`: `production`.
- `TZ`: `Australia/Melbourne`.

GitHub Actions secrets are **not** automatically forwarded to Render. Never commit plaintext secrets. Atlas must allow inbound access from the Render service egress IPs via Atlas Network Access.

Run `npm install`, `npm test` and `npm start` for local development. Select service type Web Service, Node runtime, region Singapore, build `npm install --omit=dev` and start `npm start`.

The health endpoint `/healthz` verifies the database. App intentionally refuses to start when mandatory authentication or database configuration is missing. Receipt files are stored in MongoDB GridFS. App supports one administrator; future multi-user access requires a separate identity/authorization design.


## Child-specific profiles and segmented shifts (2026 update)

- Add a family, then add children under **Families & Rates**.
- Select individual children when creating a profile. One child uses its first four normalised letters; a subset combines four-letter names alphabetically; selecting all children in a multi-child family uses five letters of the family name. IDs end in `DDMMYY`, with `-02` etc. on collision.
- Saved profiles snapshot the selected children's IDs and names. Adding a new child will not change an existing all-children profile or its Rate ID.
- Each profile applies to one service type and is either hourly or flat per time segment; multiple profiles may exist per family.
- A segmented shift can contain up to 24 nonoverlapping, chronological parts (including overnight). Each part references a specific profile and its saved child selection, rate, unit, times and earnings. Historical stored earnings are never recalculated using newer rate profiles.
- Existing shift documents and earlier rate profiles remain readable and usable through the legacy entry forms.
- Receipts may be uploaded as PDF/JPG/PNG or captured by supported mobile cameras, to an 8 MB maximum. The image/PDF can be previewed, replaced or removed before saving.
- Every **new** expense requires a type; previously saved uncategorised expenses are retained and displayed as **Uncategorised**. Editing an old expense requires choosing a type.
- The optional expense-category report never changes payment or reimbursement totals.
- Mobile Recent Shifts uses stacked cards and expandable segment details.
- Primary colour `#660066`; accent `#9900cc`; visible focus and error states.

### Notes for deployment
No database migration or new secret is required. The server creates a unique child-name index on startup. Keep the existing MongoDB and authentication variables on Render. Physical camera capture varies with device and browser: the device upload choice always remains available. The automated tests cover rate code generation, billing and category logic; verify camera UI on the target handset before production use.
