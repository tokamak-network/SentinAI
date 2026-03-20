'use client';

import { useState, useEffect } from 'react';

export interface FreeTrialState {
  serviceKey: string;
  usedCalls: number;
  totalFreeCalls: number;
  lastResetDate: string;
}

const STORAGE_KEY = 'sentinai_free_trials';

export function useFreeTrials(serviceKey: string) {
  const [trial, setTrial] = useState<FreeTrialState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const stored = localStorage.getItem(STORAGE_KEY);
    const trials = stored ? JSON.parse(stored) : {};
    
    if (!trials[serviceKey]) {
      trials[serviceKey] = {
        serviceKey,
        usedCalls: 0,
        totalFreeCalls: 3,
        lastResetDate: new Date().toISOString().split('T')[0],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trials));
    }
    
    setTrial(trials[serviceKey]);
    setIsLoading(false);
  }, [serviceKey]);

  // Use a free call
  const useFreeCall = async () => {
    if (!trial || trial.usedCalls >= trial.totalFreeCalls) {
      return { success: false, reason: 'No free calls remaining' };
    }

    // Simulate API call
    const mockResult = {
      success: true,
      data: `Mock data for ${trial.serviceKey}`,
      timestamp: new Date().toISOString(),
    };

    // Update localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    const trials = stored ? JSON.parse(stored) : {};
    trials[serviceKey].usedCalls += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trials));

    // Update state
    setTrial({ ...trial, usedCalls: trial.usedCalls + 1 });

    return { success: true, data: mockResult };
  };

  return { trial, isLoading, useFreeCall };
}
