/**
 * Service Catalog Metadata
 * Use-case driven descriptions + response previews for each service
 */

export interface ServiceMeta {
  useCase: string;
  personas: string[];
  responsePreview: Record<string, unknown>;
}

export const SERVICE_META: Record<string, ServiceMeta> = {
  sequencer_health: {
    useCase: '시퀀서 장애를 1초 안에 감지하고, 이상 시 자동으로 트래픽을 다른 노드로 전환',
    personas: ['DeFi Ops', 'Bridge Operators', 'MEV Bots'],
    responsePreview: {
      status: 'healthy',
      latency: 1250,
      syncLag: 2,
      uptime: 99.97,
      lastUpdate: '2026-03-24T10:00:00Z',
    },
  },
  incident_summary: {
    useCase: '최근 장애 이력을 확인해서 이 체인에 자금을 넣어도 안전한지 판단',
    personas: ['Fund Managers', 'Risk Teams', 'DeFi Protocols'],
    responsePreview: {
      activeIncidents: 0,
      resolvedToday: 2,
      avgResolutionTime: '12.5 min',
      lastIncident: '2026-03-23T14:30:00Z',
    },
  },
  batch_submission_status: {
    useCase: '배치 제출 지연을 감지해서 내 L2 트랜잭션 지연에 미리 대응',
    personas: ['L2 App Devs', 'MEV Bots', 'Sequencer Ops'],
    responsePreview: {
      pendingBatches: 3,
      submittedToday: 18,
      avgSubmissionTime: '2.1 min',
      lastSubmission: '2026-03-24T08:00:00Z',
    },
  },
  derivation_lag: {
    useCase: 'L1↔L2 동기화 지연을 모니터링해서 브릿지 안전성을 실시간 확인',
    personas: ['Bridge Operators', 'Cross-chain Protocols'],
    responsePreview: {
      l2BlockNumber: 18234567,
      l1Origin: 19876543,
      lagBlocks: 2,
      lagSeconds: 24,
      status: 'synced',
    },
  },
  anomaly_feed: {
    useCase: '이상 징후를 실시간으로 받아서 내 봇이나 대시보드에 바로 연동',
    personas: ['Monitoring Teams', 'Alert Systems', 'Trading Bots'],
    responsePreview: {
      anomalies: [
        { severity: 'warning', component: 'op-geth', metric: 'cpu', value: 78.5, threshold: 70 },
      ],
      activeCount: 1,
      totalRecent: 3,
    },
  },
  health_diagnostics: {
    useCase: '전체 시스템 헬스체크를 한 번에 — 운영 리포트나 SLA 보고에 활용',
    personas: ['Node Operators', 'DevOps', 'SRE Teams'],
    responsePreview: {
      overall: 'healthy',
      components: { 'op-geth': 'ok', 'op-node': 'ok', 'op-batcher': 'ok' },
      metrics: { cpu: '45%', memory: '8 GiB' },
      anomalies: 0,
    },
  },
  rca_report: {
    useCase: '장애 원인 분석 보고서 — 포스트모템이나 컴플라이언스 보고에 활용',
    personas: ['SRE Teams', 'Compliance', 'Incident Managers'],
    responsePreview: {
      incidentId: 'INC-2026-0324-001',
      rootCause: 'L1 RPC endpoint timeout caused derivation stall',
      affectedComponents: ['op-node', 'op-batcher'],
      resolution: 'Automatic failover to backup L1 RPC',
      duration: '4 min 32 sec',
    },
  },
  // Validator services
  validator_status: {
    useCase: '밸리데이터 상태와 리워드를 실시간으로 추적해서 슬래싱 리스크 관리',
    personas: ['Staking Providers', 'Validators', 'DAO Treasuries'],
    responsePreview: {
      status: 'active',
      uptime: '99.95%',
      pendingRewards: '12.5 ETH',
      missedBlocks: 0,
    },
  },
  stake_info: {
    useCase: '스테이킹 풀 현황과 수익률을 확인해서 최적 스테이킹 전략 수립',
    personas: ['DeFi Protocols', 'Yield Aggregators'],
    responsePreview: {
      totalStaked: '32,000 ETH',
      apr: '4.2%',
      delegators: 156,
      nextPayout: '2026-03-25T00:00:00Z',
    },
  },
  consensus_health: {
    useCase: '컨센서스 참여율과 미스된 블록을 추적해서 네트워크 안정성 확인',
    personas: ['Network Monitors', 'Governance Teams'],
    responsePreview: {
      participationRate: '99.8%',
      missedSlots: 2,
      finalizedEpoch: 234567,
      headSlot: 7501234,
    },
  },
  // RPC services
  request_count: {
    useCase: 'RPC 요청량을 시간별로 추적해서 용량 계획과 비용 최적화',
    personas: ['RPC Providers', 'Infrastructure Teams'],
    responsePreview: {
      lastHour: 45230,
      last24h: 1082400,
      peakRps: 125,
      trend: 'stable',
    },
  },
  latency_stats: {
    useCase: 'P99/P95 레이턴시를 모니터링해서 SLA 준수 여부 실시간 확인',
    personas: ['Performance Engineers', 'SLA Managers'],
    responsePreview: {
      p50: '12ms',
      p95: '45ms',
      p99: '89ms',
      avg: '18ms',
    },
  },
  error_rate: {
    useCase: '에러 코드별 실패율을 분석해서 장애 원인을 빠르게 파악',
    personas: ['Backend Devs', 'Reliability Engineers'],
    responsePreview: {
      totalErrors: 23,
      errorRate: '0.02%',
      breakdown: { '429': 15, '500': 5, '503': 3 },
    },
  },
  // Oracle services
  price_feed: {
    useCase: '다중 DEX에서 수집한 실시간 토큰 가격으로 정확한 가격 피드 확보',
    personas: ['DeFi Protocols', 'Trading Bots', 'Lending Platforms'],
    responsePreview: {
      pair: 'ETH/USDT',
      price: 3245.67,
      sources: 5,
      confidence: '99.2%',
      updatedAt: '2026-03-24T10:00:01Z',
    },
  },
  freshness_monitor: {
    useCase: '온체인 가격 업데이트 지연을 감지해서 스테일 데이터 리스크 방지',
    personas: ['Oracle Operators', 'Risk Monitors'],
    responsePreview: {
      pairs: { 'ETH/USDT': '2s ago', 'TON/USDT': '5s ago' },
      staleCount: 0,
      avgFreshness: '3.2s',
    },
  },
  // Monitoring services
  alert_status: {
    useCase: '현재 활성 알림을 모아서 보고, 전체 에코시스템 상태를 한눈에 파악',
    personas: ['On-call Engineers', 'NOC Teams'],
    responsePreview: {
      activeAlerts: 1,
      severity: { critical: 0, warning: 1, info: 3 },
      lastTriggered: '2026-03-24T09:45:00Z',
    },
  },
  sla_metrics: {
    useCase: '전체 운영자 SLA 준수율을 집계해서 네트워크 신뢰도 리포트에 활용',
    personas: ['Platform Ops', 'Business Teams'],
    responsePreview: {
      avgUptime: '99.7%',
      avgResponseTime: '185ms',
      operatorsAboveSLA: 4,
      totalOperators: 5,
    },
  },
};

export function getServiceMeta(serviceKey: string): ServiceMeta | null {
  return SERVICE_META[serviceKey] ?? null;
}
