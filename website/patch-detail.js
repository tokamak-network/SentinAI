const fs = require('fs');
const file = 'src/app/marketplace/operators/[address]/page.tsx';
let src = fs.readFileSync(file, 'utf8');

src = src.replace(
  "import { formatTONPrice } from '@/lib/agent-marketplace';",
  "import { formatTONPrice, getOperatorByAddress } from '@/lib/agent-marketplace';"
);

const newFallback = `
      // Fallback: use the local catalog base URL (single-operator mode)
      const mockOp = getOperatorByAddress(address);
      if (mockOp) {
        setCatalog({
          agent: {
            id: mockOp.address,
            status: mockOp.status === 'offline' ? 'inactive' : 'active',
            version: '1.0.0',
            operator: mockOp.operator,
            operatorAddress: mockOp.address,
            baseUrl: \`https://sentinai.tokamak.network/operators/\${mockOp.address}\`,
            performanceHistory: mockOp.performanceHistory,
          },
          services: mockOp.services,
        } as any);
        setSnapshot({
          version: '1.0.0',
          generatedAt: new Date().toISOString(),
          metrics: {
            cpu: { mean: mockOp.metrics.cpuMean, max: mockOp.metrics.cpuMean, trend: 'stable' },
          },
          scaling: {
            currentVcpu: 1,
            currentMemoryGiB: mockOp.metrics.memoryGiB,
            autoScalingEnabled: true,
            cooldownRemaining: 0,
            lastDecisionScore: null,
            lastDecisionReason: null,
          },
          anomalies: { activeCount: mockOp.metrics.activeAnomalies, totalRecent: mockOp.metrics.activeAnomalies },
          operatorAddress: mockOp.address,
        });
        return '';
      }
      return 'http://localhost:3002';
`;

src = src.replace(
  `      // Fallback: use the local catalog base URL (single-operator mode)
      const catRes = await fetch('/api/agent-marketplace/catalog');
      if (catRes.ok) {
        const cat = await catRes.json();
        return cat.agent?.baseUrl ?? 'http://localhost:3002';
      }
      return 'http://localhost:3002';`,
  newFallback
);

src = src.replace(
  "const agentUri = await resolveAgentUri();",
  "const agentUri = await resolveAgentUri();\n        if (!agentUri) { setLoading(false); return; }"
);

fs.writeFileSync(file, src);
