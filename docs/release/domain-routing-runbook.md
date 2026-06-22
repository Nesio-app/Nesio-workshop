# Nesio Domain Routing Runbook

Canonical domain: `www.nesio.app`

Current test-safe fallback domain: `https://treasurebox-nu.vercel.app`

## Purpose

Use this runbook before claiming that the canonical public domain is live.

`www.nesio.app` must route to the Vercel / Next runtime for Baohe / Nesio. A
successful Vercel deployment is not enough if DNS still points to an older
hosting provider.

## Required DNS State

Choose one of these configurations at the active DNS provider:

- Recommended: set `A www.nesio.app 76.76.21.21`
- Alternative: move nameservers to Vercel DNS:
  - `ns1.vercel-dns.com`
  - `ns2.vercel-dns.com`

If the current nameservers are `dns1.namecheaphosting.com` and
`dns2.namecheaphosting.com`, requests may still route to Namecheap Hosting /
LiteSpeed even after Vercel says the project is deployed.

## Verification Commands

Check the canonical domain:

```bash
npm run precheck:domain-routing
```

Expected passing evidence:

- `ok: true`
- `server: "Vercel"`
- `matchedPath: "/api/portal/production/health"`

If it fails with `server: "LiteSpeed"`, the DNS provider has not routed the
domain to Vercel yet. This is a DNS/config issue, not an application build
failure.

Check the fallback Vercel domain while DNS is pending:

```bash
BAOHE_DOMAIN_PRECHECK_URL=https://treasurebox-nu.vercel.app npm run precheck:domain-routing
BAOHE_CANARY_BASE_URL=https://treasurebox-nu.vercel.app npm run canary:production-runtime
```

The fallback domain can be used for QA while `www.nesio.app` DNS is being fixed.

## Release Rule

Do not mark `www.nesio.app` ready for public use until
`npm run precheck:domain-routing` passes against the canonical domain.

It is acceptable to continue QA on `https://treasurebox-nu.vercel.app` if the
fallback domain passes the production runtime canary.

## CEO Gate

Changing DNS to point a previously public domain at the production Vercel app is
a release-routing action. Keep CEO/Sina aware before treating the canonical
domain as public-ready.
