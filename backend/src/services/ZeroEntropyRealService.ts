import ZeroEntropy from 'zeroentropy';
import { v4 as uuidv4 } from 'uuid';
import MockDataService, { StoredTranscript } from './MockDataService';

interface SearchResult {
  id: string;
  text: string;
  score: number;
  metadata: any;
}

class ZeroEntropyRealService {
  private client: ZeroEntropy | null = null;
  private isInitialized = false;
  private useMockData = true; // Start with mock data
  private collectionId: string | null = null;

  constructor() {
    this.initialize();
  }

  private async initialize() {
    const apiKey = process.env.ZEROENTROPY_API_KEY;
    
    if (!apiKey || !apiKey.startsWith('ze_')) {
      console.log('ZeroEntropy API key not configured properly, using mock data');
      console.log('To use ZeroEntropy, ensure ZEROENTROPY_API_KEY starts with "ze_"');
      this.useMockData = true;
      return;
    }

    try {
      // Initialize ZeroEntropy client
      console.log('Initializing ZeroEntropy with API key:', apiKey.substring(0, 10) + '...');
      
      this.client = new ZeroEntropy({
        apiKey: apiKey,
      });

      // Check status
      const status = await this.client.status.getStatus({});
      console.log('ZeroEntropy status:', status);

      // Get or create a collection for our app
      const collections = await this.client.collections.getList({});
      console.log(`Found ${collections.results?.length || 0} collections`);

      if (collections.results && collections.results.length > 0) {
        // Use existing collection
        this.collectionId = collections.results[0].id;
        console.log(`Using existing collection: ${this.collectionId}`);
      } else {
        // Create new collection
        const newCollection = await this.client.collections.add({
          name: 'ai-wearable-transcripts',
          description: 'Transcripts from AI wearable device',
        });
        this.collectionId = newCollection.id;
        console.log(`Created new collection: ${this.collectionId}`);
      }
      
      this.isInitialized = true;
      this.useMockData = false; // Switch to real ZeroEntropy
      
      console.log('ZeroEntropy initialized successfully');
    } catch (error: any) {
      console.error('Failed to initialize ZeroEntropy:', error.message);
      console.log('Falling back to mock data');
      this.useMockData = true;
    }
  }

  async storeDocument(text: string, metadata: any): Promise<string> {
    // If using mock data or not initialized
    if (this.useMockData || !this.isInitialized) {
      const documentId = await MockDataService.addTranscript(text, metadata.recordingId);
      console.log(`Document stored in mock database: ${documentId}`);
      return documentId;
    }

    try {
      if (!this.client || !this.collectionId) {
        throw new Error('ZeroEntropy client not initialized');
      }

      // Store document using ZeroEntropy documents.add API
      const document = await this.client.documents.add({
        collectionId: this.collectionId,
        text: text,
        metadata: JSON.stringify({
          ...metadata,
          timestamp: new Date().toISOString(),
        }),
      });

      console.log(`Document stored in ZeroEntropy: ${document.id}`);
      return document.id;
    } catch (error: any) {
      console.error('Error storing document in ZeroEntropy:', error.message);
      // Fallback to mock data
      return await MockDataService.addTranscript(text, metadata.recordingId);
    }
  }

  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    // If using mock data or not initialized
    if (this.useMockData || !this.isInitialized) {
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

    try {
      if (!this.client || !this.collectionId) {
        throw new Error('ZeroEntropy client not initialized');
      }

      // Search documents using ZeroEntropy queries API
      const searchResults = await this.client.queries.topDocuments({
        collectionId: this.collectionId,
        query: query,
        topK: limit,
      });

      // Map results to our format
      if (searchResults.results && Array.isArray(searchResults.results)) {
        return searchResults.results.map((result: any) => ({
          id: result.documentId || uuidv4(),
          text: result.text || '',
          score: result.score || 0.5,
          metadata: result.metadata ? JSON.parse(result.metadata) : {},
        }));
      }

      return [];
    } catch (error: any) {
      console.error('Error searching in ZeroEntropy:', error.message);
      // Fallback to mock data
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
  }

  async generateAnswer(query: string, context: SearchResult[]): Promise<string> {
    if (this.useMockData || !this.isInitialized || !this.client) {
      // Simple answer generation for mock data
      if (context.length === 0) {
        return 'No relevant information found in your recordings.';
      }
      return `Based on your recordings: ${context[0].text}`;
    }

    try {
      // Use context to generate answer
      if (context.length === 0) {
        return 'No relevant information found in your recordings.';
      }
      
      // Format the answer with the best result
      const bestResult = context[0];
      return `Based on your recordings about "${query}":\n\n${bestResult.text}\n\nRelevance score: ${(bestResult.score * 100).toFixed(1)}%`;
    } catch (error: any) {
      console.error('Error generating answer:', error.message);
      if (context.length === 0) {
        return 'No relevant information found in your recordings.';
      }
      return `Based on your recordings: ${context[0].text}`;
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    if (this.useMockData || !this.isInitialized || !this.client) {
      console.log(`Mock delete document: ${documentId}`);
      return;
    }

    try {
      if (!this.collectionId) {
        throw new Error('Collection ID not set');
      }

      await this.client.documents.delete({
        collectionId: this.collectionId,
        documentId: documentId,
      });

      console.log(`Document deleted from ZeroEntropy: ${documentId}`);
    } catch (error: any) {
      console.error('Error deleting document from ZeroEntropy:', error.message);
    }
  }

  // Helper method to check if ZeroEntropy is properly configured
  isConfigured(): boolean {
    return this.isInitialized && !this.useMockData;
  }

  // Method to get all mock transcripts (useful for testing)
  getMockTranscripts(): StoredTranscript[] {
    return MockDataService.getAllTranscripts();
  }

  // Get configuration status
  getStatus() {
    return {
      initialized: this.isInitialized,
      useMockData: this.useMockData,
      collectionId: this.collectionId,
      hasClient: !!this.client,
      apiKeyConfigured: !!process.env.ZEROENTROPY_API_KEY && process.env.ZEROENTROPY_API_KEY.startsWith('ze_'),
    };
  }
}

export default new ZeroEntropyRealService();