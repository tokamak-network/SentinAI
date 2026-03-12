import Link from 'next/link';
import { getAgentMarketplaceCatalog } from '@/lib/agent-marketplace/catalog';
import { toAgentMarketplaceAgentManifest } from '@/lib/agent-marketplace/catalog-response';
import { getAgentMarketplaceContractsStatus } from '@/lib/agent-marketplace/contracts-status';

type MarketplaceTab = 'registry' | 'instance' | 'guide';

function resolveMarketplaceTab(value: string | undefined): MarketplaceTab {
  if (value === 'instance' || value === 'guide') {
    return value;
  }

  return 'registry';
}

function formatTonAmount(amount: string | null | undefined): string {
  if (!amount || !/^\d+$/.test(amount)) {
    return 'N/A';
  }

  const normalized = amount.padStart(19, '0');
  const whole = normalized.slice(0, -18).replace(/^0+/, '') || '0';
  const fraction = normalized.slice(-18).slice(0, 2).replace(/0+$/, '');

  return `${whole}${fraction ? `.${fraction}` : ''} TON`;
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const enabled = process.env.MARKETPLACE_ENABLED === 'true';
  const catalog = getAgentMarketplaceCatalog();
  const manifest = toAgentMarketplaceAgentManifest(catalog);
  const contracts = getAgentMarketplaceContractsStatus();
  const tab = resolveMarketplaceTab((await searchParams)?.tab);
  const supportedNetworks = Array.from(
    new Set(
      catalog.services
        .map((service) => service.payment?.network)
        .filter((network): network is string => Boolean(network))
    )
  );

  return (
    <main className="min-h-screen bg-[#F0F0F0] px-6 py-8 text-[#0A0A0A]">
      <div className="mx-auto max-w-6xl border border-[#C0C0C0] bg-white font-mono shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
        <header className="flex min-h-10 items-stretch border-b border-[#D0D0D0] bg-white">
          <div className="flex items-center border-r-2 border-[#8B0000] bg-[#D40000] px-5 text-[13px] font-bold tracking-[0.05em] text-white">
            SENTINAI
          </div>
          <Link href="/docs" className="flex items-center border-r border-[#E8E8E8] px-4 text-[10px] font-semibold tracking-[0.1em] text-[#3A3A3A]">
            DOCS
          </Link>
          <Link href="/marketplace" className="flex items-center border-b-2 border-[#D40000] border-r border-[#E8E8E8] px-4 text-[10px] font-semibold tracking-[0.1em] text-[#D40000]">
            MARKETPLACE
          </Link>
          <Link href="/api/agent-marketplace/catalog" className="flex items-center border-r border-[#E8E8E8] px-4 text-[10px] font-semibold tracking-[0.1em] text-[#3A3A3A]">
            API
          </Link>
          <Link href="/v2/marketplace" className="ml-auto flex items-center border-l-2 border-[#8B0000] bg-[#D40000] px-5 text-[10px] font-bold tracking-[0.1em] text-white">
            OPS CONSOLE →
          </Link>
        </header>

        <section className="border-b border-[#D0D0D0] bg-[#FAFAFA] px-12 pt-7">
          <div className="max-w-5xl">
            <div className="mb-2 text-[9px] font-bold tracking-[0.2em] text-[#D40000]">AGENT ECONOMY</div>
            <h1 className="mb-1 text-[22px] font-bold tracking-[-0.02em]">SentinAI Marketplace</h1>
            <p className="mb-5 text-[11px] text-[#666]">
              Discover paid monitoring signals for autonomous agents over x402. This public surface is aligned to the current
              agent marketplace backend and live catalog.
            </p>
          </div>
          <div className="flex max-w-5xl gap-0 border-b-2 border-[#D0D0D0]">
            <Link
              href="/marketplace?tab=instance"
              className={`px-5 py-3 text-[10px] font-bold tracking-[0.1em] ${tab === 'instance' ? 'mb-[-2px] border-b-[3px] border-[#D40000] text-[#D40000]' : 'text-[#777]'}`}
            >
              THIS INSTANCE
            </Link>
            <Link
              href="/marketplace?tab=registry"
              className={`px-5 py-3 text-[10px] font-bold tracking-[0.1em] ${tab === 'registry' ? 'mb-[-2px] border-b-[3px] border-[#D40000] text-[#D40000]' : 'text-[#777]'}`}
            >
              BROWSE REGISTRY
            </Link>
            <Link
              href="/marketplace?tab=guide"
              className={`px-5 py-3 text-[10px] font-bold tracking-[0.1em] ${tab === 'guide' ? 'mb-[-2px] border-b-[3px] border-[#D40000] text-[#D40000]' : 'text-[#777]'}`}
            >
              CONNECT GUIDE
            </Link>
          </div>
        </section>

        {!enabled ? (
          <section className="m-6 max-w-2xl border border-[#D0D0D0] bg-[#FFF8F8] p-6">
            <h2 className="mb-3 text-[13px] font-bold tracking-[0.08em] text-[#D40000]">MARKETPLACE DISABLED</h2>
            <p className="mb-4 text-[11px] text-[#666]">
              Set MARKETPLACE_ENABLED=true to expose paid services and start serving x402-protected requests.
            </p>
            <pre className="bg-[#F0F0F0] p-4 text-[10px] leading-7 text-[#333]">
              MARKETPLACE_ENABLED=true{'\n'}
              MARKETPLACE_WALLET_KEY=0x...{'\n'}
              REDIS_URL=redis://localhost:6379
            </pre>
          </section>
        ) : null}

        {tab === 'registry' ? (
        <section id="registry" className="px-12 py-6">
          <div className="mb-6 flex gap-2">
            <div className="min-w-[130px] border border-[#D0D0D0] bg-white px-4 py-3">
              <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-[#888]">REGISTERED</div>
              <div className="text-[18px] font-bold">1</div>
              <div className="text-[9px] text-[#888]">instance</div>
            </div>
            <div className="min-w-[130px] border border-[#D0D0D0] bg-white px-4 py-3">
              <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-[#888]">CHAINS</div>
              <div className="text-[18px] font-bold">{supportedNetworks.length}</div>
              <div className="text-[9px] text-[#888]">configured networks</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-3 border border-[#D0D0D0] bg-white px-4 py-3 text-[12px]">
              <span className="font-bold">SentinAI Marketplace</span>
              <span className="text-[11px] text-[#0055AA]">{manifest.payment.network}</span>
              <span className="text-[11px] text-[#777]">· {manifest.version}</span>
              <span className="ml-auto text-[11px] text-[#555]">{catalog.services.length} services</span>
              <span className="text-[10px] font-semibold text-[#27ae60]">x402 ✓</span>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-[#BBB]">
            Phase 1 exposes the local SentinAI marketplace surface directly. Multi-instance registry browsing can expand on top of the
            same manifest and ERC-8004 metadata later.
          </div>
        </section>
        ) : null}

        {tab === 'instance' ? (
        <section id="instance" className="border-t border-[#E8E8E8] bg-[#FAFAFA] px-12 py-6">
          <div className="mb-4 flex items-center gap-3 border-b border-[#E8E8E8] pb-4">
            <div className="h-2 w-2 rounded-full bg-[#27ae60]" />
            <span className="text-[13px] font-bold">SentinAI @ Agent Marketplace</span>
            <span className="text-[11px] text-[#0055AA]">{manifest.payment.network}</span>
            <span className="ml-auto text-[11px] font-semibold text-[#D40000]">x402 ✓</span>
          </div>

          <div className="mb-3 text-[9px] font-bold tracking-[0.12em] text-[#888]">
            LIVE SERVICES
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {catalog.services.map((service, index) => (
              <div key={service.key} className="border border-[#D0D0D0] border-t-[3px] border-t-[#D40000] bg-white p-3">
                <div className="mb-1 text-[11px] text-[#555]">{service.displayName}</div>
                <div className="mb-1 text-[14px] font-bold">{formatTonAmount(service.payment?.amount)}</div>
                <div className="mb-2 text-[10px] font-semibold text-[#27ae60]">
                  {service.state === 'active' ? 'live ●' : 'planned ○'}
                </div>
                <p className="text-[10px] leading-5 text-[#666]">{service.description}</p>
                <div className="mt-3 text-[9px] text-[#888]">
                  endpoint /api/agent-marketplace/{service.key.replace(/_/g, '-')}
                </div>
                <div className="mt-1 text-[9px] text-[#888]">capability {manifest.capabilities[index] ?? service.key}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="border border-[#D0D0D0] bg-white">
              <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
                AGENT MANIFEST
              </div>
              <div className="px-4 py-3 text-[11px] leading-6">
                <div>
                  <span className="text-[#888]">endpoint:</span> {manifest.endpoint}
                </div>
                <div>
                  <span className="text-[#888]">capabilities:</span> {manifest.capabilities.join(', ')}
                </div>
                <div>
                  <span className="text-[#888]">payment:</span> {manifest.payment.protocol} / {manifest.payment.network}
                </div>
                <div>
                  <span className="text-[#888]">agent.json:</span> /api/agent-marketplace/agent.json
                </div>
              </div>
            </div>

            <div className="border border-[#D0D0D0] bg-white">
              <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
                CONTRACTS
              </div>
              <div className="px-4 py-3 text-[11px] leading-6">
                <div>
                  <span className="text-[#888]">{contracts.registry.name}:</span> {contracts.registry.address ?? 'missing'}
                </div>
                <div>
                  <span className="text-[#888]">{contracts.reputation.name}:</span> {contracts.reputation.address ?? 'missing'}
                </div>
                <div className="text-[#666]">
                  events: {contracts.registry.eventNames.join(', ')} / {contracts.reputation.eventNames.join(', ')}
                </div>
              </div>
            </div>
          </div>
        </section>
        ) : null}

        {tab === 'guide' ? (
        <section id="guide" className="px-12 py-6">
          <div className="max-w-3xl">
            <div className="mb-5 text-[12px] font-bold tracking-[0.1em]">HOW TO BUY DATA WITH x402</div>

            <div className="mb-5">
              <div className="mb-2 text-[10px] font-semibold text-[#777]">1. Read the public catalog and agent manifest</div>
              <pre className="overflow-x-auto border border-[#D0D0D0] bg-[#F5F5F5] px-4 py-3 text-[10px] leading-7 text-[#333]">
GET /api/agent-marketplace/catalog{'\n'}
GET /api/agent-marketplace/agent.json
              </pre>
            </div>

            <div className="mb-5">
              <div className="mb-2 text-[10px] font-semibold text-[#777]">2. Request a paid endpoint and inspect the payment challenge</div>
              <pre className="overflow-x-auto border border-[#D0D0D0] bg-[#F5F5F5] px-4 py-3 text-[10px] leading-7 text-[#333]">
                {`curl https://sentinai.example.com/api/agent-marketplace/sequencer-health
← 402 Payment Required
accepts[0].scheme = "exact"
accepts[0].network = "${manifest.payment.network}"
accepts[0].asset.symbol = "TON"`}
              </pre>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-semibold text-[#777]">3. Retry with the signed payment envelope</div>
              <pre className="overflow-x-auto border border-[#D0D0D0] bg-[#F5F5F5] px-4 py-3 text-[10px] leading-7 text-[#333]">
                {`curl https://sentinai.example.com/api/agent-marketplace/sequencer-health \\
  -H "X-PAYMENT: <base64-envelope>"

← 200 OK
{
  "status": "healthy",
  "action": "proceed",
  "updatedAt": "2026-03-12T00:00:00.000Z"
}`}
              </pre>
            </div>
          </div>
        </section>
        ) : null}
      </div>
    </main>
  );
}
