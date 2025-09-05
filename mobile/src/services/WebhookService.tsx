import AsyncStorage from '@react-native-async-storage/async-storage';

// Simple EventEmitter implementation for React Native
class EventEmitter {
  private events: { [key: string]: Function[] } = {};

  on(event: string, callback: Function) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
  }

  emit(event: string, data?: any) {
    if (this.events[event]) {
      this.events[event].forEach(callback => callback(data));
    }
  }

  off(event: string, callback: Function) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(cb => cb !== callback);
    }
  }

  removeAllListeners() {
    this.events = {};
  }
}

interface TranscriptSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  source?: string;
  language?: string;
  timestamp?: string;
  id?: string;
  receivedAt?: Date;
}

interface WebhookData {
  uuid: string;
  method: string;
  ip: string;
  content: any;
  created_at: string;
}

interface Conversation {
  id: string;
  startTime: Date;
  endTime?: Date;
  transcripts: TranscriptSegment[];
  status: "recording" | "completed";
  summary?: string;
  title?: string;
}

class WebhookService extends EventEmitter {
  private isMonitoring = false;
  private audioPollingInterval: NodeJS.Timeout | null = null;
  private transcriptionPollingInterval: NodeJS.Timeout | null = null;
  private audioTimeoutRef: NodeJS.Timeout | null = null;
  private lastAudioBytesUuid: string | null = null;
  private processedRequestIds = new Set<string>();
  private processedSegmentIds = new Set<string>();
  private currentConversation: Conversation | null = null;
  
  // Live transcription accumulation
  private currentSessionId: string | null = null;
  private accumulatedTranscripts: TranscriptSegment[] = [];
  private silenceTimeoutRef: NodeJS.Timeout | null = null;
  private readonly SILENCE_TIMEOUT = 10000; // 10 seconds
  private lastTranscriptTime = 0;
  private pollingDelay = 2000; // Start with 2 seconds
  private readonly MAX_POLLING_DELAY = 30000; // Max 30 seconds
  private pendingSegments: TranscriptSegment[] = []; // Store segments for batch sending

  // Webhook URLs
  private readonly AUDIO_BYTES_WEBHOOK = 'https://webhook.site/d82d2c53-b568-4ac7-a9b9-808ce52fde1f';
  private readonly TRANSCRIPTION_WEBHOOK = 'https://webhook.site/9a442af0-3269-4223-be14-ed4b60d81bc0';

  constructor() {
    super();
    this.loadPersistedData();
  }

  private async loadPersistedData() {
    try {
      const processedRequests = await AsyncStorage.getItem('webhook-processed-requests');
      const processedSegments = await AsyncStorage.getItem('webhook-processed-segments');
      
      if (processedRequests) {
        this.processedRequestIds = new Set(JSON.parse(processedRequests));
      }
      if (processedSegments) {
        this.processedSegmentIds = new Set(JSON.parse(processedSegments));
      }
    } catch (error) {
      console.error('Failed to load persisted webhook data:', error);
    }
  }

  private async persistData() {
    try {
      await AsyncStorage.setItem(
        'webhook-processed-requests', 
        JSON.stringify(Array.from(this.processedRequestIds))
      );
      await AsyncStorage.setItem(
        'webhook-processed-segments', 
        JSON.stringify(Array.from(this.processedSegmentIds))
      );
    } catch (error) {
      console.error('Failed to persist webhook data:', error);
    }
  }

  private async fetchWebhookData(webhookUrl: string): Promise<WebhookData[]> {
    try {
      // Convert webhook URL to token API format like the working webapp
      const tokenMatch = webhookUrl.match(/webhook\.site\/([^\/]+)/);
      if (!tokenMatch) {
        throw new Error('Invalid webhook URL format');
      }
      
      const token = tokenMatch[1];
      const tokenApiUrl = `https://webhook.site/token/${token}/requests?sorting=newest&size=10`;
      
      // Use Vercel proxy with token API URL
      const proxyUrl = `https://v0-react-transcription-monitor.vercel.app/api/webhook-proxy?url=${encodeURIComponent(tokenApiUrl)}&apiKey=debd5467-1359-4403-93d1-4260374cede0`;
      console.log(`🌐 TOKEN API: Fetching via proxy with token format: ${proxyUrl}`);
      return this.fetchViaProxy(proxyUrl);
    } catch (error) {
      console.log(`❌ Token API fetch failed: ${error.message}`);
      // Fallback to direct webhook.site access if proxy fails
      console.log(`🔄 Attempting direct fallback...`);
      try {
        return this.fetchDirectWebhookSite(webhookUrl);
      } catch (fallbackError) {
        console.log(`❌ Direct fallback also failed: ${fallbackError.message}`);
        return [];
      }
    }
  }

  private async fetchViaProxy(proxyUrl: string): Promise<WebhookData[]> {
    const response = await fetch(proxyUrl, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'GET'
    });
    
    if (response.status === 429) {
      // Rate limited - increase polling delay
      this.pollingDelay = Math.min(this.pollingDelay * 2, this.MAX_POLLING_DELAY);
      console.warn(`Rate limited. Increasing polling delay to ${this.pollingDelay}ms`);
      throw new Error('Rate limited');
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Proxy error response:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Reset polling delay on success
    this.pollingDelay = 2000;
    console.log(`✅ Proxy: Successfully fetched ${Array.isArray(data) ? data.length : 1} webhook requests`);
    
    // Handle different response formats from different APIs
    if (data.data && Array.isArray(data.data)) {
      // Your webapp API wraps data in a "data" property
      return data.data;
    } else if (Array.isArray(data)) {
      // Direct array response
      return data;
    } else {
      // Single item response
      return [data];
    }
  }

  private async fetchDirectWebhookSite(webhookUrl: string): Promise<WebhookData[]> {
    // Extract token from webhook URL to use token API
    const tokenMatch = webhookUrl.match(/webhook\.site\/([^\/]+)/);
    if (!tokenMatch) {
      throw new Error('Invalid webhook URL format');
    }
    
    const token = tokenMatch[1];
    const apiUrl = `https://webhook.site/token/${token}/requests?sorting=newest&size=10`;
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Origin': 'https://webhook.site',
      'Referer': `https://webhook.site/#!/${token}`
    };

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers
    });

    if (response.status === 429) {
      this.pollingDelay = Math.min(this.pollingDelay * 2, this.MAX_POLLING_DELAY);
      console.warn(`🚫 Rate limited. Increasing polling delay to ${this.pollingDelay}ms`);
      throw new Error('Rate limited');
    }

    if (!response.ok) {
      console.error(`⚠️ Direct webhook.site access failed: ${response.status} ${response.statusText}`);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Reset polling delay on success
    this.pollingDelay = 2000;
    console.log(`✅ Direct: Successfully fetched ${Array.isArray(data) ? data.length : 1} requests`);
    
    return Array.isArray(data) ? data : [data];
  }

  private async checkAudioBytes() {
    try {
      const requests = await this.fetchWebhookData(this.AUDIO_BYTES_WEBHOOK);
      
      if (!requests || requests.length === 0) {
        return;
      }

      const latestRequest = requests[0];
      
      if (!this.lastAudioBytesUuid) {
        // First time - establish baseline
        this.lastAudioBytesUuid = latestRequest.uuid;
        console.log('Established audio bytes baseline:', latestRequest.uuid);
        return;
      }

      if (latestRequest.uuid !== this.lastAudioBytesUuid) {
        // New audio bytes detected - recording started
        this.lastAudioBytesUuid = latestRequest.uuid;
        this.handleRecordingStart();
        
        // Clear any existing timeout
        if (this.audioTimeoutRef) {
          clearTimeout(this.audioTimeoutRef);
        }

        // Set new timeout for recording end detection
        this.audioTimeoutRef = setTimeout(() => {
          this.handleRecordingEnd('no_audio_timeout');
        }, 5000); // 5 second timeout
      }
    } catch (error) {
      console.error('Audio bytes check failed:', error);
    }
  }

  private async checkTranscription() {
    try {
      const requests = await this.fetchWebhookData(this.TRANSCRIPTION_WEBHOOK);
      
      if (!requests || requests.length === 0) {
        console.log('📝 No transcription requests found');
        return;
      }

      console.log(`📦 Received ${requests.length} transcription requests from webhook`);
      const newSegments: TranscriptSegment[] = [];

      for (const request of requests) {
        // Skip if we've already processed this request
        if (this.processedRequestIds.has(request.uuid)) {
          continue;
        }

        try {
          const content = request.content;
          console.log(`🔍 Processing request ${request.uuid}:`, JSON.stringify(content, null, 2));
          
          // Parse transcription data from webhook content
          let transcriptData: any;
          if (typeof content === 'string') {
            transcriptData = JSON.parse(content);
          } else {
            transcriptData = content;
          }

          console.log(`📋 Parsed transcript data:`, JSON.stringify(transcriptData, null, 2));

          // Extract transcript segments - handle both formats
          let segments = [];
          
          if (transcriptData.segments && Array.isArray(transcriptData.segments)) {
            // New format: segments array from your webapp
            segments = transcriptData.segments.map((seg: any) => ({
              id: seg.id || request.uuid,
              speaker: seg.speaker || `SPEAKER_${seg.speaker_id || '1'}`,
              text: seg.text,
              start: seg.start || 0,
              end: seg.end || 0,
              confidence: 0.95, // Default confidence for segments
              source: request.method,
              timestamp: request.created_at,
              session_id: transcriptData.session_id,
            }));
          } else if (transcriptData.transcript || transcriptData.text) {
            // Legacy format: single transcript
            const transcriptText = transcriptData.transcript || transcriptData.text;
            segments = [{
              id: request.uuid,
              speaker: transcriptData.speaker || 'Speaker',
              text: transcriptText,
              start: transcriptData.start || 0,
              end: transcriptData.end || 0,
              confidence: transcriptData.confidence,
              source: request.method,
              timestamp: request.created_at,
            }];
          }

          // Process all segments
          segments.forEach((segment: TranscriptSegment) => {
            console.log(`💬 Found transcription: "${segment.text}" (${segment.speaker})`);
            
            const segmentKey = `${segment.speaker}-${segment.text}-${segment.start}`;
            
            if (!this.processedSegmentIds.has(segmentKey)) {
              console.log(`✅ Adding new transcript segment: "${segment.text}" (confidence: ${segment.confidence || 'N/A'})`);
              newSegments.push(segment);
              this.processedSegmentIds.add(segmentKey);
            } else {
              console.log(`⏭️ Skipping duplicate segment: "${segment.text}"`);
            }
          });

          if (segments.length === 0) {
            console.log(`❌ No transcript segments found in webhook data:`, transcriptData);
          }

          this.processedRequestIds.add(request.uuid);
        } catch (parseError) {
          console.warn('Failed to parse request content:', request.uuid, parseError);
          this.processedRequestIds.add(request.uuid);
        }
      }

      if (newSegments.length > 0) {
        this.handleNewTranscriptsLive(newSegments);
        await this.persistData();
      }
    } catch (error) {
      console.error('Transcription check failed:', error);
    }
  }

  private handleRecordingStart() {
    console.log('🎙️ Recording started - new audio bytes detected');
    
    // Create new conversation
    this.currentConversation = {
      id: Date.now().toString(),
      startTime: new Date(),
      transcripts: [],
      status: 'recording',
    };

    this.emit('recordingStarted', {
      conversationId: this.currentConversation.id,
      timestamp: this.currentConversation.startTime,
    });
  }

  private handleNewTranscriptsLive(segments: TranscriptSegment[]) {
    if (!this.currentConversation) {
      console.log('⚠️ No active conversation for new transcripts - creating one');
      this.handleRecordingStart();
    }

    const now = Date.now();
    this.lastTranscriptTime = now;

    // Extract session ID from first segment
    const sessionId = segments[0]?.session_id || segments[0]?.id || 'default-session';
    
    // If this is a new session, finalize the previous one
    if (this.currentSessionId && this.currentSessionId !== sessionId && this.accumulatedTranscripts.length > 0) {
      console.log('📝 New session detected, finalizing previous session:', this.currentSessionId);
      this.finalizeAccumulatedTranscription();
    }

    this.currentSessionId = sessionId;
    
    // Add new segments to accumulation
    segments.forEach(segment => {
      this.accumulatedTranscripts.push({
        ...segment,
        receivedAt: new Date()
      });
      
      // Also add to current conversation for real-time display
      if (this.currentConversation) {
        this.currentConversation.transcripts.push({
          ...segment,
          receivedAt: new Date()
        });
      }
    });

    // Emit live update event for real-time display
    this.emit('liveTranscript', {
      segments,
      totalSegments: this.accumulatedTranscripts.length,
      sessionId: this.currentSessionId,
      accumulatedText: this.accumulatedTranscripts.map(s => s.text).join(' ')
    });

    console.log(`📊 Live transcript update: ${segments.length} new, ${this.accumulatedTranscripts.length} total`);

    // Reset silence timeout - restart the 10-second countdown
    this.resetSilenceTimeout();
  }

  private resetSilenceTimeout() {
    // Clear existing timeout
    if (this.silenceTimeoutRef) {
      clearTimeout(this.silenceTimeoutRef);
    }

    // Set new 10-second timeout
    this.silenceTimeoutRef = setTimeout(() => {
      console.log('⏰ 10 seconds of silence detected - finalizing transcription');
      this.finalizeAccumulatedTranscription();
    }, this.SILENCE_TIMEOUT);
  }

  private async finalizeAccumulatedTranscription() {
    if (this.accumulatedTranscripts.length === 0) {
      console.log('⚠️ No accumulated transcripts to finalize');
      return;
    }

    console.log(`🎯 Finalizing accumulated transcription with ${this.accumulatedTranscripts.length} segments`);

    // Clear silence timeout
    if (this.silenceTimeoutRef) {
      clearTimeout(this.silenceTimeoutRef);
      this.silenceTimeoutRef = null;
    }

    // Create final conversation object
    const finalConversation: Conversation = {
      id: this.currentSessionId || Date.now().toString(),
      startTime: this.accumulatedTranscripts[0]?.receivedAt || new Date(),
      endTime: new Date(),
      transcripts: [...this.accumulatedTranscripts],
      status: 'completed'
    };

    // Store conversation to backend for AI title/summary generation
    await this.storeConversationToBackend(finalConversation);

    // Emit conversation completed event (this will trigger UI updates)
    this.emit('conversationCompleted', {
      conversation: finalConversation,
      summary: `Live transcription completed with ${this.accumulatedTranscripts.length} segments`
    });

    console.log(`✅ Conversation finalized: ${finalConversation.id} (${this.accumulatedTranscripts.length} segments)`);

    // Reset for next session
    this.accumulatedTranscripts = [];
    this.currentSessionId = null;
    this.currentConversation = null;
  }


  private handleRecordingEnd(reason: 'no_audio_timeout' | 'manual_stop' | 'device_off') {
    console.log(`⏹️ Recording ended - reason: ${reason} (now handled by live accumulation system)`);
    
    // The live accumulation system now handles conversation completion
    // This method just cleans up the old audio timeout system
    
    // Clear timeout if exists
    if (this.audioTimeoutRef) {
      clearTimeout(this.audioTimeoutRef);
      this.audioTimeoutRef = null;
    }

    this.emit('recordingEnded', {
      reason,
      message: 'Recording ended, live accumulation system will handle completion'
    });
  }

  private async generateConversationSummary(conversation: Conversation) {
    try {
      const fullText = conversation.transcripts.map(t => t.text).join(' ');
      
      if (fullText.trim().length === 0) {
        conversation.summary = 'No speech detected in this recording.';
      } else {
        // You can integrate with your existing APIService here
        conversation.summary = `Summary of ${conversation.transcripts.length} segments recorded from ${conversation.startTime.toLocaleString()} to ${conversation.endTime?.toLocaleString()}`;
      }

      // Store the complete conversation in backend
      await this.storeConversationToBackend(conversation);

      this.emit('conversationSummarized', {
        conversationId: conversation.id,
        summary: conversation.summary,
        conversation,
      });
    } catch (error) {
      console.error('Failed to generate conversation summary:', error);
      conversation.summary = 'Summary generation failed.';
    }
  }

  // Store transcription segments to backend API in the same format as regular recordings
  private async storeConversationToBackend(conversation: Conversation) {
    try {
      console.log(`💾 Storing conversation ${conversation.id} to backend with ${conversation.transcripts.length} segments...`);
      console.log(`🎯 Full conversation data:`, JSON.stringify(conversation, null, 2));
      
      const transcriptSegments = conversation.transcripts.map(transcript => ({
        speaker: transcript.speaker || 'SPEAKER_UNKNOWN',
        text: transcript.text,
        start: transcript.start || 0,
        end: transcript.end || (transcript.start ? transcript.start + 3 : 3), // Use actual timing or estimate
        confidence: transcript.confidence || 0.8,
        timestamp: transcript.timestamp || new Date().toISOString()
      }));

      console.log(`📤 Sending to backend:`, JSON.stringify({
        recordingId: conversation.id,
        sessionId: conversation.id,
        transcriptSegments,
        metadata: {
          source: 'hardware-webhook-mobile',
          deviceId: 'mobile-device',
          startTime: conversation.startTime.toISOString(),
          endTime: conversation.endTime?.toISOString(),
          duration: conversation.endTime ? 
            (conversation.endTime.getTime() - conversation.startTime.getTime()) / 1000 : undefined,
          segmentCount: transcriptSegments.length
        }
      }, null, 2));

      const response = await fetch('https://backend-kexb4s6xd-amy-zhous-projects-45e75853.vercel.app/api/webhook-transcription/store', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recordingId: conversation.id,
          sessionId: conversation.id,
          transcriptSegments,
          metadata: {
            source: 'hardware-webhook-mobile',
            deviceId: 'mobile-device', // You might want to get actual device ID
            startTime: conversation.startTime.toISOString(),
            endTime: conversation.endTime?.toISOString(),
            duration: conversation.endTime ? 
              (conversation.endTime.getTime() - conversation.startTime.getTime()) / 1000 : undefined,
            segmentCount: transcriptSegments.length
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`✅ Stored conversation to backend:`, result);
        console.log(`📝 Title: "${result.title}"`);
        console.log(`📄 Summary: "${result.summary}"`);
        
        // Update conversation with backend-generated title/summary
        conversation.title = result.title;
        conversation.summary = result.summary;
        
      } else {
        const error = await response.text();
        console.error(`❌ Failed to store conversation to backend:`, error);
      }

    } catch (error) {
      console.error('💥 Error storing conversation to backend:', error.message);
      // Don't throw - allow the conversation to continue without backend storage
    }
  }

  // Add segments to pending batch for incremental storage
  private addToPendingSegments(segments: TranscriptSegment[]) {
    this.pendingSegments.push(...segments);
    console.log(`📝 Added ${segments.length} segments to pending batch. Total pending: ${this.pendingSegments.length}`);
    
    // Store segments when we have enough or after a delay
    if (this.pendingSegments.length >= 5) {
      this.storePendingSegments();
    }
  }

  public startMonitoring() {
    if (this.isMonitoring) {
      console.log('Webhook monitoring already active');
      return;
    }

    const isDevelopment = __DEV__;
    console.log('🚀 Starting webhook monitoring...');
    console.log(`📡 Environment: ${isDevelopment ? 'DEVELOPMENT' : 'PRODUCTION'}`);
    console.log(`🔗 Audio bytes webhook: ${this.AUDIO_BYTES_WEBHOOK}`);
    console.log(`📝 Transcription webhook: ${this.TRANSCRIPTION_WEBHOOK}`);
    console.log(`⚙️ Method: ${isDevelopment ? 'Local proxy (192.168.1.16:3000)' : 'Direct webhook.site API'}`);
    this.isMonitoring = true;

    // Start monitoring audio bytes for recording detection
    this.audioPollingInterval = setInterval(() => {
      this.checkAudioBytes();
    }, 5000); // Check every 5 seconds

    // Start monitoring transcription webhook
    this.transcriptionPollingInterval = setInterval(() => {
      this.checkTranscription();
    }, this.pollingDelay);

    this.emit('monitoringStarted');
  }

  public stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    console.log('🛑 Stopping webhook monitoring...');
    this.isMonitoring = false;

    if (this.audioPollingInterval) {
      clearInterval(this.audioPollingInterval);
      this.audioPollingInterval = null;
    }

    if (this.transcriptionPollingInterval) {
      clearInterval(this.transcriptionPollingInterval);
      this.transcriptionPollingInterval = null;
    }

    if (this.audioTimeoutRef) {
      clearTimeout(this.audioTimeoutRef);
      this.audioTimeoutRef = null;
    }

    // Clear silence timeout for live transcription accumulation
    if (this.silenceTimeoutRef) {
      clearTimeout(this.silenceTimeoutRef);
      this.silenceTimeoutRef = null;
    }

    // Finalize any accumulated transcription before stopping
    if (this.accumulatedTranscripts.length > 0) {
      console.log('🎯 Finalizing accumulated transcription before stopping monitoring');
      this.finalizeAccumulatedTranscription();
    }

    // End current recording if active
    if (this.currentConversation && this.currentConversation.status === 'recording') {
      this.handleRecordingEnd('manual_stop');
    }

    this.emit('monitoringStopped');
  }

  public manualStopRecording() {
    this.handleRecordingEnd('manual_stop');
  }

  public getCurrentConversation(): Conversation | null {
    return this.currentConversation;
  }

  public isCurrentlyMonitoring(): boolean {
    return this.isMonitoring;
  }

  public isCurrentlyRecording(): boolean {
    return this.currentConversation?.status === 'recording' || false;
  }

  public exportConversationData(): string {
    const conversations = this.currentConversation ? [this.currentConversation] : [];
    return JSON.stringify(conversations, null, 2);
  }

  public clearProcessedData() {
    this.processedRequestIds.clear();
    this.processedSegmentIds.clear();
    this.persistData();
    console.log('Cleared all processed webhook data');
  }

  // Testing method to simulate webhook transcription data
  public simulateWebhookTranscription(text: string = 'This is a test transcription from webhook simulation.') {
    const testSegment = {
      id: `test-${Date.now()}`,
      speaker: 'Test Hardware',
      text,
      start: 0,
      end: 5,
      confidence: 0.95,
      source: 'SIMULATION',
      timestamp: new Date().toISOString(),
    };

    this.handleNewTranscriptsLive([testSegment]);
    console.log('🧪 Simulated webhook transcription:', text);
  }

  // Test method to simulate recording start
  public simulateRecordingStart() {
    this.handleRecordingStart();
  }

  // Test method to simulate recording end
  public simulateRecordingEnd() {
    this.handleRecordingEnd('manual_stop');
  }

  // FORCE IMMEDIATE FINALIZATION: Bypasses timeout and forces finalization with current data
  public async forceImmediateFinalization() {
    console.log('🚨 FORCE FINALIZE: Bypassing timeout and finalizing current transcripts...');
    
    if (this.accumulatedTranscripts.length > 0) {
      console.log(`🚨 FORCE FINALIZE: Found ${this.accumulatedTranscripts.length} accumulated transcripts, finalizing now...`);
      await this.finalizeAccumulatedTranscription();
    } else {
      console.log('🚨 FORCE FINALIZE: No accumulated transcripts, creating test data...');
      // Add test data and finalize
      const testSegment = {
        id: `force-finalize-${Date.now()}`,
        speaker: 'FORCE_TEST',
        text: 'Force finalization test - bypassing timeout completely',
        start: 0,
        end: 2,
        confidence: 0.98,
        source: 'FORCE_FINALIZE_TEST',
        timestamp: new Date().toISOString(),
      };
      this.accumulatedTranscripts.push(testSegment);
      this.currentSessionId = `force-session-${Date.now()}`;
      await this.finalizeAccumulatedTranscription();
    }
  }

  // EMERGENCY TEST METHOD: Force backend storage immediately with current accumulated data
  public async testBackendStorageNow() {
    console.log('🧪 EMERGENCY TEST: Forcing backend storage with current data...');
    
    if (this.accumulatedTranscripts.length === 0) {
      // Create test data if no accumulated data
      const testSegment = {
        id: `test-emergency-${Date.now()}`,
        speaker: 'TEST_STORAGE',
        text: 'Testing emergency backend storage functionality',
        start: 0,
        end: 3,
        confidence: 0.95,
        source: 'EMERGENCY_TEST',
        timestamp: new Date().toISOString(),
        receivedAt: new Date()
      };
      this.accumulatedTranscripts.push(testSegment);
      console.log('🧪 Created test segment for emergency test');
    }

    console.log(`🧪 Testing with ${this.accumulatedTranscripts.length} accumulated segments`);
    
    // Force create conversation and store
    const testConversation: Conversation = {
      id: `emergency-test-${Date.now()}`,
      startTime: new Date(Date.now() - 60000), // 1 minute ago
      endTime: new Date(),
      transcripts: [...this.accumulatedTranscripts],
      status: 'completed'
    };

    try {
      await this.storeConversationToBackend(testConversation);
      console.log('🧪 EMERGENCY TEST: Storage call completed - check logs above for success/failure');
    } catch (error) {
      console.error('🧪 EMERGENCY TEST FAILED:', error);
    }
  }
}

export default new WebhookService();