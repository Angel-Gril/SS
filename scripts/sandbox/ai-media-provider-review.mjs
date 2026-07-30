function evidenceKey(evidence) {
  return [
    String(evidence?.endpointSha256 || ''),
    String(evidence?.operation || ''),
    String(evidence?.inputTransport || ''),
    String(evidence?.resultMode || ''),
  ].join(':');
}

export function reviewedPaidDerivedCapabilityMatches(entry, reviewed) {
  if (!reviewed || !Array.isArray(entry.operations) || !(reviewed.operations instanceof Set)) {
    return false;
  }
  const operations = new Set(entry.operations);
  if (operations.size !== entry.operations.length) return false;
  const paidDerivedOperations = entry.operations
    .filter((operation) => operation !== 'TEXT_TO_IMAGE');
  if (
    paidDerivedOperations.length !== reviewed.operations.size
    || paidDerivedOperations.some((operation) => !reviewed.operations.has(operation))
    || entry.inputTransport !== reviewed.inputTransport
    || entry.resultMode !== reviewed.resultMode
    || entry.maxReferences !== reviewed.maxReferences
    || entry.supportsMask !== reviewed.supportsMask
  ) {
    return false;
  }

  if (entry.evidenceLevel !== 'sandbox-verified') {
    return reviewed.sandboxEvidence == null && entry.sandboxEvidence == null;
  }
  if (!(reviewed.sandboxEvidence instanceof Set)
    || reviewed.sandboxEvidence.size < 1
    || !Array.isArray(entry.sandboxEvidence)
    || entry.sandboxEvidence.length < 1) return false;

  const actualKeys = [];
  const evidencedOperations = new Set();
  for (const evidence of entry.sandboxEvidence) {
    if (!/^[a-f0-9]{64}$/u.test(String(evidence?.endpointSha256 || ''))
      || !operations.has(evidence?.operation)
      || !['none', 'public_url', 'base64', 'multipart'].includes(evidence?.inputTransport)
      || !['sync', 'async'].includes(evidence?.resultMode)) {
      return false;
    }
    actualKeys.push(evidenceKey(evidence));
    evidencedOperations.add(evidence.operation);
  }
  const actualEvidence = new Set(actualKeys);
  if (actualEvidence.size !== actualKeys.length
    || entry.operations.some((operation) => !evidencedOperations.has(operation))) {
    return false;
  }
  return actualEvidence.size === reviewed.sandboxEvidence.size
    && [...actualEvidence].every((key) => reviewed.sandboxEvidence.has(key));
}
