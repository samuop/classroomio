import { describe, expect, it } from 'vitest';
import { resolveTeacherPromptMode } from '../services/agent/chat-context';

/**
 * The phase decides which tools ship to the model. `plan` is deliberately
 * read-only, so getting this wrong does not degrade an answer — it makes the
 * agent unable to act, and it says so out loud to the teacher.
 */

describe('resolveTeacherPromptMode', () => {
  it('builds once a plan has been approved', () => {
    expect(
      resolveTeacherPromptMode({ isTeacher: true, hasApprovedPlan: true, existingSectionCount: 0 })
    ).toBe('build');
  });

  it('plans only on a course with nothing in it yet', () => {
    expect(
      resolveTeacherPromptMode({ isTeacher: true, hasApprovedPlan: false, existingSectionCount: 0 })
    ).toBe('plan');
  });

  it('gives a fresh chat on an ALREADY-BUILT course the write tools', () => {
    // The regression this file exists for: no approved plan in this transcript,
    // no lesson open, but eight sections of real content on screen. Reading the
    // transcript alone said 'plan', and the agent answered that it had no tool
    // to write lesson notes — on a course full of lessons.
    expect(
      resolveTeacherPromptMode({ isTeacher: true, hasApprovedPlan: false, existingSectionCount: 8 })
    ).toBe('full');
  });

  it('still gives the write tools while a single lesson is open', () => {
    expect(
      resolveTeacherPromptMode({
        isTeacher: true,
        hasApprovedPlan: false,
        lessonId: 'lesson-1',
        existingSectionCount: 0
      })
    ).toBe('full');
  });

  it('prefers build over full when a plan exists and a lesson is open', () => {
    expect(
      resolveTeacherPromptMode({
        isTeacher: true,
        hasApprovedPlan: true,
        lessonId: 'lesson-1',
        existingSectionCount: 8
      })
    ).toBe('build');
  });

  it('never puts a student into a teacher phase', () => {
    expect(
      resolveTeacherPromptMode({ isTeacher: false, hasApprovedPlan: false, existingSectionCount: 0 })
    ).toBe('full');
    expect(
      resolveTeacherPromptMode({ isTeacher: false, hasApprovedPlan: true, existingSectionCount: 8 })
    ).toBe('full');
  });
});
