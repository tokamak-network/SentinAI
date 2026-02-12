# LLM Stress Test Framework
## Implementation Plan & Architecture

---

## 📋 Overview

Comprehensive testing framework to benchmark multiple LLM providers (Claude, OpenAI, Gemini) across:
- **Performance:** Latency, throughput, error rates
- **Cost:** Tokens/request, cost per task
- **Accuracy:** Task-specific quality metrics
- **Reliability:** Rate limiting, retry handling

**Duration:** 3 weeks (Phase 1-3)

---

## 🏗️ Architecture

```
src/lib/__tests__/llm-stress-test/
├── index.ts                    # Main test orchestrator
├── config.ts                   # Test configuration & scenarios
├── models/                     # Model clients
│   ├── claude-client.ts
│   ├── openai-client.ts
│   └── gemini-client.ts
├── scenarios/                  # Test scenarios
│   ├── fast-tier.ts           # Log analysis, intent classification
│   ├── best-tier.ts           # RCA, cost optimization
│   └── mixed-workload.ts      # 80% fast + 20% best simulation
├── metrics/                    # Metrics collection
│   ├── latency-collector.ts
│   ├── cost-calculator.ts
│   ├── accuracy-scorer.ts
│   └── metrics-aggregator.ts
├── utils/                      # Utilities
│   ├── test-data-generator.ts
│   ├── concurrent-executor.ts
│   └── result-formatter.ts
└── __tests__/
    ├── unit/                   # Unit tests for components
    └── integration/            # Integration tests
```

---

## 📐 Component Specifications

### 1. **Model Clients** (`models/`)

#### 1.1 Base Interface
```typescript
// models/types.ts
export interface LLMClient {
  name: string;
  provider: 'anthropic' | 'openai' | 'gemini';
  
  // Main inference method
  invoke(prompt: string, options?: InvokeOptions): Promise<InvokeResult>;
  
  // Metrics tracking
  getMetrics(): ClientMetrics;
  reset(): void;
}

export interface InvokeResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: number;
  model: string;
}

export interface ClientMetrics {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  errors: number;
  avgLatencyMs: number;
}
```

#### 1.2 Claude Client Implementation
```typescript
// models/claude-client.ts
import Anthropic from '@anthropic-ai/sdk';

export class ClaudeClient implements LLMClient {
  name = 'claude-haiku-4.5' | 'claude-sonnet-4.5';
  provider = 'anthropic';
  
  private client: Anthropic;
  private metrics: ClientMetrics;
  
  constructor(model: 'haiku' | 'sonnet') {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.model = model === 'haiku' 
      ? 'claude-haiku-4-5-20251001'
      : 'claude-sonnet-4-5-20250929';
  }
  
  async invoke(prompt: string, options?: InvokeOptions): Promise<InvokeResult> {
    const startTime = Date.now();
    
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: options?.maxTokens ?? 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      
      const latencyMs = Date.now() - startTime;
      const tokensIn = response.usage.input_tokens;
      const tokensOut = response.usage.output_tokens;
      
      // Pricing: haiku $0.80/$0.15, sonnet $3.00/$15.00 per 1M tokens
      const costUsd = this.calculateCost(tokensIn, tokensOut);
      
      this.updateMetrics(tokensIn, tokensOut, costUsd);
      
      return {
        text: response.content[0].type === 'text' 
          ? response.content[0].text 
          : '',
        tokensIn,
        tokensOut,
        latencyMs,
        costUsd,
        model: this.model,
      };
    } catch (error) {
      this.metrics.errors++;
      throw error;
    }
  }
  
  private calculateCost(tokensIn: number, tokensOut: number): number {
    const inPrice = this.model.includes('haiku') ? 0.80 : 3.00;
    const outPrice = this.model.includes('haiku') ? 0.15 : 15.00;
    return (tokensIn * inPrice + tokensOut * outPrice) / 1_000_000;
  }
  
  private updateMetrics(tokensIn: number, tokensOut: number, costUsd: number) {
    this.metrics.totalRequests++;
    this.metrics.totalTokensIn += tokensIn;
    this.metrics.totalTokensOut += tokensOut;
    this.metrics.totalCostUsd += costUsd;
  }
  
  getMetrics(): ClientMetrics {
    return { ...this.metrics };
  }
  
  reset(): void {
    this.metrics = {
      totalRequests: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCostUsd: 0,
      errors: 0,
      avgLatencyMs: 0,
    };
  }
}
```

#### 1.3 OpenAI Client (Similar pattern)
```typescript
// models/openai-client.ts
export class OpenAIClient implements LLMClient {
  // Implementation similar to Claude
  // Models: gpt-4.1-mini (fast), gpt-4.1 (best)
  // Pricing: $0.15/$0.60 (mini), $30/$60 (4.1)
}
```

#### 1.4 Gemini Client (Similar pattern)
```typescript
// models/gemini-client.ts
export class GeminiClient implements LLMClient {
  // Implementation for Gemini models
  // Models: gemini-2.5-flash-lite, gemini-2.5-pro
  // Pricing: $0.075/$0.30 (flash), $1.50/$6.00 (pro)
}
```

---

### 2. **Test Scenarios** (`scenarios/`)

#### 2.1 Fast-Tier Scenario
```typescript
// scenarios/fast-tier.ts
import { TestScenario, ScenarioConfig } from './types';

export class FastTierScenario implements TestScenario {
  name = 'Fast-Tier: Log Analysis + Anomaly Detection';
  
  config: ScenarioConfig = {
    testLoad: [
      { name: 'sequential', requests: 100, parallelism: 1 },
      { name: 'throughput', requests: 100, parallelism: 10 },
      { name: 'endurance', requests: 1000, parallelism: 3 },
    ],
    inputTokenRange: [500, 2000],
    expectedOutputTokens: 200, // Estimated
  };
  
  // Test data: Real SentinAI logs
  generateTestData(count: number): TestData[] {
    return Array(count).fill(0).map(() => ({
      category: 'log_analysis',
      input: this.generateLogChunk(),
      expectedOutput: { severity: 'medium' | 'high' | 'low' },
    }));
  }
  
  private generateLogChunk(): string {
    // Sample: Docker logs, RPC errors, memory usage
    return `[2026-02-12T08:45:30] ERROR: RPC timeout after 5s
[2026-02-12T08:45:31] WARN: CPU spike to 85% (was 20%)
[2026-02-12T08:45:32] INFO: TxPool jumped from 50 to 2000 pending
[2026-02-12T08:45:33] ERROR: K8s pod restart (3 restarts in 10m)`;
  }
  
  async run(clients: LLMClient[]): Promise<ScenarioResult> {
    const results: ScenarioResult[] = [];
    
    for (const config of this.config.testLoad) {
      for (const client of clients) {
        const result = await this.executeLoad(client, config);
        results.push(result);
      }
    }
    
    return this.aggregateResults(results);
  }
  
  private async executeLoad(
    client: LLMClient, 
    config: LoadConfig
  ): Promise<ScenarioResult> {
    const testData = this.generateTestData(config.requests);
    const metrics = [];
    
    for (let i = 0; i < config.requests; i += config.parallelism) {
      const batch = testData.slice(i, i + config.parallelism);
      const batchMetrics = await Promise.all(
        batch.map(data => this.invokeClient(client, data))
      );
      metrics.push(...batchMetrics);
    }
    
    return this.calculateResults(client, metrics, config);
  }
  
  private async invokeClient(client: LLMClient, data: TestData) {
    const prompt = `Analyze this log and classify severity as low/medium/high:
${data.input}

Respond with JSON: {"severity": "low|medium|high", "reasoning": "..."}`;
    
    return client.invoke(prompt);
  }
  
  private calculateResults(
    client: LLMClient, 
    metrics: InvokeResult[], 
    config: LoadConfig
  ): ScenarioResult {
    const latencies = metrics.map(m => m.latencyMs);
    
    return {
      clientName: client.name,
      scenario: this.name,
      testLoad: config.name,
      totalRequests: config.requests,
      avgLatencyMs: latencies.reduce((a, b) => a + b) / latencies.length,
      p50LatencyMs: this.percentile(latencies, 0.5),
      p95LatencyMs: this.percentile(latencies, 0.95),
      p99LatencyMs: this.percentile(latencies, 0.99),
      avgCostPerRequest: metrics.reduce((s, m) => s + m.costUsd, 0) / metrics.length,
      totalCostUsd: metrics.reduce((s, m) => s + m.costUsd, 0),
      errors: metrics.filter(m => !m.text).length,
      accuracy: this.calculateAccuracy(metrics),
    };
  }
  
  private percentile(arr: number[], p: number): number {
    const sorted = arr.sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[idx];
  }
  
  private calculateAccuracy(metrics: InvokeResult[]): number {
    // Parse JSON response and check if severity is valid
    const valid = metrics.filter(m => {
      try {
        const parsed = JSON.parse(m.text);
        return ['low', 'medium', 'high'].includes(parsed.severity);
      } catch {
        return false;
      }
    }).length;
    
    return (valid / metrics.length) * 100;
  }
}
```

#### 2.2 Best-Tier Scenario
```typescript
// scenarios/best-tier.ts
export class BestTierScenario implements TestScenario {
  name = 'Best-Tier: Root Cause Analysis + Cost Optimization';
  
  config: ScenarioConfig = {
    testLoad: [
      { name: 'quality', requests: 50, parallelism: 1 },
      { name: 'stability', requests: 50, parallelism: 5 },
    ],
    inputTokenRange: [3000, 5000],
    expectedOutputTokens: 500,
  };
  
  generateTestData(count: number): TestData[] {
    return Array(count).fill(0).map(() => ({
      category: 'rca',
      input: this.generateRCAPrompt(),
      expectedOutput: { cause: 'string', severity: 'string' },
    }));
  }
  
  private generateRCAPrompt(): string {
    return `Given this failure timeline:
- T+0s: CPU normal (30%)
- T+5s: CPU spike to 95%
- T+10s: Block processing delay 5→20s
- T+15s: TxPool 100→2000 pending
- T+20s: Node sync lag detected
- T+30s: K8s pod restart

Provide JSON RCA: {
  "root_cause": "...",
  "contributing_factors": [...],
  "recommendation": "...",
  "confidence": 0.0-1.0
}`;
  }
  
  // Similar implementation to FastTierScenario
  // But focus on quality metrics instead of speed
}
```

#### 2.3 Mixed Workload Scenario
```typescript
// scenarios/mixed-workload.ts
export class MixedWorkloadScenario implements TestScenario {
  name = 'Real Production Pattern: 80% fast + 20% best tier';
  
  async run(clients: LLMClient[]): Promise<ScenarioResult> {
    // Simulate 1 hour of production traffic
    // 240 fast-tier calls (log analysis)
    // 60 best-tier calls (RCA)
    // Concurrent: up to 10 requests at once
    
    const fastScenario = new FastTierScenario();
    const bestScenario = new BestTierScenario();
    
    const fastResult = await fastScenario.run(clients);
    const bestResult = await bestScenario.run(clients);
    
    return this.aggregateResults(fastResult, bestResult);
  }
}
```

---

### 3. **Metrics Collection** (`metrics/`)

#### 3.1 Latency Collector
```typescript
// metrics/latency-collector.ts
export class LatencyCollector {
  private measurements: LatencyMeasurement[] = [];
  
  record(latencyMs: number): void {
    this.measurements.push({
      value: latencyMs,
      timestamp: Date.now(),
    });
  }
  
  getPercentile(p: number): number {
    const sorted = this.measurements
      .map(m => m.value)
      .sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[idx];
  }
  
  getStats(): LatencyStats {
    const values = this.measurements.map(m => m.value);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b) / values.length,
      p50: this.getPercentile(0.5),
      p95: this.getPercentile(0.95),
      p99: this.getPercentile(0.99),
      count: values.length,
    };
  }
}
```

#### 3.2 Cost Calculator
```typescript
// metrics/cost-calculator.ts
export class CostCalculator {
  private costs: CostEntry[] = [];
  
  recordCost(tokensIn: number, tokensOut: number, model: string): number {
    const pricing = this.getPricing(model);
    const cost = (tokensIn * pricing.input + tokensOut * pricing.output) 
      / 1_000_000;
    
    this.costs.push({
      model,
      tokensIn,
      tokensOut,
      cost,
      timestamp: Date.now(),
    });
    
    return cost;
  }
  
  private getPricing(model: string): Pricing {
    const pricingMap: Record<string, Pricing> = {
      'claude-haiku-4-5-20251001': { input: 0.80, output: 0.15 },
      'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
      'gpt-4.1-mini': { input: 0.15, output: 0.60 },
      'gpt-4.1': { input: 30.00, output: 60.00 },
      'gemini-2.5-flash-lite': { input: 0.075, output: 0.30 },
      'gemini-2.5-pro': { input: 1.50, output: 6.00 },
    };
    
    return pricingMap[model] || { input: 0, output: 0 };
  }
  
  getStats(): CostStats {
    return {
      totalCost: this.costs.reduce((s, c) => s + c.cost, 0),
      avgCostPerRequest: this.costs.reduce((s, c) => s + c.cost, 0) 
        / this.costs.length,
      costByModel: this.groupByModel(),
    };
  }
  
  private groupByModel(): Record<string, number> {
    return this.costs.reduce((acc, entry) => {
      acc[entry.model] = (acc[entry.model] || 0) + entry.cost;
      return acc;
    }, {} as Record<string, number>);
  }
}
```

#### 3.3 Accuracy Scorer
```typescript
// metrics/accuracy-scorer.ts
export class AccuracyScorer {
  private scores: AccuracyScore[] = [];
  
  recordScore(
    scenario: string,
    expected: unknown,
    actual: unknown,
    score: number
  ): void {
    this.scores.push({
      scenario,
      expected,
      actual,
      score,
      timestamp: Date.now(),
    });
  }
  
  getStats(): AccuracyStats {
    const byScenario = this.groupByScenario();
    
    return {
      overallAccuracy: this.scores.reduce((s, x) => s + x.score, 0) 
        / this.scores.length,
      byScenario: Object.entries(byScenario).reduce((acc, [scenario, scores]) => {
        acc[scenario] = scores.reduce((s, x) => s + x.score, 0) / scores.length;
        return acc;
      }, {} as Record<string, number>),
    };
  }
  
  private groupByScenario(): Record<string, AccuracyScore[]> {
    return this.scores.reduce((acc, score) => {
      if (!acc[score.scenario]) acc[score.scenario] = [];
      acc[score.scenario].push(score);
      return acc;
    }, {} as Record<string, AccuracyScore[]>);
  }
}
```

#### 3.4 Metrics Aggregator
```typescript
// metrics/metrics-aggregator.ts
export class MetricsAggregator {
  latency = new LatencyCollector();
  cost = new CostCalculator();
  accuracy = new AccuracyScorer();
  
  aggregate(): AggregatedMetrics {
    return {
      latency: this.latency.getStats(),
      cost: this.cost.getStats(),
      accuracy: this.accuracy.getStats(),
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

### 4. **Utilities** (`utils/`)

#### 4.1 Test Data Generator
```typescript
// utils/test-data-generator.ts
export class TestDataGenerator {
  generateLogChunk(): string {
    const logTemplates = [
      '[{time}] ERROR: RPC timeout after 5s',
      '[{time}] WARN: CPU spike to {cpu}%',
      '[{time}] INFO: TxPool {from} → {to} pending',
      '[{time}] ERROR: K8s pod restart',
    ];
    
    return logTemplates
      .map(t => t
        .replace('{time}', new Date().toISOString())
        .replace('{cpu}', Math.floor(Math.random() * 100).toString())
        .replace('{from}', Math.floor(Math.random() * 500).toString())
        .replace('{to}', Math.floor(Math.random() * 5000).toString())
      )
      .join('\n');
  }
  
  generateMetricsChunk(): string {
    return JSON.stringify({
      timestamp: Date.now(),
      metrics: {
        cpu: Math.random() * 100,
        memory: Math.random() * 100,
        txPool: Math.floor(Math.random() * 5000),
      },
    }, null, 2);
  }
}
```

#### 4.2 Concurrent Executor
```typescript
// utils/concurrent-executor.ts
export class ConcurrentExecutor {
  async execute<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number
  ): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(t => t()));
      results.push(...batchResults);
    }
    
    return results;
  }
}
```

#### 4.3 Result Formatter
```typescript
// utils/result-formatter.ts
export class ResultFormatter {
  formatTable(results: ScenarioResult[]): string {
    // Generate markdown table comparing all models
    const header = '| Model | Latency (ms) | Cost | Accuracy | Notes |';
    const rows = results.map(r => 
      `| ${r.clientName} | ${r.avgLatencyMs} | $${r.avgCostPerRequest} | ${r.accuracy}% | ... |`
    );
    
    return [header, '|---|---|---|---|---|', ...rows].join('\n');
  }
  
  formatJSON(metrics: AggregatedMetrics): string {
    return JSON.stringify(metrics, null, 2);
  }
  
  formatReport(results: ScenarioResult[]): string {
    // Generate comprehensive markdown report
    let report = '# LLM Stress Test Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;
    report += this.formatTable(results);
    return report;
  }
}
```

---

## 🎯 Main Test Orchestrator

```typescript
// index.ts
export class LLMStressTestOrchestrator {
  private clients: Map<string, LLMClient>;
  private scenarios: TestScenario[];
  private aggregator = new MetricsAggregator();
  
  constructor() {
    this.clients = new Map([
      ['claude-haiku', new ClaudeClient('haiku')],
      ['claude-sonnet', new ClaudeClient('sonnet')],
      ['gpt-4.1-mini', new OpenAIClient('mini')],
      ['gpt-4.1', new OpenAIClient('4.1')],
      ['gemini-flash', new GeminiClient('flash')],
      ['gemini-pro', new GeminiClient('pro')],
    ]);
    
    this.scenarios = [
      new FastTierScenario(),
      new BestTierScenario(),
      new MixedWorkloadScenario(),
    ];
  }
  
  async runAll(): Promise<void> {
    console.log('Starting LLM stress tests...\n');
    
    const allResults: ScenarioResult[] = [];
    
    for (const scenario of this.scenarios) {
      console.log(`Running: ${scenario.name}`);
      const results = await scenario.run(Array.from(this.clients.values()));
      allResults.push(...results);
    }
    
    this.generateReport(allResults);
  }
  
  private generateReport(results: ScenarioResult[]): void {
    const formatter = new ResultFormatter();
    const report = formatter.formatReport(results);
    
    // Save to file
    fs.writeFileSync(
      'test-results/llm-stress-test-report.md',
      report
    );
    
    // Save JSON
    fs.writeFileSync(
      'test-results/llm-stress-test-results.json',
      formatter.formatJSON(this.aggregator.aggregate())
    );
    
    console.log('\nReport saved to test-results/');
  }
}
```

---

## 📅 Implementation Timeline

### Week 1: Foundation
- [ ] Day 1-2: Set up project structure & base types
- [ ] Day 3-4: Implement Claude client
- [ ] Day 5: Implement OpenAI + Gemini clients

### Week 2: Test Scenarios
- [ ] Day 1-2: Implement fast-tier scenario
- [ ] Day 3-4: Implement best-tier scenario
- [ ] Day 5: Implement mixed workload scenario

### Week 3: Metrics & Reporting
- [ ] Day 1-2: Implement metrics collectors
- [ ] Day 3-4: Build result formatting & reporting
- [ ] Day 5: End-to-end testing & documentation

---

## 🚀 Running Tests

```bash
# Run all tests
npm run test:llm-stress

# Run specific scenario
npm run test:llm-stress -- --scenario=fast-tier

# Run specific models
npm run test:llm-stress -- --models=claude-haiku,gpt-4.1-mini

# Generate report
npm run test:llm-stress -- --format=report
```

---

## 📊 Expected Output

```
✅ Fast-Tier Scenario
├─ claude-haiku: 450ms avg, $0.0012/req, 94% accuracy
├─ gpt-4.1-mini: 200ms avg, $0.0005/req, 91% accuracy
└─ gemini-flash: 350ms avg, $0.0001/req, 88% accuracy

✅ Best-Tier Scenario
├─ claude-sonnet: 1200ms avg, $0.036/req, 9.2/10 quality
├─ gpt-4.1: 1800ms avg, $0.090/req, 8.8/10 quality
└─ gemini-pro: 950ms avg, $0.045/req, 8.5/10 quality

✅ Mixed Workload
├─ Total Cost: $84.50 (80% fast + 20% best)
├─ Avg Latency P95: 850ms
└─ Overall Accuracy: 91%

📊 Report saved to: test-results/llm-stress-test-report.md
```

---

## 🔗 Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "openai": "^4.52.0",
    "@google/generative-ai": "^0.3.0"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## ✅ Validation Checklist

- [ ] All clients handle rate limiting gracefully
- [ ] Accurate cost calculation for each provider
- [ ] Proper error handling and retry logic
- [ ] Metrics aggregation works correctly
- [ ] Report generation is reproducible
- [ ] Performance benchmarks are reliable
- [ ] Documentation is complete

