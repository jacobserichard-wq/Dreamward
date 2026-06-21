# Dreamward — Information Security Policy

**Owner:** Richard Jacobsen (Founder & Security Lead)
**Contact:** Dreamwardsystems@gmail.com
**Version:** 1.0
**Effective date:** June 20, 2026
**Review cadence:** Reviewed at least annually, and whenever a material change occurs (new subprocessor, new data category, security incident).

---

## 1. Purpose & scope

This policy documents how Dreamward — bookkeeping and Schedule-C profit-and-loss software for small businesses — identifies, mitigates, and monitors information security risks. It applies to all Dreamward production systems, source code, third-party services (subprocessors), and the customer data those systems process: business profile data, financial transaction data, uploaded files, and access tokens for connected accounts (banks via Plaid; sales platforms such as Shopify, Square, Etsy, Wix).

Dreamward is operated by a single founder. Controls are implemented directly in the application architecture, infrastructure configuration, and operational practice. This document consolidates those controls into a single reference.

## 2. Roles & responsibilities

- The **Founder & Security Lead** (Richard Jacobsen) is responsible for all security decisions: access management, incident response, vendor selection, and review of this policy.
- Security contact for partners and institutions: **Dreamwardsystems@gmail.com** (monitored).

## 3. Risk management

Security risks are identified and mitigated through:
- **Secure-by-default architecture** — the controls in Sections 4–8 are built into the codebase and infrastructure rather than left to manual discretion.
- **Change review** — every change passes static type checking and is reviewed before deployment (Section 9).
- **Dependency monitoring** — third-party packages are tracked and reviewed for known vulnerabilities; security-relevant updates are applied promptly.
- **Least data collection** — we collect only what the product needs (e.g., Google sign-in uses only the `openid` and `email` scopes; the bank feed pulls transaction data only — no money movement, no account/routing numbers).

## 4. Access control

- **Least privilege.** Access to production systems and customer data is restricted to the Founder. No third parties have standing access.
- **Multi-factor authentication (MFA)** is enabled on all administrative accounts that support it (hosting, database, source control, domain registrar, email, and each integration provider's dashboard).
- **Authentication.** End users authenticate via Google OAuth (NextAuth). Session state is held in an encrypted session cookie. Dreamward does not store user passwords.
- **Tenant isolation.** Every data query is scoped to the authenticated account (`client_id`), preventing cross-tenant data access.

## 5. Data protection

- **Encryption in transit.** All connections to Dreamward and between Dreamward and its subprocessors use TLS.
- **Encryption at rest.** Production database contents are encrypted at rest by the managed database provider.
- **Application-layer token encryption.** Access tokens for connected accounts (bank and sales-platform integrations) are encrypted at the application layer with **AES-256-GCM** (authenticated encryption) before storage. Encryption keys are held only in the hosting provider's managed secret store and are never committed to source code.
- **Secrets management.** All credentials and API keys live in managed environment variables (hosting provider), never in the codebase or client-side bundles.

## 6. Application security

- **Parameterized queries.** All database access uses parameterized SQL, preventing SQL injection.
- **Tenant scoping.** See Section 4 — enforced on every read and write.
- **No secrets client-side.** API keys and tokens are used only server-side; the browser never receives them.
- **Input validation.** API endpoints validate request payloads (types, required fields, allowed values) before acting on them.
- **Minimal third-party scope.** Integrations request only the permissions required for their function (e.g., read-only transaction access from Plaid).

## 7. Infrastructure & subprocessors

Production runs on reputable managed providers, each of which maintains its own security and compliance program. Subprocessors and the data they receive:

| Subprocessor | Data received | Purpose |
|---|---|---|
| Vercel | Application traffic, logs | Hosting / infrastructure |
| Railway | Database contents | Managed PostgreSQL |
| Plaid | Bank transaction data (read-only) | Bank feed (expenses) |
| Stripe | Name, email, payment method | Subscription billing |
| Anthropic | Uploaded file content | AI data extraction |
| Google | Email address | Sign-in |
| Resend | Name, email | Transactional email |

Subprocessors are reviewed before adoption and listed in the public Privacy Policy. We do not sell customer data or share it with advertising networks.

## 8. Logging & monitoring

- Application and infrastructure logs are captured by the hosting provider.
- We monitor for unauthorized access and anomalous activity.
- Access tokens that enter an error state (e.g., a revoked or expired bank connection) are surfaced for re-authentication rather than silently failing.

## 9. Change management

- Source code is version-controlled in Git.
- Every change passes **static type checking** (`tsc --noEmit`) and is reviewed before merge to the deployment branch.
- Deployments are automated through the hosting provider from the reviewed branch.
- Database schema changes are applied through reviewed, idempotent migration scripts.

## 10. Data lifecycle

- **Retention & deletion** follow the published Privacy Policy: account data and processed items are retained while the account is active and for a limited window after cancellation, then deleted; payment records are retained as required for tax/legal compliance.
- **Backups.** Production data resides in a managed PostgreSQL service that maintains automated backups.
- **Deletion requests.** Users may request export or deletion of their data per the Privacy Policy; requests are honored within the stated timeline.

## 11. Incident response & breach notification

- Suspected incidents are investigated immediately by the Founder.
- Affected users are notified by email within **72 hours** of confirming a breach that affects them, and applicable authorities are notified as required by law (as committed in the Privacy Policy).
- After an incident, the root cause is remediated and this policy and related controls are updated as needed.

## 12. Vendor / third-party management

- New subprocessors are evaluated for their security posture and data-handling terms before adoption.
- Access granted to integrations is scoped to the minimum required and can be revoked by the user (and by Dreamward) at any time.

## 13. Policy review & maintenance

This policy is reviewed at least annually and updated when material changes occur. The current version and effective date are recorded in the header. Questions: **Dreamwardsystems@gmail.com**.
