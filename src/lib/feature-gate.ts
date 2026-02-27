/**
 * Feature Gate — UI nudge only, no blocking.
 * Self-hosted users control their own server; technical enforcement is trivially bypassed.
 * Premium value is team service (custom playbooks, co-response), not code restrictions.
 */
import { isPremium } from './subscription-manager'

export interface GateResult {
  included: boolean
  nudgeMessage?: string
}

type PremiumFeature =
  | 'custom-playbooks'
  | 'threshold-tuning'
  | 'incident-co-response'
  | 'monthly-review'
  | 'priority-protocol-support'

const NUDGE_MESSAGES: Record<PremiumFeature, string> = {
  'custom-playbooks': 'Premium에서 SentinAI 팀이 환경 맞춤 플레이북을 직접 작성해드립니다.',
  'threshold-tuning': 'Premium에서 실제 노드 패턴을 기반으로 이상 탐지 임계값을 튜닝해드립니다.',
  'incident-co-response': 'Premium에서 크리티컬 알림 시 SentinAI 엔지니어가 함께 대응합니다.',
  'monthly-review': 'Premium에서 월 1회 이상 패턴 분석 + 개선 제안 리뷰를 제공합니다.',
  'priority-protocol-support': 'Premium에서 새 체인/클라이언트 지원을 우선 제공합니다.',
}

export function checkGate(feature: PremiumFeature): GateResult {
  if (isPremium()) return { included: true }
  return {
    included: false,
    nudgeMessage: NUDGE_MESSAGES[feature],
  }
}
