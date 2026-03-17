'use client';

import { useEffect, useState, useRef } from 'react';
import type { CatalogAgent, OpsBreakdown } from '@/types/marketplace';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface CatalogAgentWithScore extends CatalogAgent {
  opsScore: number;
  opsBreakdown: OpsBreakdown | null;
}

interface CreateFormData {
  name: string;
  description: string;
  status: 'active' | 'suspended' | 'probation';
  capabilities: string;
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#3b82f6'; // blue
  if (score >= 60) return '#10b981'; // green
  if (score >= 30) return '#f59e0b'; // yellow
  return '#ef4444'; // red
}

function getScoreBg(score: number): string {
  if (score >= 80) return '#dbeafe';
  if (score >= 60) return '#dcfce7';
  if (score >= 30) return '#fef3c7';
  return '#fee2e2';
}

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: '#dcfce7', text: '#15803d' },
  suspended: { bg: '#fee2e2', text: '#991b1b' },
  probation: { bg: '#fef3c7', text: '#92400e' },
};

export default function CatalogPage() {
  const [agents, setAgents] = useState<CatalogAgentWithScore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const deleteConfirmRef = useRef<{ id: string; name: string } | null>(null);

  const [formData, setFormData] = useState<CreateFormData>({
    name: '',
    description: '',
    status: 'active',
    capabilities: '',
  });

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/admin/catalog`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = (await res.json()) as { success: boolean; agents: CatalogAgentWithScore[] };
      setAgents(data.agents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.description.trim()) {
      setError('Name and description are required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const capabilities = formData.capabilities
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c);

      const res = await fetch(`${BASE_PATH}/api/admin/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim(),
          status: formData.status,
          capabilities,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { errors?: string[] };
        throw new Error(data.errors ? data.errors.join(', ') : 'Failed to create agent');
      }

      await fetchAgents();
      setShowAddForm(false);
      setFormData({ name: '', description: '', status: 'active', capabilities: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAgent = async (id: string) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${BASE_PATH}/api/admin/catalog/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete agent');

      await fetchAgents();
      deleteConfirmRef.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`${BASE_PATH}/api/admin/catalog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.status.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ padding: '0' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#111827' }}>
          Catalog Management
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
          Manage agents available in the marketplace ({agents.length} total
          {agents.length > 0 && `, avg score: ${Math.round(agents.reduce((s, a) => s + a.opsScore, 0) / agents.length)}`})
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: '20px',
            backgroundColor: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            color: '#991b1b',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {/* Search and Add button */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="Search by name or status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '14px',
          }}
        />
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: '500',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          + Add Agent
        </button>
      </div>

      {/* Add form modal */}
      {showAddForm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => !isSubmitting && setShowAddForm(false)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '24px',
              minWidth: '500px',
              maxWidth: '600px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 20px 0', color: '#111827' }}>
              Add New Agent
            </h2>

            <form onSubmit={handleAddAgent} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '4px', color: '#374151' }}>
                  Agent Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Scaling Agent v2"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '4px', color: '#374151' }}>
                  Description *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of the agent"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '13px',
                    minHeight: '80px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '4px', color: '#374151' }}>
                  Status *
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="probation">Probation</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '4px', color: '#374151' }}>
                  Capabilities (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.capabilities}
                  onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
                  placeholder="e.g., scaling, monitoring, cost-optimization"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    backgroundColor: '#3b82f6',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: '500',
                    fontSize: '14px',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: isSubmitting ? 0.6 : 1,
                  }}
                >
                  {isSubmitting ? 'Creating...' : 'Create Agent'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  disabled={isSubmitting}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    backgroundColor: '#f3f4f6',
                    color: '#374151',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontWeight: '500',
                    fontSize: '14px',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: isSubmitting ? 0.6 : 1,
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Agents Table */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading agents...
        </div>
      ) : filteredAgents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          No agents found. {agents.length === 0 && 'Click "Add Agent" to get started.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Name
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Ops Score
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  SLA
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Success Rate
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Operations
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Status
                </th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: '#374151', fontSize: '13px' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAgents.map((agent) => (
                <tr
                  key={agent.id}
                  style={{
                    borderBottom: '1px solid #e5e7eb',
                    backgroundColor: '#ffffff',
                    transition: 'background-color 200ms',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f9fafb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ffffff';
                  }}
                >
                  <td style={{ padding: '12px', color: '#111827', fontSize: '13px' }}>
                    <div style={{ fontWeight: '500' }}>{agent.name}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{agent.description}</div>
                  </td>
                  <td style={{ padding: '12px', color: '#111827', fontSize: '13px', minWidth: '120px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{
                          width: '60px',
                          height: '8px',
                          backgroundColor: '#f3f4f6',
                          borderRadius: '4px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${agent.opsScore}%`,
                            backgroundColor: getScoreColor(agent.opsScore),
                            transition: 'width 300ms ease',
                          }}
                        />
                      </div>
                      <span style={{
                        fontWeight: '600',
                        color: getScoreColor(agent.opsScore),
                        fontSize: '13px',
                      }}>
                        {agent.opsScore}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '12px', color: '#6b7280', fontSize: '12px' }}>
                    {agent.opsBreakdown?.slaScore ?? '-'}
                  </td>
                  <td style={{ padding: '12px', color: '#6b7280', fontSize: '12px' }}>
                    {agent.opsBreakdown ? `${(agent.opsBreakdown.successRate * 100).toFixed(1)}%` : '-'}
                  </td>
                  <td style={{ padding: '12px', color: '#6b7280', fontSize: '12px' }}>
                    {agent.opsBreakdown?.totalOperations ?? '-'}
                  </td>
                  <td style={{ padding: '12px', color: '#111827', fontSize: '13px' }}>
                    <select
                      value={agent.status}
                      onChange={(e) => handleStatusChange(agent.id, e.target.value)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: statusColors[agent.status]?.bg ?? '#f3f4f6',
                        color: statusColors[agent.status]?.text ?? '#374151',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '500',
                        border: '1px solid transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                      <option value="probation">Probation</option>
                    </select>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <button
                      onClick={() => {
                        deleteConfirmRef.current = { id: agent.id, name: agent.name };
                      }}
                      disabled={isSubmitting}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#fee2e2',
                        color: '#991b1b',
                        border: '1px solid #fecaca',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '500',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        opacity: isSubmitting ? 0.6 : 1,
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirmRef.current && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => !isSubmitting && (deleteConfirmRef.current = null)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '24px',
              minWidth: '400px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 12px 0', color: '#111827' }}>
              Delete Agent?
            </h3>
            <p style={{ color: '#6b7280', fontSize: '14px', margin: '0 0 20px 0' }}>
              Are you sure you want to delete &quot;{deleteConfirmRef.current.name}&quot;? This action cannot be undone.
            </p>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => handleDeleteAgent(deleteConfirmRef.current!.id)}
                disabled={isSubmitting}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: '500',
                  fontSize: '14px',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.6 : 1,
                }}
              >
                {isSubmitting ? 'Deleting...' : 'Delete'}
              </button>
              <button
                onClick={() => (deleteConfirmRef.current = null)}
                disabled={isSubmitting}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  backgroundColor: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontWeight: '500',
                  fontSize: '14px',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
