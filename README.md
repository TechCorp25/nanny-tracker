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
