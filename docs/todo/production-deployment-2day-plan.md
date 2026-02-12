# SentinAI Thanos Sepolia 라이브 서비스 배포 계획

## 🎯 목표 (2일 완료)

**Day 1**: 프로덕션 환경 설정 + 일일 레포트 배포 시스템 구축
**Day 2**: 퍼블릭 대시보드 공개 + 통합 테스트 + 라이브 배포

---

## 📋 현재 상태 (2026-02-12 기준)

✅ **완료된 항목**:
- Proposal 1-8 구현 완료 (93%)
- 일일 보고서 생성 시스템 (`daily-report-generator.ts`)
- Scheduler (30초 Agent Loop)
- Redis 영속성 (선택사항)
- Cloudflare Tunnel 지원 (`docker-compose.yml`)
- 테스트: 677/677 통과

❌ **미완료 항목**:
- 일일 레포트 배포 (Email/Slack)
- 퍼블릭 대시보드 공개
- 외부 접근 보안 설정

---

## 📅 상세 실행 계획

### **DAY 1 (2026-02-13)**

#### Phase 1.1: 아침 준비 (09:00 ~ 11:00, 2시간)

**1.1.1 프로덕션 환경 변수 설정**

```bash
# 1. Thanos Sepolia EC2에서 .env.local 구성
cat > /opt/sentinai/.env.local << 'EOF'
# ===== 필수 (생성) =====
L2_RPC_URL=https://thanos-sepolia-rpc.tokamak.network  # Thanos Sepolia L2 RPC
ANTHROPIC_API_KEY=sk-ant-xxx                            # AI 분석용
AWS_CLUSTER_NAME=thanos-sepolia-cluster                 # K8s 클러스터

# ===== 프로덕션 모드 =====
NODE_ENV=production                                      # Cooldown 300s, Seed API 차단
SCALING_SIMULATION_MODE=false                            # 실제 K8s 스케일링
AGENT_LOOP_ENABLED=true                                  # 자율 루프 활성화
AUTO_REMEDIATION_ENABLED=false                           # 단계적 활성화 예정

# ===== 일일 보고서 배포 (신규) =====
REDIS_URL=redis://redis:6379                            # Redis (docker compose 내부)
DAILY_REPORT_ENABLED=true                               # 일일 보고서 활성화
DAILY_REPORT_SCHEDULE=0 9 * * *                         # 매일 오전 9시 (UTC 기준, 로컬 시간 +9시간)
DAILY_REPORT_EMAIL_RECIPIENTS=operator@tokamak.network  # 수신자 이메일 (쉼표 분리)

# ===== 이메일 배포 (선택: Email 또는 Webhook) =====
# Option A: SMTP (Gmail, SendGrid 등)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=sentinai-reports@gmail.com
SMTP_PASSWORD=your-app-password                        # Gmail App Password
SMTP_FROM=sentinai-reports@gmail.com

# Option B: Slack Webhook (권장: 더 빠름)
DAILY_REPORT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# ===== 모니터링 & 알림 =====
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL  # 이상 탐지 알림

# ===== 퍼블릭 대시보드 (신규) =====
PUBLIC_DASHBOARD_ENABLED=true                           # 누구나 접근 가능
PUBLIC_DASHBOARD_WRITE_DISABLED=true                    # 읽기 전용 (쓰기 불가)

# ===== Cloudflare Tunnel (선택) =====
# CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYWJj...               # Tunnel 사용 시
EOF

# 2. 권한 설정
chmod 600 /opt/sentinai/.env.local

# 3. AWS 자격증명 확인
aws sts get-caller-identity
# 응답: Account ID, UserId 확인

# 4. kubectl 접근 확인
kubectl auth can-i patch statefulsets -n thanos-sepolia
# 응답: yes
```

**검증**:
- ✅ .env.local 생성 확인
- ✅ AWS IAM 권한 검증
- ✅ kubectl 접근 확인

**담당**: DevOps

---

#### Phase 1.2: 오전 후반 (11:00 ~ 13:00, 2시간)

**1.2.1 일일 레포트 배포 시스템 구축**

**파일 생성**: `src/lib/daily-report-mailer.ts`

```typescript
/**
 * Daily Report Mailer
 * 일일 보고서 생성 후 이메일 또는 Slack으로 배포
 */

import { sendMail } from './mail-client'; // SMTP 사용 시
import { postToSlack } from './slack-client'; // Slack 사용 시
import { getDailyReport } from './daily-report-generator';
import type { DailyReportResponse } from '@/types/daily-report';

const DELIVERY_METHOD = process.env.DAILY_REPORT_WEBHOOK_URL ? 'slack' : 'email';

export async function deliverDailyReport(date: Date): Promise<{
  success: boolean;
  method: 'email' | 'slack';
  recipients?: string[];
  webhookUrl?: string;
  error?: string;
}> {
  try {
    // 1. 일일 보고서 생성
    const report = await getDailyReport(date);
    if (!report) {
      return { success: false, method: DELIVERY_METHOD as any, error: 'No report generated' };
    }

    // 2. 배포 방식 결정
    if (DELIVERY_METHOD === 'slack' && process.env.DAILY_REPORT_WEBHOOK_URL) {
      // Slack으로 배포 (빠르고 신뢰성 높음)
      const slackBlocks = generateSlackMessage(report);
      await postToSlack(process.env.DAILY_REPORT_WEBHOOK_URL, slackBlocks);

      return {
        success: true,
        method: 'slack',
        webhookUrl: process.env.DAILY_REPORT_WEBHOOK_URL.substring(0, 30) + '***',
      };
    } else if (process.env.DAILY_REPORT_EMAIL_RECIPIENTS) {
      // Email로 배포 (SMTP 사용)
      const recipients = process.env.DAILY_REPORT_EMAIL_RECIPIENTS.split(',').map(e => e.trim());
      const htmlContent = convertMarkdownToHtml(report.markdown);

      await sendMail({
        to: recipients,
        subject: `[SentinAI] 일일 운영 보고서 — ${formatDate(date)}`,
        html: htmlContent,
        attachments: [
          {
            filename: `sentinai-report-${formatDate(date)}.md`,
            content: report.markdown,
          }
        ]
      });

      return {
        success: true,
        method: 'email',
        recipients,
      };
    } else {
      return {
        success: false,
        method: DELIVERY_METHOD as any,
        error: 'No delivery method configured (SLACK or EMAIL)',
      };
    }
  } catch (error) {
    console.error('[DailyReportMailer] Error:', error);
    return {
      success: false,
      method: DELIVERY_METHOD as any,
      error: (error as Error).message,
    };
  }
}

// Slack Block Kit 형식 생성
function generateSlackMessage(report: DailyReportResponse) {
  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📊 SentinAI 일일 운영 보고서',
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*날짜*: ${report.date}\n*상태*: ${report.summary.length > 0 ? '✅ 정상' : '⚠️ 주의'}`,
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*요약*\n${report.summary}`,
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '<http://sentinai.yourdomain.com|📈 대시보드 보기>',
        }
      }
    ]
  };
}
```

**수정 파일**: `src/lib/scheduler.ts` (일일 보고서 스케줄 추가)

```typescript
// 기존 cron 작업 확인 및 일일 보고서 배포 추가
import { scheduleJob } from 'node-cron';
import { deliverDailyReport } from './daily-report-mailer';

export function initScheduler() {
  // 기존: Agent Loop (30초 마다)

  // 신규: 일일 보고서 배포 (매일 정해진 시간)
  const reportSchedule = process.env.DAILY_REPORT_SCHEDULE || '0 9 * * *'; // 기본: 매일 09:00
  if (process.env.DAILY_REPORT_ENABLED === 'true') {
    scheduleJob(reportSchedule, async () => {
      console.log('[Scheduler] Executing daily report delivery...');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = await deliverDailyReport(yesterday);
      console.log('[Scheduler] Daily report delivery result:', result);
    });
    console.log(`[Scheduler] Daily report scheduled: ${reportSchedule}`);
  }
}
```

**테스트**:
```bash
# Docker 재시작 (새 환경 변수 반영)
docker compose down
docker compose up -d

# 로그 확인
docker compose logs -f sentinai | grep -E 'DailyReport|Scheduler'

# 수동 배포 테스트 (API 엔드포인트 추가 필요)
curl -X POST http://localhost:3002/api/reports/daily/send \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-02-12"}'
```

**담당**: Backend Engineer

---

#### Phase 1.3: 오후 (13:00 ~ 17:00, 4시간)

**1.3.1 퍼블릭 대시보드 접근 제어 설정**

**파일 수정**: `src/app/page.tsx` (대시보드 메인 페이지)

```typescript
// 상단에 추가: 환경 변수 기반 읽기 전용 모드
const isPublicMode = process.env.PUBLIC_DASHBOARD_ENABLED === 'true';
const isWriteDisabled = process.env.PUBLIC_DASHBOARD_WRITE_DISABLED === 'true';

// 스케일링 컨트롤 버튼 조건부 렌더링
{!isWriteDisabled && (
  <button onClick={handleScaling}>스케일링 실행</button>
)}

// 또는 버튼을 비활성화하되 원인 표시
{isWriteDisabled && (
  <button disabled className="opacity-50" title="퍼블릭 모드에서는 수동 스케일링 불가">
    스케일링 (읽기 전용)
  </button>
)}
```

**파일 생성**: `src/middleware.ts` (요청 검증)

```typescript
import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const publicMode = process.env.PUBLIC_DASHBOARD_ENABLED === 'true';
  const writeDisabled = process.env.PUBLIC_DASHBOARD_WRITE_DISABLED === 'true';

  // 쓰기 작업 제어 (POST, PATCH, DELETE)
  if (publicMode && writeDisabled && ['POST', 'PATCH', 'DELETE'].includes(request.method)) {
    // GET 제외한 모든 쓰기 작업 중 위험한 것들만 차단
    if (request.nextUrl.pathname.match(/\/(scaler|seed|eoa-balance)\/(send|refill|reset)/)) {
      return NextResponse.json(
        { error: 'Write operations disabled in public mode' },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
```

**1.3.2 Docker Compose 업데이트 (Cloudflare Tunnel)**

```yaml
# docker-compose.yml에 추가

services:
  # ... 기존 sentinai, redis, cloudflared ...

  # Option 1: Cloudflare Tunnel (권장, HTTPS + Zero Trust)
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: sentinai-tunnel
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      sentinai:
        condition: service_healthy
    restart: unless-stopped
    profiles:
      - tunnel

  # Option 2: Nginx Proxy (퍼블릭 IP 직접 공개, DNS + Let's Encrypt)
  nginx:
    image: nginx:alpine
    container_name: sentinai-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./letsencrypt:/etc/letsencrypt:ro
    depends_on:
      sentinai:
        condition: service_healthy
    restart: unless-stopped
    profiles:
      - nginx
```

**파일 생성**: `nginx/conf.d/sentinai.conf` (Nginx 설정)

```nginx
upstream sentinai {
    server sentinai:8080;
}

# HTTP → HTTPS 리다이렉트
server {
    listen 80;
    server_name sentinai.yourdomain.com;

    # Let's Encrypt 인증 (certbot 사용)
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # 나머지 트래픽: HTTPS로 리다이렉트
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS 설정
server {
    listen 443 ssl http2;
    server_name sentinai.yourdomain.com;

    # SSL 인증서 (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/sentinai.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sentinai.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 보안 헤더
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 비율 제한 (대시보드 API 보호)
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;

    # SentinAI 프록시
    location / {
        proxy_pass http://sentinai;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 지원
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 타임아웃
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

**검증**:
- ✅ Cloudflare Tunnel 또는 Nginx 설정 확인
- ✅ 대시보드 접근 테스트 (HTTP/HTTPS)

**담당**: DevOps / Infrastructure

---

### **DAY 2 (2026-02-14)**

#### Phase 2.1: 오전 (09:00 ~ 11:00, 2시간)

**2.1.1 일일 레포트 배포 검증**

```bash
# 1. 일일 보고서 생성 확인
docker exec sentinai curl -s http://localhost:8080/api/reports/daily \
  | jq '.latestReport'

# 2. Slack 배포 테스트 (매뉴얼 트리거)
docker exec sentinai curl -X POST http://localhost:8080/api/reports/daily/send \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-02-13"}'

# 예상 응답:
# {
#   "success": true,
#   "method": "slack",
#   "webhookUrl": "https://hooks.slack.com/services/YOUR/..."
# }

# 3. Slack 채널 확인 (보고서 메시지 수신)
# → Slack 워크스페이스 #sentinai-reports 채널 확인

# 4. Redis에 보고서 저장 확인
docker exec sentinai-redis redis-cli GET sentinai:daily-report:2026-02-13
```

**성공 기준**:
- ✅ Slack에 보고서 메시지 수신
- ✅ 마크다운 형식 정상
- ✅ Redis에 저장됨

**담당**: QA

---

#### Phase 2.2: 오전 후반 (11:00 ~ 13:00, 2시간)

**2.2.1 퍼블릭 대시보드 접근 테스트**

```bash
# 1. Cloudflare Tunnel 공개 도메인 확인
# → Cloudflare Dashboard: Networks → Tunnels → sentinai
# → Public hostname: sentinai.yourdomain.com

# 2. HTTPS 접근 테스트
curl -I https://sentinai.yourdomain.com/
# 예상: HTTP 200, SSL 인증서 유효

# 3. 브라우저에서 접근
# → https://sentinai.yourdomain.com
# → 대시보드 표시 확인
# → 실시간 메트릭 업데이트 확인

# 4. 읽기 전용 모드 검증
# → "스케일링 실행" 버튼 비활성화 확인
# → 수동 스케일링 API 요청 시 403 응답 확인
curl -X POST https://sentinai.yourdomain.com/api/scaler \
  -d '{"targetVcpu": 2}'
# 예상: {"error":"Write operations disabled in public mode"}

# 5. 성능 테스트 (동시 접근 100명 시뮬레이션)
ab -n 100 -c 10 https://sentinai.yourdomain.com/api/metrics
# 예상: p95 < 500ms
```

**성공 기준**:
- ✅ HTTPS 접근 가능 (SSL 인증서 유효)
- ✅ 대시보드 정상 렌더링
- ✅ 읽기 작업만 허용 (쓰기 차단)
- ✅ 성능: p95 < 500ms

**담당**: QA

---

#### Phase 2.3: 오후 (13:00 ~ 15:00, 2시간)

**2.3.1 최종 통합 테스트**

```bash
# 1. Agent Loop 동작 확인
docker compose logs -f sentinai | grep -E '\[AgentLoop\]'
# 예상: 30초마다 cycle 실행 로그

# 2. 실제 부하 주입 (선택사항)
# → `docs/guide/production-load-testing-guide.md` 참조
# → 200개 트랜잭션 전송
# → 1 → 2 vCPU 자동 스케일링 확인

# 3. K8s StatefulSet 상태 확인
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}'
# 예상: "1" 또는 "2" (실제 리소스)

# 4. 모니터링 포인트 확인
curl -s https://sentinai.yourdomain.com/api/health | jq .
# 예상: {"status":"ok","timestamp":"..."}

# 5. 일일 보고서 자동 배포 확인
# → 내일(2026-02-15) 09:00에 자동으로 배포됨을 확인
# → 또는 수동 테스트: curl -X POST .../api/reports/daily/send
```

**성공 기준**:
- ✅ Agent Loop 정상 실행 (30초마다)
- ✅ K8s 스케일링 정상 작동
- ✅ 일일 보고서 자동 배포 (또는 수동 테스트 성공)
- ✅ 대시보드 실시간 메트릭 업데이트

**담당**: QA

---

#### Phase 2.4: 오후 후반 (15:00 ~ 17:00, 2시간)

**2.4.1 배포 준비**

```bash
# 1. 프로덕션 환경 변수 최종 확인
cat /opt/sentinai/.env.local | grep -E 'SCALING_SIMULATION_MODE|AGENT_LOOP_ENABLED|PUBLIC_DASHBOARD'
# 예상:
# SCALING_SIMULATION_MODE=false
# AGENT_LOOP_ENABLED=true
# PUBLIC_DASHBOARD_ENABLED=true

# 2. 백업 생성 (긴급 롤백용)
docker compose exec redis redis-cli --rdb /backup/redis-backup-2026-02-14.rdb
cp -r /opt/sentinai/data/reports /backup/reports-backup-2026-02-14

# 3. 초기 모니터링 설정
# → 매 시간마다 대시보드 상태 확인
# → Agent Loop 로그 모니터링
# → 이상 탐지 알림 (Slack) 확인

# 4. Operator 교육 자료 준비
# → 일일 보고서 Slack 채널 설명
# → 대시보드 접근 URL 공유
# → 긴급 연락처 (기술 지원)
```

**체크리스트**:
- ✅ 환경 변수 확인
- ✅ 백업 생성
- ✅ 모니터링 설정
- ✅ Operator 교육

**담당**: DevOps / Operations

---

**2.4.2 라이브 배포**

```bash
# 최종 Docker 재시작 (새 설정 적용)
cd /opt/sentinai
git pull origin main                    # 최신 코드 동기화
docker compose build sentinai            # 이미지 빌드
docker compose down                      # 종료
docker compose up -d                     # 시작 (새 이미지, 새 환경 변수)

# 배포 확인
docker compose ps
# 예상: sentinai, redis, cloudflared 모두 "Up" 상태

# 헬스 체크
curl -I https://sentinai.yourdomain.com/api/health
# 예상: HTTP 200
```

**배포 완료** ✅

---

## 🎯 최종 결과물

### Day 1 완성 항목
1. ✅ 프로덕션 환경 변수 설정 (`.env.local`)
2. ✅ 일일 레포트 배포 시스템 (`daily-report-mailer.ts`)
3. ✅ Slack/Email 배포 자동화
4. ✅ 읽기 전용 대시보드 모드 (`PUBLIC_DASHBOARD_WRITE_DISABLED=true`)
5. ✅ 퍼블릭 접근 제어 (Cloudflare Tunnel 또는 Nginx + Let's Encrypt)

### Day 2 완성 항목
1. ✅ 일일 레포트 배포 검증 (Slack 수신 확인)
2. ✅ 퍼블릭 대시보드 접근 테스트 (HTTPS + 읽기 전용)
3. ✅ 최종 통합 테스트 (Agent Loop + K8s + 보고서)
4. ✅ 라이브 배포 (EC2 또는 Cloudflare Tunnel)

---

## 📊 운영 요구사항

### 일일 레포트 (자동 배포)
- **생성 시간**: 매일 09:00 UTC (한국 시간 +18:00 = 다음날 06:00)
  - 또는 .env에서 `DAILY_REPORT_SCHEDULE` 조정 가능
- **배포 채널**: Slack 또는 Email
- **내용**:
  - 24시간 메트릭 요약 (CPU, Gas, TxPool, 블록)
  - 리소스 스케일링 이력
  - 이상 징후 분석
  - 권고사항 (AI 기반)
- **수신자**: Operator 이메일 또는 Slack 채널

### 퍼블릭 대시보드
- **접근 URL**: `https://sentinai.yourdomain.com`
- **접근 제어**: 누구나 읽기 가능 (인증 없음)
- **쓰기 차단**: 수동 스케일링 불가 (자동 Agent Loop만 작동)
- **SSL/HTTPS**: Let's Encrypt (자동 갱신)
- **비율 제한**: 초당 10 요청 (대시보드 보호)

---

## ⚠️ 주의사항

### Day 1
- ✅ `.env.local` 권한: `chmod 600` (비밀번호 보호)
- ✅ Redis 용량 확인: 최소 128MB (docker-compose.yml에 설정됨)
- ✅ AWS IAM 권한 재확인 (kubectl patch 필요)

### Day 2
- ✅ 일일 레포트 첫 배포: 내일 (2026-02-14) 09:00
  - 수동 테스트: `curl -X POST .../api/reports/daily/send`
- ✅ 대시보드 공개 전 최종 보안 검토 (읽기 전용 확인)
- ✅ 모니터링 알림 설정 (Slack 채널)

---

## 🔄 긴급 롤백

만약 문제 발생 시:

```bash
# 1. 즉시 자동 스케일링 중지
curl -X PATCH https://sentinai.yourdomain.com/api/scaler \
  -d '{"autoScalingEnabled": false, "simulationMode": true}'

# 2. 시뮬레이션 모드 재활성화
docker compose down
docker compose up -d  # 이전 이미지 사용 (다시 빌드 X)

# 3. 대시보드 임시 폐쇄 (필요시)
docker compose -f docker-compose.yml --profile tunnel down

# 4. Redis 백업에서 복원
docker exec sentinai-redis redis-cli SHUTDOWN
rm /data/redis/dump.rdb
cp /backup/redis-backup-2026-02-14.rdb /data/redis/dump.rdb
docker compose up -d redis
```

---

## 📝 완료 체크리스트

### Day 1
- [ ] 프로덕션 `.env.local` 설정
- [ ] AWS IAM & kubectl 권한 검증
- [ ] 일일 레포트 배포 시스템 구현 (`daily-report-mailer.ts`)
- [ ] Scheduler에 일일 보고서 job 추가
- [ ] 퍼블릭 대시보드 읽기 전용 모드 설정 (middleware)
- [ ] Cloudflare Tunnel 또는 Nginx 설정
- [ ] Docker Compose 재빌드 및 시작

### Day 2
- [ ] 일일 레포트 배포 수동 테스트 (Slack 수신 확인)
- [ ] 퍼블릭 대시보드 HTTPS 접근 테스트
- [ ] 읽기 전용 모드 검증 (쓰기 차단 확인)
- [ ] Agent Loop 정상 작동 (30초마다 실행)
- [ ] K8s 실제 스케일링 확인 (부하 주입 또는 모니터링)
- [ ] 성능 테스트 (p95 < 500ms)
- [ ] 모니터링 알림 설정 (Slack)
- [ ] 백업 생성
- [ ] 최종 라이브 배포

---

## 📞 기술 지원

**문제 발생 시**:
1. 서버 로그 확인: `docker compose logs -f sentinai`
2. 헬스 체크: `curl https://sentinai.yourdomain.com/api/health`
3. Redis 상태: `docker exec sentinai-redis redis-cli ping`
4. K8s 상태: `kubectl get statefulset -n thanos-sepolia`

---

## 🎉 배포 완료 후

**Day 2 저녁**:
- ✅ SentinAI 라이브 서비스 시작
- ✅ Operator는 매일 09:00에 Slack에서 일일 보고서 수신
- ✅ 누구나 `https://sentinai.yourdomain.com`에서 대시보드 조회 가능
- ✅ 자동 스케일링 30초마다 실행 중

