# Redis State Persistence Guide

> ⚠️ **Redis는 선택사항입니다.** 일일 레포트와 비용 분석을 사용할 때만 필요합니다.

---

## 빠른 시작

### 🟢 Redis 설정 (일일 레포트 + 비용 분석)

#### 1단계: Docker Compose로 Redis 시작

```bash
docker-compose up redis -d
```

**확인:**
```bash
docker-compose ps redis
# Status: Up X seconds (healthy)

docker-compose exec redis redis-cli ping
# PONG
```

#### 2단계: .env.local에 추가

```bash
# 로컬 개발용
REDIS_URL=redis://localhost:6379

# Docker Compose 내부에서는 자동 설정됨:
# REDIS_URL=redis://redis:6379
```

#### 3단계: 개발 서버 재시작

```bash
npm run dev
```

**로그에서 확인:**
```
[State Store] Using Redis: redis://localhost:6379
```

---

## Redis 의존성 분석

**언제 Redis가 필요한가?**

| 기능 | Redis 필수? | 설명 |
|------|----------|------|
| **일일 레포트** (Daily Report) | 🔴 필수 | 24시간 메트릭 스냅샷 누적 (48시간 TTL) |
| **비용 최적화** (Cost Optimizer) | 🔴 필수 | 7일 vCPU 사용량 누적 (비용 분석) |
| **실시간 스케일링** | 🟢 선택 | InMemory 버퍼로 충분 (재시작 시 손실 가능) |
| **이상 탐지** (Anomaly Detection) | 🟢 선택 | 이벤트 히스토리만 (UI 표시용) |
| **예측 스케일링** (Predictive Scaler) | 🟢 선택 | 예측 추적 (기능에 영향 없음) |
| **NLOps 채팅** | 🟢 선택 | Redis 미사용 |

**결론:**
- **Redis 필수**: 일일 레포트 OR 비용 분석을 하려면
- **Redis 불필요**: 실시간 모니터링 + 스케일링만 필요하면

---

## Redis 제거

### 🔴 Redis 중지 및 제거

#### 1단계: 설정 제거

**.env.local에서 Redis 관련 설정 제거:**

```bash
# 이 라인을 주석 처리하거나 삭제
# REDIS_URL=redis://localhost:6379
```

**레포트 & 비용 분석 비활성화 (선택):**

```bash
COST_TRACKING_ENABLED=false
```

#### 2단계: Docker Compose에서 Redis 중지

```bash
# Redis 컨테이너만 중지
docker-compose stop redis

# 또는 완전히 제거 (데이터도 삭제)
docker-compose down redis
# 또는 모든 컨테이너 & 볼륨 제거
docker-compose down -v
```

#### 3단계: 개발 서버 재시작

```bash
npm run dev
```

**로그에서 확인:**
```
[State Store] Using InMemory (set REDIS_URL for persistence)
```

---

## InMemory vs Redis 비교

### InMemory (Redis 없음)

**장점:**
- ✅ 설정 간단 (즉시 사용 가능)
- ✅ 외부 의존성 없음
- ✅ 메모리 효율적 (개발 환경)

**단점:**
- ❌ 서버 재시작 시 모든 데이터 손실
- ❌ 일일 레포트 불완전 (24시간 누적 불가)
- ❌ 비용 분석 부정확 (7일 히스토리 손실)
- ❌ 메트릭 히스토리 없음

### Redis (권장)

**장점:**
- ✅ 모든 데이터 영속성
- ✅ 일일 레포트 정상 작동
- ✅ 비용 분석 정확
- ✅ 서버 재시작 후에도 데이터 유지

**단점:**
- ❌ Docker 추가 설정 필요
- ❌ 추가 메모리 사용
- ❌ 프로덕션에서는 Redis 서버 필요

---

## 프로덕션 배포

### Docker Compose 배포 (권장)

```bash
# 전체 SentinAI + Redis 배포
docker-compose up -d

# 또는 Redis 없이 배포
docker-compose up -d sentinai
# 단, .env.local에서 REDIS_URL 제거 필수
```

**docker-compose.yml 설정:**

```yaml
services:
  sentinai:
    environment:
      - REDIS_URL=redis://redis:6379  # 내부 DNS 사용
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
```

### EC2 배포 (Redis 별도 설치)

Redis를 별도 서버에 설치하는 경우:

```bash
# EC2에 Redis 설치
sudo yum install redis -y
sudo systemctl start redis-server

# .env.local 설정
REDIS_URL=redis://redis-server-ip:6379
```

---

## Redis 모니터링

### Redis CLI 접속

```bash
# Docker 컨테이너 내 Redis CLI
docker-compose exec redis redis-cli

# 또는 로컬 설치 Redis
redis-cli -h localhost -p 6379
```

### 주요 명령어

```bash
# Redis 상태 확인
PING
# PONG

# 저장된 모든 키 확인
KEYS *

# 특정 데이터 확인
GET metrics:buffer
HGETALL scaling:state
LRANGE scaling:history 0 5

# 데이터 개수 확인
DBSIZE

# 메모리 사용량
INFO memory
```

### 데이터 초기화

```bash
# 모든 데이터 삭제 (주의!)
FLUSHALL

# 특정 키만 삭제
DEL metrics:buffer scaling:state
```

---

## 문제 해결

### Redis 연결 실패

**증상:** `[State Store] Using InMemory` 메시지가 나타남

**해결:**

```bash
# 1. Redis 실행 여부 확인
docker-compose ps redis

# 2. Redis가 실행 중이 아니면 시작
docker-compose up redis -d

# 3. .env.local에 REDIS_URL 확인
grep REDIS_URL .env.local

# 4. 개발 서버 재시작
npm run dev
```

### Redis 포트 충돌

**증상:** `Address already in use: :::6379`

**해결:**

```bash
# 1. 기존 Redis 컨테이너 정지
docker-compose stop redis

# 2. 다른 프로세스가 6379를 사용 중인지 확인
lsof -i :6379

# 3. 필요하면 다른 포트 사용
# docker-compose.yml의 ports를 6380:6379로 변경
# 그리고 .env.local: REDIS_URL=redis://localhost:6380
```

### Redis 컨테이너 건강 상태 확인

**증상:** `health: starting` 상태로 계속 진행되지 않음

**해결:**

```bash
# 컨테이너 로그 확인
docker-compose logs redis

# 컨테이너 재시작
docker-compose restart redis

# 또는 상태 강제 재설정
docker-compose down redis && docker-compose up redis -d
```

---

## 데이터 백업

### Redis RDB (스냅샷) 백업

```bash
# Docker 컨테이너 내 RDB 파일 확인
docker-compose exec redis ls -la /data/

# 로컬로 복사
docker cp sentinai-redis:/data/dump.rdb ./redis-backup.rdb
```

### Redis 데이터 내보내기

```bash
# 모든 데이터를 텍스트 형식으로 내보내기
docker-compose exec redis redis-cli --rdb /tmp/dump.rdb
docker cp sentinai-redis:/tmp/dump.rdb ./redis-dump.rdb
```

---

## 추천 설정

### 개발 환경

**일일 레포트 + 비용 분석 원하는 경우:**

```bash
REDIS_URL=redis://localhost:6379
COST_TRACKING_ENABLED=true
```

**실시간 모니터링만 필요한 경우:**

```bash
# REDIS_URL 제거 (InMemory 사용)
COST_TRACKING_ENABLED=false
```

### 프로덕션 환경

**권장:**

```bash
# docker-compose.yml에 정의된 Redis 사용
REDIS_URL=redis://redis:6379
COST_TRACKING_ENABLED=true

# Redis 메모리 제한 (필요시 조정)
# command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

**고가용성 (선택사항):**

- Redis Cluster 또는 Sentinel 구성
- 정기적 백업 (RDB 또는 AOF)
- Redis 모니터링 (prometheus-exporter)

---

## 참고

- **docker-compose.yml**: Redis 서비스 정의 (라인 24-37)
- **redis-store.ts**: InMemory/Redis 선택 로직 (라인 1050-1067)
- **daily-accumulator.ts**: 24시간 스냅샷 수집
- **usage-tracker.ts**: 7일 비용 데이터 수집
- **CLAUDE.md**: 프로젝트 설정 가이드
