CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "embeddings" (
  "id" text PRIMARY KEY NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text NOT NULL,
  "parent_id" text,
  "user_id" text,
  "thread_id" text,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "embedding" vector(768) NOT NULL,
  "embedding_provider" text NOT NULL,
  "embedding_model" text NOT NULL,
  "embedding_dimensions" integer NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "embeddings_source_type_check"
    CHECK ("source_type" IN ('workflow', 'workflow_run', 'attachment_chunk', 'chat_summary'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_embeddings_source_content_hash"
  ON "embeddings" USING btree ("source_type", "source_id", "content_hash");

CREATE INDEX IF NOT EXISTS "idx_embeddings_source"
  ON "embeddings" USING btree ("source_type", "source_id");

CREATE INDEX IF NOT EXISTS "idx_embeddings_parent"
  ON "embeddings" USING btree ("parent_id");

CREATE INDEX IF NOT EXISTS "idx_embeddings_user_thread"
  ON "embeddings" USING btree ("user_id", "thread_id");

CREATE INDEX IF NOT EXISTS "idx_embeddings_created_at"
  ON "embeddings" USING btree ("created_at");

-- pgvector ANN index for cosine similarity (used by semantic retrieval).
CREATE INDEX IF NOT EXISTS "idx_embeddings_vector_cosine"
  ON "embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
