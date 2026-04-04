ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "timezone" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "chat_attachments" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "thread_id" text REFERENCES "chat_threads"("id"),
  "message_id" text REFERENCES "chat_messages"("id"),
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_path" text NOT NULL,
  "checksum" text NOT NULL,
  "processing_status" text NOT NULL DEFAULT 'uploaded',
  "extracted_text" text,
  "structured_metadata" jsonb,
  "preview_data" jsonb,
  "error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_chat_attachments_user" ON "chat_attachments" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_attachments_thread" ON "chat_attachments" ("thread_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_attachments_message" ON "chat_attachments" ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_attachments_checksum" ON "chat_attachments" ("checksum");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "chat_attachment_chunks" (
  "id" text PRIMARY KEY NOT NULL,
  "attachment_id" text NOT NULL REFERENCES "chat_attachments"("id"),
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "token_count" integer,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_chat_attachment_chunks_attachment" ON "chat_attachment_chunks" ("attachment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_attachment_chunks_user" ON "chat_attachment_chunks" ("user_id");
