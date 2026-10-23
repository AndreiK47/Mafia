const NIGHT_ACTION_ROLES = new Set([
  'mafia', 'don', 'sheriff', 'doctor', 'detective', 'jailor',
  'prostitute', 'vagabond', 'maniac',
]);

/** Shared target eligibility for the live table, independent of a transient select-mode toggle. */
export function canSelectGameTarget({
  phase,
  actor,
  target,
  hasVoted = false,
  actionSubmitted = false,
  lastProtectedTargetUserId = null,
}) {
  if (!actor || actor.status !== 'alive' || !target || target.status !== 'alive') return false;

  if (phase === 'voting') {
    return !hasVoted && actor.userId !== target.userId;
  }
  if (phase !== 'night' || actionSubmitted || !NIGHT_ACTION_ROLES.has(actor.role)) return false;

  if (actor.userId === target.userId) return actor.role === 'doctor';
  if (actor.role === 'doctor' && target.userId === lastProtectedTargetUserId) return false;
  if ((actor.role === 'mafia' || actor.role === 'don') && target.team === 'mafia') return false;
  return true;
}
