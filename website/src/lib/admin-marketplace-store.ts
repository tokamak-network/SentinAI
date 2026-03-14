/**
 * Marketplace Data Store (Website Admin)
 * Manages agents, pricing, orders, payments
 * InMemory implementation for development/preview
 */

export interface Agent {
  id: string;
  name: string;
  description: string;
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
  addAgent(agent: Omit<Agent, 'createdAt'>): Promise<Agent>;
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
    id: 'agent-001',
    name: 'Scaling Optimizer',
    description: 'Automatic scaling based on metrics',
    status: 'active',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'agent-002',
    name: 'Anomaly Detector',
    description: 'Real-time anomaly detection and alerting',
    status: 'active',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'agent-003',
    name: 'RCA Engine',
    description: 'Root cause analysis for incidents',
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

  async addAgent(agent: Omit<Agent, 'createdAt'>): Promise<Agent> {
    const newAgent: Agent = {
      ...agent,
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
