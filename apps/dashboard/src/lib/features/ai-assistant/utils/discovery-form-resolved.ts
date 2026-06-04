import type { AiAssistantMessage, AiAssistantMessageMetadata } from '$features/ai-assistant/utils/types';

export function isDiscoveryFormResolved(messages: AiAssistantMessage[], formId: string): boolean {
  return messages.some((message) => {
    if (message.role !== 'user') {
      return false;
    }

    const meta = message.metadata as AiAssistantMessageMetadata | undefined;
    const discovery = meta?.discovery;

    if (!discovery || !('action' in discovery)) {
      return false;
    }

    return (
      (discovery.action === 'submit_discovery_answers' || discovery.action === 'skip_discovery_form') &&
      discovery.formId === formId
    );
  });
}
