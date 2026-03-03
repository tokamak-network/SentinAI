/**
 * Agent Resume Types
 *
 * Public-facing profile of an agent's operational experience.
 * Generated from Experience Store data and Pattern Extractor results.
 * Foundation for the Agent-for-Hire revenue model — clients can evaluate
 * agent competence before hiring.
 */

import type { ExperienceStats } from './experience';
import type { OperationalPattern } from './pattern';

export type ExperienceTier = 'trainee' | 'junior' | 'senior' | 'expert';

export interface AgentResume {
  instanceId: string;
  protocolId: string;
  tier: ExperienceTier;
  operatingSince: string;
  stats: ExperienceStats;
  topPatterns: OperationalPattern[];
  specialties: string[];
  generatedAt: string;
}
