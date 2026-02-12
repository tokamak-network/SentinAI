/**
 * AWS Cost Tracker Module
 * Tracks AWS service costs (EKS, EC2, NAT Gateway, CloudWatch, etc.)
 * Data source: CloudWatch metrics + Cost Explorer API (optional)
 */

import type { AWSServiceCost, AWSDailyCost } from '@/types/daily-report';

// ============================================================
// AWS Pricing (Seoul Region ap-northeast-2)
// Updated: 2026-02-12
// ============================================================

const AWS_PRICING = {
  EKS: {
    clusterPerHour: 0.10, // $0.10/hour per cluster
  },
  FARGATE: {
    vcpuPerHour: 0.04656,
    memGbPerHour: 0.00511,
  },
  NAT_GATEWAY: {
    perHour: 0.045,
    perGbProcessed: 0.045,
  },
  CLOUDWATCH: {
    logIngestionPerGb: 0.50,
    metricPerRequest: 0.0001,
    customMetricPerMonth: 0.30,
  },
  EC2: {
    t3MediumOnDemand: 0.0416, // per hour
    t3LargeOnDemand: 0.0832,
  },
  VPC: {
    dataTransferOutPerGb: 0.14, // InterZone data transfer
  },
  RDS: {
    dbInstancePerHour: 0.0, // Not used currently
  },
  S3: {
    storagePerGb: 0.025, // per month
    requestsPerThousand: 0.0004,
  },
} as const;

// ============================================================
// Cost Calculation
// ============================================================

/**
 * Calculate daily EKS cost
 * EKS has fixed cost per cluster + Fargate compute cost
 */
function calculateEKSCost(vcpuHours: number, memGbHours: number): AWSServiceCost {
  // 1 cluster × 24 hours
  const clusterCost = AWS_PRICING.EKS.clusterPerHour * 24;

  // Fargate compute (from usage tracker)
  const fargateVcpuCost = vcpuHours * AWS_PRICING.FARGATE.vcpuPerHour;
  const fargateMisCost = memGbHours * AWS_PRICING.FARGATE.memGbPerHour;

  const dailyCost = clusterCost + fargateVcpuCost + fargateMisCost;
  const monthlyCost = dailyCost * 30;

  return {
    service: 'EKS',
    dailyCost: Number(dailyCost.toFixed(3)),
    monthlyCost: Number(monthlyCost.toFixed(2)),
    unit: 'vCPU-hour + GB-hour',
    usageAmount: vcpuHours,
    description: `EKS cluster ($${clusterCost.toFixed(2)}) + Fargate (${vcpuHours}vCPU-h, ${memGbHours}GB-h)`,
  };
}

/**
 * Calculate NAT Gateway cost (estimated based on data transfer)
 * Typical L2 node uses 100-500MB/hour
 */
function calculateNATGatewayCost(dataTransferGbEstimate: number = 1.5): AWSServiceCost {
  // Hourly fee for NAT Gateway
  const hourlyFee = AWS_PRICING.NAT_GATEWAY.perHour * 24;

  // Data processing fee (estimated)
  const dataFee = dataTransferGbEstimate * AWS_PRICING.NAT_GATEWAY.perGbProcessed;

  const dailyCost = hourlyFee + dataFee;
  const monthlyCost = dailyCost * 30;

  return {
    service: 'NAT',
    dailyCost: Number(dailyCost.toFixed(3)),
    monthlyCost: Number(monthlyCost.toFixed(2)),
    unit: 'GB',
    usageAmount: dataTransferGbEstimate,
    description: `NAT Gateway (hourly: $${hourlyFee.toFixed(2)} + data: ${dataTransferGbEstimate}GB @ $${AWS_PRICING.NAT_GATEWAY.perGbProcessed}/GB)`,
  };
}

/**
 * Calculate CloudWatch cost
 * Typical SentinAI: ~500MB logs/day + ~10K metrics/month
 */
function calculateCloudWatchCost(logsGbPerDay: number = 0.5): AWSServiceCost {
  // Log ingestion
  const logCost = logsGbPerDay * AWS_PRICING.CLOUDWATCH.logIngestionPerGb;

  // Custom metrics (estimated: 50 metrics × $0.30/month)
  const metricsPerDay = (50 * 0.30) / 30;

  const dailyCost = logCost + metricsPerDay;
  const monthlyCost = dailyCost * 30;

  return {
    service: 'CloudWatch',
    dailyCost: Number(dailyCost.toFixed(3)),
    monthlyCost: Number(monthlyCost.toFixed(2)),
    unit: 'GB logs',
    usageAmount: logsGbPerDay,
    description: `Logs (${logsGbPerDay}GB) + Metrics (50 custom @ $0.30/mo)`,
  };
}

/**
 * Calculate VPC costs (mostly data transfer between zones)
 * Typical L2 node: 10-50GB data transfer/day
 */
function calculateVPCCost(dataTransferInterZoneGb: number = 30): AWSServiceCost {
  const dailyCost = dataTransferInterZoneGb * AWS_PRICING.VPC.dataTransferOutPerGb;
  const monthlyCost = dailyCost * 30;

  return {
    service: 'VPC',
    dailyCost: Number(dailyCost.toFixed(3)),
    monthlyCost: Number(monthlyCost.toFixed(2)),
    unit: 'GB',
    usageAmount: dataTransferInterZoneGb,
    description: `InterZone data transfer (${dataTransferInterZoneGb}GB @ $${AWS_PRICING.VPC.dataTransferOutPerGb}/GB)`,
  };
}

/**
 * Calculate S3 costs (if using for state snapshots)
 * Typical SentinAI: ~5GB stored, ~10K requests/day
 */
function calculateS3Cost(storageGb: number = 5, requestsPerDay: number = 10000): AWSServiceCost {
  // Storage cost (monthly, so divide by 30)
  const storageCost = (storageGb * AWS_PRICING.S3.storagePerGb) / 30;

  // Request cost
  const requestCost = (requestsPerDay / 1000) * AWS_PRICING.S3.requestsPerThousand;

  const dailyCost = storageCost + requestCost;
  const monthlyCost = dailyCost * 30;

  return {
    service: 'S3',
    dailyCost: Number(dailyCost.toFixed(3)),
    monthlyCost: Number(monthlyCost.toFixed(2)),
    unit: 'GB + requests',
    usageAmount: storageGb,
    description: `Storage (${storageGb}GB) + Requests (${requestsPerDay}/day)`,
  };
}

// ============================================================
// Daily Cost Aggregation
// ============================================================

/**
 * Generate AWS cost breakdown for the day
 */
export function calculateDailyAWSCost(
  date: string,
  metrics?: {
    vcpuHours?: number;
    memGbHours?: number;
    natDataTransferGb?: number;
    cloudwatchLogsGb?: number;
    vpcDataTransferGb?: number;
    s3StorageGb?: number;
    s3RequestsPerDay?: number;
  }
): AWSDailyCost {
  const defaultMetrics = {
    vcpuHours: 48, // 2 vCPU average × 24 hours
    memGbHours: 120, // 5GB average × 24 hours
    natDataTransferGb: 1.5,
    cloudwatchLogsGb: 0.5,
    vpcDataTransferGb: 30,
    s3StorageGb: 5,
    s3RequestsPerDay: 10000,
  };

  const m = { ...defaultMetrics, ...metrics };

  // Calculate service costs
  const eksCost = calculateEKSCost(m.vcpuHours, m.memGbHours);
  const natCost = calculateNATGatewayCost(m.natDataTransferGb);
  const cwCost = calculateCloudWatchCost(m.cloudwatchLogsGb);
  const vpcCost = calculateVPCCost(m.vpcDataTransferGb);
  const s3Cost = calculateS3Cost(m.s3StorageGb, m.s3RequestsPerDay);

  const services: AWSServiceCost[] = [eksCost, natCost, cwCost, vpcCost, s3Cost];

  const dailyTotal = services.reduce((sum, s) => sum + s.dailyCost, 0);
  const monthlyProjected = services.reduce((sum, s) => sum + s.monthlyCost, 0);

  return {
    date,
    dailyTotal: Number(dailyTotal.toFixed(2)),
    monthlyProjected: Number(monthlyProjected.toFixed(2)),
    services,
    metadata: {
      currency: 'USD',
      region: 'ap-northeast-2',
      dataSource: 'Manual Estimate', // TODO: connect to Cost Explorer API
      lastUpdated: new Date().toISOString(),
    },
  };
}

/**
 * Format AWS costs for daily report
 */
export function formatAWSCostForReport(awsCost: AWSDailyCost): string {
  const serviceLines = awsCost.services
    .map(s => `- **${s.service}**: $${s.dailyCost.toFixed(3)}/day (~$${s.monthlyCost.toFixed(2)}/month)`)
    .join('\n');

  const tableHeader = '| 서비스 | 일일 비용 | 월간 예상 | 사용량 | 설명 |';
  const tableSeparator = '|--------|----------|----------|--------|------|';
  const tableRows = awsCost.services
    .map(
      s =>
        `| ${s.service} | $${s.dailyCost.toFixed(3)} | $${s.monthlyCost.toFixed(2)} | ${s.usageAmount} ${s.unit} | ${s.description} |`
    )
    .join('\n');

  return `## AWS 서비스 비용 분석

### 일일 요약
- **일일 총 비용**: $${awsCost.dailyTotal.toFixed(2)}
- **월간 예상**: $${awsCost.monthlyProjected.toFixed(2)}
- **데이터 출처**: ${awsCost.metadata.dataSource}
- **리전**: ${awsCost.metadata.region}

### 서비스별 상세

${tableHeader}
${tableSeparator}
${tableRows}

### 주의사항
- 이 비용은 **예상치**입니다 (실제 AWS 청구서 기준 아님)
- Reserved Instances, Savings Plans 등 할인 미적용
- Data Transfer Out (인터넷으로 나가는 데이터)는 별도 비용 발생
- 추가 서비스 (Route 53, Secret Manager 등) 미포함

### 비용 최적화 권고
1. **Reserved Instances**: EKS + Fargate을 RI로 구매 시 40% 절감
2. **Savings Plans**: 연 계약으로 추가 10-15% 절감
3. **NAT Gateway 최소화**: Endpoint를 활용해 데이터 전송 비용 절감
4. **S3 Lifecycle**: 오래된 로그를 Glacier로 이동해 저장 비용 절감
5. **CloudWatch 필터**: 불필요한 로그 수집 중단`;
}
