const COMPOSE_RAW_URL =
  'https://raw.githubusercontent.com/tokamak-network/SentinAI/main/docker-compose.yml';

const AI_KEY_VAR: Record<string, string> = {
  qwen: 'QWEN_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export type AiProvider = 'none' | 'qwen' | 'anthropic' | 'openai' | 'gemini';

export type ClientFamily =
  | 'geth'
  | 'reth'
  | 'nethermind'
  | 'besu'
  | 'erigon'
  | 'op-geth'
  | 'nitro-node'
  | 'ethrex'
  | 'other';

export interface SetupConfig {
  clientFamily: ClientFamily;
  rpcUrl: string;
  networkName: string;
  aiProvider: AiProvider;
  aiApiKey: string;
}

export function generateSetupScript(config: SetupConfig): string {
  const rpcUrl = config.rpcUrl.trim() || '<your-rpc-url>';
  const networkName = config.networkName.trim() || 'My Network';

  // ethrex uses geth-compatible API
  const clientFamily = config.clientFamily === 'ethrex' ? 'geth' : config.clientFamily;

  const envLines: string[] = [
    `NEXT_PUBLIC_NETWORK_NAME=${networkName}`,
    `L2_RPC_URL=${rpcUrl}`,
  ];

  if (clientFamily !== 'other') {
    envLines.push(`SENTINAI_CLIENT_FAMILY=${clientFamily}`);
  }

  envLines.push('SCALING_SIMULATION_MODE=true');

  if (config.aiProvider !== 'none' && config.aiApiKey.trim()) {
    envLines.push(`${AI_KEY_VAR[config.aiProvider]}=${config.aiApiKey.trim()}`);
  }

  return `#!/bin/bash
set -e
mkdir -p sentinai && cd sentinai
curl -sSL ${COMPOSE_RAW_URL} -o docker-compose.yml
cat > .env.local << 'SENTINAI_EOF'
${envLines.join('\n')}
SENTINAI_EOF
docker compose up -d
echo "✓ SentinAI is running at http://localhost:3002"`;
}
