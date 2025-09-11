import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Animated,
  Dimensions,
  TextInput,
  AppState,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import APIService from '../services/APIService';
import AudioRecordingService from '../services/AudioRecordingService';
import DeepLinkService from '../services/DeepLinkService';
import uuid from 'react-native-uuid';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import SecureStorageService from '../services/SecureStorageService';
import WebhookService from '../services/WebhookService';
import OmiBluetoothService from '../services/OmiBluetoothService';
import OmiAudioStreamService from '../services/OmiAudioStreamService';
import OmiDevicePairing from '../components/OmiDevicePairing';
import OmiStreamingStatus from '../components/OmiStreamingStatus';
import { Buffer } from 'buffer';
import { useTheme, spacing, borderRadius, typography, shadows } from '../theme/colors';

const { width } = Dimensions.get('window');

interface Transcript {
  id: string;
  text: string;
  title?: string;
  summary?: string;
  timestamp: Date;
  isExpanded?: boolean;
  path?: string; // ZeroEntropy document path when available
  aiTitle?: string;
  aiSummary?: string;
  durationSeconds?: number | null;
  duration_seconds?: number | null;
  localAudioPath?: string; // Local WAV/M4A file path
  remoteAudioUrl?: string; // Backend audio URL
  source?: 'ble' | 'recording' | 'upload'; // Track where audio came from
}

export default function RecordScreen({ route }: any) {
  const colors = useTheme();
  const styles = createStyles(colors);
  const navigation = useNavigation();
  const [isRecording, setIsRecording] = useState(false);
  const [isBackgroundRecording, setIsBackgroundRecording] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [currentRecordingId, setCurrentRecordingId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const pulseAnim = new Animated.Value(1);
  const [recordingTime, setRecordingTime] = useState(0);
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTranscripts, setFilteredTranscripts] = useState<Transcript[]>([]);
  const [showUploadOptions, setShowUploadOptions] = useState(false);

  // Webhook integration states
  const [isWebhookMonitoring, setIsWebhookMonitoring] = useState(false);
  const [isTranscriptionCollapsed, setIsTranscriptionCollapsed] = useState(false);
  const [isHardwareRecording, setIsHardwareRecording] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [realtimeTranscripts, setRealtimeTranscripts] = useState<any[]>([]);
  const [webhookRecordingDuration, setWebhookRecordingDuration] = useState(0);

  // Omi device integration states
  const [omiDeviceConnected, setOmiDeviceConnected] = useState(false);
  const [omiDeviceStreaming, setOmiDeviceStreaming] = useState(false);
  const [showOmiPairing, setShowOmiPairing] = useState(false);
  const [omiRealtimeTranscript, setOmiRealtimeTranscript] = useState('');

  // Handle deep linking via events
  useEffect(() => {
    const handleDeepLink = (data: { action: string }) => {
      console.log('RecordScreen: Received deep link:', data.action);
      
      setTimeout(() => {
        if (data.action === 'record' || data.action === 'start') {
          console.log('RecordScreen: Starting recording from deep link');
          if (!isRecording) {
            toggleRecording();
          }
        } else if (data.action === 'stop') {
          console.log('RecordScreen: Stopping recording from deep link');
          if (isRecording) {
            toggleRecording();
          }
        } else if (data.action === 'toggle') {
          console.log('RecordScreen: Toggling recording from deep link');
          toggleRecording();
        }
      }, 500);
    };

    DeepLinkService.on('deeplink', handleDeepLink);
    
    return () => {
      DeepLinkService.off('deeplink', handleDeepLink);
    };
  }, [isRecording]);

  // Handle app state changes to maintain recording in background
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      console.log('App state changed to:', nextAppState);
      
      if (nextAppState === 'background' && isRecording) {
        console.log('App backgrounded while recording - enabling background mode');
        setIsBackgroundRecording(true);
      } else if (nextAppState === 'active') {
        if (isRecording && isBackgroundRecording) {
          console.log('App foregrounded while background recording - recording still active');
        }
        setIsBackgroundRecording(false);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription?.remove();
    };
  }, [isRecording, isBackgroundRecording]);

  useEffect(() => {
    // Setup webhook event listeners
    WebhookService.on('recordingStarted', handleWebhookRecordingStarted);
    WebhookService.on('liveTranscript', handleWebhookLiveTranscript);
    WebhookService.on('recordingEnded', handleWebhookRecordingEnded);
    WebhookService.on('conversationCompleted', handleConversationCompleted);
    WebhookService.on('monitoringStarted', () => setIsWebhookMonitoring(true));
    WebhookService.on('monitoringStopped', () => setIsWebhookMonitoring(false));

    // Setup Omi event listeners
    OmiBluetoothService.on('deviceConnected', handleOmiDeviceConnected);
    OmiBluetoothService.on('deviceDisconnected', handleOmiDeviceDisconnected);
    OmiAudioStreamService.on('realtimeTranscription', handleOmiRealtimeTranscription);
    OmiAudioStreamService.on('finalTranscription', handleOmiFinalTranscription);

    loadTranscriptsFromBackend();

    // Auto-start webhook monitoring
    WebhookService.startMonitoring();

    return () => {
      WebhookService.removeAllListeners();
      WebhookService.stopMonitoring();
      OmiBluetoothService.removeAllListeners();
      OmiAudioStreamService.removeAllListeners();
      if (intervalId) clearInterval(intervalId);
    };
  }, [currentRecordingId]);


  // Handle navigation from Chat screen
  useEffect(() => {
    if (route?.params?.transcriptId) {
      setHighlightedId(route.params.transcriptId);
      // Scroll to the transcript after a short delay
      setTimeout(() => {
        const index = transcripts.findIndex(t => t.id === route.params.transcriptId);
        if (index !== -1) {
          // Expand the transcript
          toggleExpand(route.params.transcriptId);
        }
      }, 500);
    }
  }, [route?.params?.transcriptId, transcripts]);

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();

      const timer = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      setIntervalId(timer);
    } else {
      pulseAnim.setValue(1);
      if (intervalId) {
        clearInterval(intervalId);
        setIntervalId(null);
      }
      setRecordingTime(0);
    }
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const loadTranscriptsFromBackend = async () => {
    try {
      console.log('Loading transcripts from backend...');
      const recentTranscripts = await APIService.getRecentTranscripts(100);
      console.log('Received', recentTranscripts?.length, 'transcripts from backend');
      
      if (recentTranscripts && recentTranscripts.length > 0) {
        // Create a map of current transcripts to preserve local audio paths
        const localTranscriptMap = new Map(
          transcripts.map(t => [t.id, t])
        );
        
        const backendTranscripts: Transcript[] = recentTranscripts.map((t: any) => {
          const fallbackTitle = (t.title && t.title.trim().length > 0)
            ? t.title
            : (t.text ? (t.text.split('\n')[0] || t.text).slice(0, 50) : 'Untitled');
          const fallbackSummary = (t.summary && t.summary.trim().length > 0)
            ? t.summary
            : (t.text ? (t.text.slice(0, 160) + (t.text.length > 160 ? '…' : '')) : '');
          
          // Check if we have local data for this transcript
          const localData = localTranscriptMap.get(t.id);
          
          return {
            id: t.id,
            text: t.text,
            title: t.title,
            summary: t.summary,
            timestamp: new Date(t.timestamp),
            path: t.path,
            aiTitle: t.aiTitle || fallbackTitle,
            aiSummary: t.aiSummary || fallbackSummary,
            durationSeconds: t.durationSeconds ?? t.duration_seconds ?? null,
            // Preserve local audio path if we have it
            localAudioPath: localData?.localAudioPath,
            remoteAudioUrl: t.audioUrl || localData?.remoteAudioUrl,
            source: localData?.source || 'backend',
          } as any;
        });

        // Find transcripts that are local-only (not yet in backend)
        const localOnlyTranscripts = transcripts.filter(localT => {
          const foundInBackend = backendTranscripts.some(backendT => backendT.id === localT.id);
          if (!foundInBackend && localT.localAudioPath) {
            console.log(`Preserving local transcript not yet in backend: ${localT.id}`);
          }
          return !foundInBackend && localT.localAudioPath; // Only keep if it has local data
        });
        
        // Combine and sort by timestamp (newest first)
        const mergedTranscripts = [...localOnlyTranscripts, ...backendTranscripts]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        
        // Final deduplication by ID to prevent React key conflicts
        const deduplicatedTranscripts = mergedTranscripts.reduce((acc, current) => {
          const existingIndex = acc.findIndex(t => t.id === current.id);
          if (existingIndex === -1) {
            acc.push(current);
          } else {
            // Keep the one with more complete data (prefer backend data with titles/summaries)
            if (current.title && current.summary && !acc[existingIndex].title) {
              acc[existingIndex] = current;
            }
          }
          return acc;
        }, [] as Transcript[]);
        
        console.log(`Merging transcripts: ${localOnlyTranscripts.length} local-only + ${backendTranscripts.length} backend = ${mergedTranscripts.length} merged -> ${deduplicatedTranscripts.length} deduplicated`);
        setTranscripts(deduplicatedTranscripts);
        setFilteredTranscripts(deduplicatedTranscripts);
        console.log('Transcripts updated with merged data');
      }
    } catch (error) {
      console.error('Error loading transcripts:', error);
    }
  };

  // Filter transcripts based on search query
  useEffect(() => {
    console.log('Filtering transcripts, total:', transcripts.length, 'search:', searchQuery);
    if (!searchQuery.trim()) {
      setFilteredTranscripts(transcripts);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = transcripts.filter(transcript => {
        const title = (transcript.aiTitle || transcript.title || '').toLowerCase();
        const summary = (transcript.aiSummary || transcript.summary || '').toLowerCase();
        const text = (transcript.text || '').toLowerCase();
        
        return title.includes(query) || summary.includes(query) || text.includes(query);
      });
      setFilteredTranscripts(filtered);
    }
    console.log('Filtered transcripts count:', filteredTranscripts.length);
  }, [searchQuery, transcripts]);

  const formatDuration = (seconds?: number | null) => {
    if (!seconds || seconds <= 0) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const buildReportText = (t: any) => {
    const dateStr = t.timestamp?.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) || '';
    const timeStr = t.timestamp?.toLocaleTimeString() || '';
    const durStr = formatDuration(t.durationSeconds ?? t.duration_seconds);
    const title = t.aiTitle || t.title || 'Untitled';
    const summary = t.aiSummary || '—';
    const fullText = (t.text && t.text.trim().length > 0) ? t.text : '[No speech detected]';
    return `📄 TaiNecklace Transcription Report\n\n📅 Date: ${dateStr}\n🕐 Time: ${timeStr}\n⏱️ Duration: ${durStr}\n\nAI Title \n${title}\n\n🤖 AI Summary:\n${summary}\n\n📝 Full Transcription:\n${fullText}\n\n---\nGenerated by TaiNecklace App\nAI-powered voice companion`;
  };

  const copyReport = async (t: any) => {
    const text = buildReportText(t);
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Report copied to clipboard');
  };


  // Omi event handlers
  const handleOmiDeviceConnected = (device: any) => {
    setOmiDeviceConnected(true);
    setShowOmiPairing(false);
    console.log('✅ Omi device connected:', device.name);
  };

  const handleOmiDeviceDisconnected = (device: any) => {
    setOmiDeviceConnected(false);
    setOmiDeviceStreaming(false);
    setOmiRealtimeTranscript('');
    console.log('❌ Omi device disconnected:', device.name);
  };

  const handleOmiRealtimeTranscription = (data: any) => {
    setOmiRealtimeTranscript(data.text);
    console.log('📝 Omi realtime transcription:', data.text);
  };

  const handleOmiFinalTranscription = async (data: any) => {
    console.log('📝 Omi final transcription:', data.text);
    
    // Create a new transcript from Omi audio
    const omiTranscript: Transcript = {
      id: data.recordingId || uuid.v4() as string,
      text: data.text,
      timestamp: new Date(),
      title: 'Omi Recording',
      summary: `Voice recording captured via Omi device (${data.duration?.toFixed(1)}s)`,
      aiTitle: 'Omi Voice Recording',
      aiSummary: data.text.length > 100 ? data.text.slice(0, 100) + '...' : data.text,
      durationSeconds: data.duration,
      source: 'omi',
    };

    setTranscripts(prev => [omiTranscript, ...prev]);
    setOmiRealtimeTranscript('');

    // Also try to get AI-generated title and summary from backend
    try {
      const response = await APIService.sendAudioBase64(
        '', // No audio data needed, just process the text
        omiTranscript.id,
        'wav',
        data.text // Pass transcription text directly
      );
      
      if (response.title || response.summary) {
        setTranscripts(prev => prev.map(t => 
          t.id === omiTranscript.id 
            ? { 
                ...t, 
                title: response.title || t.title,
                summary: response.summary || t.summary,
                aiTitle: response.title || t.aiTitle,
                aiSummary: response.summary || t.aiSummary
              }
            : t
        ));
      }
    } catch (error) {
      console.error('Failed to enhance Omi transcription:', error);
    }
  };

  // Webhook event handlers
  const handleWebhookRecordingStarted = (data: any) => {
    console.log('🎙️ Hardware recording started:', data);
    setIsHardwareRecording(true);
    setCurrentConversationId(data.conversationId);
    setRealtimeTranscripts([]);
    setWebhookRecordingDuration(0);
    
    // Start duration timer
    const startTime = Date.now();
    const timer = setInterval(() => {
      setWebhookRecordingDuration(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    // Store timer reference for cleanup
    setTimeout(() => clearInterval(timer), 300000); // Auto-clear after 5 minutes
  };

  const handleWebhookLiveTranscript = (data: any) => {
    console.log('📝 Live transcription update:', data.segments.length, 'new segments,', data.totalSegments, 'total');
    
    // Add timestamp to each segment for display
    const segmentsWithTimestamp = data.segments.map((segment: any) => ({
      ...segment,
      receivedAt: new Date(),
      conversationId: data.sessionId || 'webhook-live'
    }));
    
    // Only add new segments that aren't already in the list to prevent duplicates
    setRealtimeTranscripts(prev => {
      const newSegments = segmentsWithTimestamp.filter(newSeg => 
        !prev.some(existingSeg => 
          existingSeg.text === newSeg.text && 
          existingSeg.speaker === newSeg.speaker &&
          Math.abs((existingSeg.receivedAt?.getTime() || 0) - (newSeg.receivedAt?.getTime() || 0)) < 5000 // Within 5 seconds
        )
      );
      
      if (newSegments.length > 0) {
        console.log(`Adding ${newSegments.length} new segments (${prev.length} existing)`);
        // Keep only the last 50 segments to prevent memory bloat
        return [...prev, ...newSegments].slice(-50);
      }
      
      return prev;
    });
  };

  const handleWebhookRecordingEnded = (data: any) => {
    console.log('⏹️ Hardware recording ended:', data.reason, `Duration: ${data.duration}ms`);
    setIsHardwareRecording(false);
    setCurrentConversationId(null);
    setWebhookRecordingDuration(0);
    
    // Convert webhook transcription to regular transcript format and save
    if (realtimeTranscripts.length > 0) {
      const webhookText = realtimeTranscripts
        .map(segment => `[${segment.speaker || 'Speaker'}] ${segment.text}`)
        .join('\n');
      
      const webhookTranscript: Transcript = {
        id: uuid.v4() as string,
        text: webhookText,
        title: `Webhook Recording - ${data.reason}`,
        summary: `Hardware recording captured ${realtimeTranscripts.length} segments over ${Math.round(data.duration / 1000)}s`,
        timestamp: new Date(),
        aiTitle: 'Hardware Transcription',
        aiSummary: `Captured via webhook monitoring (${data.reason})`
      };
      
      setTranscripts(prev => [webhookTranscript, ...prev]);
      console.log('💾 Saved webhook transcription with', realtimeTranscripts.length, 'segments');
      
      // Clear realtime transcripts after saving
      setRealtimeTranscripts([]);
    }
  };

  const handleConversationCompleted = async (data: any) => {
    console.log('📋 Conversation completed:', data.conversation.id);
    
    // Create a transcript from the conversation
    const conversation = data.conversation;
    const fullText = conversation.transcripts.map((t: any) => t.text).join(' ');
    
    if (fullText.trim().length > 0) {
      // Initial transcript with temporary title
      const tempTranscript: Transcript = {
        id: conversation.id,
        text: fullText,
        title: 'Generating AI title...',
        summary: data.summary,
        timestamp: new Date(conversation.startTime),
        aiTitle: 'Generating AI title...',
        aiSummary: data.summary,
        durationSeconds: Math.floor((new Date(conversation.endTime).getTime() - new Date(conversation.startTime).getTime()) / 1000),
        source: 'hardware',
      };
      
      setTranscripts(prev => [tempTranscript, ...prev]);
      setFilteredTranscripts(prev => [tempTranscript, ...prev]);
      
      // Save to backend and get AI-generated title
      try {
        // Convert transcript segments format for webhook API
        const transcriptSegments = conversation.transcripts.map((t: any, index: number) => ({
          speaker: `Speaker ${index + 1}`,
          text: t.text,
          start: index * 3, // Estimate timing
          end: (index + 1) * 3,
          confidence: t.confidence || 0.8,
          timestamp: t.timestamp || new Date().toISOString()
        }));

        const response = await fetch('https://backend-henna-tau-11.vercel.app/api/webhook-transcription/store', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recordingId: conversation.id,
            sessionId: conversation.id,
            transcriptSegments,
            metadata: {
              source: 'hardware-mobile-app',
              deviceId: 'mobile-device',
              startTime: conversation.startTime,
              endTime: conversation.endTime
            }
          })
        });

        if (response.ok) {
          const result = await response.json();
          console.log('✅ Backend returned AI title:', result.title);
          
          // Update transcript with AI-generated title
          const updatedTranscript: Transcript = {
            ...tempTranscript,
            title: result.title || 'Hardware Recording',
            aiTitle: result.title || 'Hardware Recording',
            summary: result.summary || data.summary,
            aiSummary: result.summary || data.summary,
          };
          
          // Update the transcript in state
          setTranscripts(prev => prev.map(t => t.id === conversation.id ? updatedTranscript : t));
          setFilteredTranscripts(prev => prev.map(t => t.id === conversation.id ? updatedTranscript : t));
          
          console.log('Hardware recording saved with AI title:', result.title);
        } else {
          console.error('Failed to get AI title from backend:', response.statusText);
          // Update with fallback title
          const fallbackTranscript = { ...tempTranscript, title: 'Hardware Recording', aiTitle: 'Hardware Recording' };
          setTranscripts(prev => prev.map(t => t.id === conversation.id ? fallbackTranscript : t));
          setFilteredTranscripts(prev => prev.map(t => t.id === conversation.id ? fallbackTranscript : t));
        }
      } catch (error) {
        console.error('Failed to save hardware recording to backend:', error);
        // Update with fallback title
        const fallbackTranscript = { ...tempTranscript, title: 'Hardware Recording', aiTitle: 'Hardware Recording' };
        setTranscripts(prev => prev.map(t => t.id === conversation.id ? fallbackTranscript : t));
        setFilteredTranscripts(prev => prev.map(t => t.id === conversation.id ? fallbackTranscript : t));
      }
    }
    
    // Clear realtime transcripts
    setRealtimeTranscripts([]);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      try {
        setIsLoading(true);
        
        const audioUri = await AudioRecordingService.stopRecording();
        
        if (audioUri) {
          const base64Audio = await AudioRecordingService.getRecordingBase64();
          
          if (base64Audio) {
            const response = await APIService.sendAudioBase64(base64Audio, currentRecordingId, 'm4a');
            
            if (response.transcription) {
              console.log('Transcription received:', response.transcription);
              setTimeout(loadTranscriptsFromBackend, 2000);
            }
          }
        }
      } catch (error) {
        console.error('Failed to stop recording:', error);
        Alert.alert('Error', 'Failed to process recording');
      } finally {
        setIsLoading(false);
        setIsRecording(false);
        setCurrentRecordingId('');
      }
    } else {
      try {
        const recordingId = uuid.v4() as string;
        setCurrentRecordingId(recordingId);
        
        await AudioRecordingService.startRecording();
        setIsRecording(true);
        console.log('Audio recording started');
      } catch (error) {
        console.error('Failed to start recording:', error);
        Alert.alert('Recording Error', 'Failed to start recording. Please check microphone permissions.');
        setIsRecording(false);
      }
    }
  };

  const toggleExpand = (id: string) => {
    setTranscripts(prev => prev.map(t => 
      t.id === id ? { ...t, isExpanded: !t.isExpanded } : t
    ));
  };

  const deleteTranscript = async (transcript: Transcript) => {
    Alert.alert(
      'Delete this item?',
      'This will remove it from the list and from ZeroEntropy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete from ZeroEntropy only if we have a real document path
              if (transcript.path) {
                await APIService.deleteDocument(transcript.path);
                console.log(`Successfully deleted transcript with path ${transcript.path}`);
              } else {
                console.log('No path found, removing locally only');
              }
              
              // Remove from UI
              setTranscripts((prev) => prev.filter((t) => t.id !== transcript.id));
            } catch (err) {
              console.error('Delete failed:', err);
              Alert.alert('Delete Failed', 'Could not delete the document.');
              // Reload in case of error
              loadTranscriptsFromBackend();
            }
          }
        }
      ]
    );
  };

  const handleUploadAudio = async () => {
    try {
      setIsUploadingAudio(true);
      const pick = await DocumentPicker.getDocumentAsync({
        type: ['audio/wav', 'audio/x-m4a', 'audio/m4a', 'audio/mp4', 'audio/*'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      
      if (pick.canceled || !pick.assets || pick.assets.length === 0) {
        return;
      }
      
      const asset = pick.assets[0];
      const uri = asset.uri;
      const filename = asset.name || `upload-${Date.now()}.audio`;
      
      // Detect format from filename or mime type
      let format = 'wav';
      if (filename.toLowerCase().endsWith('.m4a') || asset.mimeType?.includes('m4a')) {
        format = 'm4a';
      } else if (filename.toLowerCase().endsWith('.mp3') || asset.mimeType?.includes('mp3')) {
        format = 'mp3';
      }
      
      console.log(`Uploading audio file: ${filename}, format: ${format}, type: ${asset.mimeType}`);

      // Read the file as base64
      const base64Audio = await FileSystem.readAsStringAsync(uri, { 
        encoding: FileSystem.EncodingType.Base64 
      });
      
      // Send to backend for transcription and storage
      const recordingId = uuid.v4() as string;
      const response = await APIService.sendAudioBase64(base64Audio, recordingId, format);
      
      if (response.transcription) {
        Alert.alert('Success', `Transcribed and uploaded ${filename} to ZeroEntropy`);
        console.log('Transcription:', response.transcription);
        // Reload transcripts to show the new one
        setTimeout(loadTranscriptsFromBackend, 2000);
      }
    } catch (e: any) {
      console.error('Audio upload failed:', e);
      Alert.alert('Upload Failed', e?.message || 'Unknown error');
    } finally {
      setIsUploadingAudio(false);
    }
  };

  const handleUploadText = async () => {
    try {
      setIsUploading(true);
      const pick = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/*', 'application/text', '*/*'], // More flexible type matching
        multiple: false,
        copyToCacheDirectory: true,
      });
      
      if (pick.canceled || !pick.assets || pick.assets.length === 0) {
        return;
      }
      
      const asset = pick.assets[0];
      const uri = asset.uri;
      const filename = asset.name || `upload-${Date.now()}.txt`;
      
      console.log('Picked file:', filename, 'URI:', uri, 'Type:', asset.mimeType);

      const fileContent = await FileSystem.readAsStringAsync(uri, { 
        encoding: FileSystem.EncodingType.UTF8 
      });
      
      console.log('File content length:', fileContent.length);
      console.log('First 200 chars:', fileContent.substring(0, 200));
      
      if (!fileContent || fileContent.trim().length === 0) {
        Alert.alert('Error', 'File appears to be empty');
        return;
      }
      
      const result = await APIService.uploadTextDocument(fileContent, {
        path: `mobile/uploads/${filename}`,
        metadata: { source: 'mobile', filename },
        collectionName: 'ai-wearable-transcripts',
      });
      
      Alert.alert('Success', `Uploaded ${filename} to ZeroEntropy\n${fileContent.length} characters`);
      console.log('Upload result:', result);
      
      // Reload transcripts after a delay to ensure it's processed
      setTimeout(loadTranscriptsFromBackend, 2000);
    } catch (e: any) {
      console.error('Upload failed:', e);
      Alert.alert('Upload Failed', e?.message || 'Unknown error');
    } finally {
      setIsUploading(false);
    }
  };

  const openReport = async (t: Transcript) => {
    try {
      const dt = t.timestamp;
      const dateStr = dt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = dt.toLocaleTimeString();
      const durationStr = formatDuration(t.durationSeconds ?? t.duration_seconds);
      let summary = '';
      try {
        summary = await APIService.generateSummary(t.text);
      } catch {
        summary = 'The recording did not contain any speech or detectable audio content.';
      }
      setReportContent({
        title: 'TaiNecklace Transcription Report',
        date: dateStr,
        time: timeStr,
        duration: durationStr,
        summary,
        transcription: t.text && t.text.trim().length > 0 ? t.text : '[No speech detected]',
      });
      setReportVisible(true);
    } catch (e) {
      console.error('Failed to open report:', e);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[colors.background.primary, colors.background.secondary]}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Welcome to Tai</Text>
         
        </View>

        <View style={styles.recordContainer}>
          {/* Main Recording Section - Horizontal Layout */}
          <View style={styles.recordingRow}>
            {/* Main Record Button */}
            <TouchableOpacity
              style={styles.recordButtonWrapper}
              onPress={toggleRecording}
              disabled={isLoading}
            >
              <Animated.View
                style={[
                  styles.pulseCircle,
                  {
                    transform: [{ scale: pulseAnim }],
                    opacity: isRecording ? 0.3 : 0,
                  },
                ]}
              />
              <LinearGradient
                colors={
                  isRecording 
                    ? [colors.accent.error, '#DC2626']
                    : [colors.primary.main, colors.secondary.main]
                }
                style={styles.recordButton}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="large" />
                ) : (
                  <Ionicons 
                    name={isRecording ? 'stop' : 'mic'} 
                    size={24} 
                    color="#fff" 
                  />
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Upload Button - Small Circular */}
            <TouchableOpacity
              style={styles.miniCircularButton}
              onPress={() => setShowUploadOptions(!showUploadOptions)}
            >
              <LinearGradient
                colors={[colors.primary.light, colors.primary.main]}
                style={styles.miniButtonGradient}
              >
                <Ionicons name="cloud-upload" size={12} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
          
          <Text style={styles.recordHint}>
            {isRecording ? 'Tap to stop' : 'Tap to record'}
          </Text>
        </View>
        {isWebhookMonitoring && (
            <View style={styles.realtimeSection}>
              <TouchableOpacity 
                style={styles.realtimeHeader} 
                onPress={() => setIsTranscriptionCollapsed(!isTranscriptionCollapsed)}
              >
                <Ionicons name="radio" size={16} color={isHardwareRecording ? colors.text.accent : colors.primary.main} />
                <Text style={styles.realtimeSectionTitle}>
                  {isHardwareRecording ? 'Recording' : 'Listening'} 
                </Text>
                <View style={styles.statusIndicator}>
                  <ActivityIndicator size="small" color={colors.primary.main} />
                  <Text style={styles.statusText}>LIVE</Text>
                </View>
                <Ionicons 
                  name={isTranscriptionCollapsed ? 'chevron-down' : 'chevron-up'} 
                  size={16} 
                  color={colors.text.secondary} 
                  style={{ marginLeft: 8 }}
                />
              </TouchableOpacity>
              
              {!isTranscriptionCollapsed && (
                realtimeTranscripts.length > 0 ? (
                  <ScrollView style={styles.transcriptContainer} nestedScrollEnabled>
                    {realtimeTranscripts.slice(-10).map((segment, index) => {
                      // Create a unique key using multiple properties to prevent duplicates
                      const uniqueKey = `${segment.conversationId || 'webhook'}-${index}-${segment.receivedAt?.getTime() || Date.now()}-${segment.text?.slice(0, 20).replace(/\s/g, '')}`;
                      return (
                        <View key={uniqueKey} style={styles.transcriptSegment}>
                          <View style={styles.transcriptHeader}>
                            <Text style={styles.transcriptTime}>
                              {segment.receivedAt ? segment.receivedAt.toLocaleTimeString() : 'Now'}
                            </Text>
                            {segment.speaker && (
                              <Text style={styles.transcriptSpeaker}>{segment.speaker}</Text>
                            )}
                            {segment.confidence && (
                              <Text style={styles.transcriptConfidence}>
                                {Math.round(segment.confidence * 100)}%
                              </Text>
                            )}
                          </View>
                          <Text style={styles.transcriptText}>{segment.text}</Text>
                        </View>
                      );
                    })}
                    {realtimeTranscripts.length > 10 && (
                      <Text style={styles.realtimeMore}>
                        +{realtimeTranscripts.length - 10} earlier transcripts...
                      </Text>
                    )}
                  </ScrollView>
                ) : (
                  <View style={styles.emptyTranscriptState}>
                    <Text style={styles.emptyTranscriptText}>
                      Waiting for transcription data from webhook...
                    </Text>
                    <Text style={styles.emptyTranscriptSubtext}>
                      Send audio to trigger hardware transcription
                    </Text>
                  </View>
                )
              )}
            </View>
          )}

        {/* Omi Device Integration Section */}
        <View style={styles.omiSection}>
          <View style={styles.omiHeader}>
            <Text style={styles.sectionTitle}>Omi Device</Text>
            <TouchableOpacity
              style={styles.omiToggleButton}
              onPress={() => setShowOmiPairing(!showOmiPairing)}
            >
              <Ionicons 
                name={showOmiPairing ? 'chevron-up' : 'headset'} 
                size={18} 
                color={colors.primary.main} 
              />
            </TouchableOpacity>
          </View>

          {!omiDeviceConnected && showOmiPairing && (
            <OmiDevicePairing
              onDeviceConnected={handleOmiDeviceConnected}
              onDeviceDisconnected={handleOmiDeviceDisconnected}
              style={styles.omiPairing}
            />
          )}

          {omiDeviceConnected && (
            <OmiStreamingStatus
              onStartStreaming={() => setOmiDeviceStreaming(true)}
              onStopStreaming={() => setOmiDeviceStreaming(false)}
              style={styles.omiStreaming}
            />
          )}

          {/* Show realtime transcript from Omi */}
          {omiDeviceStreaming && omiRealtimeTranscript && (
            <View style={styles.omiRealtimeSection}>
              <View style={styles.omiRealtimeHeader}>
                <Ionicons name="mic" size={16} color={colors.primary.main} />
                <Text style={styles.omiRealtimeTitle}>Omi Live Transcription</Text>
                <ActivityIndicator size="small" color={colors.primary.main} />
              </View>
              <Text style={styles.omiRealtimeText}>{omiRealtimeTranscript}</Text>
            </View>
          )}
        </View>

        <View style={styles.transcriptsSection}>
          <View style={styles.transcriptsHeader}>
            <Text style={styles.sectionTitle}>Recent Transcripts</Text>
            <View style={styles.headerControls}>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={loadTranscriptsFromBackend}
              >
                <Ionicons name="refresh" size={18} color={colors.primary.main} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <View style={styles.searchInputWrapper}>
              <Ionicons name="search" size={18} color={colors.text.secondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search transcripts..."
                placeholderTextColor={colors.text.disabled}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.text.secondary} />
                </TouchableOpacity>
              )}
            </View>
            {searchQuery && filteredTranscripts.length > 0 && (
              <Text style={styles.searchResults}>
                Found {filteredTranscripts.length} result{filteredTranscripts.length !== 1 ? 's' : ''}
              </Text>
            )}
          </View>

          {/* Webhook Transcription Monitor */}
         


          <ScrollView 
            ref={scrollViewRef}
            style={styles.transcriptsList}
            showsVerticalScrollIndicator={false}
          >
            {filteredTranscripts.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons 
                  name={searchQuery ? "search-outline" : "mic-off-outline"} 
                  size={40} 
                  color={colors.text.secondary} 
                />
                <Text style={styles.emptyText}>
                  {searchQuery ? 'No matching transcripts' : 'No recordings yet'}
                </Text>
                <Text style={styles.emptySubtext}>
                  {searchQuery ? 'Try different search terms' : 'Tap the mic to start recording'}
                </Text>
              </View>
            ) : (
              filteredTranscripts.map((transcript) => (
                <TouchableOpacity 
                  key={transcript.id} 
                  style={[
                    styles.transcriptCard,
                    highlightedId === transcript.id && styles.highlightedCard
                  ]}
                  onPress={() => {
                    const transcriptionData = {
                      id: transcript.id,
                      text: transcript.text,
                      timestamp: transcript.timestamp.toISOString(),
                      recordingId: transcript.recordingId,
                      aiTitle: transcript.aiTitle || `Transcription ${transcript.recordingId}`,
                      aiSummary: transcript.aiSummary || '',
                      topic: transcript.topic || '',
                    };
                    navigation.navigate('TranscriptionDetail', { transcription: transcriptionData });
                  }}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={
                      highlightedId === transcript.id 
                        ? [`${colors.primary.main}20`, `${colors.secondary.main}15`]
                        : [`${colors.primary.main}10`, `${colors.secondary.main}05`]
                    }
                    style={styles.cardGradient}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.cardHeaderLeft}>
                        <View style={styles.titleContainer}>
                          <Text style={styles.transcriptTitle}>
                            {transcript.aiTitle || transcript.title || 'Untitled Recording'}
                          </Text>
                          <Text style={styles.transcriptTime}>
                            {transcript.timestamp.toLocaleString()}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.actionsContainer}>
                        {/* Primary Chat Action */}
                        <TouchableOpacity
                          style={styles.primaryChatButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            const transcriptionData = {
                              id: transcript.id,
                              text: transcript.text,
                              timestamp: transcript.timestamp.toISOString(),
                              recordingId: transcript.recordingId,
                              aiTitle: transcript.aiTitle || `Transcription ${transcript.recordingId}`,
                              aiSummary: transcript.aiSummary || '',
                              topic: transcript.topic || '',
                            };
                            navigation.navigate('TranscriptionDetail', { 
                              transcription: transcriptionData,
                              openChat: true
                            });
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <LinearGradient
                            colors={[colors.primary.main, colors.secondary.main]}
                            style={styles.primaryChatGradient}
                          >
                            <Ionicons name="chatbubbles" size={20} color="#fff" />
                            <Text style={styles.primaryChatText}>Chat</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                        
                        {/* Secondary Actions */}
                        <View style={styles.secondaryActions}>
                          <TouchableOpacity
                            style={styles.secondaryActionButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              copyReport(transcript);
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="copy-outline" size={14} color={colors.text.secondary} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.secondaryActionButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              deleteTranscript(transcript);
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="trash-outline" size={14} color={colors.accent.error} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                    {/* Show AI title + summary collapsed; full report when expanded */}
                    {transcript.isExpanded ? (
                      <View>
                        <Text style={styles.reportTitleInline}>📄 TaiNecklace Transcription Report</Text>
                        <Text style={styles.reportMeta}>📅 Date: {transcript.timestamp.toLocaleDateString()}</Text>
                        <Text style={styles.reportMeta}>🕐 Time: {transcript.timestamp.toLocaleTimeString()}</Text>
                        <Text style={styles.reportMeta}>⏱️ Duration: {formatDuration(transcript.durationSeconds ?? transcript.duration_seconds)}</Text>
                        <Text style={styles.reportSection}>🤖 AI Summary:</Text>
                        <Text style={styles.reportBody}>{transcript.aiSummary || '—'}</Text>
                        <Text style={styles.reportSection}>📝 Full Transcription:</Text>
                        <Text style={styles.reportBody}>{(transcript.text && transcript.text.trim().length > 0) ? transcript.text : '[No speech detected]'}</Text>
                        <Text style={styles.reportFooter}>—{"\n"}Generated by TaiNecklace App{"\n"}AI-powered voice companion</Text>
                      </View>
                    ) : (
                      <View>
                        <Text style={styles.aiSummary} numberOfLines={2}>
                          {transcript.aiSummary || 'Summary unavailable'}
                        </Text>
                      </View>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </LinearGradient>

      {/* Upload Options Dropdown - positioned at screen level */}
      {showUploadOptions && (
        <View style={styles.screenDropdownContainer}>
          <TouchableOpacity
            style={styles.dropdownOption}
            onPress={handleUploadText}
            disabled={isUploading}
          >
            <Ionicons name="document-text" size={12} color={colors.primary.main} />
            <Text style={styles.dropdownOptionText}>Text File</Text>
            {isUploading && <ActivityIndicator size="small" color={colors.primary.main} />}
          </TouchableOpacity>

          <View style={styles.dropdownSeparator} />

          <TouchableOpacity
            style={styles.dropdownOption}
            onPress={handleUploadAudio}
            disabled={isUploadingAudio}
          >
            <Ionicons name="musical-notes" size={12} color={colors.primary.main} />
            <Text style={styles.dropdownOptionText}>Audio File</Text>
            {isUploadingAudio && <ActivityIndicator size="small" color={colors.primary.main} />}
          </TouchableOpacity>
        </View>
      )}

      {/* Modal removed; full report shown inline on expand */}
    </SafeAreaView>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  gradient: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    ...typography.h1,
    color: colors.text.primary,
  },
  statusBadges: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    ...shadows.button,
    shadowColor: colors.accent.error,
  },
  hardwareRecordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary.main,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    ...shadows.button,
    shadowColor: colors.primary.main,
  },
  monitoringBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.text.secondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    opacity: 0.7,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: spacing.xs,
  },
  recordingTime: {
    ...typography.micro,
    color: '#fff',
    textTransform: 'none',
  },
  recordingLabel: {
    ...typography.micro,
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
    marginLeft: spacing.xs,
    opacity: 0.8,
  },
  monitoringText: {
    ...typography.micro,
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
    marginLeft: spacing.xs,
  },
  backgroundIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.xs,
    gap: 2,
  },
  backgroundText: {
    ...typography.micro,
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
  },
  recordContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  recordButtonWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseCircle: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.accent.error,
  },
  recordButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: colors.primary.main,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  recordHint: {
    marginTop: spacing.xs,
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  actionSection: {
    flex: 1,
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.surface.border,
    position: 'relative',
    justifyContent: 'space-between',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.xs,
    height: 24, // Fixed height to ensure alignment
  },
  actionButton: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    ...shadows.inset,
  },
  actionButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    gap: 2,
    minHeight: 28,
  },
  actionButtonText: {
    ...typography.caption,
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  statusText: {
    ...typography.caption,
    color: colors.text.secondary,
    fontSize: 9,
    textAlign: 'center',
    marginTop: 2,
    fontStyle: 'italic',
  },
  dropdownContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 2,
    backgroundColor: colors.background.primary,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.surface.border,
    ...shadows.card,
    zIndex: 9999,
    elevation: 10,
  },
  screenDropdownContainer: {
    position: 'absolute',
    top: 220, // Positioned below the mini circular upload button
    right: 80, // Aligned with the upload button position
    width: 100,
    backgroundColor: colors.background.primary,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.surface.border,
    ...shadows.card,
    zIndex: 10000,
    elevation: 15,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  dropdownOptionText: {
    ...typography.caption,
    color: colors.text.primary,
    fontSize: 11,
    flex: 1,
  },
  dropdownSeparator: {
    height: 1,
    backgroundColor: colors.surface.border,
  },
  transcriptsSection: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  transcriptsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  autoScanToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    backgroundColor: `${colors.background.elevated}80`,
    borderRadius: borderRadius.sm,
  },
  autoScanIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  autoScanSpinner: {
    marginLeft: 2,
  },
  switch: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
  },
  autoScanStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: `${colors.background.elevated}60`,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },
  autoScanStatusText: {
    ...typography.caption,
    color: colors.text.secondary,
    fontSize: 12,
    fontStyle: 'italic',
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  deviceUploadTitle: {
    ...typography.caption,
    color: colors.text.primary,
    fontSize: 9,
    fontWeight: '600',
    flex: 1,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  refreshButton: {
    padding: 8,
    backgroundColor: `${colors.primary.main}20`,
    borderRadius: borderRadius.md,
  },
  searchContainer: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.primary.light}15`,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'General Sans',
    color: colors.text.primary,
  },
  searchResults: {
    fontSize: 12,
    fontFamily: 'General Sans',
    color: colors.text.secondary,
    marginTop: spacing.xs,
    marginLeft: spacing.sm,
  },
  realtimeSection: {
    backgroundColor: `${colors.primary.main}08`,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: `${colors.primary.main}20`,
    marginHorizontal: spacing.lg,
  },
  realtimeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  realtimeSectionTitle: {
    ...typography.h3,
    color: colors.primary.main,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary.main,
    letterSpacing: 0.5,
  },
  transcriptContainer: {
    maxHeight: 300,
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  transcriptSegment: {
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: `${colors.text.secondary}20`,
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  transcriptTime: {
    fontSize: 10,
    color: colors.text.secondary,
    fontWeight: '500',
  },
  transcriptSpeaker: {
    fontSize: 10,
    color: colors.primary.main,
    fontWeight: '600',
    backgroundColor: `${colors.primary.main}15`,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.xs,
  },
  transcriptConfidence: {
    fontSize: 10,
    color: colors.text.accent,
    fontWeight: '500',
  },
  transcriptText: {
    fontSize: 14,
    color: colors.text.primary,
    lineHeight: 20,
    fontFamily: 'General Sans',
  },
  emptyTranscriptState: {
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTranscriptText: {
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  emptyTranscriptSubtext: {
    fontSize: 12,
    color: colors.text.secondary,
    textAlign: 'center',
    opacity: 0.7,
  },
  realtimeTranscripts: {
    gap: spacing.sm,
  },
  webhookTestSection: {
    backgroundColor: `${colors.accent.warning}08`,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: `${colors.accent.warning}30`,
  },
  webhookTestTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent.warning,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  webhookTestButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  webhookTestButton: {
    flex: 1,
    backgroundColor: `${colors.accent.warning}15`,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: `${colors.accent.warning}30`,
  },
  webhookTestButtonText: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.accent.warning,
    textAlign: 'center',
  },
  realtimeSegment: {
    backgroundColor: colors.background.card,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary.main,
  },
  realtimeText: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  realtimeTimestamp: {
    ...typography.caption,
    color: colors.text.secondary,
    fontSize: 10,
  },
  realtimeMore: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  transcriptsList: {
    flex: 1,
  },
  transcriptCard: {
    marginBottom: spacing.lg,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    ...shadows.card,
  },
  highlightedCard: {
    transform: [{ scale: 1.02 }],
    ...shadows.button,
  },
  cardGradient: {
    padding: 8,
    borderWidth: 1,
    borderColor: colors.surface.border,
    borderRadius: borderRadius.xl,
    backgroundColor: `${colors.primary.light}10`,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  deleteButton: {
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: `${colors.accent.error}10`,
  },
  iconButton: {
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: `${colors.primary.main}10`,
  },
  titleContainer: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  transcriptTitle: {
    ...typography.h3,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  transcriptSummary: {
    ...typography.bodySecondary,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  aiTitle: {
    ...typography.h3,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  aiSummary: {
    ...typography.bodySecondary,
    color: colors.text.secondary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: 'General Sans',
    color: colors.text.secondary,
    marginTop: spacing.md,
  },
  emptySubtext: {
    ...typography.body,
    color: colors.text.disabled,
    marginTop: spacing.xs,
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    width: '100%',
    maxWidth: 600,
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  reportTitle: {
    fontSize: 18,
    fontWeight: '500',
    marginBottom: spacing.sm,
    color: colors.text.primary,
  },
  reportMeta: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: 2,
  },
  reportSection: {
    marginTop: spacing.md,
    fontWeight: '500',
    color: colors.text.primary,
  },
  reportBody: {
    ...typography.body,
    color: colors.text.primary,
    marginTop: 4,
  },
  reportFooter: {
    ...typography.caption,
    color: colors.text.disabled,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  closeButton: {
    marginTop: spacing.md,
    alignSelf: 'center',
    backgroundColor: colors.primary.main,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
  },
  closeButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  reportTitleInline: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: spacing.xs,
    color: colors.text.primary,
  },

  // New Action Container Styles
  actionsContainer: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  primaryChatButton: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadows.button,
  },
  primaryChatGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    minWidth: 80,
  },
  primaryChatText: {
    ...typography.button,
    color: '#fff',
    fontSize: 13,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  secondaryActionButton: {
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: `${colors.text.secondary}10`,
  },

  // Mini Circular Button Styles
  miniCircularButton: {
    borderRadius: 16, // Perfect circle for 32x32
    overflow: 'hidden',
    ...shadows.button,
    width: 32,
    height: 32,
  },
  miniButtonGradient: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },

  // Omi Device Styles
  omiSection: {
    backgroundColor: `${colors.secondary.main}08`,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: `${colors.secondary.main}20`,
  },
  omiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  omiToggleButton: {
    padding: spacing.xs,
    backgroundColor: `${colors.primary.main}15`,
    borderRadius: borderRadius.sm,
  },
  omiPairing: {
    marginTop: spacing.sm,
  },
  omiStreaming: {
    marginTop: spacing.sm,
  },
  omiRealtimeSection: {
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.secondary.main,
  },
  omiRealtimeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  omiRealtimeTitle: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  omiRealtimeText: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
    backgroundColor: `${colors.secondary.main}08`,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },

}); // End of createStyles function