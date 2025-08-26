// Mock audio service for testing without crashing
class MockAudioService {
  private isRecordingMock = false;

  async startRecording(): Promise<void> {
    console.log('MockAudioService: Starting recording (mock)');
    this.isRecordingMock = true;
    
    // Simulate some delay
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('MockAudioService: Recording started (mock)');
  }

  async stopRecording(): Promise<string | null> {
    console.log('MockAudioService: Stopping recording (mock)');
    this.isRecordingMock = false;
    
    // Return a mock URI
    const mockUri = 'file:///mock/recording.m4a';
    console.log('MockAudioService: Recording stopped (mock), URI:', mockUri);
    return mockUri;
  }

  async getRecordingBase64(): Promise<string | null> {
    console.log('MockAudioService: Getting base64 (mock)');
    // Return a small mock base64 string
    return 'bW9ja19hdWRpb19kYXRh'; // "mock_audio_data" in base64
  }

  getRecordingUri(): string | null {
    return 'file:///mock/recording.m4a';
  }

  isRecording(): boolean {
    return this.isRecordingMock;
  }
}

export default new MockAudioService();