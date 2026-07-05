/**
 * Guidance dedup / cooling identity
 *
 * The pipeline collapses events to "one card per identity" (Layer 6 cooling +
 * the in-loop dedup gate). For most event types the identity is just the type:
 * you want a single birthday card today, not three. DEC insights are the one
 * exception — each is an independent cross-domain recommendation, so they must
 * be keyed by their own event id.
 *
 * Why this exists as its own module: keying DEC cards by the bare 'dec_insight'
 * type made the type-dedup discard every DEC card but the first (and the
 * 12h medium type-cooldown then suppressed the rest for half a day), so
 * runDEC's whole output silently collapsed to one card — PRD TODAY-002's
 * flagship "surface several evidence-gated insights" was inert. Extracting the
 * identity rule into plain JS lets the .ts pipeline and a node .mjs behavioral
 * test share the exact same logic (the pipeline is .ts and the test harness
 * runs bare .mjs, so this is the seam where they meet).
 */

/**
 * Dedup / cooling identity for an event or card.
 * @param {string} type - GuidanceEventType (e.g. 'birthday', 'dec_insight')
 * @param {string} id   - the event id (used only for DEC insights)
 * @returns {string} identity key: the id for DEC insights, else the type
 */
export function coolingKey(type, id) {
  return type === 'dec_insight' ? id : type;
}

/**
 * Build a stateful "one card per identity" gate for a single pipeline run.
 * Returns a predicate that reports whether an event duplicates one already
 * admitted this run (first occurrence per identity wins — matching the order
 * in which the pipeline feeds surviving events through it).
 * @returns {(type: string, id: string) => boolean} isDuplicate
 */
export function makeDedupGate() {
  const seen = new Set();
  return (type, id) => {
    const key = coolingKey(type, id);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  };
}
