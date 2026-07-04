export const SIGNAL_MAIN_FACT_CONTRACT_VERSION = 'signal-main-fact-v1' as const;

export type SignalFactPlanePhase =
  | 'schema_ready'
  | 'dual_write_candidate'
  | 'signal_read_preferred'
  | 'signal_source_of_truth';

export function buildSignalMainFactContract() {
  return {
    version: SIGNAL_MAIN_FACT_CONTRACT_VERSION,
    currentPhase: 'signal_source_of_truth' satisfies SignalFactPlanePhase,
    targetPhase: 'signal_source_of_truth' satisfies SignalFactPlanePhase,
    // CEO Gate:sourceOfTruthCutover 于 2026-07-04 由 CEO 会话决策批准。
    // 实现:signal-read-cache.ts(事实库独立 + 显式删除传导 + 投影重建)。
    ceoGate: {
      sourceOfTruthCutoverApprovedAt: '2026-07-04',
      approvedVia: 'ceo_session_decision',
    },
    phaseHistory: [
      {
        phase: 'signal_read_preferred' satisfies SignalFactPlanePhase,
        until: '2026-07-04',
        signals: 'primary_cloud_fact_candidate_with_projection_fallback',
        memoryNodes: 'compat_projection_during_dual_write',
        lifeGraph: 'compat_projection_during_dual_write',
      },
    ],
    sourceOfTruth: {
      current: {
        signals: 'main_fact_table',
        memoryNodes: 'projection_view',
        lifeGraph: 'projection_view',
        inventoryItems: 'domain_private_table_that_references_or_emits_signals',
      },
      target: {
        signals: 'main_fact_table',
        memoryNodes: 'projection_view',
        lifeGraph: 'projection_view',
        inventoryItems: 'domain_private_table_that_references_or_emits_signals',
      },
    },
    writePolicy: {
      requiredFlow: 'normalize -> createSignal -> projection',
      dualWriteAllowedDuringTransition: true,
      directProjectionWriteAllowedDuringTransition: false,
      directProjectionWriteTargetState: false,
      productionMigrationRequiresCeoGate: true,
    },
    readPolicy: {
      currentPriority: ['cloud_signals', 'local_signal_cache', 'projection_fallback'],
      targetPriority: ['cloud_signals', 'local_signal_cache', 'projection_fallback'],
      todayCardsRequireEvidenceSignalIds: true,
      askBaoheShouldSearchSignals: true,
      decEnginesRequireEvidenceSignals: true,
    },
    embeddingPolicy: {
      phase1TextScoring: true,
      embeddingTextColumnReady: true,
      pgvectorSchemaReady: true,
      vectorRpcReady: true,
      pgvectorRuntimeEnabled: 'env_gated',
      runtimeEmbeddingProvider: 'Gemini text-embedding-004 when SIGNAL_EMBEDDINGS_ENABLED and SIGNAL_VECTOR_SEARCH_ENABLED are true',
      runtimeActivation: 'SIGNAL_EMBEDDINGS_ENABLED + SIGNAL_VECTOR_SEARCH_ENABLED + GEMINI_API_KEY',
      runtimeSearchPath: '/api/cloud/signals?q=...',
      vectorSearchScope: 'own_user_signals_only',
      crossUserSearchAllowed: false,
      publicCorpusSearchAllowed: false,
    },
    feedbackLoopPolicy: {
      feedbackEventsMustReferenceSignalIds: true,
      feedbackCanUpdateSignalStatus: true,
      feedbackCanUpdateDecEngineQuality: true,
      feedbackCanUpdatePreferenceModel: true,
      deletesRealDataAutomatically: false,
    },
    gates: {
      schemaMigration: 'operator_action',
      dualWriteRuntime: 'no_ceo_gate_if_no_real_migration',
      signalReadPreferred: 'qa_required',
      sourceOfTruthCutover: 'ceo_gate_required',
      realDataMigration: 'ceo_gate_required',
      projectionDecommission: 'ceo_gate_required',
    },
    boundaries: {
      noAutomaticRealDataMigration: true,
      noDestructiveProjectionCleanup: true,
      noCrossUserInference: true,
      noUnscopedEmbeddingSearch: true,
      noAgentActionFromSignalWithoutApproval: true,
    },
  };
}
