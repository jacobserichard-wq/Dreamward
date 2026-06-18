# Privacy Policy

**Last updated: May 5, 2026**

Dreamward ("we," "us," or "our") respects your privacy. This Privacy Policy explains how we collect, use, store, and disclose information when you use Dreamward at godreamward.com (the "Service"). By using the Service, you agree to this policy.

Dreamward is operated by Richard Jacobsen, an individual sole proprietor based in Cedar Lake, Indiana, USA. For privacy questions, contact Dreamwardsystems@gmail.com.

---

## 1. What we collect

We collect three categories of information:

**Information you provide directly.** When you create an account, you give us your business name, industry, and any custom expense categories you configure. When you upload CSV files for processing, we receive the data those files contain.

**Information collected through Google sign-in.** When you sign in with Google, we receive your name, email address, and profile picture from Google. We also request access to your Gmail account through OAuth scopes (described in Section 2 below) so the Service can read invoice and receipt emails on your behalf.

**Information collected automatically.** When you use the Service, we automatically log usage events such as the number of items processed per month, sign-in timestamps, and basic technical information (IP address, browser type) for security and reliability purposes. We use Vercel's built-in analytics for hosting telemetry; we do not use third-party advertising trackers.

We do not collect Social Security numbers, government IDs, biometric data, geolocation beyond IP-derived city, or information from children under 13.

---

## 2. How we use Google user data

Dreamward's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

We request the following Google OAuth scopes:

- **`openid`**, **`email`**, and **`profile`** — to identify you and create your Dreamward account.
- **`https://www.googleapis.com/auth/gmail.readonly`** — to read the content of email messages in your Gmail account. This is a "Restricted" scope under Google's classification.
- **`https://www.googleapis.com/auth/gmail.labels`** — to view and manage Gmail labels (used to identify which emails you have designated for processing).

**What the Gmail scope grants vs. how Dreamward uses it.** The `gmail.readonly` scope is broad: it grants Dreamward's servers the technical ability to read any message in your Gmail account. We disclose this honestly because Google requires us to request the scope at this level — Gmail does not currently offer a narrower production scope that would let us read only labeled messages while still accessing message bodies.

In practice, Dreamward's application code only reads messages that match the Gmail labels you configure (by default: Invoices, Expenses, AR, or whatever labels you select during onboarding). We do not retrieve, store, display, or process messages outside those labels. We do not maintain copies of your full inbox. The broader technical access is not used, not logged, and not retained beyond the duration of the labeled-message fetch.

If you would prefer not to grant this level of access, you should not connect your Gmail account to Dreamward. CSV upload remains available as an alternative for users who do not want to link their Gmail.

We use Gmail data **only** to provide the user-facing accounting automation features of Dreamward. Specifically:

- We do **not** sell Gmail data to anyone.
- We do **not** use Gmail data for advertising or marketing.
- We do **not** allow human employees to read your Gmail content, except (a) with your explicit consent, (b) for security purposes such as investigating abuse, or (c) when required by law.
- We do **not** use Gmail data to train, fine-tune, or develop generalized AI or machine learning models. (Anthropic's Claude API, which we use to extract structured data from your emails, does not train on API inputs by default.)
- We do **not** transfer Gmail data to third parties except subprocessors essential to providing the Service (described in Section 5).

You can revoke Dreamward's access to your Google account at any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## 3. How we use your information

We use the information we collect to:

- Create and manage your Dreamward account
- Read and process emails you have labeled, to extract invoice/receipt data using AI
- Display your processed data in dashboards, reports, and exports
- Process payments through Stripe
- Send transactional emails (welcome, trial expiration, payment notifications)
- Provide customer support
- Detect and prevent fraud, abuse, and security incidents
- Comply with legal obligations

We do not use your information for advertising, profiling, or any purpose unrelated to operating the Service.

---

## 4. AI processing of your data

Dreamward uses Anthropic's Claude API to read the content of emails and CSV uploads and extract structured information (vendor name, amount, due date, category). When this happens:

- Email content is sent to Anthropic's servers in real time.
- Anthropic does **not** train its AI models on data submitted through its API, per Anthropic's published commercial terms.
- Anthropic retains API requests for 30 days for abuse monitoring, then deletes them.
- We do not use any other AI provider for content processing.

If you do not want your emails processed by an AI model, do not connect your Gmail account or use the Process with AI feature.

---

## 5. Subprocessors and third parties

We share information with the following service providers who help us operate Dreamward. Each is bound by data protection terms and uses your data only to provide their service to us:

| Service | What they receive | Purpose |
|---|---|---|
| **Google (Cloud + Gmail API)** | OAuth tokens, profile info | Sign-in and Gmail access |
| **Anthropic (Claude API)** | Email content for processing | AI data extraction |
| **Vercel** | All Service traffic and logs | Hosting and infrastructure |
| **Railway** | Database contents | PostgreSQL hosting |
| **Stripe** | Name, email, payment method | Subscription billing |
| **Resend** | Name, email | Transactional email delivery |
| **Calendly** (Pro tier only) | Name, email | Onboarding call booking |

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
