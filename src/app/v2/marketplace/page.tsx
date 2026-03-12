import { buildAgentMarketplaceOpsSummary } from '@/lib/agent-marketplace/ops-summary';
import { getAgentMarketplaceContractsStatus } from '@/lib/agent-marketplace/contracts-status';
import { listAgentMarketplaceDisputes } from '@/lib/agent-marketplace/dispute-store';

function formatTonAmount(amount: string | null): string {
  if (!amount) {
    return 'N/A';
  }

  if (!/^\d+$/.test(amount)) {
    return amount;
  }

  const normalized = amount.padStart(19, '0');
  const whole = normalized.slice(0, -18).replace(/^0+/, '') || '0';
  const fraction = normalized.slice(-18).slice(0, 2).replace(/0+$/, '');

  return `${whole}${fraction ? `.${fraction}` : ''} TON`;
}

export default async function MarketplaceOpsPage() {
  const toIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [summary, disputes, contracts] = await Promise.all([
    buildAgentMarketplaceOpsSummary({ fromIso, toIso }),
    listAgentMarketplaceDisputes(),
    Promise.resolve(getAgentMarketplaceContractsStatus()),
  ]);

  if (!summary.enabled) {
    return (
      <main className="min-h-screen bg-white px-6 py-8 text-[#0A0A0A]">
        <div className="mx-auto max-w-6xl border border-[#C0C0C0] bg-white font-mono shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
          <div className="border-b-2 border-[#8B0000] bg-[#D40000] px-4 py-2 text-[11px] font-bold tracking-[0.08em] text-white">
            SENTINAI MARKETPLACE OPS
          </div>
          <section className="m-6 max-w-2xl border border-[#D0D0D0] bg-[#FFF8F8] p-6">
            <h1 className="mb-3 text-[13px] font-bold tracking-[0.08em] text-[#D40000]">
              MARKETPLACE DISABLED
            </h1>
            <p className="mb-4 text-[11px] text-[#555]">
              Set MARKETPLACE_ENABLED=true to start serving agent marketplace requests.
            </p>
            <pre className="bg-[#F0F0F0] p-4 text-[10px] leading-6 text-[#333]">
              MARKETPLACE_ENABLED=true{'\n'}
              MARKETPLACE_WALLET_KEY=0x...{'\n'}
              REDIS_URL=redis://localhost:6379
            </pre>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F0F0F0] px-6 py-8 text-[#0A0A0A]">
      <div className="mx-auto max-w-6xl border border-[#C0C0C0] bg-white font-mono shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
        <header className="border-b-2 border-[#8B0000] bg-[#D40000] px-4 py-2 text-[11px] font-bold tracking-[0.08em] text-white">
          SENTINAI MARKETPLACE OPS
        </header>

        <section className="grid gap-2 border-b border-[#E8E8E8] bg-[#FAFAFA] p-6 md:grid-cols-4">
          <div className="border border-[#D0D0D0] bg-white p-4">
            <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-[#888]">STATUS</div>
            <div className="text-[14px] font-bold text-[#27ae60]">ACTIVE ●</div>
          </div>
          <div className="border border-[#D0D0D0] bg-white p-4">
            <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-[#888]">REQUESTS / 24H</div>
            <div className="text-[18px] font-bold">{summary.requestTotals.total}</div>
          </div>
          <div className="border border-[#D0D0D0] bg-white p-4">
            <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-[#888]">BUYERS / 24H</div>
            <div className="text-[18px] font-bold">{summary.distinctBuyerCount}</div>
          </div>
          <div className="border border-[#D0D0D0] bg-white p-4">
            <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-[#888]">LAST BATCH</div>
            <div className="text-[18px] font-bold uppercase">{summary.lastBatch.status}</div>
          </div>
        </section>

        <section className="grid gap-4 p-6 md:grid-cols-2">
          <div className="border border-[#D0D0D0] bg-white">
            <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
              SERVICES
            </div>
            {summary.services.map((service) => (
              <div key={service.key} className="flex items-center justify-between border-b border-[#F0F0F0] px-4 py-2 text-[12px] last:border-b-0">
                <div>
                  <div>{service.displayName}</div>
                  <div className="text-[10px] text-[#888]">{service.requestCount} requests</div>
                </div>
                <div className="text-[#D40000]">{formatTonAmount(service.priceAmount)}</div>
              </div>
            ))}
          </div>

          <div className="border border-[#D0D0D0] bg-white">
            <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
              TOP BUYERS / SLA
            </div>
            {summary.topBuyers.map((buyer) => {
              const matchingSla = summary.slaAgents.find((agent) => agent.agentId === buyer.agentId);

              return (
                <div key={buyer.agentId} className="flex items-center justify-between border-b border-[#F0F0F0] px-4 py-2 text-[12px] last:border-b-0">
                  <div>
                    <div className="text-[#0055AA]">{buyer.agentId}</div>
                    <div className="text-[10px] text-[#888]">
                      {buyer.verifiedCount} verified / {buyer.requestCount} total
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-[#555]">
                    SLA {matchingSla?.successRate ?? 0}% / score {matchingSla?.newScore ?? 'N/A'}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="px-6 pb-6">
          <div className="mb-3 border-b border-[#E8E8E8] pb-2 text-[9px] font-bold tracking-[0.12em] text-[#888]">
            RECENT VERIFIED REQUESTS
          </div>
          {summary.recentRequests.length === 0 ? (
            <div className="border border-[#D0D0D0] bg-white px-4 py-5 text-[11px] italic text-[#999]">
              No verified requests yet.
            </div>
          ) : (
            <div className="border border-[#D0D0D0] bg-white">
              {summary.recentRequests.map((request) => (
                <div key={`${request.agentId}-${request.serviceKey}-${request.timestamp}`} className="flex items-center gap-3 border-b border-[#F0F0F0] px-4 py-2 text-[11px] last:border-b-0">
                  <span className="text-[#0055AA]">{request.agentId}</span>
                  <span className="text-[#D0D0D0]">·</span>
                  <span>{request.serviceDisplayName}</span>
                  <span className="text-[#D0D0D0]">·</span>
                  <span className="font-semibold text-[#D40000]">{request.verificationResult}</span>
                  <span className="ml-auto text-[#AAA]">{request.timestamp}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="px-6 pb-6">
          <div className="mb-3 border-b border-[#E8E8E8] pb-2 text-[9px] font-bold tracking-[0.12em] text-[#888]">
            DISPUTES
          </div>
          {disputes.length === 0 ? (
            <div className="border border-[#D0D0D0] bg-white px-4 py-5 text-[11px] italic text-[#999]">
              No open disputes.
            </div>
          ) : (
            <div className="border border-[#D0D0D0] bg-white">
              {disputes.map((dispute) => (
                <div key={dispute.id} className="flex items-center gap-3 border-b border-[#F0F0F0] px-4 py-2 text-[11px] last:border-b-0">
                  <span className="text-[#0055AA]">{dispute.agentId}</span>
                  <span className="text-[#D0D0D0]">·</span>
                  <span>{dispute.reason}</span>
                  <span className="text-[#D0D0D0]">·</span>
                  <span className="font-semibold uppercase text-[#D40000]">{dispute.status}</span>
                  <span className="ml-auto text-[#AAA]">{dispute.updatedAt}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="px-6 pb-6">
          <div className="mb-3 border-b border-[#E8E8E8] pb-2 text-[9px] font-bold tracking-[0.12em] text-[#888]">
            CONTRACTS / ABI
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              contracts.registry,
              contracts.reputation,
            ].map((contract) => (
              <div key={contract.name} className="border border-[#D0D0D0] bg-white">
                <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[10px] font-bold">
                  {contract.name}
                </div>
                <div className="px-4 py-3 text-[11px]">
                  <div className="mb-2">
                    <span className="text-[#888]">address:</span>{' '}
                    <span className={contract.address ? 'text-[#0055AA]' : 'text-[#D40000]'}>
                      {contract.address ?? 'missing'}
                    </span>
                  </div>
                  <div className="text-[#666]">
                    {contract.eventNames.join(', ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
