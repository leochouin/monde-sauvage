import { useEffect, useState } from 'react';
import './IntroSplash.css';

const FALLBACK_DURATION_MS = 4000;
const FADE_DURATION_MS = 1000;
const MIN_DURATION_MS = 1800;
const END_EVENT_FALLBACK_OFFSET_MS = 220;
const POST_END_HOLD_MS = 700;

export default function IntroSplash({ onComplete }) {
  const [fadeOut, setFadeOut] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [totalDurationMs, setTotalDurationMs] = useState(FALLBACK_DURATION_MS);

  const handleVideoMetadata = (event) => {
    const nextDurationSeconds = event?.currentTarget?.duration;

    if (!Number.isFinite(nextDurationSeconds) || nextDurationSeconds <= 0) {
      return;
    }

    const nextDurationMs = Math.round(nextDurationSeconds * 1000);
    setTotalDurationMs(Math.max(nextDurationMs, MIN_DURATION_MS));
  };

  const handleVideoEnded = () => {
    setVideoEnded(true);
  };

  useEffect(() => {
    if (!videoEnded) return undefined;

    const holdTimer = setTimeout(() => {
      setFadeOut(true);
    }, POST_END_HOLD_MS);

    return () => {
      clearTimeout(holdTimer);
    };
  }, [videoEnded]);

  useEffect(() => {
    const fallbackFadeTimer = setTimeout(() => {
      setFadeOut(true);
    }, totalDurationMs + POST_END_HOLD_MS + END_EVENT_FALLBACK_OFFSET_MS);

    return () => {
      clearTimeout(fallbackFadeTimer);
    };
  }, [totalDurationMs]);

  useEffect(() => {
    if (!fadeOut) return undefined;

    const doneTimer = setTimeout(() => {
      setIsDone(true);
      onComplete?.();
    }, FADE_DURATION_MS);

    return () => {
      clearTimeout(doneTimer);
    };
  }, [fadeOut, onComplete]);

  if (isDone) {
    return null;
  }

  return (
    <div className={`intro-splash ${fadeOut ? 'intro-splash--fade-out' : ''}`} aria-hidden="true">
      <div className="intro-splash__background" />
      <video
        className="intro-splash__video"
        autoPlay
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={handleVideoMetadata}
        onEnded={handleVideoEnded}
      >
        <source src="/intro.mp4" type="video/mp4" />
      </video>
      <div className="intro-splash__overlay" />

      <img
        src="/logo-mondesauvage.png"
        alt="Monde Sauvage"
        className="intro-splash__logo"
        loading="eager"
        fetchPriority="high"
        decoding="sync"
        draggable="false"
      />
    </div>
  );
}
