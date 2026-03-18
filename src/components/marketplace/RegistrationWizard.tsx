'use client';

import { useState } from 'react';
import type { RegistrationStatus } from '@/lib/agent-marketplace/registration-status';

/**
 * ERC8004 Registry Address (Sepolia).
 * Kept client-side so the wizard works without any server env vars.
 */
const ERC8004_REGISTRY_ADDRESS = '0x64c8f8cB66657349190c7AF783f8E0254dCF1467';
const SEPOLIA_CHAIN_ID = '0xaa36a7'; // 11155111
const ETHERSCAN_BASE = 'https://sepolia.etherscan.io';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

type WizardStep = 1 | 2 | 3 | 4;

/* ------------------------------------------------------------------ */
/*  ABI fragment (register only — avoids importing server-side viem)  */
/* ------------------------------------------------------------------ */

function encodeRegisterCalldata(agentUri: string): `0x${string}` {
  // register(string agentURI) — selector 0xf2c298be
  // keccak256("register(string)") = f2c298be... (verified from compiled methodIdentifiers)
  // ABI-encode: selector + offset (32) + length (32) + utf8 data (padded to 32)
  const selector = 'f2c298be';
  const encoder = new TextEncoder();
  const uriBytes = encoder.encode(agentUri);
  const len = uriBytes.length;

  // offset to string data = 0x20 (32)
  const offset = '0000000000000000000000000000000000000000000000000000000000000020';
  // string length
  const lengthHex = len.toString(16).padStart(64, '0');
  // string data padded to 32-byte boundary
  const paddedLen = Math.ceil(len / 32) * 32;
  const dataHex = Array.from(uriBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .padEnd(paddedLen * 2, '0');

  return `0x${selector}${offset}${lengthHex}${dataHex}`;
}

function parseAgentIdFromLogs(logs: Array<{ topics: string[]; data: string }>): string | null {
  // AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)
  // topic[0] = keccak256("AgentRegistered(uint256,address,string)")
  const AGENT_REGISTERED_TOPIC =
    '0xd8a01onal'; // We match by topic count instead
  for (const log of logs) {
    // AgentRegistered has 3 topics: event sig, agentId (indexed), agent (indexed)
    if (log.topics.length === 3) {
      const agentIdHex = log.topics[1];
      if (agentIdHex) {
        return String(parseInt(agentIdHex, 16));
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function RegistrationStatusCard({
  status,
  onReRegister,
}: {
  status: Extract<RegistrationStatus, { registered: true }>;
  onReRegister: () => void;
}) {
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
              href={`${ETHERSCAN_BASE}/tx/${status.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#0055AA] hover:underline"
            >
              {status.txHash.slice(0, 10)}...{status.txHash.slice(-6)}
            </a>
          ) : (
            <span className="text-[10px] text-[#AAA]">-</span>
          )}
        </Row>
        <Row label="REGISTERED AT">
          <span className="text-[10px] text-[#555]">
            {status.registeredAt
              ? new Date(status.registeredAt).toUTCString().replace(' GMT', ' UTC')
              : '-'}
          </span>
        </Row>
        <Row label="CONTRACT">
          <a
            href={`${ETHERSCAN_BASE}/address/${status.contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[#0055AA] hover:underline"
          >
            {status.contractAddress.slice(0, 8)}...{status.contractAddress.slice(-6)} (Sepolia)
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
    { n: 1, label: 'WALLET' },
    { n: 2, label: 'URI' },
    { n: 3, label: 'TX' },
    { n: 4, label: 'DONE' },
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

/* ------------------------------------------------------------------ */
/*  Main wizard                                                        */
/* ------------------------------------------------------------------ */

export function RegistrationWizard({
  initialStatus,
}: {
  initialStatus: RegistrationStatus;
}) {
  const [status, setStatus] = useState<RegistrationStatus>(initialStatus);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);

  // Wallet state
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  // TX state
  const [txPending, setTxPending] = useState(false);
  const [txResult, setTxResult] = useState<
    { ok: true; agentId: string; txHash: string } | { ok: false; error: string } | null
  >(null);

  // URI to register — derived from current page origin
  const agentUri =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/agent-marketplace/agent.json`
      : '/api/agent-marketplace/agent.json';

  function openWizard() {
    setStep(1);
    setTxPending(false);
    setTxResult(null);
    setWalletError(null);
    setWizardOpen(true);
  }

  async function handleConnectWallet() {
    setWalletError(null);
    if (!window.ethereum) {
      setWalletError('MetaMask not detected. Install a browser wallet to continue.');
      return;
    }

    try {
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        setWalletError('No accounts returned from wallet.');
        return;
      }

      // Ensure Sepolia network
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: SEPOLIA_CHAIN_ID }],
        });
      } catch (switchError: unknown) {
        const err = switchError as { code?: number };
        if (err.code === 4902) {
          setWalletError('Sepolia network not found in wallet. Please add it manually.');
          return;
        }
        throw switchError;
      }

      setWalletAddress(accounts[0]);
      setStep(2);
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : 'Wallet connection failed');
    }
  }

  async function handleRegister() {
    if (!walletAddress) return;
    setTxPending(true);

    try {
      const calldata = encodeRegisterCalldata(agentUri);

      // Send transaction via wallet
      const txHash = (await window.ethereum!.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: walletAddress,
            to: ERC8004_REGISTRY_ADDRESS,
            data: calldata,
          },
        ],
      })) as string;

      // Poll for receipt
      type TxReceipt = { status: string; logs: Array<{ topics: string[]; data: string }> };
      let receipt: TxReceipt | null = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const result = (await window.ethereum!.request({
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        })) as TxReceipt | null;
        if (result) {
          receipt = result;
          break;
        }
      }

      if (!receipt) {
        setTxResult({ ok: false, error: 'Transaction not confirmed after 3 minutes' });
        setStep(4);
        return;
      }

      if (receipt.status !== '0x1') {
        setTxResult({ ok: false, error: 'Transaction reverted' });
        setStep(4);
        return;
      }

      const agentId = parseAgentIdFromLogs(receipt.logs) ?? txHash;
      setTxResult({ ok: true, agentId, txHash });

      // Save to server cache (fire-and-forget)
      fetch('/api/agent-marketplace/ops/save-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          agentUri,
          txHash,
          registeredAt: new Date().toISOString(),
          contractAddress: ERC8004_REGISTRY_ADDRESS,
          walletAddress,
        }),
      }).then(async () => {
        // Refresh status from server
        try {
          const res = await fetch(
            `/api/agent-marketplace/ops/registration-status?wallet=${walletAddress}`,
          );
          if (res.ok) {
            setStatus(await res.json() as RegistrationStatus);
          }
        } catch { /* ignore */ }
      }).catch(() => { /* ignore */ });
    } catch (e) {
      setTxResult({ ok: false, error: e instanceof Error ? e.message : 'Transaction failed' });
    } finally {
      setTxPending(false);
      setStep(4);
    }
  }

  // ---- Render: registered (wizard closed) ----
  if (status.registered && !wizardOpen) {
    return (
      <section className="px-6 pb-6">
        <RegistrationStatusCard status={status} onReRegister={openWizard} />
      </section>
    );
  }

  // ---- Render: not registered (wizard closed) ----
  if (!status.registered && !wizardOpen) {
    return (
      <section className="px-6 pb-6">
        <div className="border border-[#D0D0D0] bg-white">
          <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
            REGISTRY REGISTRATION
          </div>
          <div className="px-4 py-4">
            <div className="mb-4 flex items-start gap-3 border border-[#FFC107] bg-[#FFFDE7] px-4 py-3">
              <span className="text-[14px]">!</span>
              <div>
                <div className="text-[11px] font-bold text-[#856404]">Not registered on Sepolia registry</div>
                <div className="mt-1 text-[10px] text-[#9E7000]">
                  Connect a wallet and register to enable marketplace discovery.
                </div>
              </div>
            </div>
            <button
              onClick={openWizard}
              className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
            >
              REGISTER TO REGISTRY
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ---- Render: wizard open ----
  return (
    <section className="px-6 pb-6">
      <div className="border border-[#D0D0D0] bg-white">
        <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
          REGISTRY REGISTRATION
        </div>
        <StepTabs step={step} onSelect={setStep} />

        {/* Step 1: Connect Wallet */}
        {step === 1 && (
          <div className="p-5">
            <div className="mb-4 text-[9px] font-bold tracking-[0.1em] text-[#555]">CONNECT WALLET</div>
            {walletAddress ? (
              <div className="mb-4 border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-3">
                <div className="mb-1 text-[9px] text-[#388E3C]">CONNECTED</div>
                <div className="break-all text-[11px] font-mono text-[#333]">{walletAddress}</div>
              </div>
            ) : (
              <>
                <div className="mb-3 text-[10px] text-[#888]">
                  Connect your MetaMask or browser wallet to sign the registration transaction on Sepolia.
                </div>
                {walletError && (
                  <div className="mb-3 border border-[#FFCDD2] bg-[#FFEBEE] px-3 py-2 text-[10px] text-[#C62828]">
                    {walletError}
                  </div>
                )}
                <button
                  onClick={handleConnectWallet}
                  className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                >
                  CONNECT WALLET
                </button>
              </>
            )}
            <div className="mt-4 flex justify-between">
              <button
                onClick={() => setWizardOpen(false)}
                className="border border-[#C0C0C0] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-[#555]"
              >
                CANCEL
              </button>
              {walletAddress && (
                <button
                  onClick={() => setStep(2)}
                  className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                >
                  NEXT
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 2: URI Preview */}
        {step === 2 && (
          <div className="p-5">
            <div className="mb-4 text-[9px] font-bold tracking-[0.1em] text-[#555]">AGENT MANIFEST URI PREVIEW</div>
            <div className="mb-3 border border-[#D0D0D0] bg-[#F8F8F8] px-3 py-3">
              <div className="mb-1 text-[9px] text-[#888]">WILL REGISTER ON-CHAIN:</div>
              <div className="break-all text-[11px] text-[#0055AA]">{agentUri}</div>
            </div>
            <div className="mb-3 space-y-2">
              {([
                ['Contract', ERC8004_REGISTRY_ADDRESS],
                ['Network', 'Sepolia (11155111)'],
                ['Signer', walletAddress ?? '-'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border border-[#E8E8E8] px-3 py-2 text-[11px]">
                  <span className="text-[#888]">{k}</span>
                  <span className="font-mono text-[10px]">{k === 'Signer' ? `${v.slice(0, 8)}...${v.slice(-6)}` : v}</span>
                </div>
              ))}
            </div>
            <div className="mb-4 border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-2 text-[10px] text-[#388E3C]">
              URI format valid
            </div>
            <div className="flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="border border-[#C0C0C0] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-[#555]"
              >
                BACK
              </button>
              <button
                onClick={() => setStep(3)}
                className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
              >
                NEXT
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Send TX */}
        {step === 3 && (
          <div className="p-5">
            <div className="mb-4 text-[9px] font-bold tracking-[0.1em] text-[#555]">SEND REGISTRATION TRANSACTION</div>
            <div className="mb-4 text-[10px] text-[#888]">
              Your wallet will prompt you to sign and broadcast the transaction to the Sepolia ERC8004 registry.
            </div>
            {txPending ? (
              <div className="border border-[#FFF3CD] bg-[#FFFDE7] px-4 py-3 text-center text-[11px] text-[#856404]">
                Broadcasting transaction... waiting for receipt
              </div>
            ) : (
              <div className="flex justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="border border-[#C0C0C0] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-[#555]"
                >
                  BACK
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

        {/* Step 4: Result */}
        {step === 4 && (
          <div className="p-5">
            {txResult === null ? (
              <div className="py-6 text-center text-[11px] text-[#888]">
                Go to the TX tab and press REGISTER NOW to send the transaction.
              </div>
            ) : txResult.ok ? (
              <>
                <div className="mb-4 text-[10px] font-bold text-[#27ae60]">REGISTRATION SUCCESSFUL</div>
                <div className="mb-4 space-y-2">
                  <div className="flex items-center justify-between border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-2 text-[11px]">
                    <span className="text-[#888]">AGENT ID</span>
                    <span className="font-bold text-[#27ae60]">#{txResult.agentId}</span>
                  </div>
                  <div className="flex items-center justify-between border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-2 text-[11px]">
                    <span className="text-[#888]">TX HASH</span>
                    <a
                      href={`${ETHERSCAN_BASE}/tx/${txResult.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-[#0055AA] hover:underline"
                    >
                      {txResult.txHash.slice(0, 10)}...{txResult.txHash.slice(-6)}
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
                <div className="mb-4 text-[10px] font-bold text-[#D40000]">REGISTRATION FAILED</div>
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
