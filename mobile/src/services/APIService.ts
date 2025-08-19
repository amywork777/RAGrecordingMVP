const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

interface TranscriptionResponse {
  transcription: string;
  recordingId: string;
  timestamp: string;
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
}

class APIService {
  async sendAudioChunk(audioData: ArrayBuffer, recordingId: string): Promise<TranscriptionResponse> {
    const formData = new FormData();
    const blob = new Blob([audioData], { type: 'audio/wav' });
    formData.append('audio', blob as any, 'chunk.wav');
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
    const response = await fetch(`${API_BASE_URL}/api/transcripts/recent?limit=${limit}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch recent transcripts: ${response.statusText}`);
    }

    return response.json();
  }
}

export default new APIService();