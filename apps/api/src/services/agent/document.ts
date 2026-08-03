import { nanoid } from 'nanoid';
import { AppError } from '@api/utils/errors';
import {
  MAX_DOCUMENT_TEXT_LENGTH,
  MAX_AGENT_DOCUMENT_SIZE,
  DOCUMENT_REDIS_TTL,
  SUPPORTED_DOCUMENT_TYPES
} from '@cio/ai-assistant';
import type { DocumentUploadResult } from '@cio/ai-assistant';
import { agentDocumentKey, agentDocumentSummaryKey, computeContentHash } from '@api/utils/redis/key-generators';
import { summarizeDocument } from '@api/services/agent/summarize';
import { trackAgentEvent, AgentEvent } from '@api/utils/tinybird';
import type { RedisClient } from '@api/utils/redis/redis';
import { createChatDocument, getChatDocument, findChatDocumentByContentHash } from '@cio/db/queries/agent';
import { generateFileKey } from '@api/utils/upload';
import { uploadToS3 } from '@api/utils/s3';
import { getStorageConfig } from '@api/config/storage';
import { createAssetFromUploadService } from '@api/services/assets/assets';

export interface ParsedDocument {
  text: string;
  fileName: string;
  mimeType: string;
  pageCount: number | null;
  wordCount: number;
  textPreview: string;
  truncated: boolean;
}

/**
 * Validate and extract text from an uploaded document (PDF, DOCX, PPTX). Does
 * not store anything — callers persist as needed. Throws 415/413 on bad input.
 */
export async function parseDocument(file: File): Promise<ParsedDocument> {
  const mimeType = file.type;

  if (!SUPPORTED_DOCUMENT_TYPES.includes(mimeType as (typeof SUPPORTED_DOCUMENT_TYPES)[number])) {
    throw new AppError('Unsupported file type. Allowed: PDF, DOCX, PPTX', 'UNSUPPORTED_FILE_TYPE', 415);
  }

  if (file.size > MAX_AGENT_DOCUMENT_SIZE) {
    throw new AppError(
      `File too large. Maximum size is ${MAX_AGENT_DOCUMENT_SIZE / (1024 * 1024)}MB`,
      'FILE_TOO_LARGE',
      413
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let extractedText: string;
  let pageCount: number | null = null;

  switch (mimeType) {
    case 'application/pdf':
      ({ text: extractedText, pageCount } = await extractPdfText(buffer));
      break;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      extractedText = await extractDocxText(buffer);
      break;
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      ({ text: extractedText, pageCount } = await extractPptxText(buffer));
      break;
    default:
      throw new AppError('Unsupported file type', 'UNSUPPORTED_FILE_TYPE', 415);
  }

  const truncated = extractedText.length > MAX_DOCUMENT_TEXT_LENGTH;

  if (truncated) {
    extractedText = extractedText.slice(0, MAX_DOCUMENT_TEXT_LENGTH);
  }

  const wordCount = extractedText.split(/\s+/).filter(Boolean).length;
  const textPreview = extractedText.slice(0, 200);

  return { text: extractedText, fileName: file.name, mimeType, pageCount, wordCount, textPreview, truncated };
}

/**
 * Store an already-parsed document as a DRAFT — Redis only, no conversation,
 * no course, no S3/asset/Postgres. Used by the pre-creation course wizard so a
 * teacher can attach material before the course exists. The stored `userId`
 * lets getDocumentText's ownership check pass on the first chat turn.
 */
export async function storeDraftDocument(
  parsed: ParsedDocument,
  userId: string,
  redis: RedisClient
): Promise<{ documentId: string }> {
  const documentId = nanoid();

  await redis.set(
    agentDocumentKey(documentId),
    JSON.stringify({
      text: parsed.text,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      userId,
      uploadedAt: new Date().toISOString(),
      // Carried so `promoteDraftDocuments` can persist a faithful record instead
      // of recomputing an approximation from the text.
      wordCount: parsed.wordCount,
      pageCount: parsed.pageCount
    }),
    { EX: DOCUMENT_REDIS_TTL }
  );

  return { documentId };
}

/**
 * Turn draft documents into real course sources the first time a chat uses them.
 *
 * The course wizard says "we'll use them as a source for your course", but a
 * draft lives in Redis only — no course, no row — because at upload time the
 * course does not exist yet. Nothing ever moved it across, so the material was
 * invisible in the Sources panel and, worse, GONE once DOCUMENT_REDIS_TTL (1h)
 * expired: a course built from a document that no longer existed anywhere, with
 * no way for the agent to re-read it or the teacher to recover it.
 *
 * Runs on the chat turn because that is the first moment both halves exist — the
 * draft id and a real course. Best-effort by design: a failure here must not take
 * down the turn, since the model can still read the text from Redis.
 *
 * The original bytes are not kept (the draft upload never touched S3), so the
 * promoted row has no asset. The extracted text — the part the agent actually
 * needs — is preserved in full.
 */
export async function promoteDraftDocuments(
  documentIds: string[],
  params: { userId: string; courseId: string; conversationId: string },
  redis: RedisClient
): Promise<number> {
  let promoted = 0;

  for (const documentId of documentIds) {
    try {
      if (await getChatDocument(documentId, params.userId)) continue;

      const raw = await redis.get(agentDocumentKey(documentId));
      if (!raw) continue;

      const draft = JSON.parse(raw) as {
        text?: string;
        fileName?: string;
        mimeType?: string;
        userId?: string;
        wordCount?: number;
        pageCount?: number;
      };

      // Someone else's draft id: leave it alone rather than copying their
      // material into this teacher's course.
      if (!draft.text || (draft.userId && draft.userId !== params.userId)) continue;

      const contentHash = computeContentHash(draft.text);
      const existing = await findChatDocumentByContentHash(params.courseId, contentHash);
      if (existing) continue;

      await createChatDocument({
        id: documentId,
        conversationId: params.conversationId,
        courseId: params.courseId,
        userId: params.userId,
        assetId: null,
        fileName: draft.fileName ?? 'document',
        mimeType: draft.mimeType ?? 'application/octet-stream',
        text: draft.text,
        contentHash,
        wordCount: draft.wordCount ?? draft.text.split(/\s+/).filter(Boolean).length,
        pageCount: draft.pageCount ?? null
      });

      promoted += 1;
      console.log(`[agent.documents] promoted draft ${documentId} to source of course ${params.courseId}`);
    } catch (error) {
      console.warn(`[agent.documents] could not promote draft ${documentId}:`, error);
    }
  }

  return promoted;
}

/**
 * Parse an uploaded document, store extracted text in Redis (hot cache) and Postgres
 * (durable, scoped to a conversation). Supports PDF, DOCX, and PPTX files.
 */
export async function parseAndStoreDocument(
  file: File,
  orgId: string,
  userId: string,
  courseId: string,
  conversationId: string,
  redis: RedisClient
): Promise<DocumentUploadResult> {
  const parsed = await parseDocument(file);
  const { text: extractedText, mimeType, pageCount, wordCount, textPreview, truncated } = parsed;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Hash the extracted text so users in the same course can share cache
  // entries for identical files. Same content → same hash → same cache key.
  const contentHash = computeContentHash(extractedText);

  // Multi-user dedup: if any user in the same course already uploaded a
  // document with the same content, return that documentId instead of
  // creating a duplicate row + S3 asset. The first user keeps the original
  // reference; subsequent uploads only bump the conversation attachment.
  const existing = await findChatDocumentByContentHash(courseId, contentHash);
  if (existing) {
    // Make the cached text available for this user via the standard Redis
    // key, then return the existing id.
    await redis.set(
      agentDocumentKey(existing.id),
      JSON.stringify({
        text: existing.text,
        fileName: existing.fileName,
        mimeType: existing.mimeType,
        userId: existing.userId,
        uploadedAt: existing.createdAt
      }),
      { EX: DOCUMENT_REDIS_TTL }
    );
    return {
      documentId: existing.id,
      fileName: existing.fileName,
      mimeType: existing.mimeType,
      pageCount: existing.pageCount,
      wordCount: existing.wordCount,
      textPreview,
      truncated
    };
  }

  const documentId = nanoid();

  // Persist the original file to S3 and register it as an asset so it shows
  // up in the org's asset manager — same pipeline lessons use.
  const storageKey = generateFileKey(file.name);
  const storageConfig = getStorageConfig();
  const uploadResult = await uploadToS3({
    Bucket: storageConfig.bucketDocuments,
    Key: storageKey,
    Body: buffer,
    ContentType: mimeType
  });

  if (!uploadResult.success) {
    throw new AppError(
      `Failed to upload document to storage: ${uploadResult.error ?? 'unknown error'}`,
      'DOCUMENT_STORAGE_FAILED',
      500
    );
  }

  const asset = await createAssetFromUploadService(orgId, userId, {
    kind: 'document',
    provider: 'upload',
    storageProvider: 's3',
    storageKey,
    byteSize: file.size,
    mimeType,
    title: file.name,
    isExternal: false,
    metadata: { source: 'ai_chat', conversationId }
  });

  await redis.set(
    agentDocumentKey(documentId),
    JSON.stringify({
      text: extractedText,
      fileName: file.name,
      mimeType,
      userId,
      uploadedAt: new Date().toISOString()
    }),
    { EX: DOCUMENT_REDIS_TTL }
  );

  await createChatDocument({
    id: documentId,
    conversationId,
    courseId,
    userId,
    assetId: asset.id,
    fileName: file.name,
    mimeType,
    text: extractedText,
    contentHash,
    wordCount,
    pageCount
  });

  trackAgentEvent(AgentEvent.DOCUMENT_UPLOADED, {
    orgId,
    userId,
    courseId,
    mimeType,
    fileSize: file.size,
    wordCount,
    truncated
  });

  return {
    documentId,
    fileName: file.name,
    mimeType,
    pageCount,
    wordCount,
    textPreview,
    truncated
  };
}

/** MIME type used for sources captured from a web page (Jina returns markdown). */
export const URL_SOURCE_MIME_TYPE = 'text/markdown';

/**
 * Persist a fetched web page as a course source, alongside uploaded PDFs.
 *
 * A URL used to reach the model only as a `fetch_documentation_url` tool result
 * living in the chat transcript — and build mode drops the transcript, so the page
 * vanished at exactly the moment the course was written from it. Stored as a
 * document instead, it shows up in the Sources panel, joins the cached source
 * pack, and survives the build.
 *
 * There is no S3 asset (`assetId: null`): the original lives at its URL. Dedup is
 * by content hash within the course, so re-adding the same page is a no-op and two
 * teachers adding it share one cache entry.
 */
export async function storeUrlDocument(params: {
  url: string;
  pageTitle: string;
  markdown: string;
  orgId: string;
  userId: string;
  courseId: string;
  conversationId: string;
  redis: RedisClient;
}): Promise<DocumentUploadResult & { reused: boolean }> {
  const { url, pageTitle, markdown, orgId, userId, courseId, conversationId, redis } = params;

  const text = markdown.slice(0, MAX_DOCUMENT_TEXT_LENGTH);
  const truncated = markdown.length > MAX_DOCUMENT_TEXT_LENGTH;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  // Title first, falling back to the URL, so the Sources list is readable. The
  // equality guard avoids "es.wikipedia.org (es.wikipedia.org)" when the title
  // could not be extracted and already degraded to the hostname.
  const hostname = new URL(url).hostname;
  const title = pageTitle?.trim();
  const fileName = title ? (title === hostname ? url : `${title} (${hostname})`) : url;
  const contentHash = computeContentHash(text);

  const existing = await findChatDocumentByContentHash(courseId, contentHash);
  if (existing) {
    return {
      documentId: existing.id,
      fileName: existing.fileName,
      mimeType: existing.mimeType,
      pageCount: existing.pageCount,
      wordCount: existing.wordCount,
      textPreview: text.slice(0, 500),
      truncated,
      reused: true
    };
  }

  const documentId = nanoid();

  await redis.set(
    agentDocumentKey(documentId),
    JSON.stringify({
      text,
      fileName,
      mimeType: URL_SOURCE_MIME_TYPE,
      userId,
      uploadedAt: new Date().toISOString()
    }),
    { EX: DOCUMENT_REDIS_TTL }
  );

  await createChatDocument({
    id: documentId,
    conversationId,
    courseId,
    userId,
    assetId: null,
    fileName,
    mimeType: URL_SOURCE_MIME_TYPE,
    text,
    contentHash,
    wordCount,
    pageCount: null
  });

  trackAgentEvent(AgentEvent.DOCUMENT_UPLOADED, {
    orgId,
    userId,
    courseId,
    mimeType: URL_SOURCE_MIME_TYPE,
    fileSize: text.length,
    wordCount,
    truncated
  });

  return {
    documentId,
    fileName,
    mimeType: URL_SOURCE_MIME_TYPE,
    pageCount: null,
    wordCount,
    textPreview: text.slice(0, 500),
    truncated,
    reused: false
  };
}

/**
 * Retrieve stored document text. Tries the Redis hot cache first; on miss
 * falls back to Postgres and rehydrates Redis for next time.
 */
export async function getDocumentText(documentId: string, userId: string, redis: RedisClient): Promise<string | null> {
  const raw = await redis.get(agentDocumentKey(documentId));

  if (raw) {
    const parsed = JSON.parse(raw) as { text: string; userId?: string };

    if (parsed.userId && parsed.userId !== userId) return null;

    return parsed.text;
  }

  const record = await getChatDocument(documentId, userId);

  if (!record) return null;

  await redis.set(
    agentDocumentKey(documentId),
    JSON.stringify({
      text: record.text,
      fileName: record.fileName,
      mimeType: record.mimeType,
      userId: record.userId,
      uploadedAt: record.createdAt
    }),
    { EX: DOCUMENT_REDIS_TTL }
  );

  return record.text;
}

const DOCUMENT_SUMMARY_EXCERPT_CHARS = 1_500;

/**
 * Lazily generated, Redis-cached short summary of a document, injected on
 * follow-up turns instead of the full text. Falls back to a truncated excerpt
 * on no-provider / generation failure. Never throws — must not block the chat.
 */
export async function getDocumentSummary(
  documentId: string,
  userId: string,
  redis: RedisClient
): Promise<string | null> {
  const cached = await redis.get(agentDocumentSummaryKey(documentId));

  if (cached) return cached;

  const text = await getDocumentText(documentId, userId, redis);

  if (!text) return null;

  try {
    const summary = await summarizeDocument(text);

    if (summary) {
      await redis.set(agentDocumentSummaryKey(documentId), summary, { EX: DOCUMENT_REDIS_TTL });

      return summary;
    }
  } catch {
    // Fall through to excerpt — never block the chat on a summary failure.
  }

  // Excerpt fallback (NOT cached, so a real summary can replace it next turn).
  return text.slice(0, DOCUMENT_SUMMARY_EXCERPT_CHARS);
}

// ─── Extraction Helpers ──────────────────────────────────────────────────────

async function extractPdfText(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const pdfParse = (await import('pdf-parse')).default;
  const result = await pdfParse(buffer);

  return { text: result.text, pageCount: result.numpages };
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });

  return result.value;
}

async function extractPptxText(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  // pptx-parser may not be available yet — use a simpler approach
  // For now, try to use officegen or a basic XML extraction
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);

    const slideTexts: string[] = [];
    const slideFiles = Object.keys(zip.files)
      .filter((name) => name.match(/^ppt\/slides\/slide\d+\.xml$/))
      .sort();

    for (const slideFile of slideFiles) {
      const content = await zip.files[slideFile].async('text');
      // Extract text from XML by stripping tags
      const textContent = content
        .replace(/<a:t[^>]*>/g, '')
        .replace(/<\/a:t>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (textContent) {
        slideTexts.push(textContent);
      }
    }

    return { text: slideTexts.join('\n\n---\n\n'), pageCount: slideFiles.length };
  } catch {
    throw new AppError('Failed to parse PPTX file', 'PPTX_PARSE_ERROR', 422);
  }
}
