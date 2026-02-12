# SentinAI Documentation

> Autonomous Node Guardian for Optimism L2

---

## Proposals

AI 모델을 활용한 모니터링, 스케일링, 보안, 예측, 운영 자동화 강화 제안서.

| # | 제안 | 상태 | 문서 |
|---|------|------|------|
| 1 | **Predictive Scaling** — 시계열 분석 기반 선제적 스케일링 | 구현 완료 | [상세](done/proposal-1-predictive-scaling.md) |
| 2 | **Anomaly Detection** — 다층 이상 탐지 파이프라인 | 구현 완료 | [상세](done/proposal-2-anomaly-detection.md) |
| 3 | **Root Cause Analysis** — 장애 근본 원인 자동 분석 | 구현 완료 | [상세](done/proposal-3-rca-engine.md) |
| 4 | **AI Cost Optimizer** — Fargate 비용 최적화 엔진 | 구현 완료 | [상세](done/proposal-4-cost-optimizer.md) |
| 5 | **Natural Language Ops** — 자연어 기반 운영 인터페이스 | 구현 완료 | [상세](done/proposal-5-nlops.md) |
| 6 | **Zero-Downtime Scaling** — 무중단 수직 스케일링 전략 | 구현 완료 | [상세](done/proposal-6-zero-downtime-scaling.md) |
| 7 | **Redis State Store** — 상태 영속성 계층 (Redis/InMemory 이중 구현) | 구현 완료 | [상세](done/proposal-7-redis-state-store.md) |

## Testing

### Unit Tests
- **통과율**: 541개 테스트 100% 통과 (23개 파일)
- **커버리지**:
  - 전체: ~51%
  - 핵심 모듈: ~70%
- **실행**: `npm run test:run`
- **커버리지 리포트**: `npm run test:coverage`

### E2E Verification (클러스터)
- **스크립트**: `scripts/verify-e2e.sh`
- **대상**: 실제 EKS + L2 RPC + AI Provider
- **6 Phase 검증**: 메트릭 수집 → 이상 탐지 → 예측 → 비용 → 보고서 → RCA
- **실행**: `npm run verify` 또는 `bash scripts/verify-e2e.sh --phase 2`

---

## Verification

기능 검증 계획 및 실행 결과 보고서.

| 대상 | 유형 | 문서 |
|------|------|------|
| Predictive Scaling | 검증 계획 | [상세](verification/predictive-scaling-verification.md) |
| Predictive Scaling | 실행 결과 | [상세](verification/predictive-scaling-verification-report.md) |
| Seed UI (Mock 데이터 검증) | 검증 가이드 | [상세](verification/seed-ui-verification.md) |
| Seed UI (Mock 데이터 검증) | 실행 결과 | [상세](verification/seed-ui-verification-report.md) |

---

## Guides

실무 가이드 및 배포, 테스트 방법.

| 가이드 | 대상 | 설명 |
|--------|------|------|
| [Redis 설정](guide/redis-setup.md) | 개발자 | InMemory vs Redis 선택, 설정/제거 방법 |
| [EC2 설치 가이드](guide/ec2-setup-guide.md) | 비개발자/운영자 | AWS EC2 + Docker Compose + Cloudflare Tunnel 배포 |
| [L1 Proxyd Failover](guide/proxyd-failover-setup.md) | 운영자 | **[필수]** L2 블록 생성 보호: Paid L1 RPC quota 초과 시 자동 failover |
| [데모 시나리오](guide/demo-scenarios.md) | 테스트/데모 | 다양한 시나리오별 L2 메트릭 시뮬레이션 |
| [프로덕션 로드 테스트](guide/production-load-testing-guide.md) | QA/운영 | 실제 EKS 환경에서의 부하 테스트 및 검증 |

---

## Future Work

미래 작업 로드맵 및 계획 중인 Proposal들.

| # | 제안 | 상태 | 문서 |
|---|------|------|------|
| 8 | **Auto-Remediation Engine** — RCA 기반 자동 복구 루프 및 Playbook 시스템 | 계획 중 | [상세](../todo/proposal-8-auto-remediation.md) |
| — | **Universal Blockchain Platform** — Optimism 외 L2/L1 체인 확장 (Arbitrum, zkSync 등) | 계획 중 | [상세](../todo/universal-blockchain-platform.md) |
