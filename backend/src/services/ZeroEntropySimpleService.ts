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
  private useMockData = true;

  constructor() {
    this.initialize();
  }

  private initialize() {
    this.apiKey = process.env.ZEROENTROPY_API_KEY || null;
    
    if (!this.apiKey || !this.apiKey.startsWith('ze_')) {
      console.log('ZeroEntropy: Using mock data (API key not configured)');
      console.log('Your organization ID:', this.organizationId);
      console.log('To enable ZeroEntropy, set ZEROENTROPY_API_KEY in .env');
      this.useMockData = true;
    } else {
      console.log('ZeroEntropy API key detected:', this.apiKey.substring(0, 10) + '...');
      console.log('Organization ID:', this.organizationId);
      console.log('Note: Currently using mock data. Real API integration coming soon.');
      // For now, still use mock data until API is properly integrated
      this.useMockData = true;
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
    const results = await MockDataService.searchTranscripts(query, limit);
    
    if (!this.useMockData) {
      // TODO: Add real ZeroEntropy search API call here
      console.log(`[ZeroEntropy] Would search for "${query}" in org ${this.organizationId}`);
    }
    
    return results.map(r => ({
      id: r.id,
      text: r.text,
      score: Math.random() * 0.3 + 0.7, // Simulated relevance score
      metadata: {
        timestamp: r.timestamp,
        recordingId: r.recordingId
      }
    }));
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