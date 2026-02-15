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

  const tableHeader = '| Service | Daily Cost | Monthly Projection | Usage | Description |';
  const tableSeparator = '|---------|------------|---------------------|-------|-------------|';
  const tableRows = awsCost.services
    .map(
      s =>
        `| ${s.service} | $${s.dailyCost.toFixed(3)} | $${s.monthlyCost.toFixed(2)} | ${s.usageAmount} ${s.unit} | ${s.description} |`
    )
    .join('\n');

  return `## AWS Service Cost Analysis

### Daily Summary
- **Daily total cost**: $${awsCost.dailyTotal.toFixed(2)}
- **Monthly projection**: $${awsCost.monthlyProjected.toFixed(2)}
- **Data source**: ${awsCost.metadata.dataSource}
- **Region**: ${awsCost.metadata.region}

### Service Breakdown

${tableHeader}
${tableSeparator}
${tableRows}

### Notes
- These costs are **estimates** (not based on actual AWS billing)
- Discounts such as Reserved Instances and Savings Plans are not applied
- Data Transfer Out (outbound internet traffic) incurs additional charges
- Additional services (Route 53, Secrets Manager, etc.) are not included

### Cost Optimization Recommendations
1. **Reserved Instances**: Save up to 40% by purchasing RIs for EKS + Fargate
2. **Savings Plans**: Save an additional 10-15% with annual commitments
3. **NAT Gateway optimization**: Use VPC Endpoints to reduce data transfer costs
4. **S3 Lifecycle**: Move old logs to Glacier to reduce storage costs
5. **CloudWatch filters**: Stop collecting unnecessary logs`;
}
