const COMPOSE_RAW_URL =
  'https://raw.githubusercontent.com/tokamak-network/SentinAI/main/docker-compose.yml';

export type AiProvider = 'none' | 'qwen' | 'anthropic' | 'openai' | 'gemini';

const AI_KEY_VAR: Record<Exclude<AiProvider, 'none'>, string> = {
  qwen: 'QWEN_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

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

export interface CustomProfile {
  clientFamily: string;
  detectPattern: string;
  txPoolMethod: string | null;
  l2SyncMethod: string | null;
}

export interface SetupConfig {
  clientFamily: ClientFamily;
  rpcUrl: string;
  networkName: string;
  aiProvider: AiProvider;
  aiApiKey: string;
  customProfile?: CustomProfile;
}

function sanitizeForHeredoc(value: string): string {
  return value
    .replace(/\r?\n|\r/g, ' ')    // collapse newlines
    .replace(/SENTINAI_EOF/g, ''); // prevent delimiter escape
}

export function generateSetupScript(config: SetupConfig): string {
  const rpcUrl = sanitizeForHeredoc(config.rpcUrl.trim() || '<your-rpc-url>');
  const networkName = sanitizeForHeredoc(config.networkName.trim() || 'My Network');

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
    const sanitizedKey = sanitizeForHeredoc(config.aiApiKey.trim());
    envLines.push(`${AI_KEY_VAR[config.aiProvider]}=${sanitizedKey}`);
  }

  let customProfilesBlock = '';
  if (config.customProfile) {
    const cp = config.customProfile;
    const safePattern = sanitizeForHeredoc(cp.detectPattern);
    const profile = [
      {
        clientFamily: cp.clientFamily,
        detectPattern: safePattern,
        methods: {
          txPool: cp.txPoolMethod ? { method: cp.txPoolMethod } : null,
          l2SyncStatus: cp.l2SyncMethod ? { method: cp.l2SyncMethod } : null,
        },
        capabilities: {
          supportsTxPool: !!cp.txPoolMethod,
          supportsL2SyncStatus: !!cp.l2SyncMethod,
        },
      },
    ];
    customProfilesBlock = `
cat > client-profiles.json << 'SENTINAI_PROFILES_EOF'
${JSON.stringify(profile, null, 2)}
SENTINAI_PROFILES_EOF`;
  }

  return `#!/bin/bash
# SECURITY: keep this script private
set -e
mkdir -p sentinai && cd sentinai
curl -sSL ${COMPOSE_RAW_URL} -o docker-compose.yml
cat > .env.local << 'SENTINAI_EOF'
${envLines.join('\n')}
SENTINAI_EOF${customProfilesBlock}
docker compose up -d
echo "✓ SentinAI is running at http://localhost:3002"`;
}
