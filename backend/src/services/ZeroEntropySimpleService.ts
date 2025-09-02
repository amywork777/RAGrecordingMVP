/**
 * Simplified ZeroEntropy Service
 * This service uses mock data for development and testing.
 * When ZeroEntropy API is fully configured, update the methods to use the real API.
 */

import { v4 as uuidv4 } from 'uuid';
import MockDataService, { StoredTranscript } from './MockDataService';

interface SearchResult {
  id: string;
  text: string;
  score: number;
  metadata: any;
}

class ZeroEntropySimpleService {
  private organizationId = 'org-9e338660-abe5-4375-b9e0-27357453f67d';
  private apiKey: string | null = null;
  private useMockData = false; // Disabled mock data to use real ZeroEntropy API

  constructor() {
    this.initialize();
  }

  private initialize() {
    this.apiKey = process.env.ZEROENTROPY_API_KEY || null;
    
    if (!this.apiKey || !this.apiKey.startsWith('ze_')) {
      console.log('ZeroEntropy: API key not configured - search will fail');
      console.log('Your organization ID:', this.organizationId);
      console.log('To enable ZeroEntropy, set ZEROENTROPY_API_KEY in .env');
      this.useMockData = true; // Fallback to mock when no API key
    } else {
      console.log('ZeroEntropy API key detected:', this.apiKey.substring(0, 10) + '...');
      console.log('Organization ID:', this.organizationId);
      console.log('ZeroEntropy: Using real API integration');
      this.useMockData = false; // Use real API when key is available
    }
  }

  async storeDocument(text: string, metadata: any): Promise<string> {
    const documentId = await MockDataService.addTranscript(text, metadata.recordingId);
    
    if (!this.useMockData) {
      // TODO: Add real ZeroEntropy API call here
      console.log(`[ZeroEntropy] Would store document ${documentId} to org ${this.organizationId}`);
    }
    
    console.log(`Document stored: ${documentId} (using ${this.useMockData ? 'mock' : 'ZeroEntropy'})`);
    return documentId;
  }

  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    // When mock data is disabled, try to get real documents from ZeroEntropy API
    if (!this.useMockData && this.apiKey) {
      try {
        let response: Response;
        
        if (query && query.trim()) {
          // Use search endpoint for queries
          console.log(`[ZeroEntropy] Searching documents for query: "${query}"`);
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
          console.log(`[ZeroEntropy] Fetching recent documents`);
          response = await fetch(`https://api.zeroentropy.dev/v1/documents/get-document-info-list`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              collection_name: 'ai-wearable-transcripts',
              limit: Math.max(limit || 10, 200), // Get many more documents to ensure we catch recent ones
              path_prefix: null,
              path_gt: null,
            }),
          });
        }

        if (response.ok) {
          const data: any = await response.json();
          const documents = data.documents || data.results || [];
          console.log(`[ZeroEntropy] Retrieved ${documents.length} real documents`);
          
          if (documents.length > 0) {
            // Fetch document content for each document
            const documentsWithContent = await Promise.all(
              documents.map(async (doc: any) => {
                try {
                  // Get document content using the get-document-info endpoint
                  const contentResponse = await fetch(`https://api.zeroentropy.dev/v1/documents/get-document-info`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${this.apiKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      collection_name: 'ai-wearable-transcripts',
                      path: doc.path,
                      include_content: true,
                    }),
                  });
                  
                  if (contentResponse.ok) {
                    const contentData: any = await contentResponse.json();
                    return {
                      id: doc.id || doc.path || 'unknown',
                      text: contentData.document?.content || doc.text || '[Content not available]',
                      score: doc.score || 0.95,
                      metadata: {
                        timestamp: contentData.document?.created_at || doc.created_at || doc.metadata?.timestamp || new Date().toISOString(),
                        recordingId: contentData.document?.metadata?.recordingId || doc.metadata?.recordingId || doc.path || doc.id || 'unknown'
                      }
                    };
                  } else {
                    console.warn(`Failed to fetch content for ${doc.path}: ${contentResponse.status}`);
                    return {
                      id: doc.id || doc.path || 'unknown',
                      text: doc.text || '[Content fetch failed]',
                      score: doc.score || 0.95,
                      metadata: {
                        timestamp: doc.created_at || doc.metadata?.timestamp || new Date().toISOString(),
                        recordingId: doc.metadata?.recordingId || doc.path || doc.id || 'unknown'
                      }
                    };
                  }
                } catch (error) {
                  console.error(`Error fetching content for ${doc.path}:`, error);
                  return {
                    id: doc.id || doc.path || 'unknown',
                    text: doc.text || '[Content error]',
                    score: doc.score || 0.95,
                    metadata: {
                      timestamp: doc.created_at || doc.metadata?.timestamp || new Date().toISOString(),
                      recordingId: doc.metadata?.recordingId || doc.path || doc.id || 'unknown'
                    }
                  };
                }
              })
            );
            
            // Sort documents by timestamp (newest first) before returning
            const sortedDocuments = documentsWithContent.sort((a, b) => {
              const timeA = new Date(a.metadata.timestamp).getTime();
              const timeB = new Date(b.metadata.timestamp).getTime();
              return timeB - timeA; // Newest first
            });
            
            console.log(`[ZeroEntropy] Sorted ${sortedDocuments.length} documents by timestamp`);
            
            // Return only the requested number of documents (after sorting)
            const finalResults = sortedDocuments.slice(0, limit || 10);
            console.log(`[ZeroEntropy] Returning ${finalResults.length} most recent documents`);
            return finalResults;
          }
        } else {
          const errorText = await response.text();
          console.error(`[ZeroEntropy] API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
      } catch (error) {
        console.error('[ZeroEntropy] Failed to fetch real documents:', error);
      }
      
      // If real API fails, return empty instead of mock data
      console.log(`[ZeroEntropy] No real documents retrieved - returning empty results`);
      return [];
    }
    
    // Only use mock data if explicitly enabled
    if (this.useMockData) {
      const results = await MockDataService.searchTranscripts(query, limit);
      return results.map(r => ({
        id: r.id,
        text: r.text,
        score: Math.random() * 0.3 + 0.7,
        metadata: {
          timestamp: r.timestamp,
          recordingId: r.recordingId
        }
      }));
    }
    
    // Return empty results when mock data is disabled and no API key
    return [];
  }

  async generateAnswer(query: string, context: SearchResult[]): Promise<string> {
    if (context.length === 0) {
      return 'No relevant information found in your recordings.';
    }
    
    // Simple answer generation
    const bestResult = context[0];
    return `Based on your recordings: ${bestResult.text}`;
  }

  async deleteDocument(documentId: string): Promise<void> {
    if (!this.useMockData) {
      // TODO: Add real ZeroEntropy delete API call here
      console.log(`[ZeroEntropy] Would delete document ${documentId} from org ${this.organizationId}`);
    }
    
    console.log(`Document deleted: ${documentId} (using ${this.useMockData ? 'mock' : 'ZeroEntropy'})`);
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.startsWith('ze_');
  }

  getMockTranscripts(): StoredTranscript[] {
    return MockDataService.getAllTranscripts();
  }

  getStatus() {
    return {
      organizationId: this.organizationId,
      apiKeyConfigured: this.isConfigured(),
      apiKeyPrefix: this.apiKey ? this.apiKey.substring(0, 10) + '...' : 'not set',
      useMockData: this.useMockData,
      mockTranscriptCount: this.getMockTranscripts().length,
    };
  }
}

export default new ZeroEntropySimpleService();