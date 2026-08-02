import { describe, expect, it } from 'vitest';
import { measureContextBreakdown } from '../services/agent/context-window';

/**
 * The breakdown exists to answer one question the occupancy percentage cannot:
 * would compacting actually free anything? On a teacher turn the source pack is
 * tens of thousands of tokens and is re-sent verbatim every request, so a gauge
 * at 90% is routinely 90% material and ~0% transcript.
 */

const SYSTEM = 'x'.repeat(4000); // ~1000 tokens

function userMessage(text: string) {
  return { role: 'user', content: [{ type: 'text', text }] };
}

describe('measureContextBreakdown', () => {
  it('attributes the source pack to the fixed side, not the conversation', () => {
    const breakdown = measureContextBreakdown({
      totalContextTokens: 120_000,
      systemPrompt: SYSTEM,
      sourcePackTokens: 71_160,
      turnContextText: 'y'.repeat(400),
      conversationMessages: [userMessage('z'.repeat(4000))]
    });

    expect(breakdown).toBeDefined();
    expect(breakdown!.sourcesTokens).toBe(71_160);
    expect(breakdown!.systemTokens).toBe(1000);
    expect(breakdown!.turnContextTokens).toBe(100);
    // Only the transcript is compactable, and here it is a rounding error next
    // to the material — exactly the case where offering "compact" is useless.
    expect(breakdown!.conversationTokens).toBeLessThan(1100);
  });

  it('makes the parts sum to the provider-reported total', () => {
    const total = 120_000;
    const breakdown = measureContextBreakdown({
      totalContextTokens: total,
      systemPrompt: SYSTEM,
      sourcePackTokens: 71_160,
      turnContextText: 'y'.repeat(400),
      conversationMessages: [userMessage('z'.repeat(4000))]
    })!;

    const sum =
      breakdown.systemTokens +
      breakdown.sourcesTokens +
      breakdown.turnContextTokens +
      breakdown.conversationTokens +
      breakdown.overheadTokens;

    // The measured parts are char estimates; `overheadTokens` is the derived
    // remainder, so the whole must still reconcile to the exact figure the
    // provider billed. If it does not, the gauge and its explanation disagree.
    expect(sum).toBe(total);
  });

  it('never reports negative overhead when estimates overshoot the total', () => {
    const breakdown = measureContextBreakdown({
      totalContextTokens: 100,
      systemPrompt: SYSTEM,
      sourcePackTokens: 71_160,
      turnContextText: '',
      conversationMessages: []
    })!;

    expect(breakdown.overheadTokens).toBe(0);
  });

  it('grows the conversation figure as the transcript grows', () => {
    const short = measureContextBreakdown({
      totalContextTokens: 120_000,
      systemPrompt: SYSTEM,
      turnContextText: '',
      conversationMessages: [userMessage('hola')]
    })!;

    const long = measureContextBreakdown({
      totalContextTokens: 120_000,
      systemPrompt: SYSTEM,
      turnContextText: '',
      conversationMessages: Array.from({ length: 40 }, () => userMessage('z'.repeat(2000)))
    })!;

    expect(long.conversationTokens).toBeGreaterThan(short.conversationTokens * 10);
  });

  it('counts string content as well as part arrays', () => {
    const asParts = measureContextBreakdown({
      totalContextTokens: 50_000,
      systemPrompt: '',
      turnContextText: '',
      conversationMessages: [userMessage('z'.repeat(4000))]
    })!;

    const asString = measureContextBreakdown({
      totalContextTokens: 50_000,
      systemPrompt: '',
      turnContextText: '',
      conversationMessages: [{ role: 'user', content: 'z'.repeat(4000) }]
    })!;

    // The two shapes both reach the provider; counting only one of them would
    // silently under-report the compactable side for whole classes of turn.
    expect(asString.conversationTokens).toBe(1000);
    expect(asParts.conversationTokens).toBeGreaterThanOrEqual(asString.conversationTokens);
  });

  it('reports nothing when the provider gave no usage figure', () => {
    // A fully estimated breakdown would look authoritative while being guesswork,
    // and compaction decisions would ride on it.
    expect(
      measureContextBreakdown({
        totalContextTokens: 0,
        systemPrompt: SYSTEM,
        turnContextText: '',
        conversationMessages: []
      })
    ).toBeUndefined();
  });
});
