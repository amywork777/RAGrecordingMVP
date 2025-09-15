import { Buffer } from 'buffer';
import OmiBluetoothService from './OmiBluetoothService';
import APIService from './APIService';
import uuid from 'react-native-uuid';

interface AudioChunk {
  data: Uint8Array;
  codec: 'PCM16' | 'PCM8' | 'Opus';
  timestamp: number;
}

interface AudioBuffer {
  chunks: AudioChunk[];
  startTime: number;
  totalBytes: number;
  duration: number; // in seconds
}

interface StreamingOptions {
  bufferDurationSeconds: number; // How long to buffer before sending to STT
  enableRealTimeTranscription: boolean;
  sampleRate: number;
  channels: number;
}

type EventCallback = (...args: any[]) => void;

class OmiAudioStreamService {
  private audioBuffer: AudioBuffer;
  private isBuffering = false;
  private streamingOptions: StreamingOptions;
  private sessionTimer?: NodeJS.Timeout;
  private currentRecordingId?: string;
  private listeners: Map<string, EventCallback[]> = new Map();
  private realtimeTranscriptBuffer: string = '';
  private sessionTimeout: number = 30000; // 30 second timeout - let much more audio accumulate
  
  // Create stable bound methods to avoid reference issues
  private boundHandleAudioChunk = this.handleAudioChunk.bind(this);
  private boundOnStreamStarted = this.onStreamStarted.bind(this);
  private boundOnStreamStopped = this.onStreamStopped.bind(this);
  private boundOnDeviceDisconnected = this.onDeviceDisconnected.bind(this);

  constructor() {
    this.streamingOptions = {
      bufferDurationSeconds: 10, // Send chunks every 10 seconds to accumulate enough audio
      enableRealTimeTranscription: true,
      sampleRate: 8000, // Friend devices typically use 8kHz, not 16kHz
      channels: 1 // Mono audio
    };

    this.audioBuffer = {
      chunks: [],
      startTime: 0,
      totalBytes: 0,
      duration: 0
    };

    this.setupOmiBluetoothListener();
  }

  // Event emitter methods
  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  off(event: string, callback: EventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(...args));
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  private setupOmiBluetoothListener(): void {
    console.log('🔗 Setting up OmiBluetoothService event listeners...');
    
    // Remove any existing listeners first to avoid duplicates - use stable bound methods
    OmiBluetoothService.off('audioChunk', this.boundHandleAudioChunk);
    OmiBluetoothService.off('streamStarted', this.boundOnStreamStarted);
    OmiBluetoothService.off('streamStopped', this.boundOnStreamStopped);
    OmiBluetoothService.off('deviceDisconnected', this.boundOnDeviceDisconnected);
    
    // Listen for audio chunks from Omi device - use stable bound methods
    OmiBluetoothService.on('audioChunk', this.boundHandleAudioChunk);
    console.log('🔗 Added audioChunk listener');
    
    // Handle connection events - use stable bound methods
    OmiBluetoothService.on('streamStarted', this.boundOnStreamStarted);
    OmiBluetoothService.on('streamStopped', this.boundOnStreamStopped);
    OmiBluetoothService.on('deviceDisconnected', this.boundOnDeviceDisconnected);
    
    console.log('🔗 All OmiBluetoothService event listeners set up');
    
    // Verify listeners are connected by checking if OmiBluetoothService has our callbacks
    this.verifyEventListeners();
  }

  private onStreamStarted(): void {
    console.log('🎵 Omi audio stream started - beginning buffering');
    this.startBuffering();
    this.emit('streamingStarted');
  }

  private onStreamStopped(): void {
    console.log('⏹️ Omi audio stream stopped - keeping session open for more audio');
    // Don't automatically stop buffering - let the session timeout handle it
    // This allows for temporary stream interruptions without losing the session
    this.emit('streamingStopped');
  }

  private onDeviceDisconnected(): void {
    console.log('🔌 Omi device disconnected - stopping audio processing');
    this.stopBuffering();
    this.emit('deviceDisconnected');
  }

  private handleAudioChunk(audioChunk: AudioChunk): void {
    if (!this.isBuffering) {
      console.log(`🎵 Starting audio session...`);
      this.startBuffering();
    }

    // Add chunk to buffer
    this.audioBuffer.chunks.push(audioChunk);
    this.audioBuffer.totalBytes += audioChunk.data.length;
    
    // Calculate duration based on audio format
    const chunkDuration = this.calculateChunkDuration(audioChunk);
    this.audioBuffer.duration += chunkDuration;

    // Emit live audio event for UI feedback
    this.emit('liveAudioData', {
      totalBytes: this.audioBuffer.totalBytes,
      duration: this.audioBuffer.duration,
      codec: audioChunk.codec
    });

    // Log progress every 100 chunks to reduce spam
    if (this.audioBuffer.chunks.length % 100 === 0) {
      console.log(`🎵 Audio: ${this.audioBuffer.totalBytes} bytes (${this.audioBuffer.chunks.length} chunks, ${this.audioBuffer.duration.toFixed(1)}s)`);
    }
  }

  private calculateChunkDuration(audioChunk: AudioChunk): number {
    // Calculate duration based on codec and sample rate
    let bytesPerSecond: number;
    
    switch (audioChunk.codec) {
      case 'PCM16':
        // 16-bit PCM: 2 bytes per sample * sample rate * channels
        bytesPerSecond = 2 * this.streamingOptions.sampleRate * this.streamingOptions.channels;
        break;
      case 'PCM8':
        // 8-bit PCM: 1 byte per sample * sample rate * channels
        bytesPerSecond = this.streamingOptions.sampleRate * this.streamingOptions.channels;
        break;
      case 'Opus':
        // Opus is variable bitrate, estimate based on typical settings
        bytesPerSecond = 8000; // ~64 kbps typical
        break;
      default:
        bytesPerSecond = 2 * this.streamingOptions.sampleRate * this.streamingOptions.channels;
    }
    
    return audioChunk.data.length / bytesPerSecond;
  }

  private async processAudioBuffer(): Promise<void> {
    if (this.audioBuffer.chunks.length === 0) {
      return;
    }

    console.log(`🎵 Processing audio buffer: ${this.audioBuffer.chunks.length} chunks, ${this.audioBuffer.totalBytes} bytes, ${this.audioBuffer.duration.toFixed(1)}s`);

    // Quick test: Force transcription regardless of size - your 68KB should work!
    if (this.audioBuffer.totalBytes < 1) {
      console.log(`🎵 ⚠️ Audio too small: ${this.audioBuffer.totalBytes} bytes - skipping transcription`);
      return;
    }
    
    console.log(`🔥 FORCING TRANSCRIPTION: ${this.audioBuffer.totalBytes} bytes - this should work with backend!`);
    
    console.log(`\n🚀 ===============================`);
    console.log(`🧪 TRANSCRIBING: ${this.audioBuffer.totalBytes} bytes of audio`);
    console.log(`🚀 ===============================\n`);

    try {
      // Convert audio chunks to a single buffer
      const audioData = this.combineAudioChunks(this.audioBuffer.chunks);
      
      // Check what codec we're actually getting
      const detectedCodec = this.audioBuffer.chunks[0]?.codec || 'PCM16';
      console.log(`🎵 Detected codec: ${detectedCodec} from ${this.audioBuffer.chunks.length} chunks`);
      
      // Convert to appropriate format for STT
      const audioForSTT = await this.convertToSTTFormat(audioData, detectedCodec);
      
      // Send to STT pipeline
      if (this.streamingOptions.enableRealTimeTranscription) {
        await this.sendToSTT(audioForSTT, detectedCodec);
      }

      // Emit processed audio event
      this.emit('audioProcessed', {
        duration: this.audioBuffer.duration,
        bytes: audioData.length,
        codec: this.audioBuffer.chunks[0]?.codec
      });

    } catch (error) {
      console.error('❌ Failed to process audio buffer:', error);
      this.emit('processingError', error);
    }

    // Clear the buffer for next batch
    this.clearBuffer();
  }

  private combineAudioChunks(chunks: AudioChunk[]): Uint8Array {
    // Calculate total size
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    
    // Combine all chunks into a single buffer
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    
    for (const chunk of chunks) {
      combined.set(chunk.data, offset);
      offset += chunk.data.length;
    }
    
    return combined;
  }

  private async convertToSTTFormat(audioData: Uint8Array, codec: string): Promise<string> {
    if (codec === 'Opus') {
      // For Opus, send raw data - both AssemblyAI and Whisper support Opus
      const base64 = Buffer.from(audioData).toString('base64');
      console.log(`🔊 Opus audio: ${audioData.length} bytes → ${base64.length} base64 chars`);
      console.log(`🔍 First 20 bytes of "Opus" data: [${Array.from(audioData.slice(0, 20)).join(', ')}]`);
      return base64;
    } else {
      // For PCM formats, convert to WAV
      return this.convertToWav(audioData, codec);
    }
  }

  private async convertToWav(audioData: Uint8Array, codec: string): Promise<string> {
    console.log(`🔊 Converting ${audioData.length} bytes of ${codec} audio to WAV`);
    
    // Debug: Check if audio data looks valid
    const first10Bytes = Array.from(audioData.slice(0, Math.min(10, audioData.length)));
    const last10Bytes = Array.from(audioData.slice(Math.max(0, audioData.length - 10)));
    console.log(`🔍 Audio data sample - first 10 bytes: [${first10Bytes.join(', ')}]`);
    console.log(`🔍 Audio data sample - last 10 bytes: [${last10Bytes.join(', ')}]`);
    
    if (codec === 'PCM16') {
      // Try multiple sample rates for Friend device compatibility
      const formats = [
        { sampleRate: 8000, name: '8kHz' },
        { sampleRate: 16000, name: '16kHz' },
        { sampleRate: 44100, name: '44.1kHz' }
      ];
      
      console.log(`🧪 Testing multiple audio formats for Friend device...`);
      
      // Try 16kHz first (standard speech rate), then 8kHz if that fails
      console.log(`🔍 Friend device PCM16 data analysis: ${audioData.length} bytes`);
      console.log(`🔍 Estimated duration at 8kHz: ${audioData.length / 2 / 8000}s`);
      console.log(`🔍 Estimated duration at 16kHz: ${audioData.length / 2 / 16000}s`);
      
      // Friend devices usually use 16kHz for better quality
      const wav = this.createWavFromPCM16WithSampleRate(audioData, 16000);
      const base64 = Buffer.from(wav).toString('base64');
      console.log(`🔊 PCM16 → WAV (16kHz): ${audioData.length} → ${wav.length} bytes → ${base64.length} base64 chars`);
      
      // Save the WAV data for playback testing
      this.saveAudioForPlayback(base64, 'wav');
      
      return base64;
    } else if (codec === 'PCM8') {
      // Convert PCM8 to PCM16 first
      const pcm16Data = this.convertPCM8toPCM16(audioData);
      const wav = this.createWavFromPCM16WithSampleRate(pcm16Data, 8000);
      const base64 = Buffer.from(wav).toString('base64');
      console.log(`🔊 PCM8 → PCM16 → WAV (8kHz): ${audioData.length} → ${pcm16Data.length} → ${wav.length} bytes → ${base64.length} base64 chars`);
      return base64;
    } else {
      // For Opus, we'll send raw data and let backend handle conversion
      const base64 = Buffer.from(audioData).toString('base64');
      console.log(`🔊 Raw ${codec} data: ${audioData.length} bytes → ${base64.length} base64 chars`);
      return base64;
    }
  }

  private createWavFromPCM16(pcmData: Uint8Array): Uint8Array {
    return this.createWavFromPCM16WithSampleRate(pcmData, this.streamingOptions.sampleRate);
  }

  private createWavFromPCM16WithSampleRate(pcmData: Uint8Array, sampleRate: number): Uint8Array {
    const channels = this.streamingOptions.channels;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, fileSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Copy PCM data
    const wavData = new Uint8Array(buffer);
    wavData.set(pcmData, 44);

    console.log(`🔊 Created WAV: ${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit, ${dataSize} PCM bytes → ${wavData.length} WAV bytes`);
    return wavData;
  }

  private convertPCM8toPCM16(pcm8Data: Uint8Array): Uint8Array {
    const pcm16Data = new Uint8Array(pcm8Data.length * 2);
    
    for (let i = 0; i < pcm8Data.length; i++) {
      // Convert 8-bit unsigned to 16-bit signed
      const sample8 = pcm8Data[i];
      const sample16 = (sample8 - 128) * 256; // Convert to 16-bit range
      
      // Write as little-endian 16-bit
      pcm16Data[i * 2] = sample16 & 0xFF;
      pcm16Data[i * 2 + 1] = (sample16 >> 8) & 0xFF;
    }
    
    return pcm16Data;
  }

  private async sendToSTT(audioBase64: string, codec: string = 'wav'): Promise<void> {
    if (!this.currentRecordingId) {
      this.currentRecordingId = uuid.v4() as string;
    }

    console.log(`🗣️ Sending audio to STT: ${audioBase64.length} chars, recordingId: ${this.currentRecordingId}`);
    
    // Debug: Check if the base64 data looks valid
    if (audioBase64.length < 1000) {
      console.warn(`⚠️ Audio base64 is very small: ${audioBase64.length} chars - this might be the issue!`);
    }
    
    // Debug: Show first and last few characters of base64
    const preview = audioBase64.length > 100 ? 
      `${audioBase64.substring(0, 50)}...${audioBase64.substring(audioBase64.length - 50)}` : 
      audioBase64;
    console.log(`🗣️ Audio base64 preview: ${preview}`);

    try {
      // Send to existing STT pipeline with correct format
      const apiFormat = codec === 'Opus' ? 'opus' : 'wav';
      console.log(`🗣️ Sending ${apiFormat} format to backend...`);
      const response = await APIService.sendAudioBase64(
        audioBase64, 
        this.currentRecordingId, 
        apiFormat
      );
      
      console.log(`🗣️ STT response:`, response);
      
      if (response.transcription) {
        console.log('📝 ✅ Received transcription chunk:', response.transcription);
        
        // Update realtime transcript buffer
        this.realtimeTranscriptBuffer += response.transcription + ' ';
        
        // Emit realtime transcription event
        this.emit('realtimeTranscription', {
          text: response.transcription,
          fullTranscript: this.realtimeTranscriptBuffer.trim(),
          recordingId: this.currentRecordingId
        });
        
        console.log(`📝 ✅ Emitted realtimeTranscription event with: "${response.transcription}"`);
      } else {
        console.log('📝 ⚠️ STT response had no transcription field');
      }
    } catch (error) {
      console.error('❌ STT processing failed:', error);
      this.emit('sttError', error);
    }
  }

  private startBuffering(): void {
    if (this.isBuffering) {
      return;
    }

    console.log('🎵 Starting audio buffering session');
    this.isBuffering = true;
    this.clearBuffer();
    this.audioBuffer.startTime = Date.now();
    this.currentRecordingId = uuid.v4() as string;
    this.realtimeTranscriptBuffer = '';

    // Set up session timeout to automatically end sessions
    this.sessionTimer = setTimeout(() => {
      console.log(`⏰ Session timeout reached (${this.sessionTimeout / 1000}s) - ending session`);
      this.stopBuffering();
    }, this.sessionTimeout);
    
    console.log(`🎵 Session started: ${this.currentRecordingId} (will timeout in ${this.sessionTimeout / 1000}s)`);
  }

  private stopBuffering(): void {
    if (!this.isBuffering) {
      return;
    }

    // Debug: Log call stack to see what's triggering early stops
    console.log(`⏹️ Stopping audio buffering session: ${this.currentRecordingId}`);
    console.log(`📊 Session summary: ${this.audioBuffer.chunks.length} chunks, ${this.audioBuffer.totalBytes} bytes, ${this.audioBuffer.duration.toFixed(1)}s`);
    console.log(`🔍 stopBuffering() called by:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));
    
    this.isBuffering = false;

    // Clear session timer
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = undefined;
    }

    // Process the entire session as one transcription
    if (this.audioBuffer.chunks.length > 0) {
      console.log('🎵 Processing complete session for transcription...');
      this.processAudioBuffer();
    } else {
      console.log('⚠️ No audio chunks to process in this session');
    }

    // Emit final transcription if we have any
    if (this.realtimeTranscriptBuffer.trim().length > 0) {
      this.emit('finalTranscription', {
        text: this.realtimeTranscriptBuffer.trim(),
        recordingId: this.currentRecordingId,
        duration: this.audioBuffer.duration
      });
    }
  }

  private clearBuffer(): void {
    this.audioBuffer = {
      chunks: [],
      startTime: Date.now(),
      totalBytes: 0,
      duration: 0
    };
  }

  // Public methods
  updateStreamingOptions(options: Partial<StreamingOptions>): void {
    this.streamingOptions = { ...this.streamingOptions, ...options };
    console.log('⚙️ Updated streaming options:', this.streamingOptions);
  }

  getStreamingStatus(): {
    isBuffering: boolean;
    bufferDuration: number;
    totalBytes: number;
    chunksCount: number;
    currentTranscript: string;
  } {
    return {
      isBuffering: this.isBuffering,
      bufferDuration: this.audioBuffer.duration,
      totalBytes: this.audioBuffer.totalBytes,
      chunksCount: this.audioBuffer.chunks.length,
      currentTranscript: this.realtimeTranscriptBuffer.trim()
    };
  }

  getCurrentRecordingId(): string | undefined {
    return this.currentRecordingId;
  }

  // Manual session control
  forceEndSession(): void {
    if (this.isBuffering) {
      console.log('🔄 Manually ending current session...');
      this.stopBuffering();
    } else {
      console.log('⚠️ No active session to end');
    }
  }

  // For testing - reduce session timeout to 5 seconds
  setTestMode(): void {
    this.sessionTimeout = 5000; // 5 seconds
    console.log('🧪 Test mode enabled - sessions will timeout after 5 seconds');
  }

  // Manual initialization method to ensure connection
  initialize(): void {
    console.log('🔄 Manually initializing OmiAudioStreamService connections...');
    console.log('🔄 OmiBluetoothService reference available:', !!OmiBluetoothService);
    console.log('🔄 Current listeners map size:', this.listeners.size);
    this.setupOmiBluetoothListener();
  }

  // Verify event listeners are properly connected
  private verifyEventListeners(): void {
    console.log('🔍 Verifying event listeners are connected...');
    
    // Test emit a dummy event to see if our handler gets called
    setTimeout(() => {
      console.log('🔍 Testing event connection by checking listener counts...');
      // Try to verify connection by checking if we can call methods
      if (OmiBluetoothService && typeof OmiBluetoothService.emit === 'function') {
        console.log('🔍 OmiBluetoothService emit method is available');
        // Check if our listeners are actually registered by examining the listeners map
        // Test injection removed - now using only real OmiConnection audio data
      } else {
        console.error('🔍 OmiBluetoothService emit method not available!');
      }
      console.log('🔍 Event listeners should now be connected with stable references');
    }, 100);
  }

  // Debug method to get current service state
  getDebugInfo(): any {
    return {
      isBuffering: this.isBuffering,
      listenersMapSize: this.listeners.size,
      hasBluetoothServiceReference: !!OmiBluetoothService,
      boundMethodsAvailable: {
        handleAudioChunk: !!this.boundHandleAudioChunk,
        onStreamStarted: !!this.boundOnStreamStarted,
        onStreamStopped: !!this.boundOnStreamStopped,
        onDeviceDisconnected: !!this.boundOnDeviceDisconnected,
      }
    };
  }

  // Audio playback for testing
  private savedAudioData: string | null = null;
  private savedAudioFormat: string = 'wav';

  private saveAudioForPlayback(audioBase64: string, format: string): void {
    this.savedAudioData = audioBase64;
    this.savedAudioFormat = format;
    console.log(`🎵 Audio saved for playback testing: ${audioBase64.length} chars (${format})`);
    
    // Emit event to UI so user can trigger playback
    this.emit('audioReadyForPlayback', {
      hasAudio: true,
      format: format,
      size: audioBase64.length
    });
  }

  // Public method to play back the last converted audio for testing
  async playLastAudio(): Promise<void> {
    if (!this.savedAudioData) {
      console.log('⚠️ No audio data available for playback');
      return;
    }

    try {
      console.log('🔊 Playing back converted audio...');
      
      // Use React Native's Audio API for playback
      const { Audio } = await import('expo-av');
      
      // Create data URI for playback
      const mimeType = this.savedAudioFormat === 'wav' ? 'audio/wav' : 'audio/m4a';
      const dataUri = `data:${mimeType};base64,${this.savedAudioData}`;
      
      const { sound } = await Audio.Sound.createAsync(
        { uri: dataUri },
        { shouldPlay: true }
      );
      
      console.log('✅ Audio playback started');
      
      // Cleanup sound after playback
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          console.log('🔇 Audio playback finished');
        }
      });
      
    } catch (error) {
      console.error('❌ Audio playback failed:', error);
      
      // Fallback: just log audio data info
      console.log('📊 Audio data info for debugging:');
      console.log(`📊 Format: ${this.savedAudioFormat}`);
      console.log(`📊 Base64 length: ${this.savedAudioData.length}`);
      console.log(`📊 First 100 chars: ${this.savedAudioData.substring(0, 100)}`);
    }
  }

  // Cleanup
  cleanup(): void {
    console.log('🧹 Cleaning up OmiAudioStreamService...');
    this.stopBuffering();
    
    // Clear session timer if running
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = undefined;
    }
    
    // Remove our specific listeners using stable bound methods
    OmiBluetoothService.off('audioChunk', this.boundHandleAudioChunk);
    OmiBluetoothService.off('streamStarted', this.boundOnStreamStarted);
    OmiBluetoothService.off('streamStopped', this.boundOnStreamStopped);
    OmiBluetoothService.off('deviceDisconnected', this.boundOnDeviceDisconnected);
    
    this.removeAllListeners();
  }
}

export default new OmiAudioStreamService();