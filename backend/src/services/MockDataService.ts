import { v4 as uuidv4 } from 'uuid';

export interface StoredTranscript {
  id: string;
  text: string;
  timestamp: string;
  recordingId: string;
  embedding?: number[];
}

class MockDataService {
  private transcripts: StoredTranscript[] = [];

  constructor() {
    this.initializeMockData();
  }

  private initializeMockData() {
    const mockTranscripts = [
      "I saw a dolphin today at the aquarium. They're incredibly intelligent marine mammals that use echolocation to navigate and hunt. Did you know they can recognize themselves in mirrors?",
      "The elephant at the zoo was amazing. These gentle giants have incredible memories and can remember other elephants for decades. They also mourn their dead and have complex social structures.",
      "Watched a documentary about octopuses last night. They have three hearts and blue blood. Their problem-solving abilities are off the charts - they can open jars from the inside!",
      "My neighbor's parrot can speak over 100 words. African Grey parrots are known to have the intelligence of a 5-year-old child. They can actually understand context, not just mimic.",
      "Saw a video of a mantis shrimp today. They have the most complex eyes in the animal kingdom with 16 color receptors. Humans only have 3! They can also punch with the force of a bullet.",
      "The cheetah is the fastest land animal, reaching speeds up to 70 mph. But they can only maintain that speed for about 30 seconds before overheating.",
      "Penguins are fascinating. Emperor penguins can dive to depths of over 500 meters and hold their breath for more than 20 minutes. The males incubate eggs on their feet for two months in Antarctic winter.",
      "Just learned that crows can hold grudges for years and pass this information to their offspring. They can recognize human faces and will remember if you've been mean to them.",
      "Honeybees communicate through dance. The waggle dance tells other bees exactly where to find flowers - distance, direction, and even quality of the nectar source.",
      "Giraffes only sleep for 30 minutes a day on average. Their long necks have the same number of vertebrae as humans - just seven, but each one is huge!",
      "Axolotls are incredible. They can regenerate entire limbs, organs, and even parts of their brain. Scientists are studying them to understand regeneration in humans.",
      "Tardigrades, or water bears, are virtually indestructible. They can survive extreme temperatures, radiation, and even the vacuum of space. They've been around for 500 million years.",
      "The blue whale's heart alone weighs as much as a small car - about 400 pounds. Their heartbeat can be detected from two miles away underwater.",
      "Flamingos are pink because of their diet. They eat algae and brine shrimp that contain carotenoid pigments. Baby flamingos are actually born gray or white.",
      "Sloths only defecate once a week and lose up to 30% of their body weight when they do. They climb down from trees to do this, which is when they're most vulnerable to predators.",
      "Platypuses are one of only two mammals that lay eggs. They also don't have nipples - they sweat milk through their skin for their babies to lick off.",
      "Arctic foxes can survive temperatures as low as -70°C. Their fur changes color with the seasons - white in winter for camouflage in snow, brown/gray in summer.",
      "Naked mole rats are immune to cancer and can live for over 30 years. They don't feel pain from acid and can survive 18 minutes without oxygen.",
      "Pistol shrimp can create bubbles that reach temperatures nearly as hot as the sun's surface when they snap their claws. The sound can reach 218 decibels, louder than a gunshot.",
      "Hummingbirds are the only birds that can fly backwards. Their hearts beat up to 1,260 times per minute, and they need to eat every 10-15 minutes to survive."
    ];

    // Create mock transcripts with timestamps spread over the past week
    const now = new Date();
    this.transcripts = mockTranscripts.map((text, index) => {
      const hoursAgo = Math.floor(Math.random() * 168); // Random time in past week
      const timestamp = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
      
      return {
        id: uuidv4(),
        text,
        timestamp: timestamp.toISOString(),
        recordingId: `recording-${index + 1}`,
        embedding: this.generateMockEmbedding(text)
      };
    });

    console.log(`Initialized ${this.transcripts.length} mock animal transcripts`);
  }

  private generateMockEmbedding(text: string): number[] {
    // Generate a simple mock embedding based on text characteristics
    const embedding = new Array(384).fill(0);
    for (let i = 0; i < text.length; i++) {
      embedding[i % 384] += text.charCodeAt(i) / 1000;
    }
    return embedding.map(v => v / text.length);
  }

  private calculateSimilarity(embedding1: number[], embedding2: number[]): number {
    // Simple cosine similarity
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  async addTranscript(text: string, recordingId: string): Promise<string> {
    const transcript: StoredTranscript = {
      id: uuidv4(),
      text,
      timestamp: new Date().toISOString(),
      recordingId,
      embedding: this.generateMockEmbedding(text)
    };
    
    this.transcripts.push(transcript);
    return transcript.id;
  }

  async searchTranscripts(query: string, limit: number = 5): Promise<StoredTranscript[]> {
    const queryEmbedding = this.generateMockEmbedding(query);
    
    // Calculate similarity scores and sort
    const results = this.transcripts
      .map(transcript => ({
        ...transcript,
        score: this.calculateSimilarity(queryEmbedding, transcript.embedding || [])
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    return results;
  }

  async getRecentTranscripts(limit: number = 10): Promise<StoredTranscript[]> {
    return [...this.transcripts]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  getAllTranscripts(): StoredTranscript[] {
    return this.transcripts;
  }
}

export default new MockDataService();