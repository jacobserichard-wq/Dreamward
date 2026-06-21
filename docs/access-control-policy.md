# Dreamward — Access Control Policy

**Owner:** Richard Jacobsen (Founder & Security Lead)
**Contact:** Dreamwardsystems@gmail.com
**Version:** 1.0
**Effective date:** June 20, 2026
**Review cadence:** Reviewed at least annually, and whenever a material change occurs.

---

## 1. Purpose & scope

This policy defines the controls that limit access to Dreamward's production assets (virtual infrastructure, source code, and databases) and to sensitive customer and financial data. It applies to all production systems and to all personnel (currently the sole founder). It is a companion to the Dreamward Information Security Policy.

## 2. Principles

- **Least privilege:** access is limited to what each person needs to perform their role.
- **Need to know:** sensitive customer and financial data is accessible only where required to operate the Service.
- **Strong authentication** is required on every path to production.
- **No standing third-party access** to production systems or data.

## 3. Access controls in place

- **Least privilege / sole operator.** Production systems and customer data are accessible only to the Founder. No employees, contractors, or outside parties have standing access.
- **Authentication.** End users authenticate via Google sign-in (OAuth 2.0 / OpenID Connect); Dreamward stores no user passwords. Administrative access to infrastructure (hosting, database, source control) is via federated sign-in.
- **Multi-factor authentication (MFA).** MFA is enabled on all administrative accounts that support it — GitHub (which gates hosting, the database, and source code), Google, Stripe, the domain registrar, and integration-provider dashboards.
- **Single sign-on / federation.** Infrastructure access is consolidated through federated identity providers (Google, GitHub), so MFA on those accounts protects the downstream platforms (Vercel, Railway).
- **Tenant isolation.** Within the application, every data query is scoped to the authenticated account, so one customer cannot access another customer's data.
- **Secrets management.** Credentials and API keys are stored in the hosting provider's managed environment-variable store, never in source code or client-side bundles. Connected-account access tokens are encrypted at rest with AES-256-GCM.
- **Provisioning & de-provisioning.** Access is currently limited to the Founder. If additional personnel are added, access will be granted on a least-privilege basis and revoked promptly on role change or departure. Customer-granted integration access (Google, and bank or platform connections) can be revoked by the customer at any time from the Integrations page or the provider.

## 4. Review and maintenance

Access rights and this policy are reviewed at least annually and whenever a material change occurs. The current version and effective date are recorded in the header. Questions: **Dreamwardsystems@gmail.com**.
