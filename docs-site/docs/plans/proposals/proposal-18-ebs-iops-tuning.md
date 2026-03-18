# 제안 18: EBS GP3 동적 IOPS 튜닝

## 1. 개요

### 문제 정의

op-geth는 L2 체인 데이터를 Amazon EBS에 저장한다. 운영 단계에 따라 IOPS 수요가 크게 달라진다.

| 단계 | 실제 IOPS | 지속 시간 | 발생 빈도 |
|---|---|---|---|
| 초기 동기화 | 6,000-10,000 | 수시간~수일 | 1회성 |
| 일반 운영 | 200-800 | 상시 | 항상 |
| 리오그 | 3,000-5,000 | 수분 | 드묾 |
| 프루닝 | 4,000-8,000 | 수시간 | 주기적 |

GP3 기본 제공은 3,000 IOPS다. 추가 IOPS는 월 과금이 발생한다.
실무에서 “안전하게” 6,000+ IOPS를 상시 고정해 두는 경우가 많아, 실제 사용 대비 과금 낭비가 발생한다.

### 해결 요약

**EBS IOPS Optimizer**를 구현해 아래를 자동화한다.

1. CloudWatch(`VolumeReadOps`, `VolumeWriteOps`)로 실제 IOPS 모니터링
2. 부하 패턴에 따라 GP3 IOPS/Throughput 동적 조정
3. AWS 제약 준수(볼륨 수정 간 최소 6시간 간격, 최대 IOPS 제한)
4. 고 I/O 패턴 감지 시 선제적 scale-up

### 목표

- 과할당 IOPS 제거로 월 비용 절감
- sync/reorg 시점 자동 확장
- 설정 후 수동 개입 최소화
- 중요한 작업 중 I/O 스로틀링 방지

### 비목표

- 볼륨 타입 마이그레이션(GP2 → GP3)
- 스냅샷 수명주기 관리
- AZ 간 복제
- Throughput 고급 최적화(기본 정책 유지)

### 월 절감 추정

| 항목 | 기존(고정 6,000 IOPS) | 동적 적용 후 | 절감 |
|---|---|---|---|
| 추가 IOPS | 고정 과금 | 평균 사용량 기반 과금 | 절감 |
| 추가 Throughput | 상시 과금 가능 | 필요 시만 증액 | 절감 |
| 합계 |  |  | **약 $21/월** |

---

## 2. 아키텍처

### 데이터 흐름

1. Scheduler에서 60분 주기로 Optimizer 실행
2. 대상 EBS Volume 식별(`describe-volumes`)
3. CloudWatch에서 IOPS 지표 수집
4. 1시간/24시간 패턴 분석 및 추세 판별
5. 목표 IOPS/Throughput 계산
6. 필요 시 `modify-volume` 실행

### 통합 지점

| 모듈 | 파일 | 용도 |
|---|---|---|
| K8s Config | `src/lib/k8s-config.ts` | AWS CLI 인증/리전 컨텍스트 |
| Scheduler | `src/lib/scheduler.ts` | 시간 기반 실행 |
| State Store | `src/lib/redis-store.ts` | 마지막 수정 시각/이력 저장 |

### 상태 관리

`IStateStore` 확장:

- `getEbsOptimizerState()`
- `setEbsOptimizerState(state)`

---

## 3. 상세 설계

### 3.1 신규 타입

신규 파일: `src/types/ebs-optimizer.ts`

핵심 타입:

1. `EbsVolumeInfo`: 볼륨 식별/현재 프로비저닝 값
2. `IopsMetrics`: 기간별 읽기/쓰기 연산량, 합산 IOPS, 큐 길이
3. `IopsAnalysis`: 1h/24h 평균·피크·추세·권장치
4. `VolumeModificationResult`: 수정 전/후 값, 성공 여부, 오류
5. `EbsOptimizerState`: 마지막 확인/수정 시각, 이력 버퍼
6. `EbsOptimizerConfig`: 임계값, 쿨다운, 체크 주기, 최대치

권장 기본값:

- `enabled=false`
- `baselineIops=3000`
- `maxIops=10000`
- `baselineThroughput=125`
- `scaleUpThresholdPct=80`
- `scaleDownThresholdPct=30`
- `cooldownHours=6`
- `checkIntervalMinutes=60`

### 3.2 코어 모듈

신규 파일: `src/lib/ebs-optimizer.ts`

핵심 책임:

1. 대상 볼륨 탐색
2. CloudWatch 지표 조회
3. 추세/임계값 기반 목표치 산출
4. 쿨다운/안전 규칙 검증
5. `modify-volume` 실행 및 상태 반영
6. 예상 비용 절감 계산

### 3.3 Scheduler 연동

- 60분 주기 잡 추가
- 실패 시 다음 주기에 자동 재시도
- 연속 실패는 알림/로그 레벨 상향

### 3.4 API 엔드포인트

권장 API:

1. `GET /api/ebs-optimizer/status`
2. `POST /api/ebs-optimizer/check`
3. `POST /api/ebs-optimizer/adjust`

### 3.5 환경 변수

- `EBS_OPTIMIZER_ENABLED`
- `EBS_OPTIMIZER_VOLUME_TAG`
- `EBS_OPTIMIZER_MAX_IOPS`
- `EBS_OPTIMIZER_SCALE_UP_THRESHOLD_PCT`
- `EBS_OPTIMIZER_SCALE_DOWN_THRESHOLD_PCT`
- `EBS_OPTIMIZER_COOLDOWN_HOURS`
- `EBS_OPTIMIZER_CHECK_INTERVAL_MINUTES`

---

## 4. 구현 가이드

### 파일 변경 목록

신규:

- `src/types/ebs-optimizer.ts`
- `src/lib/ebs-optimizer.ts`
- `src/app/api/ebs-optimizer/status/route.ts`
- `src/lib/__tests__/ebs-optimizer.test.ts`

수정:

- `src/lib/scheduler.ts`
- `src/lib/redis-store.ts`
- `src/types/redis.ts`

### 재사용 함수

- `runK8sCommand()`
- 기존 로거/스토어 유틸

### 구현 순서

1. 타입/설정 계약 확정
2. CloudWatch 수집기 구현
3. 분석 엔진 구현(추세/권장치)
4. 볼륨 수정 실행기 구현
5. Scheduler/API 연동
6. 통합 검증

---

## 5. 테스트 명세

### Mock 전략

- AWS CLI 응답 mock(`describe-volumes`, `get-metric-statistics`, `modify-volume`)
- 시간 경과 mock(6시간 쿨다운)
- 저장소 상태 mock

### 테스트 케이스

1. 볼륨 탐색 실패/성공 처리
2. 메트릭 없음/불충분 시 안전 스킵
3. scale-up 임계값 초과 시 목표치 상향
4. scale-down 임계값 미만 시 목표치 하향
5. 쿨다운 중 수정 차단
6. 최대/최소 경계값 클램프
7. 수정 성공 시 상태/이력 업데이트
8. 수정 실패 시 오류 기록 및 재시도 가능 상태 유지

### 최소 커버리지

- 라인 커버리지 85% 이상
- 핵심 의사결정 분기 100%

---

## 6. 검증

### Step 1: Build

- `npm run lint`
- `npx tsc --noEmit`

### Step 2: Unit Tests

- `npm run test:run -- ebs-optimizer`

### Step 3: 통합 테스트 (AWS 자격 증명 필요)

1. 상태 조회 API 정상 응답 확인
2. 지표 수집/분석 결과 확인
3. 조건 충족 시 볼륨 수정 실행 확인
4. 쿨다운 동안 재수정 차단 확인

### Step 4: 전체 테스트

- `npm run test:run`

