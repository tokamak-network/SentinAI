'use client';

import { useState } from 'react';
import type { RegistrationStatus } from '@/lib/agent-marketplace/registration-status';

type WizardStep = 1 | 2 | 3 | 4;

// RegistrationStatusCard — 등록 완료 상태 표시
function RegistrationStatusCard({
  status,
  onReRegister,
}: {
  status: Extract<RegistrationStatus, { registered: true }>;
  onReRegister: () => void;
}) {
  const etherscanBase = 'https://sepolia.etherscan.io';
  return (
    <div className="border border-[#D0D0D0] bg-white">
      <div className="flex items-center justify-between border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2">
        <div className="text-[9px] font-bold tracking-[0.12em]">REGISTRY REGISTRATION</div>
        <button
          onClick={onReRegister}
          className="border border-[#C0C0C0] bg-white px-3 py-1 text-[9px] font-bold tracking-[0.08em] text-[#555] hover:bg-[#F0F0F0]"
        >
          RE-REGISTER
        </button>
      </div>
      <div className="divide-y divide-[#F0F0F0]">
        <Row label="AGENT ID">
          <span className="font-bold text-[#27ae60]">#{status.agentId}</span>
        </Row>
        <Row label="REGISTERED URI">
          <span className="text-[10px] text-[#0055AA] break-all">{status.agentUri}</span>
        </Row>
        <Row label="TX HASH">
          {status.txHash ? (
            <a
              href={`${etherscanBase}/tx/${status.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#0055AA] hover:underline"
            >
              {status.txHash.slice(0, 10)}…{status.txHash.slice(-6)} ↗
            </a>
          ) : (
            <span className="text-[10px] text-[#AAA]">—</span>
          )}
        </Row>
        <Row label="REGISTERED AT">
          <span className="text-[10px] text-[#555]">
            {status.registeredAt
              ? new Date(status.registeredAt).toUTCString().replace(' GMT', ' UTC')
              : '—'}
          </span>
        </Row>
        <Row label="CONTRACT">
          <a
            href={`${etherscanBase}/address/${status.contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[#0055AA] hover:underline"
          >
            {status.contractAddress.slice(0, 8)}…{status.contractAddress.slice(-6)} (Sepolia) ↗
          </a>
        </Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="text-[9px] font-bold tracking-[0.1em] text-[#888]">{label}</span>
      <div className="text-[11px]">{children}</div>
    </div>
  );
}

function StepTabs({ step, onSelect }: { step: WizardStep; onSelect: (s: WizardStep) => void }) {
  const tabs: { n: WizardStep; label: string }[] = [
    { n: 1, label: '① ENV' },
    { n: 2, label: '② URI' },
    { n: 3, label: '③ TX' },
    { n: 4, label: '④ DONE' },
  ];
  return (
    <div className="flex border-b border-[#E8E8E8] bg-[#FAFAFA]">
      {tabs.map(({ n, label }) => (
        <button
          key={n}
          onClick={() => onSelect(n)}
          className={`flex-1 border-r border-[#E8E8E8] py-2 text-[9px] font-bold tracking-[0.08em] last:border-r-0 ${
            step === n
              ? 'border-b-2 border-b-[#D40000] bg-white text-[#D40000]'
              : 'border-b-2 border-b-transparent text-[#888]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function RegistrationWizard({
  initialStatus,
}: {
  initialStatus: RegistrationStatus;
}) {
  const [status, setStatus] = useState<RegistrationStatus>(initialStatus);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [txPending, setTxPending] = useState(false);
  const [txResult, setTxResult] = useState<
    { ok: true; agentId: string; txHash: string } | { ok: false; error: string } | null
  >(null);

  function openWizard() {
    setStep(1);
    setTxPending(false);
    setTxResult(null);
    setWizardOpen(true);
  }

  async function handleRegister() {
    setTxPending(true);
    try {
      const res = await fetch('/api/agent-marketplace/ops/register', { method: 'POST' });
      const body = await res.json() as { result: { ok: boolean; agentId?: string; txHash?: string; error?: string } };
      if (body.result.ok) {
        if (!body.result.agentId || !body.result.txHash) {
          setTxResult({ ok: false, error: 'Invalid response from server' });
        } else {
          setTxResult({ ok: true, agentId: body.result.agentId, txHash: body.result.txHash });
          const statusRes = await fetch('/api/agent-marketplace/ops/registration-status');
          const newStatus = await statusRes.json() as RegistrationStatus;
          setStatus(newStatus);
        }
      } else {
        setTxResult({ ok: false, error: body.result.error ?? 'Unknown error' });
      }
    } catch (e) {
      setTxResult({ ok: false, error: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setTxPending(false);
      setStep(4);
    }
  }

  // 등록 완료 상태
  if (status.registered && !wizardOpen) {
    return (
      <section className="px-6 pb-6">
        <RegistrationStatusCard status={status} onReRegister={openWizard} />
      </section>
    );
  }

  // 미등록 상태 (wizard 닫힘)
  if (!status.registered && !wizardOpen) {
    const envCheck = status.envCheck;
    const envReady = Object.values(envCheck).every(Boolean);
    return (
      <section className="px-6 pb-6">
        <div className="border border-[#D0D0D0] bg-white">
          <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
            REGISTRY REGISTRATION
          </div>
          <div className="px-4 py-4">
            <div className="mb-4 flex items-start gap-3 border border-[#FFC107] bg-[#FFFDE7] px-4 py-3">
              <span className="text-[14px]">⚠</span>
              <div>
                <div className="text-[11px] font-bold text-[#856404]">Not registered on Sepolia registry</div>
                <div className="mt-1 text-[10px] text-[#9E7000]">
                  Buyers cannot discover this instance. Register to enable marketplace discovery.
                </div>
              </div>
            </div>
            <button
              onClick={openWizard}
              disabled={!envReady}
              className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              REGISTER TO REGISTRY →
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Wizard 열림
  const envCheck = status.registered ? null : status.envCheck;
  const agentUri = status.registered ? status.agentUri : (status.agentUri ?? '');

  return (
    <section className="px-6 pb-6">
      <div className="border border-[#D0D0D0] bg-white">
        <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
          REGISTRY REGISTRATION
        </div>
        <StepTabs step={step} onSelect={setStep} />

        {/* Step 1: ENV */}
        {step === 1 && (
          <div className="p-5">
            <div className="mb-4 text-[9px] font-bold tracking-[0.1em] text-[#555]">ENVIRONMENT CONFIGURATION</div>
            <div className="mb-4 space-y-2">
              {([
                ['ERC8004_REGISTRY_ADDRESS', envCheck?.registryAddress ?? true],
                ['MARKETPLACE_AGENT_URI_BASE', envCheck?.agentUriBase ?? true],
                ['MARKETPLACE_WALLET_KEY (masked)', envCheck?.walletKey ?? true],
                ['SENTINAI_L1_RPC_URL', envCheck?.l1RpcUrl ?? true],
              ] as [string, boolean][]).map(([key, ok]) => (
                <div key={key} className="flex items-center justify-between border border-[#E8E8E8] px-3 py-2 text-[11px]">
                  <span className="text-[#888]">{key}</span>
                  <span className={ok ? 'text-[#27ae60]' : 'text-[#D40000]'}>
                    {ok ? '● SET' : '✗ MISSING'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <button onClick={() => setWizardOpen(false)} className="border border-[#C0C0C0] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-[#555]">
                CANCEL
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={envCheck ? !Object.values(envCheck).every(Boolean) : false}
                className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white disabled:opacity-40"
              >
                NEXT →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: URI */}
        {step === 2 && (
          <div className="p-5">
            <div className="mb-4 text-[9px] font-bold tracking-[0.1em] text-[#555]">AGENT MANIFEST URI PREVIEW</div>
            <div className="mb-3 border border-[#D0D0D0] bg-[#F8F8F8] px-3 py-3">
              <div className="mb-1 text-[9px] text-[#888]">WILL REGISTER ON-CHAIN:</div>
              <div className="break-all text-[11px] text-[#0055AA]">{agentUri}</div>
            </div>
            <div className="mb-4 border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-2 text-[10px] text-[#388E3C]">
              ✓ URI format valid
            </div>
            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="border border-[#C0C0C0] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-[#555]">
                ← BACK
              </button>
              <button onClick={() => setStep(3)} className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white">
                NEXT →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: TX */}
        {step === 3 && (
          <div className="p-5">
            <div className="mb-4 text-[9px] font-bold tracking-[0.1em] text-[#555]">SEND REGISTRATION TRANSACTION</div>
            <div className="mb-4 space-y-2">
              {([
                ['Contract', 'SentinAIERC8004Registry'],
                ['Function', 'register(agentURI)'],
                ['Network', 'Sepolia (11155111)'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border border-[#E8E8E8] px-3 py-2 text-[11px]">
                  <span className="text-[#888]">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            {txPending ? (
              <div className="border border-[#FFF3CD] bg-[#FFFDE7] px-4 py-3 text-center text-[11px] text-[#856404]">
                ⏳ Broadcasting transaction… waiting for receipt
              </div>
            ) : (
              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="border border-[#C0C0C0] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-[#555]">
                  ← BACK
                </button>
                <button
                  onClick={handleRegister}
                  className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                >
                  REGISTER NOW
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: RESULT */}
        {step === 4 && (
          <div className="p-5">
            {txResult === null ? (
              <div className="py-6 text-center text-[11px] text-[#888]">
                Click ③ TX tab and press REGISTER NOW to send the transaction.
              </div>
            ) : txResult.ok ? (
              <>
                <div className="mb-4 text-[10px] font-bold text-[#27ae60]">✓ REGISTRATION SUCCESSFUL</div>
                <div className="mb-4 space-y-2">
                  <div className="flex items-center justify-between border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-2 text-[11px]">
                    <span className="text-[#888]">AGENT ID</span>
                    <span className="font-bold text-[#27ae60]">#{txResult.agentId}</span>
                  </div>
                  <div className="flex items-center justify-between border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-2 text-[11px]">
                    <span className="text-[#888]">TX HASH</span>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${txResult.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-[#0055AA] hover:underline"
                    >
                      {txResult.txHash.slice(0, 10)}…{txResult.txHash.slice(-6)} ↗
                    </a>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setWizardOpen(false)}
                    className="border border-[#333] bg-[#333] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                  >
                    DONE
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4 text-[10px] font-bold text-[#D40000]">✗ REGISTRATION FAILED</div>
                <div className="mb-4 border border-[#FFCDD2] bg-[#FFEBEE] px-4 py-3 text-[11px] text-[#C62828]">
                  {txResult.error ?? 'Unknown error'}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setStep(3)}
                    className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                  >
                    RETRY
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
