// Types
export {
  AgentRole,
  AIProvider,
  ToolName,
  CoursePlanSchema,
  CoursePlanFieldsSchema,
  CoursePlanSectionSchema,
  CoursePlanItemSchema,
  MAX_DOCUMENT_TEXT_LENGTH,
  MAX_AGENT_DOCUMENT_SIZE,
  DOCUMENT_REDIS_TTL,
  MAX_STEPS_PER_ROUND,
  MAX_STEPS_PER_ROUND_STUDENT,
  MAX_OUTPUT_TOKENS_STUDENT,
  SUPPORTED_DOCUMENT_TYPES,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  TOKEN_COST_ESTIMATES,
  DEFAULT_AGENT_CONTEXT_BUDGET,
  resolveAgentContextBudget
} from './types';

export type {
  AIProviderConfig,
  AgentContext,
  CoursePlan,
  CoursePlanSection,
  CoursePlanItem,
  TokenUsage,
  TokenBalance,
  AgentStatus,
  AgentTutorStatus,
  DocumentUploadResult
} from './types';

// Providers
export {
  createModel,
  getProviderConfigForProvider,
  pickAnyConfiguredProvider,
  resolveModelName,
  getEmbeddingModel,
  EMBEDDING_MODEL_NAME,
  EMBEDDING_PROVIDER_OPTIONS,
  isAnthropicCompatibleProvider,
  ANTHROPIC_COMPATIBLE_PROVIDERS
} from './providers';

// Tools
export { getToolSchemas } from './tools';
export type { ToolSchema } from './tools';

// Prompts
export {
  buildSystemPrompt,
  buildTeacherSystemPrompt,
  buildStudentSystemPrompt,
  buildContextMessage,
  buildTeacherContextMessage,
  buildStudentContextMessage,
  SVG_DIAGRAM_RULES,
  MATH_FORMULA_RULES
} from './prompt';
export type { TeacherPromptMode } from './prompt/teacher';

export {
  COURSE_TEMPLATES,
  getCourseTemplate,
  TemplateFormFieldSchema,
  CourseTemplateIdSchema,
  DEPTH_TIERS,
  DEPTH_TIER_IDS,
  getDepthTier,
  describeDepthTier,
  type CourseTemplateId,
  type CourseTemplate,
  type TemplateFormField,
  type DepthTier,
  type DepthTierId
} from './templates';

// Tutor configuration
export {
  TUTOR_PERSONA_IDS,
  TUTOR_RESPONSE_LENGTHS,
  TUTOR_ASSESSMENT_MODES,
  TUTOR_CODE_POLICIES,
  TUTOR_GROUNDING_SCOPES,
  defaultAiTutorSettings,
  mergeAiTutorSettings,
  STUDENT_TUTOR_MONTHLY_CAP,
  STUDENT_TUTOR_APPROACHING_THRESHOLD,
  type AiTutorSettings,
  type AiTutorEscalation,
  type TutorPersonaId,
  type TutorResponseLength,
  type TutorAssessmentMode,
  type TutorCodePolicy,
  type TutorGroundingScope
} from './tutor-config';
