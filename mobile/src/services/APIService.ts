const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

interface TranscriptionResponse {
  transcription: string;
  recordingId: string;
  timestamp: string;
  // AssemblyAI may return transcription with speaker labels
  hasDiarization?: boolean;
}

interface SearchResult {
  id: string;
  text: string;
  timestamp: string;
  recordingId: string;
  score: number;
}

interface SearchResponse {
  results: SearchResult[];
  answer?: string;
  sources?: Array<{
    text: string;
    timestamp: string;
    topic: string;
    score: number;
  }>;
}

class APIService {
  async sendAudioBase64(base64Audio: string, recordingId: string, format: string = 'm4a'): Promise<TranscriptionResponse> {
    const formData = new FormData();
    
    // Create a file-like object from base64
    const mimeType = format === 'wav' ? 'audio/wav' : 'audio/m4a';
    const filename = format === 'wav' ? 'recording.wav' : 'recording.m4a';
    
    formData.append('audio', {
      uri: `data:${mimeType};base64,${base64Audio}`,
      type: mimeType,
      name: filename,
    } as any);
    formData.append('recordingId', recordingId);

    const response = await fetch(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Transcription failed: ${response.statusText}`);
    }

    return response.json();
  }

  async searchTranscripts(query: string): Promise<SearchResponse> {
    // Try ZeroEntropy + GPT search first
    try {
      const response = await fetch(`${API_BASE_URL}/api/zeroentropy/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          query,
          limit: 5,
          useGPT: true 
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Using ZeroEntropy + GPT search');
        return data;
      }
    } catch (error) {
      console.log('ZeroEntropy search failed, falling back to regular search');
    }

    // Fallback to regular search
    const response = await fetch(`${API_BASE_URL}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getRecentTranscripts(limit: number = 10): Promise<SearchResult[]> {
    // Try to fetch from ZeroEntropy first
    try {
      const response = await fetch(`${API_BASE_URL}/api/zeroentropy/documents?limit=${limit}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`Fetched ${data.count} documents from ZeroEntropy`);
        return data.documents || [];
      }
    } catch (error) {
      console.log('ZeroEntropy fetch failed, falling back to mock data');
    }

    // Fallback to mock data endpoint
    const response = await fetch(`${API_BASE_URL}/api/transcripts/recent?limit=${limit}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch recent transcripts: ${response.statusText}`);
    }

    return response.json();
  }

  async uploadTextDocument(
    text: string,
    options?: { path?: string; metadata?: Record<string, any>; collectionName?: string }
  ): Promise<any> {
    const body: any = {
      text,
    };
    if (options?.path) body.path = options.path;
    if (options?.metadata) body.metadata = options.metadata;
    if (options?.collectionName) body.collection_name = options.collectionName;

    const response = await fetch(`${API_BASE_URL}/api/zeroentropy/upload-text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to upload document: ${response.statusText}`);
    }

    return response.json();
  }

  async deleteDocument(path: string, collectionName: string = 'ai-wearable-transcripts'): Promise<any> {
    const response = await fetch(`${API_BASE_URL}/api/zeroentropy/delete-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path, collection_name: collectionName }),
    });
    if (!response.ok) {
      throw new Error(`Failed to delete document: ${response.statusText}`);
    }
    return response.json();
  }
}

export default new APIService();