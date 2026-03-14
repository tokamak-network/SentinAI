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

const disputeStatusOptions = ['open', 'reviewed', 'resolved', 'rejected'] as const;

function resolveAgentManifestUri(): string {
  const agentUriBase = process.env.MARKETPLACE_AGENT_URI_BASE?.trim();
  if (!agentUriBase) {
    return 'missing';
  }

  return `${agentUriBase.replace(/\/+$/, '')}/api/agent-marketplace/agent.json`;
}

export default async function MarketplaceOpsPage({
  searchParams,
}: {
  searchParams?: Promise<{ dispute?: string; batch?: string }>;
}) {
  const toIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [summary, disputes, contracts] = await Promise.all([
    buildAgentMarketplaceOpsSummary({ fromIso, toIso }),
    listAgentMarketplaceDisputes(),
    Promise.resolve(getAgentMarketplaceContractsStatus()),
  ]);
  const resolvedSearchParams = await searchParams;
  const selectedDisputeId = resolvedSearchParams?.dispute;
  const selectedBatchTimestamp = resolvedSearchParams?.batch;
  const selectedDispute = disputes.find((dispute) => dispute.id === selectedDisputeId) ?? disputes[0] ?? null;
  const selectedDisputeSla = selectedDispute
    ? summary.slaAgents.find((agent) => agent.agentId === selectedDispute.agentId) ?? null
    : null;
  const selectedBatch =
    summary.batchHistory.find((batch) => batch.publishedAt === selectedBatchTimestamp) ??
    summary.batchHistory[0] ??
    null;
  const manifestUri = resolveAgentManifestUri();

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
        <header className="flex items-center justify-between border-b-2 border-[#8B0000] bg-[#D40000] px-4 py-2 text-[11px] font-bold tracking-[0.08em] text-white">
          <span>SENTINAI MARKETPLACE OPS</span>
          <form action="/api/auth/siwe/logout" method="post" style={{ display: 'inline' }}>
            <button
              type="submit"
              style={{
                background: '#8B0000',
                border: '1px solid #FFFFFF',
                color: 'white',
                padding: '4px 12px',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: 'pointer',
                fontFamily: "'IBM Plex Mono', monospace",
              }}
              onMouseEnter={(e) => { (e.currentTarget.style.background = '#FFFFFF'); (e.currentTarget.style.color = '#D40000'); }}
              onMouseLeave={(e) => { (e.currentTarget.style.background = '#8B0000'); (e.currentTarget.style.color = 'white'); }}
            >
              LOGOUT
            </button>
          </form>
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
          <div className="border border-[#D0D0D0] bg-white">
            <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
              REGISTRY REGISTRATION
            </div>
            <div className="space-y-3 px-4 py-3 text-[11px]">
              <div><span className="text-[#888]">registry:</span> {contracts.registry.address ?? 'missing'}</div>
              <div><span className="text-[#888]">agent.json:</span> {manifestUri}</div>
              <form action="/api/agent-marketplace/ops/register" method="post">
                <button
                  type="submit"
                  className="border border-[#8B0000] bg-[#D40000] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                >
                  Register to Registry
                </button>
              </form>
            </div>
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

        <section className="grid gap-4 px-6 pb-6 md:grid-cols-2">
          <div className="border border-[#D0D0D0] bg-white">
            <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
              DISPUTE DETAIL
            </div>
            {selectedDispute ? (
              <div className="space-y-2 px-4 py-3 text-[11px]">
                <div><span className="text-[#888]">id:</span> {selectedDispute.id}</div>
                <div><span className="text-[#888]">agent:</span> {selectedDispute.agentId}</div>
                <div><span className="text-[#888]">status:</span> <span className="font-semibold uppercase text-[#D40000]">{selectedDispute.status}</span></div>
                <div><span className="text-[#888]">reason:</span> {selectedDispute.reason}</div>
                <div><span className="text-[#888]">batch hash:</span> {selectedDispute.batchHash}</div>
                <div><span className="text-[#888]">merkle root:</span> {selectedDispute.merkleRoot}</div>
                <div><span className="text-[#888]">requested score:</span> {selectedDispute.requestedScore}</div>
                <div><span className="text-[#888]">expected score:</span> {selectedDispute.expectedScore}</div>
                <div><span className="text-[#888]">score delta:</span> {selectedDispute.expectedScore - selectedDispute.requestedScore}</div>
                <div><span className="text-[#888]">created:</span> {selectedDispute.createdAt}</div>
                <div><span className="text-[#888]">updated:</span> {selectedDispute.updatedAt}</div>
                <div><span className="text-[#888]">reviewed by:</span> {selectedDispute.reviewedBy ?? 'none'}</div>
                <div><span className="text-[#888]">reviewer note:</span> {selectedDispute.reviewerNote ?? 'none'}</div>
                <div className="border-t border-[#F0F0F0] pt-2 text-[#555]">
                  {selectedDisputeSla ? (
                    <>
                      <div>SLA {selectedDisputeSla.successRate}%</div>
                      <div>latency {selectedDisputeSla.averageLatencyMs}ms</div>
                      <div>score {selectedDisputeSla.newScore}</div>
                    </>
                  ) : (
                    <div>No matching SLA summary.</div>
                  )}
                </div>
                <form
                  action={`/api/agent-marketplace/ops/disputes/${selectedDispute.id}`}
                  method="post"
                  className="space-y-3 border-t border-[#F0F0F0] pt-3"
                >
                  <input type="hidden" name="redirectTo" value={`/v2/marketplace?dispute=${selectedDispute.id}`} />
                  <div className="text-[10px] font-bold tracking-[0.1em] text-[#888]">UPDATE DISPUTE</div>
                  <label className="block space-y-1">
                    <span className="block text-[10px] text-[#666]">status</span>
                    <select
                      name="status"
                      defaultValue={selectedDispute.status}
                      className="w-full border border-[#D0D0D0] bg-white px-2 py-2 text-[11px]"
                    >
                      {disputeStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="block text-[10px] text-[#666]">reviewed by</span>
                    <input
                      type="text"
                      name="reviewedBy"
                      defaultValue={selectedDispute.reviewedBy ?? ''}
                      className="w-full border border-[#D0D0D0] bg-white px-2 py-2 text-[11px]"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="block text-[10px] text-[#666]">reviewer note</span>
                    <textarea
                      name="reviewerNote"
                      defaultValue={selectedDispute.reviewerNote ?? ''}
                      rows={4}
                      className="w-full border border-[#D0D0D0] bg-white px-2 py-2 text-[11px]"
                    />
                  </label>
                  <button
                    type="submit"
                    className="border border-[#8B0000] bg-[#D40000] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                  >
                    Save Review
                  </button>
                </form>
                <div className="space-y-2 border-t border-[#F0F0F0] pt-3">
                  <div className="text-[10px] font-bold tracking-[0.1em] text-[#888]">REVIEW HISTORY</div>
                  {selectedDispute.history && selectedDispute.history.length > 0 ? (
                    <div className="border border-[#E8E8E8] bg-[#FAFAFA]">
                      {selectedDispute.history.map((entry) => (
                        <div
                          key={`${entry.changedAt}-${entry.fromStatus}-${entry.toStatus}`}
                          className="grid gap-1 border-b border-[#E8E8E8] px-3 py-2 text-[10px] last:border-b-0"
                        >
                          <div className="font-semibold text-[#333]">
                            {entry.fromStatus} → {entry.toStatus}
                          </div>
                          <div className="text-[#666]">{entry.changedAt}</div>
                          <div className="text-[#666]">reviewed by: {entry.reviewedBy ?? 'none'}</div>
                          <div className="text-[#666]">note: {entry.reviewerNote ?? 'none'}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10px] italic text-[#999]">No review history recorded yet.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="px-4 py-5 text-[11px] italic text-[#999]">No dispute selected.</div>
            )}
          </div>

          <div className="border border-[#D0D0D0] bg-white">
            <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
              LAST BATCH DETAIL
            </div>
            {selectedBatch === null ? (
              <div className="px-4 py-5 text-[11px] italic text-[#999]">
                No reputation batch has been published yet.
              </div>
            ) : (
              <div className="space-y-2 px-4 py-3 text-[11px]">
                <div><span className="text-[#888]">status:</span> <span className="font-semibold uppercase text-[#D40000]">{selectedBatch.status}</span></div>
                <div><span className="text-[#888]">published:</span> {selectedBatch.publishedAt}</div>
                <div><span className="text-[#888]">window:</span> {selectedBatch.window.fromIso} → {selectedBatch.window.toIso}</div>
                <div><span className="text-[#888]">batch hash:</span> {selectedBatch.batchHash ?? 'N/A'}</div>
                <div><span className="text-[#888]">tx hash:</span> {selectedBatch.txHash ?? 'N/A'}</div>
                <div><span className="text-[#888]">error:</span> {selectedBatch.error ?? 'none'}</div>
              </div>
            )}
          </div>
        </section>

        <section className="px-6 pb-6">
          <div className="mb-3 border-b border-[#E8E8E8] pb-2 text-[9px] font-bold tracking-[0.12em] text-[#888]">
            LAST BATCH HISTORY
          </div>
          {summary.batchHistory.length === 0 ? (
            <div className="border border-[#D0D0D0] bg-white px-4 py-5 text-[11px] italic text-[#999]">
              No batch history recorded yet.
            </div>
          ) : (
            <div className="border border-[#D0D0D0] bg-white">
              {summary.batchHistory.slice(0, 5).map((batch) => (
                <a
                  key={`${batch.publishedAt}-${batch.batchHash ?? batch.error ?? 'batch'}`}
                  href={`/v2/marketplace?${new URLSearchParams({
                    ...(selectedDispute ? { dispute: selectedDispute.id } : {}),
                    batch: batch.publishedAt,
                  }).toString()}`}
                  className="grid gap-1 border-b border-[#F0F0F0] px-4 py-3 text-[11px] last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold uppercase text-[#D40000]">{batch.status}</span>
                    <span className="text-[#D0D0D0]">·</span>
                    <span className="text-[#AAA]">{batch.publishedAt}</span>
                  </div>
                  <div className="text-[#555]">
                    window {batch.window.fromIso} → {batch.window.toIso}
                  </div>
                  <div className="text-[#555]">batch hash: {batch.batchHash ?? 'N/A'}</div>
                  <div className="text-[#555]">
                    {batch.txHash ? `tx hash: ${batch.txHash}` : `error: ${batch.error ?? 'none'}`}
                  </div>
                </a>
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
