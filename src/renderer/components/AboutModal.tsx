import React, { useEffect, useRef, useMemo } from 'react';
import { X, Wand2, ExternalLink, FileCode, BarChart3 } from 'lucide-react';
import type { Theme, Session, GlobalStats } from '../types';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import pedramAvatar from '../assets/pedram-avatar.png';

interface AboutModalProps {
  theme: Theme;
  sessions: Session[];
  persistedStats: GlobalStats;
  onClose: () => void;
}

export function AboutModal({ theme, sessions, persistedStats, onClose }: AboutModalProps) {
  const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
  const layerIdRef = useRef<string>();

  // Calculate current session stats (in-memory, for this run)
  const currentSessionStats = useMemo(() => {
    let totalMessages = 0;
    let totalActiveTimeMs = 0;

    for (const session of sessions) {
      // Count messages (AI logs from user source)
      totalMessages += session.aiLogs.filter(log => log.source === 'user').length;
      // Aggregate active time
      totalActiveTimeMs += session.activeTimeMs || 0;
    }

    return { totalMessages, totalActiveTimeMs, totalSessions: sessions.length };
  }, [sessions]);

  // Combine persisted stats with current session stats
  // Persisted stats track: tokens and cost (accumulated across restarts)
  // Current session stats track: sessions, messages, active time (this run only, but messages/time could be persisted later)
  const globalStats: GlobalStats = useMemo(() => ({
    totalSessions: currentSessionStats.totalSessions,
    totalMessages: currentSessionStats.totalMessages,
    totalInputTokens: persistedStats.totalInputTokens,
    totalOutputTokens: persistedStats.totalOutputTokens,
    totalCacheReadTokens: persistedStats.totalCacheReadTokens,
    totalCacheCreationTokens: persistedStats.totalCacheCreationTokens,
    totalCostUsd: persistedStats.totalCostUsd,
    totalActiveTimeMs: currentSessionStats.totalActiveTimeMs,
  }), [persistedStats, currentSessionStats]);

  // Format token count with K/M suffix
  const formatTokens = (count: number): string => {
    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}K`;
    }
    return count.toString();
  };

  // Format duration from milliseconds
  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };
  const containerRef = useRef<HTMLDivElement>(null);

  // Register layer on mount
  useEffect(() => {
    const id = registerLayer({
      type: 'modal',
      priority: MODAL_PRIORITIES.ABOUT,
      blocksLowerLayers: true,
      capturesFocus: true,
      focusTrap: 'strict',
      ariaLabel: 'About Maestro',
      onEscape: onClose,
    });
    layerIdRef.current = id;

    // Auto-focus the container for immediate keyboard control
    containerRef.current?.focus();

    return () => {
      if (layerIdRef.current) {
        unregisterLayer(layerIdRef.current);
      }
    };
  }, [registerLayer, unregisterLayer]);

  // Update handler when dependencies change
  useEffect(() => {
    if (layerIdRef.current) {
      updateLayerHandler(layerIdRef.current, onClose);
    }
  }, [onClose, updateLayerHandler]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999] animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="About Maestro"
      tabIndex={-1}
    >
      <div className="w-[450px] border rounded-lg shadow-2xl overflow-hidden" style={{ backgroundColor: theme.colors.bgSidebar, borderColor: theme.colors.border }}>
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: theme.colors.border }}>
          <h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>About Maestro</h2>
          <button onClick={onClose} style={{ color: theme.colors.textDim }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {/* Logo and Title */}
          <div className="flex items-center gap-4">
            <Wand2 className="w-12 h-12" style={{ color: theme.colors.accent }} />
            <div>
              <h1 className="text-2xl font-bold tracking-widest" style={{ color: theme.colors.textMain }}>MAESTRO</h1>
              <p className="text-xs opacity-70" style={{ color: theme.colors.textDim }}>Agent Orchestration Command Center</p>
            </div>
          </div>

          {/* Author Section */}
          <div className="flex items-center gap-4 p-4 rounded border" style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}>
            <img
              src={pedramAvatar}
              alt="Pedram Amini"
              className="w-16 h-16 rounded-full border-2"
              style={{ borderColor: theme.colors.accent }}
            />
            <div className="flex-1">
              <div className="text-sm font-bold" style={{ color: theme.colors.textMain }}>Pedram Amini</div>
              <div className="text-xs opacity-70 mb-2" style={{ color: theme.colors.textDim }}>Founder, Hacker, Investor, Advisor</div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => window.maestro.shell.openExternal('https://github.com/pedramamini')}
                  className="inline-flex items-center gap-1 text-xs hover:underline cursor-pointer text-left"
                  style={{ color: theme.colors.accent, background: 'none', border: 'none', padding: 0 }}
                >
                  <ExternalLink className="w-3 h-3" />
                  GitHub Profile
                </button>
                <button
                  onClick={() => window.maestro.shell.openExternal('https://www.linkedin.com/in/pedramamini/')}
                  className="inline-flex items-center gap-1 text-xs hover:underline cursor-pointer text-left"
                  style={{ color: theme.colors.accent, background: 'none', border: 'none', padding: 0 }}
                >
                  <ExternalLink className="w-3 h-3" />
                  LinkedIn Profile
                </button>
              </div>
            </div>
          </div>

          {/* Global Usage Stats - show if we have any stats (sessions or persisted tokens/cost) */}
          {(globalStats.totalSessions > 0 || globalStats.totalCostUsd > 0 || globalStats.totalInputTokens > 0) && (
            <div className="p-4 rounded border" style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}>
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4" style={{ color: theme.colors.accent }} />
                <span className="text-sm font-bold" style={{ color: theme.colors.textMain }}>Global Statistics</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {/* Sessions & Messages */}
                <div className="flex justify-between">
                  <span style={{ color: theme.colors.textDim }}>Sessions</span>
                  <span className="font-mono font-bold" style={{ color: theme.colors.textMain }}>{globalStats.totalSessions}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: theme.colors.textDim }}>Messages</span>
                  <span className="font-mono font-bold" style={{ color: theme.colors.textMain }}>{globalStats.totalMessages}</span>
                </div>

                {/* Tokens */}
                <div className="flex justify-between">
                  <span style={{ color: theme.colors.textDim }}>Input Tokens</span>
                  <span className="font-mono font-bold" style={{ color: theme.colors.textMain }}>{formatTokens(globalStats.totalInputTokens)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: theme.colors.textDim }}>Output Tokens</span>
                  <span className="font-mono font-bold" style={{ color: theme.colors.textMain }}>{formatTokens(globalStats.totalOutputTokens)}</span>
                </div>

                {/* Cache Tokens (if any) */}
                {(globalStats.totalCacheReadTokens > 0 || globalStats.totalCacheCreationTokens > 0) && (
                  <>
                    <div className="flex justify-between">
                      <span style={{ color: theme.colors.textDim }}>Cache Read</span>
                      <span className="font-mono font-bold" style={{ color: theme.colors.textMain }}>{formatTokens(globalStats.totalCacheReadTokens)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: theme.colors.textDim }}>Cache Creation</span>
                      <span className="font-mono font-bold" style={{ color: theme.colors.textMain }}>{formatTokens(globalStats.totalCacheCreationTokens)}</span>
                    </div>
                  </>
                )}

                {/* Active Time */}
                {globalStats.totalActiveTimeMs > 0 && (
                  <div className="flex justify-between col-span-2 pt-2 border-t" style={{ borderColor: theme.colors.border }}>
                    <span style={{ color: theme.colors.textDim }}>Active Time</span>
                    <span className="font-mono font-bold" style={{ color: theme.colors.textMain }}>{formatDuration(globalStats.totalActiveTimeMs)}</span>
                  </div>
                )}

                {/* Total Cost */}
                {globalStats.totalCostUsd > 0 && (
                  <div className="flex justify-between col-span-2 pt-2 border-t" style={{ borderColor: theme.colors.border }}>
                    <span style={{ color: theme.colors.textDim }}>Total Cost</span>
                    <span className="font-mono font-bold" style={{ color: theme.colors.success }}>${globalStats.totalCostUsd.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Project Link */}
          <div className="pt-2 border-t" style={{ borderColor: theme.colors.border }}>
            <button
              onClick={() => window.maestro.shell.openExternal('https://github.com/pedramamini/Maestro')}
              className="w-full flex items-center justify-between p-3 rounded border hover:bg-white/5 transition-colors"
              style={{ borderColor: theme.colors.border }}
            >
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4" style={{ color: theme.colors.accent }} />
                <span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>View on GitHub</span>
              </div>
              <ExternalLink className="w-4 h-4" style={{ color: theme.colors.textDim }} />
            </button>
          </div>

          {/* Made in Austin */}
          <div className="pt-3 text-center">
            <span className="text-xs" style={{ color: theme.colors.textDim }}>Made in Austin, TX</span>
          </div>
        </div>
      </div>
    </div>
  );
}
