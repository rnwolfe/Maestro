import React, { useRef, useEffect, useState } from 'react';
import type { Theme } from '../types';
import { useClickOutside } from '../hooks';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean; // Use error color for destructive actions
  dividerAfter?: boolean; // Add divider after this item
}

export interface ContextMenuProps {
  x: number;
  y: number;
  theme: Theme;
  items: ContextMenuItem[];
  onClose: () => void;
  minWidth?: string;
}

/**
 * Reusable context menu component with viewport-aware positioning and full accessibility support.
 *
 * Features:
 * - Adjusts position to stay within viewport bounds
 * - Closes on Escape key or click outside
 * - Themed styling with hover states
 * - Support for disabled items and dividers
 * - Optional danger/destructive styling
 * - Full keyboard navigation (Arrow keys, Enter/Space, Tab, Escape)
 * - ARIA attributes for screen reader accessibility
 * - Enhanced visual feedback for disabled items
 *
 * Accessibility:
 * - Uses role="menu" and role="menuitem" for semantic structure
 * - Keyboard navigation with Up/Down arrows to navigate, Enter/Space to select
 * - Disabled items are marked with aria-disabled and cannot be activated
 * - First enabled item receives focus on mount
 * - Escape key closes the menu
 *
 * Usage:
 * ```tsx
 * {contextMenu && (
 *   <ContextMenu
 *     x={contextMenu.x}
 *     y={contextMenu.y}
 *     theme={theme}
 *     items={[
 *       { label: 'Rename', icon: <Edit2 />, onClick: () => handleRename() },
 *       { label: 'Delete', icon: <Trash2 />, onClick: () => handleDelete(), danger: true, disabled: false },
 *     ]}
 *     onClose={() => setContextMenu(null)}
 *   />
 * )}
 * ```
 */
export function ContextMenu({
  x,
  y,
  theme,
  items,
  onClose,
  minWidth = '160px'
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(() => {
    // Find first enabled item to focus initially
    const firstEnabledIndex = items.findIndex(item => !item.disabled);
    return firstEnabledIndex !== -1 ? firstEnabledIndex : 0;
  });

  // Use ref to avoid re-registering listener when onClose changes
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Close on click outside
  useClickOutside(menuRef, onClose);

  // Keyboard navigation and accessibility
  useEffect(() => {
    /**
     * Handle keyboard navigation for the context menu.
     * - Escape: Close menu
     * - ArrowDown/ArrowUp: Navigate between enabled items
     * - Enter/Space: Activate focused item (if enabled)
     * - Tab: Close menu (prevent focus trap issues)
     */
    const handleKeyDown = (e: KeyboardEvent) => {
      // Close on Escape or Tab
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      // Navigate with arrow keys
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Find next enabled item after current focus
        let nextIndex = focusedIndex + 1;
        while (nextIndex < items.length && items[nextIndex].disabled) {
          nextIndex++;
        }
        // Wrap to first enabled item if we reached the end
        if (nextIndex >= items.length) {
          nextIndex = items.findIndex(item => !item.disabled);
        }
        if (nextIndex !== -1 && nextIndex !== focusedIndex) {
          setFocusedIndex(nextIndex);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        // Find previous enabled item before current focus
        let prevIndex = focusedIndex - 1;
        while (prevIndex >= 0 && items[prevIndex].disabled) {
          prevIndex--;
        }
        // Wrap to last enabled item if we reached the beginning
        if (prevIndex < 0) {
          for (let i = items.length - 1; i >= 0; i--) {
            if (!items[i].disabled) {
              prevIndex = i;
              break;
            }
          }
        }
        if (prevIndex !== -1 && prevIndex !== focusedIndex) {
          setFocusedIndex(prevIndex);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const item = items[focusedIndex];
        if (item && !item.disabled) {
          item.onClick();
          onCloseRef.current();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, items]);

  // Focus the menu container on mount for keyboard navigation
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  // Adjust menu position to stay within viewport
  const adjustedPosition = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - (items.length * 32 + 20)) // Estimate menu height
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Tab context menu"
      tabIndex={-1}
      className="fixed z-50 py-1 rounded-md shadow-xl border outline-none"
      style={{
        left: adjustedPosition.left,
        top: adjustedPosition.top,
        backgroundColor: theme.colors.bgSidebar,
        borderColor: theme.colors.border,
        minWidth
      }}
      onClick={(e) => e.stopPropagation()} // Prevent clicks from bubbling
    >
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <button
            role="menuitem"
            aria-disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
            onMouseEnter={() => {
              // Update focused index on mouse hover (for hybrid mouse+keyboard usage)
              if (!item.disabled) {
                setFocusedIndex(index);
              }
            }}
            className={`
              w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2
              ${item.disabled
                ? 'opacity-40 cursor-default' // Enhanced: lower opacity for better visibility
                : 'hover:bg-white/10 cursor-pointer' // Enhanced: stronger hover effect
              }
              ${focusedIndex === index && !item.disabled ? 'bg-white/10' : ''}
            `}
            style={{
              color: item.disabled
                ? theme.colors.textDim // Disabled items use dim color
                : item.danger
                  ? theme.colors.error
                  : theme.colors.textMain
            }}
          >
            {item.icon && (
              <span
                className="w-3.5 h-3.5 shrink-0"
                style={{
                  color: item.disabled
                    ? theme.colors.textDim
                    : item.danger
                      ? theme.colors.error
                      : theme.colors.textDim
                }}
              >
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
          {item.dividerAfter && (
            <div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
