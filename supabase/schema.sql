-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run

-- 1. Turn on pgvector (adds the "vector" column type + similarity operators)
create extension if not exists vector;

-- 2. Table that holds every chunk of every PDF
--    content   = the chunk text
--    metadata  = JSON like {"source": "report.pdf", "page": 3}
--    embedding = the chunk's meaning as 768 numbers (must match the embedding model's size)
create table if not exists documents (
  id bigserial primary key,
  content text,
  metadata jsonb,
  embedding vector(768)
);

-- 3. Index so similarity search stays fast as the table grows (HNSW, cosine distance)
create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);

-- 4. Search function LangChain calls: "give me the k chunks closest to this question vector"
create or replace function match_documents (
  query_embedding vector(768),
  match_count int default null,
  filter jsonb default '{}'
) returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where documents.metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 5. Lock the table down: only the server (service-role key) can touch it.
--    The browser never talks to the database directly.
alter table documents enable row level security;
