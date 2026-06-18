# Treasurebox / Baohe

Treasurebox is a modular toolbox app. The current beta path is intentionally small: a PWA shell plus the Inventory / purchase-memory tool.

This repository keeps the broader module registry, contracts, and iOS shell work in one place, but most modules are not part of the public first-launch promise yet.

## Current Launch Scope

Public PWA beta scope:

- PWA web shell / module registry
- Inventory / purchase-memory
- Local-first data storage
- Local file export / restore and delete for launch-local data
- Static paywall preview state
- Approval-gated visibility for non-launch modules

Not publicly promised for first launch:

- AI runtime behavior
- Health, mental health, finance, or therapeutic outcomes
- Real cloud sync
- Real account system
- Real StoreKit purchase / restore / receipt validation
- Real external service authorization
- Production notifications

Approval Gate always takes priority over Paywall. Paid state never means a gated module or risky action is safe to use.

## Module Status

The repo contains multiple historical or sandbox tools. Only Inventory / purchase-memory is launch-visible for normal users.

Other modules may remain in the internal registry as sandbox, gated, hidden, or future candidates. They should not be described as public product commitments until their contracts, data boundary, QA, privacy copy, and App Store wording are approved.

## Data Boundary

Current data layer:

- Local profile only: `LocalProfile@v1`
- Local data root: `BaoheLocalDataRoot@v1`
- Inventory item schema: `LocalInventoryItem@v1`
- Inventory store schema: `LocalInventoryStore@v1`
- Cloud flags must remain disabled for first launch

The launch-local data layer supports local initialization, read/write helpers, export, delete/reset, and migration smoke checks. It does not use a real cloud database or server user identity.

## PWA Beta

The current testable path is the web/PWA surface. It is local-first and does not require accounts, cloud sync, StoreKit, or external service authorization.

Run locally:

```bash
npm run dev
```

The launch-visible tool is Inventory / purchase-memory. Other modules can remain registered for internal sandbox or future planning, but ordinary users should not see them as public commitments.

## iOS

The iOS shell lives in `treasurebox-ios/` and is kept as a later packaging path. It is not the current beta release target.

Previously verified local build target:

```bash
cd treasurebox-ios
npm run cap:sync
DEVELOPER_DIR=/Users/jing/Downloads/Xcode.app/Contents/Developer xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The current iOS shell intentionally avoids optional native splash/status-bar plugins because the previous plugin versions were incompatible with the installed Capacitor/Xcode build path.

## Development

Install dependencies:

```bash
npm install
```

Run the web shell:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Core checks:

```bash
npm run report:modules
npm run test:qa:static
npm run test:launch-surface
npm run precheck:local-data-launch
npm run precheck:no-real-data
```

Some reports may return review warnings for known non-runtime items, such as Data Aggregation review warnings. Do not treat report-only visibility as remediation done.

## Release Gate

The following actions require CEO approval before execution:

- TestFlight or App Store submission
- Production deploy decisions
- Real cloud database connection
- Real account or identity binding
- Real StoreKit products, prices, purchase, restore, or receipt validation
- External service authorization
- Notification sending
- Public claims about AI, health, finance, mental health, therapy, or outcomes

Local development, static contract checks, local iOS builds, and report-only QA do not require that gate.
