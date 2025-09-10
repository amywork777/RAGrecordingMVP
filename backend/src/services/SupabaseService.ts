import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface DocumentUpsertInput {
  ze_collection_name: string;
  ze_path: string;
  ze_document_id?: string | null;
  recording_id?: string | null;
  timestamp?: string | null; // ISO
  topic?: string | null;
  mime_type?: string | null;
  original_name?: string | null;
  size_bytes?: number | null;
  source?: string | null;
  ze_index_status?: string | null;
  device_name?: string | null;
  duration_seconds?: number | null;
}

class SupabaseService {
  private client: SupabaseClient | null = null;

  private getClient(): SupabaseClient | null {
    if (this.client) return this.client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    this.client = createClient(url, key);
    return this.client;
  }

  isConfigured(): boolean {
    return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
  }

  async upsertDocument(input: DocumentUpsertInput): Promise<string | null> {
    const supabase = this.getClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('documents')
      .upsert({
        ze_collection_name: input.ze_collection_name,
        ze_path: input.ze_path,
        ze_document_id: input.ze_document_id || null,
        recording_id: input.recording_id || null,
        timestamp: input.timestamp || null,
        topic: input.topic || null,
        mime_type: input.mime_type || null,
        original_name: input.original_name || null,
        size_bytes: input.size_bytes ?? null,
        source: input.source || null,
        ze_index_status: input.ze_index_status || null,
        device_name: input.device_name || null,
        duration_seconds: input.duration_seconds ?? null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'ze_collection_name,ze_path'
      })
      .select('id')
      .single();

    if (error) {
      console.error('Supabase upsertDocument error:', error);
      return null;
    }
    return data?.id ?? null;
  }

  async setLatestAnnotation(documentId: string, title: string, summary: string, model?: string, tokens_used?: number): Promise<void> {
    const supabase = this.getClient();
    if (!supabase) return;
    // Mark previous latest false
    const { error: updErr } = await supabase
      .from('ai_annotations')
      .update({ is_latest: false })
      .eq('document_id', documentId)
      .eq('is_latest', true);
    if (updErr) {
      console.warn('Supabase setLatestAnnotation: could not mark previous latest false', updErr);
    }
    // Insert new latest
    const { error: insErr } = await supabase
      .from('ai_annotations')
      .insert({
        document_id: documentId,
        title,
        summary,
        model: model || null,
        tokens_used: tokens_used || null,
        is_latest: true,
      });
    if (insErr) {
      console.error('Supabase setLatestAnnotation insert error:', insErr);
    }
  }

  async fetchLatestAnnotationByPath(ze_collection_name: string, ze_path: string): Promise<{ title: string; summary: string } | null> {
    const supabase = this.getClient();
    if (!supabase) return null;

    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id')
      .eq('ze_collection_name', ze_collection_name)
      .eq('ze_path', ze_path)
      .single();
    if (docErr || !doc) return null;

    const { data: ann, error: annErr } = await supabase
      .from('ai_annotations')
      .select('title, summary')
      .eq('document_id', doc.id)
      .eq('is_latest', true)
      .limit(1)
      .single();
    if (annErr || !ann) return null;
    return { title: ann.title, summary: ann.summary };
  }

  async fetchDocumentByPath(ze_collection_name: string, ze_path: string): Promise<{ id: string; duration_seconds: number | null } | null> {
    const supabase = this.getClient();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('documents')
      .select('id, duration_seconds')
      .eq('ze_collection_name', ze_collection_name)
      .eq('ze_path', ze_path)
      .single();
    if (error || !data) return null;
    return data as any;
  }

  async findDocumentByRecordingId(recordingId: string): Promise<{ id: string } | null> {
    const supabase = this.getClient();
    if (!supabase) return null;
    
    const { data, error } = await supabase
      .from('documents')
      .select('id')
      .eq('recording_id', recordingId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned, not an error for our use case
        return null;
      }
      throw error;
    }

    return data as any;
  }

  async getRecentTranscriptions(limit: number = 20, offset: number = 0): Promise<any[] | null> {
    const supabase = this.getClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('documents')
      .select(`
        id,
        ze_document_id,
        ze_path,
        recording_id,
        timestamp,
        topic,
        mime_type,
        original_name,
        size_bytes,
        source,
        duration_seconds,
        ai_annotations!inner (
          title,
          summary,
          is_latest
        )
      `)
      .eq('ai_annotations.is_latest', true)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Supabase getRecentTranscriptions error:', error);
      return null;
    }

    // Flatten the ai_annotations data
    return data?.map(doc => ({
      id: doc.id,
      ze_document_id: doc.ze_document_id,
      ze_path: doc.ze_path,
      recording_id: doc.recording_id,
      timestamp: doc.timestamp,
      topic: doc.topic,
      mime_type: doc.mime_type,
      original_name: doc.original_name,
      size_bytes: doc.size_bytes,
      source: doc.source,
      duration_seconds: doc.duration_seconds,
      ai_title: (doc.ai_annotations as any)?.[0]?.title,
      ai_summary: (doc.ai_annotations as any)?.[0]?.summary,
      title: (doc.ai_annotations as any)?.[0]?.title,
      summary: (doc.ai_annotations as any)?.[0]?.summary,
    })) || null;
  }
}

export default new SupabaseService();

