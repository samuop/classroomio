/**
 * Where a student may not reach for the assistant.
 *
 * An exercise is the one place in a course where the point is what the student
 * knows, not what they can look up — so on that page they do not get the button
 * at all, rather than a button that opens a chat which then refuses to answer.
 * A disabled control still tells them help exists and is being withheld; no
 * control says the question is theirs to answer, which is the truthful framing.
 *
 * Teachers keep it everywhere: on an exercise page they are writing or reviewing
 * the thing, and that is exactly when they want a hand.
 */
const ASSESSMENT_PATH = /^\/courses\/[^/]+\/exercises\/[^/]+/;

/** True on the page where an exercise or exam is actually taken. */
export function isAssessmentPath(pathname: string): boolean {
  return ASSESSMENT_PATH.test(pathname);
}

/**
 * Whether the assistant should be unreachable right now.
 *
 * This is a rule about the interface, and it is worth being clear about what it
 * therefore is not: a student who opens the assistant on a lesson and then opens
 * the exercise in a second tab still has it. Closing that gap needs the server
 * to know an attempt is under way — there is no in-progress attempt today, a
 * submission row appears only when the exercise is handed in — so it would mean
 * introducing one, not tightening this check.
 */
export function isAssistantBlocked(pathname: string, isStudent: boolean): boolean {
  return isStudent && isAssessmentPath(pathname);
}
