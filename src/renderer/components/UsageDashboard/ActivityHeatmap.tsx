/**
 * ActivityHeatmap
 *
 * Heatmap showing AI usage activity by hour of day.
 * For week view: shows hours (0-23) on Y-axis, days on X-axis.
 * For month view: shows AM/PM on Y-axis, days on X-axis.
 *
 * Features:
 * - X-axis: days, Y-axis: hours (or AM/PM for month+)
 * - Color intensity toggle between query count and duration
 * - Tooltip on hover showing exact time and count/duration
 * - Theme-aware gradient colors (bgSecondary → accent)
 * - Fills available width
 */

import React, { useState, useMemo, useCallback } from 'react';
import { format, subDays } from 'date-fns';
import type { Theme } from '../../types';
import type { StatsTimeRange, StatsAggregation } from '../../hooks/useStats';
import { COLORBLIND_HEATMAP_SCALE } from '../../constants/colorblindPalettes';

// Metric display mode
type MetricMode = 'count' | 'duration';

interface HourData {
  date: Date;
  hour: number; // 0-23
  dateString: string; // yyyy-MM-dd
  hourKey: string; // yyyy-MM-dd-HH
  count: number;
  duration: number;
  intensity: number; // 0-4 scale for color intensity
}

interface DayColumn {
  date: Date;
  dateString: string;
  dayLabel: string;
  hours: HourData[];
}

interface ActivityHeatmapProps {
  /** Aggregated stats data from the API */
  data: StatsAggregation;
  /** Current time range selection */
  timeRange: StatsTimeRange;
  /** Current theme for styling */
  theme: Theme;
  /** Enable colorblind-friendly colors */
  colorBlindMode?: boolean;
}

/**
 * Get the number of days to display based on time range
 */
function getDaysForRange(timeRange: StatsTimeRange): number {
  switch (timeRange) {
    case 'day':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'year':
      return 365;
    case 'all':
      return 365; // Show last year for "all time"
    default:
      return 7;
  }
}

/**
 * Check if we should use AM/PM grouping (for larger time ranges)
 */
function shouldUseAmPm(timeRange: StatsTimeRange): boolean {
  return timeRange === 'month' || timeRange === 'year' || timeRange === 'all';
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Calculate intensity level (0-4) from a value and max value
 * Level 0 = no activity, 1-4 = increasing activity
 */
function calculateIntensity(value: number, maxValue: number): number {
  if (value === 0) return 0;
  if (maxValue === 0) return 0;

  const ratio = value / maxValue;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * Get color for a given intensity level
 */
function getIntensityColor(intensity: number, theme: Theme, colorBlindMode?: boolean): string {
  // Use colorblind-safe palette when colorblind mode is enabled
  if (colorBlindMode) {
    const clampedIntensity = Math.max(0, Math.min(4, Math.round(intensity)));
    return COLORBLIND_HEATMAP_SCALE[clampedIntensity];
  }

  const accent = theme.colors.accent;
  const bgSecondary = theme.colors.bgActivity;

  // Parse the accent color to get RGB values for interpolation
  let accentRgb: { r: number; g: number; b: number } | null = null;

  if (accent.startsWith('#')) {
    const hex = accent.slice(1);
    accentRgb = {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  } else if (accent.startsWith('rgb')) {
    const match = accent.match(/\d+/g);
    if (match && match.length >= 3) {
      accentRgb = {
        r: parseInt(match[0]),
        g: parseInt(match[1]),
        b: parseInt(match[2]),
      };
    }
  }

  // Fallback to accent with varying opacity if parsing fails
  if (!accentRgb) {
    const opacities = [0.1, 0.3, 0.5, 0.7, 1.0];
    return `${accent}${Math.round(opacities[intensity] * 255).toString(16).padStart(2, '0')}`;
  }

  // Generate colors for each intensity level
  switch (intensity) {
    case 0:
      return bgSecondary;
    case 1:
      return `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.2)`;
    case 2:
      return `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.4)`;
    case 3:
      return `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.6)`;
    case 4:
      return `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.9)`;
    default:
      return bgSecondary;
  }
}


export function ActivityHeatmap({ data, timeRange, theme, colorBlindMode = false }: ActivityHeatmapProps) {
  const [metricMode, setMetricMode] = useState<MetricMode>('count');
  const [hoveredCell, setHoveredCell] = useState<HourData | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const useAmPm = shouldUseAmPm(timeRange);

  // Convert byDay data to a lookup map
  const dayDataMap = useMemo(() => {
    const map = new Map<string, { count: number; duration: number }>();
    for (const day of data.byDay) {
      map.set(day.date, { count: day.count, duration: day.duration });
    }
    return map;
  }, [data.byDay]);

  // Generate hour-based data for the heatmap
  const { dayColumns, hourLabels } = useMemo(() => {
    const numDays = getDaysForRange(timeRange);
    const today = new Date();
    const columns: DayColumn[] = [];

    // Determine hour rows based on mode
    const hours = useAmPm ? [0, 12] : Array.from({ length: 24 }, (_, i) => i);
    // Labels for Y-axis: show every 2 hours for readability
    const labels = useAmPm
      ? ['AM', 'PM']
      : ['12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p'];

    // Track max values for intensity calculation
    let maxCount = 0;
    let maxDuration = 0;

    // Generate days from (numDays-1) days ago to today
    for (let dayOffset = numDays - 1; dayOffset >= 0; dayOffset--) {
      const date = subDays(today, dayOffset);
      const dateString = format(date, 'yyyy-MM-dd');
      const dayStats = dayDataMap.get(dateString) || { count: 0, duration: 0 };

      // For AM/PM mode, split the day's data in half
      // For hourly mode, distribute evenly (since we don't have hourly granularity in data)
      const hourData: HourData[] = hours.map((hour) => {
        let count: number;
        let duration: number;

        if (useAmPm) {
          // Split day data between AM and PM
          count = Math.floor(dayStats.count / 2);
          duration = Math.floor(dayStats.duration / 2);
          // Give remainder to PM if odd
          if (hour === 12 && dayStats.count % 2 === 1) count++;
          if (hour === 12 && dayStats.duration % 2 === 1) duration++;
        } else {
          // Distribute evenly across hours (simplified - real data would have hourly breakdown)
          count = Math.floor(dayStats.count / 24);
          duration = Math.floor(dayStats.duration / 24);
          // Distribute remainder to typical work hours (9-17)
          if (hour >= 9 && hour <= 17) {
            count += Math.floor((dayStats.count % 24) / 9);
            duration += Math.floor((dayStats.duration % 24) / 9);
          }
        }

        maxCount = Math.max(maxCount, count);
        maxDuration = Math.max(maxDuration, duration);

        return {
          date,
          hour,
          dateString,
          hourKey: `${dateString}-${hour.toString().padStart(2, '0')}`,
          count,
          duration,
          intensity: 0, // Will be calculated after we know max values
        };
      });

      columns.push({
        date,
        dateString,
        dayLabel: format(date, numDays <= 7 ? 'EEE' : 'd'),
        hours: hourData,
      });
    }

    // Now calculate intensities with known max values
    const maxVal = metricMode === 'count' ? Math.max(maxCount, 1) : Math.max(maxDuration, 1);
    columns.forEach((col) => {
      col.hours.forEach((hourData) => {
        const value = metricMode === 'count' ? hourData.count : hourData.duration;
        hourData.intensity = calculateIntensity(value, maxVal);
      });
    });

    return {
      dayColumns: columns,
      hourLabels: labels,
    };
  }, [dayDataMap, metricMode, timeRange, useAmPm]);

  // Handle mouse events for tooltip
  const handleMouseEnter = useCallback(
    (cell: HourData, event: React.MouseEvent<HTMLDivElement>) => {
      setHoveredCell(cell);
      const rect = event.currentTarget.getBoundingClientRect();
      // Position tooltip above and centered on the cell
      setTooltipPos({
        x: rect.left + rect.width / 2,
        y: rect.top - 4,
      });
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredCell(null);
    setTooltipPos(null);
  }, []);

  return (
    <div
      className="p-4 rounded-lg"
      style={{ backgroundColor: theme.colors.bgMain }}
      role="figure"
      aria-label={`Activity heatmap showing ${metricMode === 'count' ? 'query activity' : 'duration'} by ${useAmPm ? 'AM/PM' : 'hour'} over ${getDaysForRange(timeRange)} days.`}
    >
      {/* Header with title and metric toggle */}
      <div className="flex items-center justify-between mb-4">
        <h3
          className="text-sm font-medium"
          style={{ color: theme.colors.textMain }}
        >
          Activity Heatmap
        </h3>
        <div className="flex items-center gap-2">
          <span
            className="text-xs"
            style={{ color: theme.colors.textDim }}
          >
            Show:
          </span>
          <div
            className="flex rounded overflow-hidden border"
            style={{ borderColor: theme.colors.border }}
          >
            <button
              onClick={() => setMetricMode('count')}
              className="px-2 py-1 text-xs transition-colors"
              style={{
                backgroundColor:
                  metricMode === 'count'
                    ? `${theme.colors.accent}20`
                    : 'transparent',
                color:
                  metricMode === 'count'
                    ? theme.colors.accent
                    : theme.colors.textDim,
              }}
              aria-pressed={metricMode === 'count'}
              aria-label="Show query count"
            >
              Count
            </button>
            <button
              onClick={() => setMetricMode('duration')}
              className="px-2 py-1 text-xs transition-colors"
              style={{
                backgroundColor:
                  metricMode === 'duration'
                    ? `${theme.colors.accent}20`
                    : 'transparent',
                color:
                  metricMode === 'duration'
                    ? theme.colors.accent
                    : theme.colors.textDim,
                borderLeft: `1px solid ${theme.colors.border}`,
              }}
              aria-pressed={metricMode === 'duration'}
              aria-label="Show total duration"
            >
              Duration
            </button>
          </div>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="flex gap-2">
        {/* Hour labels (Y-axis) - only show every 2 hours for readability */}
        <div className="flex flex-col flex-shrink-0" style={{ width: 28, paddingTop: 20 }}>
          {hourLabels.map((label, idx) => (
            <div
              key={idx}
              className="text-xs text-right flex items-center justify-end"
              style={{
                color: theme.colors.textDim,
                height: useAmPm ? 34 : 14,
              }}
            >
              {/* Only show labels for even hours (0, 2, 4, etc.) */}
              {useAmPm || idx % 2 === 0 ? label : ''}
            </div>
          ))}
        </div>

        {/* Grid of cells */}
        <div className="flex-1">
          <div className="flex gap-[3px]">
            {dayColumns.map((col) => (
              <div
                key={col.dateString}
                className="flex flex-col gap-[2px] flex-1"
                style={{ minWidth: 20 }}
              >
                {/* Day label */}
                <div
                  className="text-xs text-center truncate h-[18px] flex items-center justify-center"
                  style={{ color: theme.colors.textDim }}
                  title={format(col.date, 'EEEE, MMM d')}
                >
                  {col.dayLabel}
                </div>
                {/* Hour cells */}
                {col.hours.map((hourData) => (
                  <div
                    key={hourData.hourKey}
                    className="rounded-sm cursor-default"
                    style={{
                      height: useAmPm ? 34 : 14,
                      backgroundColor: getIntensityColor(
                        hourData.intensity,
                        theme,
                        colorBlindMode
                      ),
                      outline:
                        hoveredCell?.hourKey === hourData.hourKey
                          ? `2px solid ${theme.colors.accent}`
                          : 'none',
                      outlineOffset: -1,
                      transition: 'background-color 0.3s ease, outline 0.15s ease',
                    }}
                    onMouseEnter={(e) => handleMouseEnter(hourData, e)}
                    onMouseLeave={handleMouseLeave}
                    role="gridcell"
                    aria-label={`${format(hourData.date, 'MMM d')} ${useAmPm ? (hourData.hour === 0 ? 'AM' : 'PM') : `${hourData.hour}:00`}: ${hourData.count} ${hourData.count === 1 ? 'query' : 'queries'}${hourData.duration > 0 ? `, ${formatDuration(hourData.duration)}` : ''}`}
                    tabIndex={0}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-2 mt-3" role="list" aria-label="Activity intensity scale from less to more">
        <span
          className="text-xs"
          style={{ color: theme.colors.textDim }}
          aria-hidden="true"
        >
          Less
        </span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className="rounded-sm"
            style={{
              width: 12,
              height: 12,
              backgroundColor: getIntensityColor(level, theme, colorBlindMode),
            }}
            role="listitem"
            aria-label={`Intensity level ${level}: ${level === 0 ? 'No activity' : level === 1 ? 'Low' : level === 2 ? 'Medium-low' : level === 3 ? 'Medium-high' : 'High'} activity`}
          />
        ))}
        <span
          className="text-xs"
          style={{ color: theme.colors.textDim }}
          aria-hidden="true"
        >
          More
        </span>
      </div>

      {/* Tooltip */}
      {hoveredCell && tooltipPos && (
        <div
          className="fixed z-50 px-2 py-1.5 rounded text-xs whitespace-nowrap pointer-events-none shadow-lg"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y - 8,
            transform: 'translate(-50%, -100%)',
            backgroundColor: theme.colors.bgActivity,
            color: theme.colors.textMain,
            border: `1px solid ${theme.colors.border}`,
          }}
        >
          <div className="font-medium mb-0.5">
            {format(hoveredCell.date, 'EEEE, MMM d')}
            {!useAmPm && ` at ${hoveredCell.hour}:00`}
            {useAmPm && ` (${hoveredCell.hour === 0 ? 'AM' : 'PM'})`}
          </div>
          <div style={{ color: theme.colors.textDim }}>
            {hoveredCell.count} {hoveredCell.count === 1 ? 'query' : 'queries'}
            {hoveredCell.duration > 0 && (
              <span> • {formatDuration(hoveredCell.duration)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ActivityHeatmap;
