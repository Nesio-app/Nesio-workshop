const LOCAL_DATA_RECORD_STATE_PRIORITY = Object.freeze(['needs_ceo', 'blocked', 'QA', 'active', 'archived']);

const LOCAL_DATA_RECORD_BOUNDARIES_V0 = Object.freeze({
  implementation: 'local-report-projected-records-v0',
  localStaticOnly: true,
  readsArtifactFilesOnly: true,
  derivesFromArtifactStatus: true,
  createsDbRows: false,
  createsGateRecords: false,
  syncsHandoffs: false,
  writesRealData: false,
  readsRealData: false,
  writesNotion: false,
  sendsNotifications: false,
  authorizesExternalServices: false,
  executesActions: false,
  productionDeploy: false,
});
const LOCAL_DATA_DASHBOARD_LIMIT_DEFAULT = 25;

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function byCount(items) {
  return Object.fromEntries([...items.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => [key, count]));
}

function toString(value, fallback = '') {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : fallback;
  }
  return fallback;
}

function normalizeState(state) {
  return LOCAL_DATA_RECORD_STATE_PRIORITY.includes(state) ? state : 'active';
}

function normalizeHandoffTo(value) {
  if (Array.isArray(value)) {
    return [...new Set(value
      .map((item) => toString(item))
      .filter((item) => item.length > 0)
      .map((item) => item.toLowerCase()))];
  }
  const raw = toString(value, '');
  if (!raw) return [];
  return [...new Set(raw
    .split(/[,\uFF0C]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.toLowerCase()))];
}

function normalizeArtifactKind(value, artifactPath) {
  const normalized = toString(value, '').toLowerCase();
  if (normalized) return normalized;
  const pathValue = toString(artifactPath, '').toLowerCase();
  if (pathValue.includes('-engineering')) return 'engineering';
  if (pathValue.includes('-qa')) return 'qa';
  if (pathValue.includes('archive') || pathValue.includes('closeout')) return 'archive';
  if (pathValue.includes('-spec')) return 'spec';
  if (pathValue.includes('plan')) return 'plan';
  if (pathValue.includes('audit')) return 'audit';
  if (pathValue.includes('inventory')) return 'inventory';
  if (pathValue.includes('report') || pathValue.includes('brief')) return 'report';
  return 'unknown';
}

function normalizeId(rawValue) {
  const normalized = toString(rawValue, 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return normalized || 'item';
}

function qaStatusForState(state) {
  if (state === 'needs_ceo') return 'needs_ceo_decision';
  if (state === 'blocked') return 'blocked';
  if (state === 'QA') return 'pending_qa';
  return 'active';
}

function inferGateCategory(record) {
  const sourceText = [
    toString(record.blocker),
    toString(record.reason),
    toString(record.resumeAction),
    toString(record.resolutionHint),
    toString(record.title),
    toString(record.artifactPath),
  ].join(' ').toLowerCase();
  if (/(notion|notion\\s+mirror|notion\\s+sync|notion\\s+api)/.test(sourceText)) return 'notion_mirror';
  if (/(supabase|prisma|postgres|sqlite|postgresql|mysql|real\\s+db|database)/.test(sourceText)) return 'real_db';
  if (/(migration|migrate|import|export|restore|backup|rollback|backfill)/.test(sourceText)) return 'real_data_migration';
  if (/(external\\s+service|webhook|provider|oauth|api|sdk)/.test(sourceText)) return 'external_service';
  if (/(notification|notify|push|email|sms|ding|wechat)/.test(sourceText)) return 'notification';
  if (/(deploy|release|production|publish|public|launch|go-live)/.test(sourceText)) return 'production_deploy';
  if (/(health|medical|mental|therapy|privacy|personal|sensitive|pii)/.test(sourceText)) return 'real_user_data';
  if (/(market|pricing|legal|commercial|payment|purchase)/.test(sourceText)) return 'commercial_claim';
  return 'other';
}

function artifactPathToTitle(artifactPath, fallback) {
  return toString(fallback, 'artifact')
    .replace(/\.md$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/-/g, ' ');
}

function toArtifactRecord(record, index, generatedAt) {
  const artifactPath = toString(record.artifactPath, `artifact-${index}`);
  const state = normalizeState(toString(record.state, 'active'));
  const handoffTo = normalizeHandoffTo(record.handoffTo);
  const needsCeoGate = record.needsCeoGate === true;
  const owner = toString(record.owner, 'unknown');
  const nextOwner = toString(record.nextOwner, handoffTo[0] || null);
  return {
    id: `artifact:${normalizeId(artifactPath)}`,
    artifactPath,
    title: artifactPathToTitle(artifactPath, toString(record.title, artifactPath)),
    artifactKind: normalizeArtifactKind(record.artifactKind, artifactPath),
    owner,
    state,
    nextOwner,
    nextStep: toString(record.nextStep, 'Continue next action.'),
    resumeAction: toString(record.resumeAction, null),
    blocker: toString(record.blocker, null),
    needsCeoGate,
    primaryActionKind: toString(record.primaryActionKind, 'view_detail'),
    visibilityPriority: typeof record.visibilityPriority === 'number'
      ? record.visibilityPriority
      : LOCAL_DATA_RECORD_STATE_PRIORITY.indexOf(state),
    sourceVerified: record.sourceVerified === true,
    handoffParsed: record.handoffParsed === true,
    qaStatus: qaStatusForState(state),
    handoffFrom: toString(record.handoffFrom, owner),
    handoffTo,
    artifactState: state,
    archiveEligible: state === 'archived' && record.blocker == null && !needsCeoGate && record.handoffParsed !== false,
    updatedAt: toString(record.modifiedAt, generatedAt),
  };
}

function toHandoffRecord(artifactRecord, sourceRecord) {
  if (!sourceRecord.handoffParsed && !(artifactRecord.handoffFrom || artifactRecord.handoffTo.length > 0)) {
    return null;
  }
  const from = toString(sourceRecord.handoffFrom, artifactRecord.owner);
  const to = artifactRecord.handoffTo;
  return {
    id: `handoff:${normalizeId(`${artifactRecord.artifactPath}:${from}:${to.join(',')}`)}`,
    source: 'artifact_status_visibility_v02',
    artifactPath: artifactRecord.artifactPath,
    artifactTitle: artifactRecord.title,
    status: sourceRecord.needsCeoGate
      ? 'waiting_ceo'
      : to.length > 0 || sourceRecord.blocker ? 'queued' : 'open',
    from,
    to,
    nextOwner: toString(sourceRecord.nextOwner, null),
    reason: toString(sourceRecord.nextStep, sourceRecord.resumeAction),
    resumeAction: toString(sourceRecord.resumeAction, null),
    blocker: toString(sourceRecord.blocker, null),
    needsCeoGate: sourceRecord.needsCeoGate === true,
    sourceVerified: sourceRecord.sourceVerified === true,
    parsedAt: artifactRecord.updatedAt,
    dedupeKey: normalizeId(`${artifactRecord.artifactPath}:${from}:${to.join(',')}`),
    sourceThreadId: toString(sourceRecord.sourceThreadId, null),
  };
}

function toGateRecord(sourceRecord, artifactRecord) {
  if (sourceRecord.needsCeoGate !== true) return null;
  const reason = [
    toString(sourceRecord.blocker),
    toString(sourceRecord.nextStep),
    toString(sourceRecord.resumeAction),
  ].find(Boolean);
  return {
    id: `gate:${normalizeId(`${artifactRecord.artifactPath}:ceo`)}`,
    source: 'artifact_status_visibility_v02',
    artifactPath: artifactRecord.artifactPath,
    artifactTitle: artifactRecord.title,
    category: inferGateCategory(sourceRecord),
    status: 'waiting_ceo',
    owner: 'CEO',
    reason: reason || 'Needs CEO-level decision before local data action.',
    blocker: toString(sourceRecord.blocker, null),
    needsCeoGate: true,
    sourceVerified: sourceRecord.sourceVerified === true,
    qaStatus: artifactRecord.qaStatus,
    dedupeKey: normalizeId(`${artifactRecord.artifactPath}:needs_ceo`),
    evidenceRef: `artifactStatusVisibility:${artifactRecord.artifactPath}`,
  };
}

function computeBoundaryWarnings(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }
  const missingOwner = records.filter((record) => !record.owner || record.owner === 'unknown').length;
  const needsCeoWithoutGate = records.filter((record) => (
    record.state === 'needs_ceo' && record.needsCeoGate !== true
  )).length;
  const warnings = [];
  if (missingOwner > 0) {
    warnings.push({
      warningKind: 'missing_owner',
      count: missingOwner,
      issue: 'Some local artifact records are missing owner metadata.',
    });
  }
  if (needsCeoWithoutGate > 0) {
    warnings.push({
      warningKind: 'needs_ceo_gate_missing',
      count: needsCeoWithoutGate,
      issue: 'Some needs-ceo artifact records are not marked as CEO-gated.',
    });
  }
  return warnings;
}

function buildLocalDataRecordsV0(records, options = {}) {
  const safeRecords = Array.isArray(records) ? records : [];
  const generatedAt = toString(options.generatedAt, new Date().toISOString());
  const artifactRecords = safeRecords.map((record, index) => toArtifactRecord(record, index, generatedAt));
  const handoffRecords = artifactRecords
    .map((artifactRecord, index) => toHandoffRecord(
      artifactRecord,
      safeRecords[index] || {},
    ))
    .filter((record) => record !== null);
  const gateRecords = artifactRecords
    .map((artifactRecord, index) => toGateRecord(safeRecords[index] || {}, artifactRecord))
    .filter((record) => record !== null);
  const summary = {
    artifactRecordCount: artifactRecords.length,
    handoffRecordCount: handoffRecords.length,
    gateRecordCount: gateRecords.length,
    needsCeoGateCount: gateRecords.length,
    byArtifactState: Object.fromEntries(LOCAL_DATA_RECORD_STATE_PRIORITY.map((state) => [
      state,
      artifactRecords.filter((record) => record.state === state).length,
    ])),
    warningCount: 0,
  };
  const warnings = computeBoundaryWarnings(artifactRecords);
  summary.warningCount = warnings.length;

  return {
    implementation: LOCAL_DATA_RECORD_BOUNDARIES_V0.implementation,
    boundaries: LOCAL_DATA_RECORD_BOUNDARIES_V0,
    generatedAt,
    artifactRecords,
    handoffRecords,
    gateRecords,
    summary,
    warnings,
  };
}

function buildLocalDataRecordsDashboardPack(localDataRecords, options = {}) {
  if (!localDataRecords || typeof localDataRecords !== 'object') {
    return {
      implementation: LOCAL_DATA_RECORD_BOUNDARIES_V0.implementation,
      summary: {
        artifactRecordCount: 0,
        handoffRecordCount: 0,
        gateRecordCount: 0,
        needsCeoGateCount: 0,
        byArtifactState: Object.fromEntries(LOCAL_DATA_RECORD_STATE_PRIORITY.map((state) => [state, 0])),
        warningCount: 0,
      },
      boundaries: LOCAL_DATA_RECORD_BOUNDARIES_V0,
      metrics: {
        byArtifactKind: {},
        byOwner: {},
        byGateCategory: {},
        byHandoffStatus: {},
        archivedCount: 0,
      },
      queues: {
        needsCeoArtifacts: [],
        handoffQueue: [],
        gateQueue: [],
      },
      warnings: [],
    };
  }

  const topN = normalizeNumber(options.topN, LOCAL_DATA_DASHBOARD_LIMIT_DEFAULT);
  const artifactRecords = Array.isArray(localDataRecords.artifactRecords) ? localDataRecords.artifactRecords : [];
  const handoffRecords = Array.isArray(localDataRecords.handoffRecords) ? localDataRecords.handoffRecords : [];
  const gateRecords = Array.isArray(localDataRecords.gateRecords) ? localDataRecords.gateRecords : [];

  const byKind = new Map();
  const byOwner = new Map();
  const byGateCategory = new Map();
  const byHandoffStatus = new Map();
  for (const artifact of artifactRecords) {
    byKind.set(artifact.artifactKind, (byKind.get(artifact.artifactKind) || 0) + 1);
    byOwner.set(artifact.owner, (byOwner.get(artifact.owner) || 0) + 1);
  }
  for (const gate of gateRecords) {
    byGateCategory.set(gate.category, (byGateCategory.get(gate.category) || 0) + 1);
  }
  for (const handoff of handoffRecords) {
    byHandoffStatus.set(handoff.status, (byHandoffStatus.get(handoff.status) || 0) + 1);
  }

  const needsCeoArtifacts = artifactRecords
    .filter((record) => record.needsCeoGate)
    .slice(0, topN)
    .map((record) => ({
      artifactPath: record.artifactPath,
      title: record.title,
      owner: record.owner,
      state: record.state,
      blocker: record.blocker,
      nextOwner: record.nextOwner,
      archiveEligible: record.archiveEligible,
    }));
  const handoffQueue = handoffRecords
    .filter((record) => record.status === 'queued')
    .slice(0, topN)
    .map((record) => ({
      id: record.id,
      artifactPath: record.artifactPath,
      artifactTitle: record.artifactTitle,
      from: record.from,
      to: record.to,
      status: record.status,
      reason: record.reason,
    }));
  const gateQueue = gateRecords
    .filter((record) => record.status === 'waiting_ceo')
    .slice(0, topN)
    .map((record) => ({
      id: record.id,
      artifactPath: record.artifactPath,
      artifactTitle: record.artifactTitle,
      category: record.category,
      reason: record.reason,
      evidenceRef: record.evidenceRef,
    }));

  return {
    implementation: localDataRecords.implementation,
    summary: localDataRecords.summary,
    generatedAt: localDataRecords.generatedAt || new Date().toISOString(),
    boundaries: localDataRecords.boundaries,
    metrics: {
      byArtifactKind: byCount(byKind),
      byOwner: byCount(byOwner),
      byGateCategory: byCount(byGateCategory),
      byHandoffStatus: byCount(byHandoffStatus),
      archivedCount: artifactRecords.filter((record) => record.state === 'archived').length,
    },
    queues: {
      needsCeoArtifacts,
      handoffQueue,
      gateQueue,
    },
    warnings: localDataRecords.warnings || [],
  };
}

export {
  buildLocalDataRecordsV0,
  buildLocalDataRecordsDashboardPack,
  inferGateCategory,
  LOCAL_DATA_RECORD_BOUNDARIES_V0,
  LOCAL_DATA_RECORD_STATE_PRIORITY,
  LOCAL_DATA_DASHBOARD_LIMIT_DEFAULT,
  normalizeHandoffTo,
};
