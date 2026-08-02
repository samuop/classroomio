-- Add content_hash column to ai_chat_document for multi-user cache sharing
ALTER TABLE "ai_chat_document" ADD COLUMN IF NOT EXISTS "content_hash" text;
CREATE INDEX IF NOT EXISTS "idx_ai_chat_document_course_hash" ON "ai_chat_document" ("course_id", "content_hash");