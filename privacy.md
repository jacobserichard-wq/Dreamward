# Privacy Policy

**Last updated: June 16, 2026**

Dreamward ("we," "us," or "our") respects your privacy. This Privacy Policy explains how we collect, use, store, and disclose information when you use Dreamward at godreamward.com (the "Service"). By using the Service, you agree to this policy.

Dreamward is operated by Richard Jacobsen, an individual sole proprietor based in Cedar Lake, Indiana, USA. For privacy questions, contact Dreamwardsystems@gmail.com.

---

## 1. What we collect

We collect three categories of information:

**Information you provide directly.** When you create an account, you give us your business name, industry, and any custom expense categories you configure. When you upload CSV files for processing, we receive the data those files contain.

**Information collected through Google sign-in.** When you sign in with Google, we request only the `openid` and `email` scopes. We receive your email address and a Google account identifier — used to create and identify your account. We do not request your name, profile picture, Gmail, or any other Google data.

**Information collected automatically.** When you use the Service, we automatically log usage events such as the number of items processed per month, sign-in timestamps, and basic technical information (IP address, browser type) for security and reliability purposes. We use Vercel's built-in analytics for hosting telemetry; we do not use third-party advertising trackers.

We do not collect Social Security numbers, government IDs, biometric data, geolocation beyond IP-derived city, or information from children under 13.

---

## 2. How we use Google sign-in

Dreamward uses Google **solely to sign you in.** We request only the `openid` and `email` scopes — the minimum needed to create and identify your account. We receive your email address and a Google account identifier; nothing else.

We do **not** request access to your Gmail, Google Drive, contacts, calendar, profile details, or any other Google service. We do not read, store, or process any Google data beyond your email address, we do not use it for advertising, and we do not sell it.

You can revoke Dreamward's access to your Google account at any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## 3. How we use your information

We use the information we collect to:

- Create and manage your Dreamward account
- Extract structured data (vendor, amount, date, category) from files you upload, using AI
- Display your processed data in dashboards, reports, and exports
- Process payments through Stripe
- Send transactional emails (welcome, trial expiration, payment notifications)
- Provide customer support
- Detect and prevent fraud, abuse, and security incidents
- Comply with legal obligations

We do not use your information for advertising, profiling, or any purpose unrelated to operating the Service.

---

## 4. AI processing of your data

Dreamward uses Anthropic's Claude API to read the content of the files you upload (CSV/TSV/XLSX spreadsheets and PDF invoices) and extract structured information (vendor name, amount, due date, category). When this happens:

- Your uploaded file content is sent to Anthropic's servers in real time.
- Anthropic does **not** train its AI models on data submitted through its API, per Anthropic's published commercial terms.
- Anthropic retains API requests for 30 days for abuse monitoring, then deletes them.
- We do not use any other AI provider for content processing.

If you do not want your data processed by an AI model, do not use the file-upload features.

---

## 5. Subprocessors and third parties

We share information with the following service providers who help us operate Dreamward. Each is bound by data protection terms and uses your data only to provide their service to us:

| Service | What they receive | Purpose |
|---|---|---|
| **Google** | Email address | Sign-in |
| **Anthropic (Claude API)** | Uploaded file content (CSV / PDF) | AI data extraction |
| **Vercel** | All Service traffic and logs | Hosting and infrastructure |
| **Railway** | Database contents | PostgreSQL hosting |
| **Stripe** | Name, email, payment method | Subscription billing |
| **Resend** | Name, email | Transactional email delivery |

We do not sell your information to anyone. We do not share information with advertising networks.

We may disclose information when legally required (subpoena, court order), to protect our rights, or to investigate fraud or abuse.

---

## 6. Where your data is stored

Your data is stored in the United States on infrastructure operated by Vercel and Railway. Some subprocessors (notably Google and Stripe) may process data in additional regions for redundancy and reliability. By using the Service, you consent to this storage and processing.

If you are in the European Economic Area, the United Kingdom, or another region with data transfer restrictions, please be aware that the Service is operated from the United States and your data will be transferred there.

---

## 7. How long we keep your data

We retain your data for as long as your account is active. After you cancel your subscription:

- Account data and processed items: retained for 90 days, then deleted, unless you request earlier deletion.
- Stripe payment records: retained for 7 years for tax and legal compliance.
- Backup copies: may persist for up to 30 additional days before being overwritten.
- Anonymized usage logs: may be retained indefinitely.

If you request deletion (Section 8), we will delete your data on the timeline described there, except records we are legally required to keep.

---

## 8. Your rights and choices

You have the right to:

- **Access** the information we hold about you
- **Correct** inaccurate information
- **Delete** your account and data
- **Export** your data in a machine-readable format
- **Revoke** Google account access at any time

To exercise any of these rights, email **Dreamwardsystems@gmail.com** with your request and the email address associated with your account. We will respond within 30 days. Manual deletion of account data and processed items will be completed within 30 days of a valid deletion request, with the exceptions noted in Section 7.

If you are a California resident, you have additional rights under the CCPA, including the right to know what personal information we have collected and the right to opt out of any "sale" of personal information (we do not sell personal information).

If you are in the EEA or UK, you have rights under GDPR including data portability and the right to object to processing. The legal basis for our processing is your consent and the performance of the contract you enter when subscribing to Dreamward.

---

## 9. Security

We protect your data with industry-standard measures:

- All connections to Dreamward are encrypted with TLS.
- Database contents are encrypted at rest.
- OAuth tokens are encrypted with NextAuth's session encryption.
- Access to production systems is limited to authorized personnel (currently the founder).
- We monitor for unauthorized access and security incidents.

No system is perfectly secure. If a data breach affects you, we will notify you by email within 72 hours of confirming the breach, and we will report the breach to applicable authorities as required by law.

---

## 10. Children's privacy

Dreamward is not directed to children under 13, and we do not knowingly collect information from anyone under 13. If you believe we have collected information from a child, contact us and we will delete it.

---

## 11. Cookies and similar technologies

We use only essential cookies — specifically, the session cookie set by NextAuth to keep you signed in. We do not use advertising cookies, tracking pixels, or third-party analytics cookies.

---

## 12. Changes to this policy

We may update this policy from time to time. Material changes will be communicated by email to active subscribers and posted on this page with an updated "Last updated" date. Continued use of the Service after a change constitutes acceptance of the revised policy.

---

## 13. Contact

For privacy questions, requests, or concerns:

**Email:** Dreamwardsystems@gmail.com
**Mailing location:** Cedar Lake, Indiana, USA

---

*This Privacy Policy applies only to Dreamward at godreamward.com. Linked services have their own privacy policies.*
