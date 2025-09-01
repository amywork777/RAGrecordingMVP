import { v4 as uuidv4 } from 'uuid';
import MockDataService from './MockDataService';

interface Document {
  id: string;
  text: string;
  metadata: {
    timestamp: string;
    recordingId: string;
    userId?: string;
  };
}

interface SearchResult {
  id: string;
  text: string;
  score: number;
  metadata: any;
}

class ZeroEntropyService {
  private apiKey: string;
  private projectId: string;
  private baseUrl = 'https://api.zeroentropy.ai/v1';
  private useMockData = false; // Toggle for testing - Set to false to use real ZeroEntropy API

  constructor() {
    this.apiKey = process.env.ZEROENTROPY_API_KEY || '';
    this.projectId = process.env.ZEROENTROPY_PROJECT_ID || '';
  }

  async storeDocument(text: string, metadata: any): Promise<string> {
    const documentId = uuidv4();
    
    try {
      // Try to use real ZeroEntropy API
      const ZeroEntropy = (await import('zeroentropy')).default;
      const client = new ZeroEntropy({ apiKey: this.apiKey });
      
      await client.documents.add({
        collection_name: 'ai-wearable-transcripts',
        path: `recordings/recording-${documentId}.txt`,
        content: {
          type: 'text',
          text: text,
        },
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
          source: 'user-recording',
        },
      });
      
      console.log(`Document stored in ZeroEntropy: ${documentId}`);
      return documentId;
    } catch (error) {
      console.error('Error storing document in ZeroEntropy:', error);
      console.log('Using mock data storage instead...');
      return await MockDataService.addTranscript(text, metadata.recordingId);
    }
  }

  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    try {
      let response: Response;
      
      if (query && query.trim()) {
        // Use search endpoint for queries
        console.log(`[ZeroEntropyService] Searching documents for query: "${query}"`);
        response = await fetch(`https://api.zeroentropy.dev/v1/queries/top-documents`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            collection_name: 'ai-wearable-transcripts',
            query: query,
            k: limit || 10,
          }),
        });
      } else {
        // Use document list endpoint for recent transcripts (no query)
        console.log(`[ZeroEntropyService] Fetching recent documents`);
        response = await fetch(`https://api.zeroentropy.dev/v1/documents/get-document-info-list`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            collection_name: 'ai-wearable-transcripts',
            limit: limit || 100,
            path_prefix: null,
            path_gt: null,
          }),
        });
      }

      if (response.ok) {
        const data: any = await response.json();
        
        // Handle different API response formats
        const results = data.results || data.documents || [];
        console.log(`[ZeroEntropyService] Retrieved ${results.length} search results`);
        
        if (results.length > 0) {
          // Fetch actual content for the search results
          const resultsWithContent = await Promise.all(
            results.map(async (result: any) => {
              try {
                // Get document content using the path
                const contentResponse = await fetch(`https://api.zeroentropy.dev/v1/documents/get-document-info`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    collection_name: 'ai-wearable-transcripts',
                    path: result.path,
                    include_content: true,
                  }),
                });

                if (contentResponse.ok) {
                  const contentData: any = await contentResponse.json();
                  return {
                    id: result.path || 'unknown',
                    text: contentData.document?.content || result.path,
                    score: result.score || 0.95,
                    metadata: {
                      timestamp: contentData.document?.created_at || new Date().toISOString(),
                      recordingId: result.path?.split('_')[1] || 'unknown',
                      topic: contentData.document?.metadata?.topic || 'Recording'
                    }
                  };
                } else {
                  // Fallback without content
                  return {
                    id: result.path || 'unknown',
                    text: result.path || 'No content available',
                    score: result.score || 0.95,
                    metadata: {
                      timestamp: new Date().toISOString(),
                      recordingId: result.path?.split('_')[1] || 'unknown',
                      topic: 'Recording'
                    }
                  };
                }
              } catch (error) {
                console.error(`Error fetching content for ${result.path}:`, error);
                return {
                  id: result.path || 'unknown',
                  text: result.path || 'No content available',
                  score: result.score || 0.95,
                  metadata: {
                    timestamp: new Date().toISOString(),
                    recordingId: result.path?.split('_')[1] || 'unknown',
                    topic: 'Recording'
                  }
                };
              }
            })
          );
          
          return resultsWithContent;
        }
      } else {
        const errorText = await response.text();
        console.error(`[ZeroEntropyService] API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('[ZeroEntropyService] Failed to fetch real documents:', error);
    }
    
    // If real API fails, return empty instead of mock data
    console.log(`[ZeroEntropyService] No real documents retrieved - returning empty results`);
    return [];
  }

  async generateAnswer(query: string, context: SearchResult[]): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/projects/${this.projectId}/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          context: context.map(r => r.text).join('\n\n'),
          max_tokens: 200,
        }),
      });

      if (!response.ok) {
        throw new Error(`ZeroEntropy API error: ${response.statusText}`);
      }

      const data: any = await response.json();
      return data.answer;
    } catch (error) {
      console.error('Error generating answer with ZeroEntropy:', error);
      return `Based on your recordings: ${context[0]?.text || 'No relevant information found.'}`;
    }
  }

  private getSimulatedResults(query: string, limit: number): SearchResult[] {
    const simulatedResults: SearchResult[] = [
      {
        id: uuidv4(),
        text: 'Discussed the project timeline and key milestones for Q4.',
        score: 0.92,
        metadata: {
          timestamp: new Date(Date.now() - 86400000).toISOString(),
          recordingId: uuidv4(),
        },
      },
      {
        id: uuidv4(),
        text: 'Meeting about the new feature implementation and technical requirements.',
        score: 0.85,
        metadata: {
          timestamp: new Date(Date.now() - 172800000).toISOString(),
          recordingId: uuidv4(),
        },
      },
      {
        id: uuidv4(),
        text: 'Review of the user feedback and proposed improvements to the UI.',
        score: 0.78,
        metadata: {
          timestamp: new Date(Date.now() - 259200000).toISOString(),
          recordingId: uuidv4(),
        },
      },
    ];

    return simulatedResults.slice(0, limit);
  }

  async getDocumentById(documentId: string): Promise<SearchResult | null> {
    // Try to fetch from ZeroEntropy documents endpoint that the mobile app uses
    try {
      const response = await fetch(`http://localhost:3000/api/zeroentropy/documents?limit=100`);
      
      if (response.ok) {
        const data: any = await response.json();
        const documents = data.documents || [];
        const document = documents.find((doc: any) => doc.id === documentId);
        
        if (document) {
          return {
            id: document.id,
            text: document.text,
            score: 1,
            metadata: {
              timestamp: document.timestamp,
              recordingId: document.recordingId || 'unknown',
              title: document.title || document.aiTitle || 'Untitled',
              topic: document.topic || 'General',
            },
          };
        }
      }
    } catch (error) {
      console.log(`ZeroEntropy documents endpoint error: ${error}`);
    }

    // Fallback to mock data
    const mockTranscripts = MockDataService.getAllTranscripts();
    const transcript = mockTranscripts.find((t: any) => 
      t.id === documentId || t.recordingId === documentId
    );
    
    if (transcript) {
      return {
        id: transcript.id,
        text: transcript.text,
        score: 1,
        metadata: {
          timestamp: transcript.timestamp,
          recordingId: transcript.recordingId,
          title: (transcript as any).title || 'Untitled',
          topic: (transcript as any).topic || 'General',
        },
      };
    }

    console.log(`Document not found with ID: ${documentId}`);
    return null;
  }

  async deleteDocument(documentId: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/projects/${this.projectId}/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`ZeroEntropy API error: ${response.statusText}`);
      }

      console.log(`Document deleted from ZeroEntropy: ${documentId}`);
    } catch (error) {
      console.error('Error deleting document from ZeroEntropy:', error);
    }
  }
}

export default new ZeroEntropyService();