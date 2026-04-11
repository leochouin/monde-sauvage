const DAY_MS = 24 * 60 * 60 * 1000;

const toUtcDate = (dateInput) => {
  if (!dateInput) return null;
  const date = new Date(`${dateInput}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const dateRangeKey = (startDate, endDate) => `${startDate}__${endDate}`;

export const buildNearbyDateCandidates = (startDate, endDate, offsetDays = 7) => {
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  if (!start || !end || end <= start) return [];

  const tripDurationMs = end.getTime() - start.getTime();
  const candidates = [];

  for (let offset = -offsetDays; offset <= offsetDays; offset += 1) {
    const candidateStart = new Date(start.getTime() + (offset * DAY_MS));
    const candidateEnd = new Date(candidateStart.getTime() + tripDurationMs);

    candidates.push({
      startDate: candidateStart.toISOString().slice(0, 10),
      endDate: candidateEnd.toISOString().slice(0, 10),
      offsetDays: offset,
      isOriginal: offset === 0,
      tripDurationDays: Math.round(tripDurationMs / DAY_MS),
    });
  }

  return candidates;
};

export const curateAlternativeDateOptions = (options, maxOptions = 7) => {
  if (!Array.isArray(options) || options.length === 0) return [];

  const withScore = options.map((option) => {
    const guideScore = (option.guideCount || 0) * 3;
    const chaletScore = (option.chaletCount || 0) * 2;
    const distancePenalty = Math.abs(option.offsetDays || 0) * 0.6;
    const score = guideScore + chaletScore - distancePenalty;

    return {
      ...option,
      score,
      hasAnyAvailability: (option.guideCount || 0) > 0 || (option.chaletCount || 0) > 0,
      isWeakOption: (option.guideCount || 0) === 0 || (option.chaletCount || 0) === 0,
    };
  });

  const originalOption = withScore.find((option) => option.isOriginal) || null;
  const alternatives = withScore
    .filter((option) => !option.isOriginal)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.guideCount || 0) !== (a.guideCount || 0)) return (b.guideCount || 0) - (a.guideCount || 0);
      if ((b.chaletCount || 0) !== (a.chaletCount || 0)) return (b.chaletCount || 0) - (a.chaletCount || 0);
      return Math.abs(a.offsetDays || 0) - Math.abs(b.offsetDays || 0);
    });

  const curated = alternatives.slice(0, Math.max(0, maxOptions - (originalOption ? 1 : 0)));
  const combined = originalOption ? [originalOption, ...curated] : curated;

  return combined.sort((a, b) => (a.offsetDays || 0) - (b.offsetDays || 0));
};
