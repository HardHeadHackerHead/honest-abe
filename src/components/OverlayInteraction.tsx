import { useState, useEffect, useRef, useCallback } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import useEngineStatus from '../hooks/useEngineStatus';

const interactionWindow = getCurrentWebviewWindow();

/**
 * Invisible interaction overlay - captures mouse events for dragging the main overlay.
 * This window is pill-sized and positioned over the main overlay's pill.
 * Clicks pass through to apps behind via the main overlay (which ignores cursor events).
 */
export default function OverlayInteraction() {
  const [isDragging, setIsDragging] = useState(false);
  const [isLocked, setIsLocked] = useState(() => {
    return localStorage.getItem('abe_overlay_locked') === 'true';
  });
  const [isActive, setIsActive] = useState(false); // When recording/processing, hide this overlay
  const { status: engineStatus, isChecking: isCheckingEngine } = useEngineStatus();
  const hasIssue = !isCheckingEngine && !engineStatus?.ready;
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);

  // Hide scrollbars, set transparent background, and constrain size
  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.background = 'transparent';
    document.documentElement.style.width = '95px';
    document.documentElement.style.height = '32px';
    document.body.style.overflow = 'hidden';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.width = '95px';
    document.body.style.height = '32px';
    const root = document.getElementById('root');
    if (root) {
      root.style.overflow = 'hidden';
      root.style.background = 'transparent';
      root.style.height = '32px';
      root.style.width = '95px';
    }
  }, []);

  // Listen for recording state changes to show/hide this overlay
  useEffect(() => {
    const unlistenStart = listen('overlay-recording-start', () => {
      setIsActive(true);
    });
    const unlistenStop = listen('overlay-recording-stop', () => {
      setIsActive(false);
    });
    const unlistenProcessing = listen('overlay-processing', () => {
      setIsActive(true);
    });
    const unlistenTransformStart = listen('overlay-transform-start', () => {
      setIsActive(true);
    });
    const unlistenTransformStop = listen('overlay-transform-stop', () => {
      setIsActive(false);
    });
    const unlistenTransformProcessing = listen('overlay-transform-processing', () => {
      setIsActive(true);
    });
    // A warning or error ends the recording/processing state; come back so the
    // pill can be dragged again (F10)
    const unlistenEnded = ['overlay-warning', 'overlay-error', 'overlay-blocked'].map(event =>
      listen(event, () => setIsActive(false)));

    return () => {
      unlistenStart.then(fn => fn());
      unlistenStop.then(fn => fn());
      unlistenProcessing.then(fn => fn());
      unlistenTransformStart.then(fn => fn());
      unlistenTransformStop.then(fn => fn());
      unlistenTransformProcessing.then(fn => fn());
      unlistenEnded.forEach(unlisten => unlisten.then(fn => fn()));
    };
  }, []);

  // Hide this overlay when active (recording/processing)
  useEffect(() => {
    (isActive ? interactionWindow.hide() : interactionWindow.show()).catch(console.error);
  }, [isActive]);

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isLocked || e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.screenX, y: e.screenY };
    didDragRef.current = false;
  }, [isLocked]);

  // Restore saved position on mount
  useEffect(() => {
    const savedPosition = localStorage.getItem('abe_overlay_position');
    if (savedPosition) {
      try {
        const { x, y } = JSON.parse(savedPosition);
        // Moves both overlays (logical pixels)
        invoke('position_overlay', { x, y }).catch(console.error);
      } catch (error) {
        console.error('Failed to restore overlay position:', error);
      }
    }
  }, []);

  // Handle drag
  useEffect(() => {
    if (!isDragging) return;

    // At most one move per frame, always to the latest position
    let frame: number | null = null;
    let pending: { x: number; y: number } | null = null;
    const flush = () => {
      frame = null;
      if (!pending) return;
      const position = pending;
      pending = null;
      // screenX/screenY are CSS (logical) pixels, which is what position_overlay takes (R17)
      lastPositionRef.current = position;
      invoke('position_overlay', position).catch((error) => console.error('Failed to move overlay:', error));
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const dx = Math.abs(e.screenX - dragStartRef.current.x);
      const dy = Math.abs(e.screenY - dragStartRef.current.y);
      if (dx > 3 || dy > 3) {
        didDragRef.current = true;
      }

      // Top-left of the main overlay, keeping the pill under the cursor
      pending = { x: Math.round(e.screenX - 160), y: Math.round(e.screenY - 40) };
      if (frame === null) frame = requestAnimationFrame(flush);

      dragStartRef.current = { x: e.screenX, y: e.screenY };
    };

    const handleMouseUp = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      flush();
      setIsDragging(false);
      dragStartRef.current = null;

      if (lastPositionRef.current) {
        localStorage.setItem('abe_overlay_position', JSON.stringify(lastPositionRef.current));
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Handle right-click to toggle lock
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const newLocked = !isLocked;
    setIsLocked(newLocked);
    localStorage.setItem('abe_overlay_locked', String(newLocked));
  }, [isLocked]);

  // Handle click to open engine setup when no engine is ready
  const handleClick = useCallback(async () => {
    if (didDragRef.current) return;

    if (hasIssue) {
      // The main window shows and focuses itself on this event; the overlay
      // has no permission to control other windows.
      try {
        await emit('open-engine-setup', {});
      } catch (error) {
        console.error('Failed to open engine setup:', error);
      }
    }
  }, [hasIssue]);

  // Determine cursor
  const getCursor = () => {
    if (isLocked) return hasIssue ? 'pointer' : 'default';
    if (isDragging) return 'grabbing';
    return 'grab';
  };

  // Broadcast hover state to RecordingOverlay via Tauri events
  const handleMouseEnter = useCallback(() => {
    emit('overlay-hover', { hovering: true }).catch(console.error);
  }, []);

  const handleMouseLeave = useCallback(() => {
    emit('overlay-hover', { hovering: false }).catch(console.error);
  }, []);

  // Set window size on mount to ensure it's correct
  useEffect(() => {
    invoke('set_window_size', { width: 95, height: 32 }).catch(console.error);
  }, []);

  // Invisible interaction area - captures mouse events for dragging
  return (
    <div
      className="w-full h-full select-none"
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      style={{ cursor: getCursor() }}
    />
  );
}
