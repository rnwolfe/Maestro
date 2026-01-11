/**
 * Tests for context usage estimation utilities
 */

import { estimateContextUsage, DEFAULT_CONTEXT_WINDOWS } from '../../../renderer/utils/contextUsage';
import type { UsageStats } from '../../../shared/types';

describe('estimateContextUsage', () => {
  const createStats = (overrides: Partial<UsageStats> = {}): UsageStats => ({
    inputTokens: 10000,
    outputTokens: 5000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalCostUsd: 0.01,
    contextWindow: 0,
    ...overrides,
  });

  describe('when contextWindow is provided', () => {
    it('should calculate percentage from provided context window', () => {
      const stats = createStats({ contextWindow: 100000 });
      const result = estimateContextUsage(stats, 'claude-code');
      // (10000 + 0 + 0) / 100000 = 10%
      expect(result).toBe(10);
    });

    it('should include cacheReadInputTokens in calculation', () => {
      const stats = createStats({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 50000,
        contextWindow: 100000,
      });
      const result = estimateContextUsage(stats, 'claude-code');
      // (1000 + 0 + 50000) / 100000 = 51% -> 51%
      expect(result).toBe(51);
    });

    it('should cap at 100%', () => {
      const stats = createStats({
        inputTokens: 50000,
        outputTokens: 50000,
        cacheReadInputTokens: 150000,
        contextWindow: 200000,
      });
      const result = estimateContextUsage(stats, 'claude-code');
      // (50000 + 50000 + 150000) / 200000 = 125% -> capped at 100%
      expect(result).toBe(100);
    });

    it('should round to nearest integer', () => {
      const stats = createStats({
        inputTokens: 33333,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 100000,
      });
      const result = estimateContextUsage(stats, 'claude-code');
      // 33333 / 100000 = 33.333% -> 33%
      expect(result).toBe(33);
    });
  });

  describe('when contextWindow is not provided (fallback)', () => {
    it('should use claude-code default context window (200k)', () => {
      const stats = createStats({ contextWindow: 0 });
      const result = estimateContextUsage(stats, 'claude-code');
      // (10000 + 0 + 0) / 200000 = 5%
      expect(result).toBe(5);
    });

    it('should use claude default context window (200k)', () => {
      const stats = createStats({ contextWindow: 0 });
      const result = estimateContextUsage(stats, 'claude');
      expect(result).toBe(8);
    });

    it('should use codex default context window (200k)', () => {
      const stats = createStats({ contextWindow: 0 });
      const result = estimateContextUsage(stats, 'codex');
      expect(result).toBe(8);
    });

    it('should use opencode default context window (128k)', () => {
      const stats = createStats({ contextWindow: 0 });
      const result = estimateContextUsage(stats, 'opencode');
      // (10000 + 0 + 0) / 128000 = 7.8% -> 8%
      expect(result).toBe(8);
    });

    it('should use aider default context window (128k)', () => {
      const stats = createStats({ contextWindow: 0 });
      const result = estimateContextUsage(stats, 'aider');
      expect(result).toBe(12);
    });

    it('should return null for terminal agent', () => {
      const stats = createStats({ contextWindow: 0 });
      const result = estimateContextUsage(stats, 'terminal');
      expect(result).toBeNull();
    });

    it('should return null when no agent specified', () => {
      const stats = createStats({ contextWindow: 0 });
      const result = estimateContextUsage(stats);
      expect(result).toBeNull();
    });

    it('should return 0 when no tokens used', () => {
      const stats = createStats({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 0,
      });
      const result = estimateContextUsage(stats, 'claude-code');
      expect(result).toBe(0);
    });
  });

  describe('cacheReadInputTokens handling', () => {
    it('should handle undefined cacheReadInputTokens', () => {
      const stats = createStats({
        inputTokens: 10000,
        outputTokens: 5000,
        contextWindow: 100000,
      });
      // @ts-expect-error - testing undefined case
      stats.cacheReadInputTokens = undefined;
      const result = estimateContextUsage(stats, 'claude-code');
      // (10000 + 0 + 0) / 100000 = 10%
      expect(result).toBe(10);
    });

    it('should correctly calculate with large cache read tokens', () => {
      // This simulates a real scenario: small new input but large cached history
      const stats = createStats({
        inputTokens: 500,      // small new turn input
        outputTokens: 1000,    // small response
        cacheReadInputTokens: 180000,  // large cached conversation
        contextWindow: 200000,
      });
      const result = estimateContextUsage(stats, 'claude-code');
      // (500 + 0 + 180000) / 200000 = 90% -> 90%
      expect(result).toBe(90);
    });
  });

  describe('edge cases', () => {
    it('should handle negative context window as missing', () => {
      const stats = createStats({ contextWindow: -100 });
      const result = estimateContextUsage(stats, 'claude-code');
      // Should use fallback since contextWindow is invalid
      expect(result).toBe(8);
    });

    it('should handle undefined context window', () => {
      const stats = createStats();
      // @ts-expect-error - testing undefined case
      stats.contextWindow = undefined;
      const result = estimateContextUsage(stats, 'claude-code');
      // Should use fallback
      expect(result).toBe(8);
    });

    it('should handle very large token counts', () => {
      const stats = createStats({
        inputTokens: 500000,
        outputTokens: 500000,
        cacheReadInputTokens: 500000,
        contextWindow: 0,
      });
      const result = estimateContextUsage(stats, 'claude-code');
      // (500000 + 0 + 500000) / 200000 = 250% -> capped at 100%
      expect(result).toBe(100);
    });

    it('should handle very small percentages', () => {
      const stats = createStats({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        contextWindow: 0,
      });
      const result = estimateContextUsage(stats, 'claude-code');
      // (100 + 50 + 0) / 200000 = 0.075% -> 0%
      expect(result).toBe(0);
    });
  });
});

describe('DEFAULT_CONTEXT_WINDOWS', () => {
  it('should have context windows defined for all known agent types', () => {
    expect(DEFAULT_CONTEXT_WINDOWS['claude-code']).toBe(200000);
    expect(DEFAULT_CONTEXT_WINDOWS['claude']).toBe(200000);
    expect(DEFAULT_CONTEXT_WINDOWS['codex']).toBe(200000);
    expect(DEFAULT_CONTEXT_WINDOWS['opencode']).toBe(128000);
    expect(DEFAULT_CONTEXT_WINDOWS['aider']).toBe(128000);
    expect(DEFAULT_CONTEXT_WINDOWS['terminal']).toBe(0);
  });
});
