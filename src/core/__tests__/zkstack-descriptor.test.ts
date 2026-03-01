import { describe, expect, it } from 'vitest';
import { ZKSTACK_DESCRIPTOR } from '@/protocols/zkstack/descriptor';

describe('ZKSTACK_DESCRIPTOR', () => {
  it('declares zkstack protocol id and execution collector', () => {
    expect(ZKSTACK_DESCRIPTOR.protocolId).toBe('zkstack');
    expect(ZKSTACK_DESCRIPTOR.collectorType).toBe('evm-execution');
  });

  it('includes zkstack batch metric fields with nullable optional proof queue', () => {
    const fieldNames = ZKSTACK_DESCRIPTOR.metricsFields.map((f) => f.fieldName);

    expect(fieldNames).toContain('blockHeight');
    expect(fieldNames).toContain('l1BatchNumber');

    const proverQueueDepth = ZKSTACK_DESCRIPTOR.metricsFields.find((f) => f.fieldName === 'proverQueueDepth');
    expect(proverQueueDepth?.nullable).toBe(true);
  });

  it('tracks anomaly configuration for zkstack-specific l1 batch metric', () => {
    expect(ZKSTACK_DESCRIPTOR.anomalyConfig.l1BatchNumber).toMatchObject({
      enabled: true,
      method: 'plateau',
    });
  });
});
