# Dreamward — Data Retention and Disposal Policy

**Owner:** Richard Jacobsen (Founder & Security Lead)
**Contact:** Dreamwardsystems@gmail.com
**Version:** 1.0
**Effective date:** June 20, 2026
**Review cadence:** Reviewed at least annually, and whenever a material change occurs.

---

## 1. Purpose & scope

This policy defines how long Dreamward retains the categories of data it processes and how that data is securely disposed of when it is no longer needed. It applies to all customer and operational data held across Dreamward's production systems and subprocessors. It aligns with the Dreamward Privacy Policy (https://godreamward.com/privacy) and the Dreamward Information Security Policy.

## 2. Principles

- Retain personal and financial data only as long as needed to provide the Service, meet legal or tax obligations, or serve a legitimate, disclosed business purpose.
- Delete or irreversibly anonymize data once its retention period ends.
- Honor user export and deletion requests in accordance with applicable data-privacy laws (including CCPA and GDPR).
- Collect the minimum data necessary, reducing what must later be retained or disposed of.

## 3. Retention schedule

| Data category | Retention period | Disposal trigger |
|---|---|---|
| Account data (business profile, settings, custom categories) | While the account is active; deleted within 90 days after cancellation | Account cancellation + 90 days, or a verified deletion request |
| Processed financial data (uploaded files, manually entered records, and transactions imported from connected bank accounts via Plaid) | While the account is active; deleted within 90 days after cancellation | Account cancellation + 90 days, or a verified deletion request |
| Connected-account access tokens (Plaid and sales-platform integrations) | Until the connection is disconnected or the account is deleted | Disconnect action (immediate) or account deletion |
| Payment records (processed via Stripe) | Up to 7 years | Expiry of the tax/legal retention period |
| Backups | Up to 30 days after data is deleted from production, then overwritten | Backup rotation cycle |
| Operational/usage logs | Limited operational window | Log rotation |

Aggregate or anonymized usage data that cannot be used to identify an individual may be retained indefinitely for analytics and reliability.

## 4. Disposal method

- **Production data** is deleted from the managed PostgreSQL database; rows are removed and are not recoverable from production systems.
- **Access tokens** are encrypted at rest (AES-256-GCM); on disposal the token row is deleted, and Dreamward also instructs the provider to invalidate the connection where supported (for example, Plaid item removal). With the row deleted and keys inaccessible, the token is unrecoverable.
- **Backups** containing deleted data age out of the backup rotation (within ~30 days) and are overwritten; they are not separately mined or restored after deletion.
- Dreamward operates on cloud infrastructure only — there is no physical media requiring destruction.

## 5. Deletion and export on request

Users may request access to, export of, or deletion of their data by emailing **Dreamwardsystems@gmail.com** with the email address associated with their account. Verified deletion requests are completed within **30 days**, except for records Dreamward is legally required to retain (for example, payment and tax records). Users may also revoke third-party access at any time — Google account access via myaccount.google.com/permissions, and bank or platform connections from the Integrations page in the app.

## 6. Legal compliance

This policy supports compliance with applicable data-privacy laws, including the California Consumer Privacy Act (CCPA) and the EU/UK General Data Protection Regulation (GDPR). The 7-year retention of payment records reflects tax and legal recordkeeping requirements.

## 7. Review and maintenance

This policy is reviewed at least annually and updated when a material change occurs (new data category, new subprocessor, or a change in legal requirements). The current version and effective date are recorded in the header. Questions: **Dreamwardsystems@gmail.com**.
