'use client';

import { useState, useCallback } from 'react';
import {
  connectWallet,
  getTokenInfo,
  approveToken,
  waitForTx,
  signPaymentAuthorization,
  executePayment,
  type PaymentRequirements,
  type SettlementResult,
} from '@/lib/x402-buyer';

const FONT = "'IBM Plex Mono', monospace";
const OPERATOR_API_URL =
  process.env.NEXT_PUBLIC_OPERATOR_API_URL ?? 'http://localhost:3002';
const SEPOLIA_CHAIN_ID = 11155111;

export interface PurchaseModalProps {
  agentId: string;
  agentName: string;
  endpoint: string; // e.g. '/api/marketplace/sequencer-health'
  onClose: () => void;
}

type Step = 'connect' | 'requirements' | 'balance' | 'sign' | 'result';

interface StepState {
  step: Step;
  account?: string;
  chainId?: number;
  requirements?: PaymentRequirements;
  balance?: bigint;
  allowance?: bigint;
  needsApprove?: boolean;
  result?: SettlementResult;
  error?: string;
  loading?: boolean;
}

function formatTON(weiStr: string): string {
  try {
    const wei = BigInt(weiStr);
    return `${(Number(wei) / 1e18).toFixed(4)} TON`;
  } catch {
    return weiStr;
  }
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const RED = '#D40000';
const DARK_RED = '#8B0000';
const GREEN = '#007A00';
const BLUE = '#0055AA';

interface ButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}

function Btn({ onClick, disabled, children, variant = 'primary' }: ButtonProps) {
  const [hover, setHover] = useState(false);
  const isPrimary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: FONT,
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.1em',
        padding: '8px 20px',
        border: isPrimary ? 'none' : `1px solid ${BLUE}`,
        background: isPrimary ? (hover && !disabled ? DARK_RED : RED) : (hover ? BLUE : 'transparent'),
        color: isPrimary ? 'white' : (hover ? 'white' : BLUE),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 150ms',
      }}
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '10px', fontFamily: FONT }}>
      <span style={{ color: '#707070' }}>{label}</span>
      <span style={{ color: '#0A0A0A', fontWeight: 600, maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 8px',
      background: color + '22',
      color,
      fontFamily: FONT,
      fontSize: '9px',
      fontWeight: 700,
      letterSpacing: '0.08em',
      border: `1px solid ${color}44`,
    }}>
      {label.toUpperCase()}
    </span>
  );
}

export default function PurchaseModal({ agentName, endpoint, onClose }: PurchaseModalProps) {
  const [state, setState] = useState<StepState>({ step: 'connect' });

  const fullEndpoint = `${OPERATOR_API_URL}${endpoint}`;

  const setLoading = (loading: boolean) =>
    setState((prev) => ({ ...prev, loading, error: loading ? undefined : prev.error }));

  const setError = (error: string) =>
    setState((prev) => ({ ...prev, loading: false, error }));

  // Step 1: Connect wallet
  const handleConnect = useCallback(async () => {
    setLoading(true);
    try {
      const { account, chainId } = await connectWallet(SEPOLIA_CHAIN_ID);
      setState((prev) => ({ ...prev, step: 'requirements', account, chainId, loading: false }));
      // Immediately fetch 402 requirements
      handleFetchRequirements(account);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 2: Fetch 402 requirements
  const handleFetchRequirements = useCallback(async (account?: string) => {
    setState((prev) => ({ ...prev, loading: true, step: 'requirements', error: undefined }));
    try {
      const res = await fetch(fullEndpoint, { method: 'GET' });
      if (res.status !== 402) {
        throw new Error(`Expected 402 response, got ${res.status}`);
      }
      const body = await res.json();
      const requirements: PaymentRequirements = body;
      setState((prev) => ({
        ...prev,
        requirements,
        step: 'balance',
        loading: false,
      }));
      handleCheckBalance(account ?? state.account!, requirements);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch payment requirements');
    }
  }, [fullEndpoint, state.account]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 3: Check balance
  const handleCheckBalance = useCallback(async (account: string, requirements: PaymentRequirements) => {
    setState((prev) => ({ ...prev, loading: true, step: 'balance', error: undefined }));
    try {
      const { balance, allowance } = await getTokenInfo({
        account,
        tokenAddress: requirements.asset,
        spenderAddress: requirements.facilitator.spender,
      });
      const amountNeeded = BigInt(requirements.amount);
      setState((prev) => ({
        ...prev,
        balance,
        allowance,
        needsApprove: allowance < amountNeeded,
        loading: false,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check token balance');
    }
  }, []);

  // Step 3b: Approve
  const handleApprove = useCallback(async () => {
    if (!state.account || !state.requirements) return;
    setLoading(true);
    try {
      const txHash = await approveToken({
        account: state.account,
        tokenAddress: state.requirements.asset,
        spenderAddress: state.requirements.facilitator.spender,
        amount: BigInt(state.requirements.amount),
      });
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      await waitForTx(txHash);
      // Re-check balance
      await handleCheckBalance(state.account, state.requirements);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    }
  }, [state.account, state.requirements, handleCheckBalance]);

  // Step 4: Sign & Pay
  const handleSignAndPay = useCallback(async () => {
    if (!state.account || !state.requirements) return;
    setState((prev) => ({ ...prev, loading: true, step: 'sign', error: undefined }));
    try {
      const paymentHeader = await signPaymentAuthorization({
        account: state.account,
        paymentRequirements: state.requirements,
      });
      const result = await executePayment({ endpoint: fullEndpoint, paymentHeader });
      setState((prev) => ({ ...prev, step: 'result', result, loading: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
      setState((prev) => ({ ...prev, step: 'balance' }));
    }
  }, [state.account, state.requirements, fullEndpoint]);

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1001,
        width: '480px',
        maxWidth: '95vw',
        background: '#FFFFFF',
        border: '1px solid #D0D0D0',
        fontFamily: FONT,
      }}>
        {/* Header */}
        <div style={{
          background: RED,
          color: 'white',
          padding: '10px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em' }}>
            BUY — {agentName.toUpperCase()}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: 'white',
              fontSize: '16px', cursor: 'pointer', fontFamily: FONT, lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Step Indicator */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #D0D0D0',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.1em',
        }}>
          {(['connect', 'requirements', 'balance', 'sign', 'result'] as Step[]).map((s, i) => {
            const steps: Step[] = ['connect', 'requirements', 'balance', 'sign', 'result'];
            const currentIdx = steps.indexOf(state.step);
            const stepIdx = i;
            const isCurrent = state.step === s;
            const isDone = stepIdx < currentIdx;
            return (
              <div key={s} style={{
                flex: 1,
                padding: '6px 4px',
                textAlign: 'center',
                color: isCurrent ? RED : isDone ? GREEN : '#A0A0A0',
                borderBottom: isCurrent ? `2px solid ${RED}` : 'none',
                background: isCurrent ? '#FFF5F5' : 'transparent',
              }}>
                {s.toUpperCase()}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 16px', minHeight: '180px' }}>
          {state.error && (
            <div style={{
              padding: '8px 12px',
              background: '#FFF0F0',
              border: '1px solid #FFC0C0',
              color: RED,
              fontSize: '10px',
              marginBottom: '14px',
            }}>
              {state.error}
            </div>
          )}

          {/* Step: Connect */}
          {state.step === 'connect' && (
            <div>
              <p style={{ fontSize: '10px', color: '#707070', marginBottom: '16px' }}>
                Connect MetaMask to purchase access to this agent service via x402 TON payment on Sepolia.
              </p>
              <Row label="Endpoint" value={endpoint} />
              <div style={{ marginTop: '20px' }}>
                <Btn onClick={handleConnect} disabled={state.loading}>
                  {state.loading ? 'CONNECTING...' : 'CONNECT METAMASK'}
                </Btn>
              </div>
            </div>
          )}

          {/* Step: Requirements (loading) */}
          {state.step === 'requirements' && (
            <div>
              <p style={{ fontSize: '10px', color: '#A0A0A0' }}>
                {state.loading ? 'Fetching payment requirements...' : 'Payment requirements loaded.'}
              </p>
            </div>
          )}

          {/* Step: Balance */}
          {state.step === 'balance' && state.requirements && (
            <div>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '9px', color: '#707070', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '8px' }}>
                  PAYMENT REQUIREMENTS
                </div>
                <Row label="Asset" value={shortAddr(state.requirements.asset)} />
                <Row label="Amount" value={formatTON(state.requirements.amount)} />
                <Row label="Merchant" value={shortAddr(state.requirements.merchant)} />
                <Row label="Spender" value={shortAddr(state.requirements.facilitator.spender)} />
                <Row label="Resource" value={state.requirements.resource} />
              </div>

              {state.loading ? (
                <p style={{ fontSize: '10px', color: '#A0A0A0' }}>Checking balance...</p>
              ) : (
                <>
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '9px', color: '#707070', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '8px' }}>
                      YOUR BALANCE
                    </div>
                    <Row label="TON Balance" value={state.balance !== undefined ? formatTON(state.balance.toString()) : '—'} />
                    <Row label="Allowance" value={state.allowance !== undefined ? formatTON(state.allowance.toString()) : '—'} />
                    <Row
                      label="Approval Status"
                      value={state.needsApprove
                        ? <StatusBadge label="approval needed" color={RED} />
                        : <StatusBadge label="approved" color={GREEN} />
                      }
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {state.needsApprove ? (
                      <Btn onClick={handleApprove}>APPROVE TON</Btn>
                    ) : (
                      <Btn onClick={handleSignAndPay}>SIGN &amp; PAY</Btn>
                    )}
                    <Btn variant="secondary" onClick={onClose}>CANCEL</Btn>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step: Sign */}
          {state.step === 'sign' && (
            <div>
              <p style={{ fontSize: '10px', color: '#707070', marginBottom: '12px' }}>
                {state.loading ? 'Awaiting MetaMask signature...' : 'Executing payment...'}
              </p>
              <p style={{ fontSize: '9px', color: '#A0A0A0' }}>
                Check your MetaMask wallet to sign the EIP-712 payment authorization.
              </p>
            </div>
          )}

          {/* Step: Result */}
          {state.step === 'result' && state.result && (
            <div>
              {state.result.success ? (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <StatusBadge label="payment successful" color={GREEN} />
                  </div>
                  {state.result.settlementId && (
                    <Row label="Settlement ID" value={state.result.settlementId} />
                  )}
                  {state.result.txHash && (
                    <Row label="Tx Hash" value={shortAddr(state.result.txHash)} />
                  )}
                  {state.result.status && (
                    <Row label="Status" value={<StatusBadge label={state.result.status} color={GREEN} />} />
                  )}
                </>
              ) : (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <StatusBadge label="payment failed" color={RED} />
                  </div>
                  <p style={{ fontSize: '10px', color: RED }}>{state.result.error ?? 'Unknown error'}</p>
                </>
              )}
              <div style={{ marginTop: '20px' }}>
                <Btn onClick={onClose}>{state.result.success ? 'DONE' : 'CLOSE'}</Btn>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid #E8E8E8',
          padding: '8px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '9px',
          color: '#A0A0A0',
        }}>
          <span>x402 TON · Sepolia</span>
          {state.account && <span>Wallet: {shortAddr(state.account)}</span>}
        </div>
      </div>
    </>
  );
}
