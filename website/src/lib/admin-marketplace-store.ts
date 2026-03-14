/**
 * Marketplace Data Store (Website Admin)
 * Manages agents, pricing, orders, payments
 * InMemory implementation for development/preview
 */

export interface Agent {
  id: string;
  name: string;
  description: string;
  tier: 'trainee' | 'junior' | 'senior' | 'expert';
  priceUSDCents: number;
  imageUrl?: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface PricingPolicy {
  trainee: number;    // USD cents
  junior: number;
  senior: number;
  expert: number;
}

export interface Order {
  id: string;
  agentId: string;
  buyerAddress: string;
  tier: 'trainee' | 'junior' | 'senior' | 'expert';
  amount: number;  // USD cents
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface AdminMarketplaceData {
  agents: Agent[];
  pricing: PricingPolicy;
  orders: Order[];
  updatedAt: string;
}

export interface MarketplaceStore {
  getData(): Promise<AdminMarketplaceData>;
  addAgent(agent: Omit<Agent, 'createdAt'>, opts?: { preserveId?: boolean }): Promise<Agent>;
  updateAgent(id: string, agent: Partial<Agent>): Promise<Agent | null>;
  deleteAgent(id: string): Promise<boolean>;
  getPricing(): Promise<PricingPolicy>;
  updatePricing(pricing: Partial<PricingPolicy>): Promise<PricingPolicy>;
  getOrders(limit?: number, offset?: number): Promise<{ orders: Order[]; total: number }>;
  getOrder(id: string): Promise<Order | null>;
  updateOrderStatus(id: string, status: Order['status']): Promise<Order | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// InMemory Implementation
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PRICING: PricingPolicy = {
  trainee: 0,        // Free
  junior: 19900,     // $199
  senior: 49900,     // $499
  expert: 79900,     // $799
};

const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'anomaly-detector',
    name: 'Anomaly Detector',
    description: 'Real-time detection of L2 operational anomalies using Z-Score + AI analysis',
    tier: 'junior',
    priceUSDCents: 19900,
    status: 'active',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'rca-engine',
    name: 'RCA Engine',
    description: 'Root cause analysis with fault propagation tracing and context extraction',
    tier: 'senior',
    priceUSDCents: 49900,
    status: 'active',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'cost-optimizer',
    name: 'Cost Optimizer',
    description: 'Intelligent cost analysis and optimization recommendations for L2 operations',
    tier: 'senior',
    priceUSDCents: 49900,
    status: 'active',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'predictive-scaler',
    name: 'Predictive Scaler',
    description: 'Forecasts L2 demand and auto-scales infrastructure with zero downtime',
    tier: 'expert',
    priceUSDCents: 79900,
    status: 'active',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'nlops-chat',
    name: 'NLOps Chat',
    description: '9-tool conversational interface for log analysis, RCA, scaling, and cost optimization',
    tier: 'expert',
    priceUSDCents: 79900,
    status: 'active',
    createdAt: new Date().toISOString(),
  },
];

class InMemoryMarketplaceStore implements MarketplaceStore {
  private data: AdminMarketplaceData = {
    agents: [...DEFAULT_AGENTS],
    pricing: { ...DEFAULT_PRICING },
    orders: [],
    updatedAt: new Date().toISOString(),
  };

  async getData(): Promise<AdminMarketplaceData> {
    return { ...this.data };
  }

  async addAgent(agent: Omit<Agent, 'createdAt'>, opts?: { preserveId?: boolean }): Promise<Agent> {
    // Generate id if not provided (or if not preserving provided id)
    const agentId = (opts?.preserveId && (agent as any).id) ? (agent as any).id : `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const newAgent: Agent = {
      ...agent,
      id: agentId,
      createdAt: new Date().toISOString(),
    };
    this.data.agents.push(newAgent);
    this.updateTimestamp();
    return newAgent;
  }

  async updateAgent(id: string, agent: Partial<Agent>): Promise<Agent | null> {
    const index = this.data.agents.findIndex(a => a.id === id);
    if (index === -1) return null;

    this.data.agents[index] = {
      ...this.data.agents[index],
      ...agent,
      id: this.data.agents[index].id, // Prevent id modification
      createdAt: this.data.agents[index].createdAt,
    };
    this.updateTimestamp();
    return this.data.agents[index];
  }

  async deleteAgent(id: string): Promise<boolean> {
    const index = this.data.agents.findIndex(a => a.id === id);
    if (index === -1) return false;

    this.data.agents.splice(index, 1);
    this.updateTimestamp();
    return true;
  }

  async getPricing(): Promise<PricingPolicy> {
    return { ...this.data.pricing };
  }

  async updatePricing(pricing: Partial<PricingPolicy>): Promise<PricingPolicy> {
    this.data.pricing = {
      ...this.data.pricing,
      ...pricing,
    };
    this.updateTimestamp();
    return { ...this.data.pricing };
  }

  async getOrders(limit = 50, offset = 0): Promise<{ orders: Order[]; total: number }> {
    const total = this.data.orders.length;
    const orders = this.data.orders.slice(offset, offset + limit);
    return { orders, total };
  }

  async getOrder(id: string): Promise<Order | null> {
    return this.data.orders.find(o => o.id === id) || null;
  }

  async updateOrderStatus(id: string, status: Order['status']): Promise<Order | null> {
    const order = this.data.orders.find(o => o.id === id);
    if (!order) return null;

    order.status = status;
    order.updatedAt = new Date().toISOString();
    this.updateTimestamp();
    return order;
  }

  private updateTimestamp(): void {
    this.data.updatedAt = new Date().toISOString();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Factory
// ─────────────────────────────────────────────────────────────────────────────

let instance: MarketplaceStore | null = null;

export function getMarketplaceStore(): MarketplaceStore {
  if (!instance) {
    instance = new InMemoryMarketplaceStore();
    console.log('[MarketplaceStore] Using InMemory backend');
  }
  return instance;
}

/**
 * Seed the marketplace store with initial agent data.
 * Useful for migrations and testing. Does nothing if agents already exist.
 */
export async function seedMarketplaceAgents(agents: Agent[]): Promise<void> {
  const store = getMarketplaceStore();
  const current = await store.getData();

  // Only seed if store is empty
  if (current.agents.length === 0) {
    for (const agent of agents) {
      await store.addAgent({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        tier: agent.tier,
        priceUSDCents: agent.priceUSDCents,
        imageUrl: agent.imageUrl,
        status: agent.status,
      } as Omit<Agent, 'createdAt'>, { preserveId: true });
    }
    console.log(`[MarketplaceStore] Seeded ${agents.length} agents`);
  }
}
