export const HARDCODE_REMEDIATION_CATEGORIES = Object.freeze([
  'runtime',
  'docs-example',
  'route-contract',
  'provider-config',
  'acceptable-constant',
]);

const DOCS_EXAMPLE_FILE_RE =
  /(^|\/)(README|DEPLOY|IOS-BUILD|SIGNING|APP-STORE|SECURITY)\.md$|(^|\/)docs\/|(^|\/)config\.example\.js$|(^|\/)package-lock\.json$/i;

const ROUTE_CONTRACT_FILE_RE =
  /(^|\/)(vercel\.json|public\/portal-config\.json|lib\/portal\/module-(routes|manifest|manager|manager-core)(\.mjs|\.ts|\.d\.ts)?)$/;

const PROVIDER_FILE_RE =
  /(^|\/)(app\/api\/|api\/|lib\/portal\/flomo-api\.ts|scripts\/test-gemini\.mjs)/;

const PROVIDER_TEXT_RE =
  /generativelanguage\.googleapis\.com|api\.openai\.com|ark\.cn-beijing\.volces\.com|doubao|openai|gemini|FLOMO|flomoapp\.com|0x0\.st|GOOGLE_CALENDAR|FIDELITY|ICAL|Bearer|API_KEY|WEBHOOK/i;

const RUNTIME_FILE_RE =
  /(^|\/)(public\/(inner-shelter|secretary|storage)\/|storage-web\/|storage-ios\/web\/|inner-shelter-ios\/web\/|adhd-flow-ios\/(api|web|scripts)\/|fitness\/api\/|questionbank-ios\/api\/|treasurebox-ios\/scripts\/|treasurebox-ios\/config\.example\.js)/;

const PRODUCTION_DOMAIN_RE =
  /([a-z0-9-]+\.)?vercel\.app|storage-kohl|treasurebox-nu|inner-shelter-ios|adhd-flow-ios|health-ios|psych-tool-ios|questionbank-ios|reading-ios|weaver-ai-alpha/i;

const ACCEPTABLE_TEXT_RE =
  /localhost|127\.0\.0\.1|0\.0\.0\.0|schema\.org|w3\.org|xmlns|fonts\.googleapis\.com|fonts\.gstatic\.com|data:image|about:blank/i;

export function classifyHardcodeFinding(finding) {
  const file = normalizePath(finding.file);
  const text = `${finding.text || ''} ${finding.match || ''}`;

  if (isAcceptableConstant(file, text)) {
    return {
      category: 'acceptable-constant',
      severity: 'P3',
      reason: 'Local/dev, standards, static asset, or package metadata constant.',
      ceoGate: false,
    };
  }

  if (DOCS_EXAMPLE_FILE_RE.test(file)) {
    return {
      category: 'docs-example',
      severity: 'P3',
      reason: 'Documentation or example value; do not include in runtime cleanup counts by default.',
      ceoGate: false,
    };
  }

  if (ROUTE_CONTRACT_FILE_RE.test(file) || /routeKey|moduleId|openHref|returnHref|LOCAL_STATIC_MODULE_PATHS|rewrites/.test(text)) {
    return {
      category: 'route-contract',
      severity: 'P1/P2',
      reason: 'Route/module declaration belongs to Module Manager and Shell Route Contract governance.',
      ceoGate: false,
    };
  }

  if (PROVIDER_FILE_RE.test(file) && PROVIDER_TEXT_RE.test(text)) {
    return {
      category: 'provider-config',
      severity: /Bearer|API_KEY|WEBHOOK|FLOMO|0x0\.st|ICAL|FIDELITY/i.test(text) ? 'P1/P2' : 'P2',
      reason: 'External provider endpoint, model, env, auth, upload, or calendar adapter config.',
      ceoGate: /0x0\.st|FLOMO|ICAL|FIDELITY|Bearer|API_KEY|WEBHOOK/i.test(text),
    };
  }

  if (RUNTIME_FILE_RE.test(file) || PRODUCTION_DOMAIN_RE.test(text) || /innerHTML/.test(text)) {
    return {
      category: 'runtime',
      severity: /innerHTML|storage-kohl|treasurebox-nu|inner-shelter-ios|0x0\.st/i.test(text) ? 'P1/P2' : 'P2',
      reason: 'Runtime code path, generated client config, production fallback, or template/rendering risk.',
      ceoGate: /storage-kohl|treasurebox-nu|inner-shelter-ios|0x0\.st|FLOMO|ICAL|FIDELITY/i.test(text),
    };
  }

  return {
    category: 'acceptable-constant',
    severity: 'P3',
    reason: 'No runtime/provider/route signal found; keep as low-priority audit noise until proven otherwise.',
    ceoGate: false,
  };
}

export function summarizeClassifications(findings) {
  const byCategory = Object.fromEntries(HARDCODE_REMEDIATION_CATEGORIES.map((category) => [category, 0]));
  const bySeverity = {};
  let ceoGateCount = 0;

  for (const finding of findings) {
    const classification = finding.classification || classifyHardcodeFinding(finding);
    byCategory[classification.category] = (byCategory[classification.category] || 0) + 1;
    bySeverity[classification.severity] = (bySeverity[classification.severity] || 0) + 1;
    if (classification.ceoGate) ceoGateCount += 1;
  }

  return {
    total: findings.length,
    byCategory,
    bySeverity,
    ceoGateCount,
  };
}

function isAcceptableConstant(file, text) {
  if (ACCEPTABLE_TEXT_RE.test(text)) return true;
  if (/(^|\/)(package\.json|package-lock\.json|tsconfig\.json)$/.test(file)) return true;
  if (/\.(svg|png|jpg|jpeg|gif|mp3|pdf|ipynb)$/i.test(file)) return true;
  return false;
}

function normalizePath(file) {
  return String(file || '').replaceAll('\\', '/').replace(/^\.\//, '');
}
