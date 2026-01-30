import React, { useEffect, useState } from "react";

/**
 * HighlightOverlay component that creates a spotlight effect on a target element
 * by rendering a dark overlay with a transparent cutout around the highlighted element.
 */
export default function HighlightOverlay({ targetId, isActive, onBackdropClick }) {
  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    if (!isActive || !targetId) {
      setTargetRect(null);
      return;
    }

    const updatePosition = () => {
      const element = document.querySelector(`[data-onboarding="${targetId}"]`);
      if (element) {
        const rect = element.getBoundingClientRect();
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        });
        
        // Temporarily elevate the target element's z-index
        element.style.position = 'relative';
        element.style.zIndex = '9998';
      } else {
        setTargetRect(null);
      }
    };

    // Initial position
    updatePosition();

    // Update on resize/scroll
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition);

    // Also update periodically in case of dynamic content
    const interval = setInterval(updatePosition, 500);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition);
      clearInterval(interval);
      
      // Reset the element's z-index when unmounting
      const element = document.querySelector(`[data-onboarding="${targetId}"]`);
      if (element) {
        element.style.position = '';
        element.style.zIndex = '';
      }
    };
  }, [targetId, isActive]);

  if (!isActive || !targetRect) return null;

  const padding = 10; // Extra space around the highlighted element
  const borderRadius = 14;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9997, // Just below the modal
        pointerEvents: 'auto'
      }}
      onClick={onBackdropClick}
    >
      {/* SVG overlay with cutout */}
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%'
        }}
      >
        <defs>
          <mask id="spotlight-mask">
            {/* White = visible (the dark overlay) */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {/* Black = transparent (the cutout) */}
            <rect
              x={targetRect.left - padding}
              y={targetRect.top - padding}
              width={targetRect.width + padding * 2}
              height={targetRect.height + padding * 2}
              rx={borderRadius}
              ry={borderRadius}
              fill="black"
            />
          </mask>
        </defs>
        
        {/* Dark overlay with mask */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.7)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      {/* Animated border around highlighted element */}
      <div
        style={{
          position: 'absolute',
          top: targetRect.top - padding,
          left: targetRect.left - padding,
          width: targetRect.width + padding * 2,
          height: targetRect.height + padding * 2,
          borderRadius: borderRadius,
          border: '3px solid #4A9B8E',
          boxShadow: '0 0 0 4px rgba(74, 155, 142, 0.3), 0 0 20px rgba(74, 155, 142, 0.5)',
          animation: 'pulse-highlight 2s ease-in-out infinite',
          pointerEvents: 'none'
        }}
      />

      {/* Inject animation keyframes */}
      <style>
        {`
          @keyframes pulse-highlight {
            0%, 100% {
              box-shadow: 0 0 0 4px rgba(74, 155, 142, 0.3), 0 0 20px rgba(74, 155, 142, 0.5);
            }
            50% {
              box-shadow: 0 0 0 8px rgba(74, 155, 142, 0.2), 0 0 30px rgba(74, 155, 142, 0.6);
            }
          }
        `}
      </style>
    </div>
  );
}