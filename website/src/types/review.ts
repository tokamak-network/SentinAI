/**
 * Operator Review & Guardian Score Types
 * Inspired by 당근마켓 매너온도
 */

export interface ReviewRatings {
  dataAccuracy: number;    // 1~5: 데이터 정확도
  responseSpeed: number;   // 1~5: 응답 속도
  uptime: number;          // 1~5: 가용성 체감
  valueForMoney: number;   // 1~5: 가성비
}

export interface OperatorReview {
  id: string;
  operatorAddress: string;
  reviewerAddress: string;
  serviceKey: string;
  txHash: string;
  ratings: ReviewRatings;
  comment?: string;
  createdAt: string;       // ISO timestamp
}

export type GuardianLevel = 'cold' | 'cool' | 'new' | 'warm' | 'hot' | 'legendary';

export interface GuardianScore {
  temperature: number;     // 0 ~ 99.0
  level: GuardianLevel;
  reviewCount: number;
  avgRating: number;       // 1~5 overall average
}

export interface ReviewSubmission {
  operatorAddress: string;
  reviewerAddress: string;
  serviceKey: string;
  txHash: string;
  ratings: ReviewRatings;
  comment?: string;
}
