# SentinAI Telegram Bot Integration

## PRD (Product Requirements Document)

**Version:** 1.0  
**Date:** 2026-02-09  
**Status:** Ready for Implementation

---

## 1. 개요

### 1.1 목표
SentinAI 대시보드와 연동되는 Telegram 봇을 구축하여, 사용자가 언제 어디서나 L2 네트워크 상태를 조회하고 클러스터를 관리할 수 있도록 한다.

### 1.2 핵심 가치
- **즉각적인 접근성**: 대시보드 없이 모바일에서 바로 상태 확인
- **실시간 알림**: 이상 탐지 시 즉시 Telegram 알림
- **AI 대화**: 자연어로 시스템 상태 질의 및 분석
- **원격 관리**: 긴급 상황 시 모바일에서 스케일링/재시작

### 1.3 범위
- Phase 1: 상태 조회 명령어 (Read-only)
- Phase 2: 클러스터 관리 명령어 (Write)
- Phase 3: AI 대화 모드 (LLM Integration)
- Phase 4: 실시간 알림 시스템

---

## 2. 사용자 스토리

### US-1: 상태 확인
```
As a DevOps engineer
I want to check network status via Telegram
So that I can monitor the system while away from my desk
```

### US-2: 이상 탐지 알림
```
As a system administrator
I want to receive instant alerts when anomalies are detected
So that I can respond quickly to incidents
```

### US-3: 긴급 스케일링
```
As an on-call engineer
I want to scale resources via Telegram
So that I can handle traffic spikes without laptop access
```

### US-4: AI 분석 질의
```
As a DevOps engineer
I want to ask questions about system behavior in natural language
So that I can understand complex issues without reading raw logs
```

---

## 3. 기능 명세

### 3.1 Command 목록

| Command | 설명 | 권한 | Phase |
|---------|------|------|-------|
| `/start` | 봇 시작, 환영 메시지 | Public | 1 |
| `/help` | 명령어 목록 표시 | Public | 1 |
| `/status` | 전체 네트워크 상태 요약 | Auth | 1 |
| `/metrics` | 상세 메트릭 (CPU/MEM/TxPool/Gas) | Auth | 1 |
| `/health` | 클러스터 헬스 체크 | Auth | 1 |
| `/anomalies` | 최근 이상 탐지 로그 | Auth | 1 |
| `/cost` | 비용 분석 리포트 | Auth | 1 |
| `/scale <pod> <cpu> <mem>` | 수동 스케일링 | Admin | 2 |
| `/restart <pod>` | Pod 재시작 | Admin | 2 |
| `/logs <pod> [lines]` | 실시간 로그 조회 | Auth | 2 |
| `/alert on/off` | 알림 토글 | Auth | 2 |
| `/simulate <scenario>` | 스트레스 테스트 시뮬레이션 | Admin | 2 |

### 3.2 권한 레벨

- **Public**: 누구나 사용 가능
- **Auth**: 등록된 사용자만 (TELEGRAM_ALLOWED_USERS)
- **Admin**: 관리자만 (TELEGRAM_ADMIN_USERS)

### 3.3 응답 포맷

#### /status 응답 예시
```
🛡️ SentinAI Network Status

📊 Network
├ L2 Block: 125,847,392
├ L1 Sync: 19,847,291
└ Sync Status: 100% ✅

💻 Resources
├ CPU: 45% (4 vCPU)
├ Memory: 62% (8 GiB)
└ Disk I/O: Normal

⛽ Gas & TxPool
├ Pending TX: 128
├ Avg Gas: 0.023 gwei
└ Base Fee: 0.001 gwei

🔥 Health Score: 94/100

Last updated: 2026-02-09 15:57:29 KST
```

#### /anomalies 응답 예시
```
⚠️ Recent Anomalies (Last 24h)

1. 🟡 WARNING - 14:23
   Component: op-batcher
   Message: Queue depth increased to 847
   AI Analysis: Temporary L1 congestion

2. 🔴 CRITICAL - 12:45
   Component: op-geth
   Message: Memory usage exceeded 85%
   AI Analysis: Auto-scaling triggered
   Status: ✅ Resolved

Total: 2 anomalies (1 resolved)
```

### 3.4 Inline Keyboard (버튼 UI)

```
┌─────────────┬─────────────┐
│ 📊 Metrics  │ ⚠️ Anomalies│
├─────────────┼─────────────┤
│ ⬆️ Scale Up │ ⬇️ Scale Down│
├─────────────┼─────────────┤
│ 🔄 Restart  │ 💰 Cost     │
└─────────────┴─────────────┘
```

### 3.5 AI 대화 모드

일반 텍스트 메시지는 AI 대화 모드로 처리:

**입력:** "op-geth가 왜 느려졌어?"

**출력:**
```
🤖 AI Analysis

현재 op-geth 성능 저하 원인 분석:

1. TxPool 급증 (128 → 1,247 pending)
   - 원인: NFT 민팅 이벤트로 인한 트래픽 증가
   
2. 메모리 사용률 상승 (62% → 78%)
   - 원인: TxPool 처리 부하

💡 권장 조치:
- 자동 스케일링 대기 중 (4→6 vCPU)
- 예상 정상화 시간: 5-10분

수동 스케일링 원하시면 /scale op-geth 6 12 입력하세요.
```

---

## 4. 기술 아키텍처

### 4.1 시스템 구조

```
┌─────────────────────────────────────────────┐
│           Telegram Bot API                   │
│         (api.telegram.org)                   │
└──────────────────┬──────────────────────────┘
                   │ Webhook POST
                   ▼
┌─────────────────────────────────────────────┐
│     SentinAI Next.js Application            │
│  ┌─────────────────────────────────────┐    │
│  │  /api/telegram/webhook              │    │
│  │  - Update handler                    │    │
│  │  - Command router                    │    │
│  │  - Auth middleware                   │    │
│  └──────────────┬──────────────────────┘    │
│                 │                            │
│  ┌──────────────┴──────────────────────┐    │
│  │        TelegramBotService           │    │
│  │  - Command handlers                 │    │
│  │  - Response formatters              │    │
│  │  - Alert sender                     │    │
│  └──────────────┬──────────────────────┘    │
│                 │                            │
│  ┌─────────┬────┴────┬─────────┐           │
│  ▼         ▼         ▼         ▼           │
│ /api/    /api/     /api/    Claude         │
│ metrics  anomalies scaler    API           │
└─────────────────────────────────────────────┘
```

### 4.2 Webhook vs Polling

**선택: Webhook (Production)**
- 이유: 즉각적인 응답, 리소스 효율성
- 요구사항: HTTPS 엔드포인트 필요

**대안: Long Polling (Development)**
- 이유: 로컬 테스트 용이
- 구현: `node-telegram-bot-api` polling mode

### 4.3 보안 고려사항

1. **사용자 인증**
   - Telegram user ID 기반 화이트리스트
   - Admin 명령어는 별도 권한 체크

2. **Rate Limiting**
   - 사용자당 분당 30 요청 제한
   - 스케일링 명령은 분당 5회 제한

3. **입력 검증**
   - 모든 파라미터 sanitization
   - SQL Injection / Command Injection 방지

4. **토큰 보안**
   - BOT_TOKEN은 환경 변수로만 관리
   - 절대 로그에 노출 금지

---

## 5. 파일 구조

```
src/
├── app/
│   └── api/
│       └── telegram/
│           ├── webhook/
│           │   └── route.ts          # Webhook 엔드포인트
│           └── set-webhook/
│               └── route.ts          # Webhook 설정 API
├── lib/
│   └── telegram/
│       ├── bot.ts                    # TelegramBot 인스턴스
│       ├── commands/
│       │   ├── index.ts              # Command router
│       │   ├── start.ts              # /start handler
│       │   ├── help.ts               # /help handler
│       │   ├── status.ts             # /status handler
│       │   ├── metrics.ts            # /metrics handler
│       │   ├── health.ts             # /health handler
│       │   ├── anomalies.ts          # /anomalies handler
│       │   ├── cost.ts               # /cost handler
│       │   ├── scale.ts              # /scale handler
│       │   ├── restart.ts            # /restart handler
│       │   ├── logs.ts               # /logs handler
│       │   └── alert.ts              # /alert handler
│       ├── formatters/
│       │   ├── status.ts             # Status 응답 포맷터
│       │   ├── metrics.ts            # Metrics 응답 포맷터
│       │   └── anomalies.ts          # Anomalies 응답 포맷터
│       ├── middleware/
│       │   ├── auth.ts               # 사용자 인증
│       │   └── rate-limit.ts         # Rate limiting
│       ├── ai/
│       │   └── chat.ts               # AI 대화 처리
│       └── alerts/
│           └── sender.ts             # 알림 전송
├── types/
│   └── telegram.ts                   # Telegram 관련 타입
└── config/
    └── telegram.ts                   # Telegram 설정
```

---

## 6. 환경 변수

```env
# .env.local에 추가

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather
TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=random-secret-for-validation

# User Authorization (comma-separated Telegram user IDs)
TELEGRAM_ALLOWED_USERS=1266746900,123456789
TELEGRAM_ADMIN_USERS=1266746900

# Rate Limiting
TELEGRAM_RATE_LIMIT_PER_MINUTE=30
TELEGRAM_ADMIN_RATE_LIMIT_PER_MINUTE=5

# AI Chat (optional, uses existing ANTHROPIC_API_KEY)
TELEGRAM_AI_ENABLED=true
```

---

## 7. 구현 가이드

### Phase 1: 기본 구조 및 상태 조회 (Day 1-3)

#### Step 1.1: 의존성 설치

```bash
cd /home/theo/SentinAI
npm install node-telegram-bot-api
npm install -D @types/node-telegram-bot-api
```

#### Step 1.2: Telegram 타입 정의

```typescript
// src/types/telegram.ts

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

export interface CommandContext {
  chatId: number;
  userId: number;
  username?: string;
  args: string[];
  isAdmin: boolean;
}

export type CommandHandler = (ctx: CommandContext) => Promise<string | void>;
```

#### Step 1.3: Telegram 설정

```typescript
// src/config/telegram.ts

export const telegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  
  allowedUsers: (process.env.TELEGRAM_ALLOWED_USERS || '')
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id)),
    
  adminUsers: (process.env.TELEGRAM_ADMIN_USERS || '')
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id)),
    
  rateLimitPerMinute: parseInt(process.env.TELEGRAM_RATE_LIMIT_PER_MINUTE || '30'),
  adminRateLimitPerMinute: parseInt(process.env.TELEGRAM_ADMIN_RATE_LIMIT_PER_MINUTE || '5'),
  
  aiEnabled: process.env.TELEGRAM_AI_ENABLED === 'true',
};
```

#### Step 1.4: Bot 인스턴스

```typescript
// src/lib/telegram/bot.ts

import TelegramBot from 'node-telegram-bot-api';
import { telegramConfig } from '@/config/telegram';

// Singleton bot instance
let botInstance: TelegramBot | null = null;

export function getBot(): TelegramBot {
  if (!botInstance) {
    botInstance = new TelegramBot(telegramConfig.botToken, {
      // Webhook mode - don't poll
      polling: false,
    });
  }
  return botInstance;
}

export async function sendMessage(
  chatId: number,
  text: string,
  options?: TelegramBot.SendMessageOptions
): Promise<TelegramBot.Message> {
  const bot = getBot();
  return bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...options,
  });
}

export async function sendAlert(text: string): Promise<void> {
  const bot = getBot();
  for (const adminId of telegramConfig.adminUsers) {
    try {
      await bot.sendMessage(adminId, text, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error(`Failed to send alert to ${adminId}:`, error);
    }
  }
}
```

#### Step 1.5: 인증 미들웨어

```typescript
// src/lib/telegram/middleware/auth.ts

import { telegramConfig } from '@/config/telegram';
import { TelegramUpdate, CommandContext } from '@/types/telegram';

export function createContext(update: TelegramUpdate): CommandContext | null {
  const message = update.message || update.callback_query?.message;
  const from = update.message?.from || update.callback_query?.from;
  
  if (!message || !from) return null;
  
  const text = update.message?.text || '';
  const args = text.split(' ').slice(1);
  
  return {
    chatId: message.chat.id,
    userId: from.id,
    username: from.username,
    args,
    isAdmin: telegramConfig.adminUsers.includes(from.id),
  };
}

export function isAuthorized(userId: number): boolean {
  return telegramConfig.allowedUsers.includes(userId) ||
         telegramConfig.adminUsers.includes(userId);
}

export function isAdmin(userId: number): boolean {
  return telegramConfig.adminUsers.includes(userId);
}
```

#### Step 1.6: Command Handlers

```typescript
// src/lib/telegram/commands/start.ts

import { CommandContext } from '@/types/telegram';

export async function handleStart(ctx: CommandContext): Promise<string> {
  return `
🛡️ *SentinAI Bot*

Welcome! I'm your L2 network monitoring assistant.

*Available Commands:*
/status - Network status overview
/metrics - Detailed metrics
/health - Cluster health check
/anomalies - Recent anomaly logs
/cost - Cost analysis report
/help - Show all commands

Type any question to chat with AI about your network!
`;
}
```

```typescript
// src/lib/telegram/commands/status.ts

import { CommandContext } from '@/types/telegram';

export async function handleStatus(ctx: CommandContext): Promise<string> {
  try {
    // Fetch metrics from internal API
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/metrics`);
    
    if (!response.ok) {
      return '❌ Failed to fetch metrics. Please try again.';
    }
    
    const data = await response.json();
    
    const healthEmoji = data.healthScore >= 80 ? '✅' : 
                        data.healthScore >= 50 ? '⚠️' : '🔴';
    
    return `
🛡️ *SentinAI Network Status*

📊 *Network*
├ L2 Block: ${data.l2BlockHeight?.toLocaleString() || 'N/A'}
├ L1 Sync: ${data.l1BlockHeight?.toLocaleString() || 'N/A'}
└ Sync Status: ${data.syncProgress || 100}% ✅

💻 *Resources*
├ CPU: ${data.cpuUsage || 0}% (${data.vCPU || 0} vCPU)
├ Memory: ${data.memoryUsage || 0}% (${data.memoryGiB || 0} GiB)
└ Pods: ${data.podCount || 0} running

⛽ *Gas & TxPool*
├ Pending TX: ${data.txPoolPending || 0}
├ Avg Gas: ${data.avgGasPrice || 0} gwei
└ Base Fee: ${data.baseFee || 0} gwei

🔥 *Health Score:* ${data.healthScore || 0}/100 ${healthEmoji}

_Last updated: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}_
`;
  } catch (error) {
    console.error('Status command error:', error);
    return '❌ Error fetching status. Please try again later.';
  }
}
```

```typescript
// src/lib/telegram/commands/anomalies.ts

import { CommandContext } from '@/types/telegram';

export async function handleAnomalies(ctx: CommandContext): Promise<string> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/anomalies`);
    
    if (!response.ok) {
      return '❌ Failed to fetch anomalies.';
    }
    
    const data = await response.json();
    const anomalies = data.anomalies || [];
    
    if (anomalies.length === 0) {
      return '✅ *No anomalies detected in the last 24 hours!*\n\nYour network is running smoothly.';
    }
    
    const severityEmoji: Record<string, string> = {
      critical: '🔴',
      warning: '🟡',
      info: '🔵',
    };
    
    let message = '⚠️ *Recent Anomalies (Last 24h)*\n\n';
    
    anomalies.slice(0, 5).forEach((anomaly: any, index: number) => {
      const emoji = severityEmoji[anomaly.severity] || '⚪';
      const status = anomaly.resolved ? '✅ Resolved' : '🔄 Active';
      
      message += `*${index + 1}. ${emoji} ${anomaly.severity.toUpperCase()}* - ${anomaly.timestamp}\n`;
      message += `   Component: \`${anomaly.component}\`\n`;
      message += `   Message: ${anomaly.message}\n`;
      if (anomaly.aiAnalysis) {
        message += `   AI Analysis: ${anomaly.aiAnalysis}\n`;
      }
      message += `   Status: ${status}\n\n`;
    });
    
    message += `_Total: ${anomalies.length} anomalies_`;
    
    return message;
  } catch (error) {
    console.error('Anomalies command error:', error);
    return '❌ Error fetching anomalies.';
  }
}
```

```typescript
// src/lib/telegram/commands/index.ts

import { CommandContext, CommandHandler } from '@/types/telegram';
import { isAuthorized, isAdmin } from '../middleware/auth';
import { handleStart } from './start';
import { handleStatus } from './status';
import { handleAnomalies } from './anomalies';
// Import other handlers...

interface CommandDefinition {
  handler: CommandHandler;
  requiresAuth: boolean;
  requiresAdmin: boolean;
  description: string;
}

const commands: Record<string, CommandDefinition> = {
  '/start': {
    handler: handleStart,
    requiresAuth: false,
    requiresAdmin: false,
    description: 'Start the bot',
  },
  '/help': {
    handler: handleHelp,
    requiresAuth: false,
    requiresAdmin: false,
    description: 'Show help',
  },
  '/status': {
    handler: handleStatus,
    requiresAuth: true,
    requiresAdmin: false,
    description: 'Network status',
  },
  '/metrics': {
    handler: handleMetrics,
    requiresAuth: true,
    requiresAdmin: false,
    description: 'Detailed metrics',
  },
  '/health': {
    handler: handleHealth,
    requiresAuth: true,
    requiresAdmin: false,
    description: 'Health check',
  },
  '/anomalies': {
    handler: handleAnomalies,
    requiresAuth: true,
    requiresAdmin: false,
    description: 'Recent anomalies',
  },
  '/cost': {
    handler: handleCost,
    requiresAuth: true,
    requiresAdmin: false,
    description: 'Cost report',
  },
  '/scale': {
    handler: handleScale,
    requiresAuth: true,
    requiresAdmin: true,
    description: 'Scale resources',
  },
  '/restart': {
    handler: handleRestart,
    requiresAuth: true,
    requiresAdmin: true,
    description: 'Restart pod',
  },
  '/logs': {
    handler: handleLogs,
    requiresAuth: true,
    requiresAdmin: false,
    description: 'View logs',
  },
  '/alert': {
    handler: handleAlert,
    requiresAuth: true,
    requiresAdmin: false,
    description: 'Toggle alerts',
  },
};

export async function routeCommand(
  command: string,
  ctx: CommandContext
): Promise<string> {
  const cmd = commands[command];
  
  if (!cmd) {
    return '❓ Unknown command. Type /help for available commands.';
  }
  
  // Auth check
  if (cmd.requiresAuth && !isAuthorized(ctx.userId)) {
    return '🔒 You are not authorized to use this bot.';
  }
  
  // Admin check
  if (cmd.requiresAdmin && !isAdmin(ctx.userId)) {
    return '🔒 This command requires admin privileges.';
  }
  
  try {
    const result = await cmd.handler(ctx);
    return result || '✅ Command executed successfully.';
  } catch (error) {
    console.error(`Command ${command} failed:`, error);
    return '❌ Command failed. Please try again.';
  }
}

// Placeholder handlers (implement separately)
async function handleHelp(ctx: CommandContext): Promise<string> {
  let message = '🛡️ *SentinAI Bot Commands*\n\n';
  
  for (const [cmd, def] of Object.entries(commands)) {
    const adminBadge = def.requiresAdmin ? ' 🔐' : '';
    message += `${cmd}${adminBadge} - ${def.description}\n`;
  }
  
  message += '\n🔐 = Admin only\n';
  message += '\n_Or just type a question to chat with AI!_';
  
  return message;
}

async function handleMetrics(ctx: CommandContext): Promise<string> {
  // Similar to handleStatus but more detailed
  return 'Metrics implementation...';
}

async function handleHealth(ctx: CommandContext): Promise<string> {
  return 'Health implementation...';
}

async function handleCost(ctx: CommandContext): Promise<string> {
  return 'Cost implementation...';
}

async function handleScale(ctx: CommandContext): Promise<string> {
  const [pod, cpu, mem] = ctx.args;
  if (!pod || !cpu || !mem) {
    return '❌ Usage: /scale <pod> <cpu> <memory>\nExample: /scale op-geth 4 8';
  }
  // Call scaler API
  return `✅ Scaling ${pod} to ${cpu} vCPU, ${mem} GiB...`;
}

async function handleRestart(ctx: CommandContext): Promise<string> {
  const [pod] = ctx.args;
  if (!pod) {
    return '❌ Usage: /restart <pod>\nExample: /restart op-geth';
  }
  // Call restart API
  return `🔄 Restarting ${pod}...`;
}

async function handleLogs(ctx: CommandContext): Promise<string> {
  return 'Logs implementation...';
}

async function handleAlert(ctx: CommandContext): Promise<string> {
  const [action] = ctx.args;
  if (action !== 'on' && action !== 'off') {
    return '❌ Usage: /alert on|off';
  }
  return `🔔 Alerts turned ${action}.`;
}
```

#### Step 1.7: Webhook 엔드포인트

```typescript
// src/app/api/telegram/webhook/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { TelegramUpdate } from '@/types/telegram';
import { createContext, isAuthorized } from '@/lib/telegram/middleware/auth';
import { routeCommand } from '@/lib/telegram/commands';
import { sendMessage } from '@/lib/telegram/bot';
import { handleAIChat } from '@/lib/telegram/ai/chat';
import { telegramConfig } from '@/config/telegram';

export async function POST(req: NextRequest) {
  try {
    // Verify webhook secret (optional but recommended)
    const secretHeader = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (telegramConfig.webhookSecret && secretHeader !== telegramConfig.webhookSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const update: TelegramUpdate = await req.json();
    
    // Handle callback queries (button clicks)
    if (update.callback_query) {
      await handleCallbackQuery(update);
      return NextResponse.json({ ok: true });
    }
    
    // Handle messages
    if (update.message?.text) {
      await handleMessage(update);
    }
    
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

async function handleMessage(update: TelegramUpdate) {
  const ctx = createContext(update);
  if (!ctx) return;
  
  const text = update.message!.text!;
  
  // Check if it's a command
  if (text.startsWith('/')) {
    const command = text.split(' ')[0].toLowerCase();
    const response = await routeCommand(command, ctx);
    await sendMessage(ctx.chatId, response);
    return;
  }
  
  // Otherwise, treat as AI chat
  if (telegramConfig.aiEnabled && isAuthorized(ctx.userId)) {
    const response = await handleAIChat(ctx, text);
    await sendMessage(ctx.chatId, response);
  }
}

async function handleCallbackQuery(update: TelegramUpdate) {
  const callback = update.callback_query!;
  const ctx = createContext(update);
  if (!ctx) return;
  
  const action = callback.data;
  
  // Route callback actions
  switch (action) {
    case 'metrics':
      const response = await routeCommand('/metrics', ctx);
      await sendMessage(ctx.chatId, response);
      break;
    case 'anomalies':
      await routeCommand('/anomalies', ctx);
      break;
    // ... other actions
  }
}
```

#### Step 1.8: AI 대화 모드

```typescript
// src/lib/telegram/ai/chat.ts

import { CommandContext } from '@/types/telegram';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function handleAIChat(
  ctx: CommandContext,
  userMessage: string
): Promise<string> {
  try {
    // Get current system state for context
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    
    const [metricsRes, anomaliesRes] = await Promise.all([
      fetch(`${baseUrl}/api/metrics`).then(r => r.json()).catch(() => null),
      fetch(`${baseUrl}/api/anomalies`).then(r => r.json()).catch(() => null),
    ]);
    
    const systemContext = `
Current SentinAI System State:
- Metrics: ${JSON.stringify(metricsRes, null, 2)}
- Recent Anomalies: ${JSON.stringify(anomaliesRes?.anomalies?.slice(0, 3), null, 2)}

You are SentinAI, an AI assistant for monitoring L2 blockchain infrastructure.
Answer questions about the system status concisely and helpfully.
If asked to perform actions, suggest the appropriate command (e.g., /scale, /restart).
`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemContext,
      messages: [
        { role: 'user', content: userMessage }
      ],
    });
    
    const text = response.content[0].type === 'text' 
      ? response.content[0].text 
      : 'Unable to process response.';
    
    return `🤖 *AI Analysis*\n\n${text}`;
  } catch (error) {
    console.error('AI chat error:', error);
    return '❌ AI is temporarily unavailable. Try a command like /status instead.';
  }
}
```

#### Step 1.9: Webhook 설정 API

```typescript
// src/app/api/telegram/set-webhook/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getBot } from '@/lib/telegram/bot';
import { telegramConfig } from '@/config/telegram';

export async function POST(req: NextRequest) {
  try {
    const bot = getBot();
    const webhookUrl = telegramConfig.webhookUrl;
    
    if (!webhookUrl) {
      return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_URL not configured' }, { status: 400 });
    }
    
    await bot.setWebHook(webhookUrl, {
      secret_token: telegramConfig.webhookSecret,
    });
    
    return NextResponse.json({ 
      success: true, 
      message: `Webhook set to ${webhookUrl}` 
    });
  } catch (error) {
    console.error('Set webhook error:', error);
    return NextResponse.json({ error: 'Failed to set webhook' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const bot = getBot();
    await bot.deleteWebHook();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Webhook deleted' 
    });
  } catch (error) {
    console.error('Delete webhook error:', error);
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const bot = getBot();
    const info = await bot.getWebHookInfo();
    
    return NextResponse.json(info);
  } catch (error) {
    console.error('Get webhook info error:', error);
    return NextResponse.json({ error: 'Failed to get webhook info' }, { status: 500 });
  }
}
```

### Phase 2: 관리 명령어 구현 (Day 4-5)

#### Step 2.1: Scale 명령어 상세 구현

```typescript
// src/lib/telegram/commands/scale.ts

import { CommandContext } from '@/types/telegram';

const VALID_PODS = ['op-geth', 'op-node', 'op-batcher', 'op-proposer'];
const MAX_CPU = 16;
const MAX_MEMORY = 32;

export async function handleScale(ctx: CommandContext): Promise<string> {
  const [pod, cpuStr, memStr] = ctx.args;
  
  // Validation
  if (!pod || !cpuStr || !memStr) {
    return `❌ *Usage:* \`/scale <pod> <cpu> <memory>\`

*Example:* \`/scale op-geth 4 8\`

*Available pods:*
${VALID_PODS.map(p => `• \`${p}\``).join('\n')}`;
  }
  
  if (!VALID_PODS.includes(pod)) {
    return `❌ Invalid pod name: \`${pod}\`\n\nValid pods: ${VALID_PODS.join(', ')}`;
  }
  
  const cpu = parseInt(cpuStr);
  const memory = parseInt(memStr);
  
  if (isNaN(cpu) || cpu < 1 || cpu > MAX_CPU) {
    return `❌ CPU must be between 1 and ${MAX_CPU}`;
  }
  
  if (isNaN(memory) || memory < 1 || memory > MAX_MEMORY) {
    return `❌ Memory must be between 1 and ${MAX_MEMORY} GiB`;
  }
  
  // Confirmation with inline keyboard
  return {
    text: `⚠️ *Confirm Scaling*

Pod: \`${pod}\`
CPU: ${cpu} vCPU
Memory: ${memory} GiB

Are you sure?`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Confirm', callback_data: `confirm_scale:${pod}:${cpu}:${memory}` },
          { text: '❌ Cancel', callback_data: 'cancel' },
        ],
      ],
    },
  };
}
```

### Phase 3: 실시간 알림 시스템 (Day 6-7)

#### Step 3.1: Alert Sender Integration

```typescript
// src/lib/telegram/alerts/sender.ts

import { sendMessage, getBot } from '../bot';
import { telegramConfig } from '@/config/telegram';

export interface AlertPayload {
  severity: 'info' | 'warning' | 'critical';
  component: string;
  message: string;
  aiAnalysis?: string;
  recommendation?: string;
}

const severityConfig = {
  info: { emoji: '🔵', priority: 1 },
  warning: { emoji: '🟡', priority: 2 },
  critical: { emoji: '🔴', priority: 3 },
};

export async function sendAlert(alert: AlertPayload): Promise<void> {
  const { emoji } = severityConfig[alert.severity];
  
  const text = `
${emoji} *${alert.severity.toUpperCase()} ALERT*

*Component:* \`${alert.component}\`
*Message:* ${alert.message}
${alert.aiAnalysis ? `\n*AI Analysis:* ${alert.aiAnalysis}` : ''}
${alert.recommendation ? `\n*Recommendation:* ${alert.recommendation}` : ''}

_${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}_
`;

  // Send to all admin users
  for (const adminId of telegramConfig.adminUsers) {
    try {
      await sendMessage(adminId, text);
    } catch (error) {
      console.error(`Failed to send alert to ${adminId}:`, error);
    }
  }
}

// Integration with anomaly detection
export async function onAnomalyDetected(anomaly: any): Promise<void> {
  await sendAlert({
    severity: anomaly.severity,
    component: anomaly.component,
    message: anomaly.message,
    aiAnalysis: anomaly.aiAnalysis,
    recommendation: anomaly.recommendation,
  });
}
```

#### Step 3.2: Metrics API에 Alert Trigger 추가

```typescript
// src/app/api/metrics/route.ts (수정)

import { onAnomalyDetected } from '@/lib/telegram/alerts/sender';

// 기존 anomaly detection 로직에 추가
if (anomalies.length > 0) {
  for (const anomaly of anomalies) {
    await onAnomalyDetected(anomaly);
  }
}
```

---

## 8. 테스트 계획

### 8.1 단위 테스트

```typescript
// __tests__/telegram/commands.test.ts

import { handleStatus } from '@/lib/telegram/commands/status';
import { handleAnomalies } from '@/lib/telegram/commands/anomalies';

describe('Telegram Commands', () => {
  const mockCtx = {
    chatId: 123456,
    userId: 1266746900,
    username: 'theobros',
    args: [],
    isAdmin: true,
  };

  describe('/status', () => {
    it('should return formatted status message', async () => {
      const result = await handleStatus(mockCtx);
      expect(result).toContain('SentinAI Network Status');
      expect(result).toContain('Health Score');
    });
  });

  describe('/anomalies', () => {
    it('should return anomaly list or no anomalies message', async () => {
      const result = await handleAnomalies(mockCtx);
      expect(result).toMatch(/anomalies|running smoothly/i);
    });
  });
});
```

### 8.2 통합 테스트

```typescript
// __tests__/telegram/webhook.test.ts

import { POST } from '@/app/api/telegram/webhook/route';
import { NextRequest } from 'next/server';

describe('Telegram Webhook', () => {
  it('should handle /status command', async () => {
    const update = {
      update_id: 123,
      message: {
        message_id: 1,
        from: { id: 1266746900, is_bot: false, first_name: 'Theo' },
        chat: { id: 1266746900, type: 'private' },
        date: Date.now(),
        text: '/status',
      },
    };

    const req = new NextRequest('http://localhost/api/telegram/webhook', {
      method: 'POST',
      body: JSON.stringify(update),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
```

### 8.3 수동 테스트 체크리스트

- [ ] BotFather에서 봇 생성 완료
- [ ] Webhook URL 설정 완료
- [ ] `/start` - 환영 메시지 표시
- [ ] `/help` - 명령어 목록 표시
- [ ] `/status` - 네트워크 상태 표시
- [ ] `/metrics` - 상세 메트릭 표시
- [ ] `/anomalies` - 이상 탐지 로그 표시
- [ ] `/scale op-geth 4 8` - 스케일링 실행 (Admin)
- [ ] 미인증 사용자 접근 차단 확인
- [ ] AI 대화 모드 동작 확인
- [ ] 이상 탐지 시 자동 알림 수신

---

## 9. 성공 지표

| 지표 | 목표 | 측정 방법 |
|------|------|----------|
| 응답 시간 | < 2초 | API 로그 |
| 명령어 성공률 | > 99% | Error rate |
| 알림 전달률 | 100% | Delivery confirmation |
| 사용자 만족도 | > 4/5 | 사용자 피드백 |

---

## 10. 배포 체크리스트

- [ ] 환경 변수 설정 (`.env.local`)
- [ ] `npm install node-telegram-bot-api`
- [ ] BotFather에서 봇 생성
- [ ] Webhook URL 설정 (`/api/telegram/set-webhook` POST)
- [ ] Admin 사용자 ID 등록
- [ ] Cloud Run 재배포
- [ ] 테스트 메시지 전송

---

## Appendix: BotFather 설정 가이드

1. Telegram에서 `@BotFather` 검색
2. `/newbot` 명령어 입력
3. 봇 이름 입력: `SentinAI Bot`
4. 봇 사용자명 입력: `sentinai_bot` (또는 원하는 이름)
5. API Token 복사 → `TELEGRAM_BOT_TOKEN`에 저장
6. `/setdescription` - 봇 설명 설정
7. `/setcommands` - 명령어 목록 설정:
   ```
   start - Start the bot
   help - Show commands
   status - Network status
   metrics - Detailed metrics
   health - Health check
   anomalies - Recent anomalies
   cost - Cost report
   scale - Scale resources (Admin)
   restart - Restart pod (Admin)
   logs - View logs
   alert - Toggle alerts
   ```
