import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

// Mock window.location
delete (window as Partial<Window>).location;
window.location = { ...window.location, href: '' } as Location;

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mocks
    global.fetch = vi.fn();
    // Reset window.ethereum
    delete (window as Partial<Window>).ethereum;
  });

  describe('UI States', () => {
    it('renders initial idle state with Connect Wallet button', () => {
      render(<LoginPage />);
      expect(screen.getByText('SIWE AUTHENTICATION')).toBeInTheDocument();
      expect(screen.getByText('Sign in with your Ethereum wallet')).toBeInTheDocument();
      expect(screen.getByText('CONNECT WALLET')).toBeInTheDocument();
      expect(screen.getByText('Connect your Ethereum wallet to sign in.')).toBeInTheDocument();
    });

    it('displays error message when MetaMask is not detected', async () => {
      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('MetaMask not detected. Please install MetaMask.')).toBeInTheDocument();
        expect(screen.getByText('ERROR')).toBeInTheDocument();
      });
    });

    it('shows connecting state message', async () => {
      const mockEthereum = {
        request: vi.fn(() => new Promise(() => {})), // Never resolves
      };
      (window as any).ethereum = mockEthereum;

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Connecting to wallet...')).toBeInTheDocument();
      });
    });

    it('shows signing state after accounts are requested', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress]) // eth_requestAccounts
          .mockImplementationOnce(() => new Promise(() => {})), // personal_sign - never resolves
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nonce: 'test-nonce-123' }),
      });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Sign the message to authenticate...')).toBeInTheDocument();
      });
    });

    it('shows verifying state after signature', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockSignature = '0x' + 'a'.repeat(130);
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress]) // eth_requestAccounts
          .mockResolvedValueOnce(mockSignature) // personal_sign
          .mockImplementationOnce(() => new Promise(() => {})), // verify fetch - never resolves
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'test-nonce-123' }),
        })
        .mockImplementationOnce(() => new Promise(() => {})); // verify - never resolves

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Verifying signature...')).toBeInTheDocument();
      });
    });
  });

  describe('MetaMask Connection Flow', () => {
    it('successfully completes auth flow and redirects to default path', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockSignature = '0x' + 'a'.repeat(130);
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockResolvedValueOnce(mockSignature),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'test-nonce-abc' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true }),
        });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Authentication successful. Redirecting...')).toBeInTheDocument();
      });

      // Wait for redirect timeout
      await waitFor(
        () => {
          expect(window.location.href).toBe('/v2/marketplace');
        },
        { timeout: 1000 }
      );
    });

    it('redirects to callbackUrl when provided in query params', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockSignature = '0x' + 'a'.repeat(130);
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockResolvedValueOnce(mockSignature),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'test-nonce-xyz' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true }),
        });

      // Mock window.location.search with callbackUrl
      Object.defineProperty(window.location, 'search', {
        value: '?callbackUrl=/admin/pricing',
        configurable: true,
      });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(
        () => {
          expect(window.location.href).toBe('/admin/pricing');
        },
        { timeout: 1000 }
      );
    });

    it('ignores unsafe callbackUrl and uses default', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockSignature = '0x' + 'a'.repeat(130);
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockResolvedValueOnce(mockSignature),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'test-nonce-safe' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true }),
        });

      // Mock unsafe URL (absolute path)
      Object.defineProperty(window.location, 'search', {
        value: '?callbackUrl=https://evil.com/phishing',
        configurable: true,
      });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(
        () => {
          expect(window.location.href).toBe('/v2/marketplace');
        },
        { timeout: 1000 }
      );
    });
  });

  describe('Error Handling', () => {
    it('handles wallet connection rejection', async () => {
      const mockEthereum = {
        request: vi.fn().mockRejectedValueOnce(new Error('User rejected the request')),
      };
      (window as any).ethereum = mockEthereum;

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Wallet connection rejected.')).toBeInTheDocument();
      });
    });

    it('handles nonce request failure', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockEthereum = {
        request: vi.fn().mockResolvedValueOnce([mockAddress]),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Server error' }),
      });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText(/Failed to get nonce/)).toBeInTheDocument();
      });
    });

    it('handles message signing rejection', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockRejectedValueOnce(new Error('User denied message signature')),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nonce: 'test-nonce' }),
      });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Message signing rejected.')).toBeInTheDocument();
      });
    });

    it('handles 403 Unauthorized (not admin)', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockSignature = '0x' + 'a'.repeat(130);
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockResolvedValueOnce(mockSignature),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'test-nonce' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({ error: 'Not authorized' }),
        });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Not authorized. Only admin wallet can sign in.')).toBeInTheDocument();
      });
    });

    it('handles generic verification failure', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockSignature = '0x' + 'a'.repeat(130);
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockResolvedValueOnce(mockSignature),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'test-nonce' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Invalid signature' }),
        });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText(/Verification failed/)).toBeInTheDocument();
      });
    });

    it('handles invalid address format from wallet', async () => {
      const mockEthereum = {
        request: vi.fn().mockResolvedValueOnce(['not-a-valid-address']),
      };
      (window as any).ethereum = mockEthereum;

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('Invalid wallet address format.')).toBeInTheDocument();
      });
    });

    it('handles no accounts found', async () => {
      const mockEthereum = {
        request: vi.fn().mockResolvedValueOnce([]),
      };
      (window as any).ethereum = mockEthereum;

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('No accounts found in MetaMask.')).toBeInTheDocument();
      });
    });
  });

  describe('Button States', () => {
    it('shows RETRY button in error state', async () => {
      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('RETRY')).toBeInTheDocument();
      });
    });

    it('disables button during connecting state', async () => {
      const mockEthereum = {
        request: vi.fn(() => new Promise(() => {})), // Never resolves
      };
      (window as any).ethereum = mockEthereum;

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('CONNECTING...')).toBeDisabled();
      });
    });

    it('disables button during signing state', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockImplementationOnce(() => new Promise(() => {})), // Never resolves
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nonce: 'test-nonce' }),
      });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('SIGNING...')).toBeDisabled();
      });
    });

    it('disables button during verifying state', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockSignature = '0x' + 'a'.repeat(130);
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockResolvedValueOnce(mockSignature),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'test-nonce' }),
        })
        .mockImplementationOnce(() => new Promise(() => {})); // Never resolves

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        expect(screen.getByText('VERIFYING...')).toBeDisabled();
      });
    });
  });

  describe('SIWE Message Format', () => {
    it('constructs correct SIWE message', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockSignature = '0x' + 'a'.repeat(130);
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockResolvedValueOnce(mockSignature),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'abc123def456' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true }),
        });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        // Check that personal_sign was called with proper message format
        const personalSignCall = mockEthereum.request.mock.calls.find(
          (call) => (call[0] as { method?: string }).method === 'personal_sign'
        );
        expect(personalSignCall).toBeDefined();
        const message = (personalSignCall![0] as { params?: unknown[] }).params?.[0] as string;
        expect(message).toContain('wallet.sentinai.io wants you to sign in');
        expect(message).toContain(mockAddress);
        expect(message).toContain('Version: 1');
        expect(message).toContain('Chain ID: 1');
        expect(message).toContain('Nonce: abc123def456');
        expect(message).toContain('Issued At:');
      });
    });
  });

  describe('API Calls', () => {
    it('sends correct nonce request with address', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockEthereum = {
        request: vi.fn(() => Promise.reject(new Error('Test error'))), // Fail after getting nonce
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Test' }),
      });

      render(<LoginPage />);

      // Mock eth_requestAccounts to succeed but catch error in nonce fetch
      mockEthereum.request = vi.fn().mockResolvedValueOnce([mockAddress]);
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nonce: 'test' }),
      });

      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        const nonceCall = (global.fetch as any).mock.calls[0];
        expect(nonceCall[0]).toContain('/api/auth/siwe/nonce');
        expect(nonceCall[0]).toContain(`address=${mockAddress}`);
        expect(nonceCall[1].method).toBe('GET');
      });
    });

    it('sends correct verify request', async () => {
      const mockAddress = '0x1234567890123456789012345678901234567890';
      const mockSignature = '0x' + 'a'.repeat(130);
      const mockEthereum = {
        request: vi
          .fn()
          .mockResolvedValueOnce([mockAddress])
          .mockResolvedValueOnce(mockSignature),
      };
      (window as any).ethereum = mockEthereum;

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'test-nonce-verify' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true }),
        });

      render(<LoginPage />);
      const connectButton = screen.getByText('CONNECT WALLET');
      fireEvent.click(connectButton);

      await waitFor(() => {
        const verifyCall = (global.fetch as any).mock.calls[1];
        expect(verifyCall[0]).toBe('/api/auth/siwe/verify');
        expect(verifyCall[1].method).toBe('POST');
        expect(verifyCall[1].headers['Content-Type']).toBe('application/json');

        const body = JSON.parse(verifyCall[1].body);
        expect(body.address).toBe(mockAddress);
        expect(body.signature).toBe(mockSignature);
        expect(body.message).toContain(mockAddress);
        expect(body.message).toContain('test-nonce-verify');
      });
    });
  });
});
