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
import BLEService from '../services/BLEService';
import BLEFileTransferService from '../services/BLEFileTransferService';
import APIService from '../services/APIService';
import AudioRecordingService from '../services/AudioRecordingService';
import DeepLinkService from '../services/DeepLinkService';
import uuid from 'react-native-uuid';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import SecureStorageService from '../services/SecureStorageService';
import { Buffer } from 'buffer';
import { useTheme, spacing, borderRadius, typography, shadows } from '../theme/colors';

const { width } = Dimensions.get('window');

// Auto-scan configuration
const AUTO_SCAN_STORAGE_KEY = 'auto_scan_enabled';
const AUTO_SCAN_INTERVAL_MS = 30000; // 30 seconds
const AUTO_SCAN_TIMEOUT_MS = 8000; // 8 seconds scan duration

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
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
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
  
  // BLE device states
  const [availableDevices, setAvailableDevices] = useState<any[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<any | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [showUploadOptions, setShowUploadOptions] = useState(false);
  
  // Auto-scanning states - always enabled
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [lastAutoScanTime, setLastAutoScanTime] = useState<Date | null>(null);
  const [autoScanInterval, setAutoScanInterval] = useState<NodeJS.Timeout | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);

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
        console.log('App backgrounded while recording - maintaining recording session');
        // Recording should continue in background with audio mode configured
      } else if (nextAppState === 'active' && isRecording) {
        console.log('App foregrounded while recording - recording session active');
        // Verify recording is still active when returning to foreground
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription?.remove();
    };
  }, [isRecording]);

  useEffect(() => {
    BLEService.on('deviceConnected', handleDeviceConnected);
    BLEService.on('deviceDisconnected', handleDeviceDisconnected);
    BLEService.on('audioChunk', handleAudioChunk);

    loadTranscriptsFromBackend();

    return () => {
      BLEService.removeAllListeners();
      if (intervalId) clearInterval(intervalId);
    };
  }, [currentRecordingId]);

  // Load auto-scan preference from storage
  useEffect(() => {
    loadAutoScanPreference();
  }, []);

  // Handle app state changes for smart scanning
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      console.log('App state changed:', appState, '->', nextAppState);
      setAppState(nextAppState);
      
      // Log background transition for debugging
      if (nextAppState.match(/inactive|background/)) {
        console.log('App backgrounded - relying on iOS background modes for BLE scanning');
      } else if (nextAppState === 'active') {
        console.log('App foregrounded - full scanning capabilities restored');
      }
      
      // Always keep auto-scanning running in all states if enabled
      if (autoScanEnabled && !autoScanInterval) {
        console.log('Auto-scan enabled, maintaining continuous scanning');
        startAutoScan();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [autoScanEnabled, appState, autoScanInterval]);

  // Manage auto-scan interval - runs in all app states
  useEffect(() => {
    if (autoScanEnabled && !isScanning && !isSyncing) {
      console.log('Starting continuous auto-scan (all app states)');
      startAutoScan();
    } else if (!autoScanEnabled) {
      console.log('Stopping auto-scan (disabled by user)');
      stopAutoScan();
    }

    return () => {
      if (autoScanInterval) {
        clearInterval(autoScanInterval);
      }
    };
  }, [autoScanEnabled, isScanning, isSyncing]);

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
        
        console.log(`Merging transcripts: ${localOnlyTranscripts.length} local-only + ${backendTranscripts.length} backend = ${mergedTranscripts.length} total`);
        setTranscripts(mergedTranscripts);
        setFilteredTranscripts(mergedTranscripts);
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

  const handleDeviceConnected = () => {
    setIsConnected(true);
    Alert.alert('Connected', 'Successfully connected to AI Wearable');
  };

  const handleDeviceDisconnected = () => {
    setIsConnected(false);
    setIsRecording(false);
    Alert.alert('Disconnected', 'Disconnected from AI Wearable');
  };

  const handleAudioChunk = async (audioData: ArrayBuffer) => {
    if (!currentRecordingId) return;

    try {
      const response = await APIService.sendAudioBase64(audioData.toString(), currentRecordingId);
      
      if (response.transcription) {
        const newTranscript: Transcript = {
          id: uuid.v4() as string,
          text: response.transcription,
          title: response.title,
          summary: response.summary,
          timestamp: new Date(response.timestamp),
        };
        
        setTranscripts(prev => [newTranscript, ...prev]);
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  };

  const toggleRecording = async () => {
    console.log('toggleRecording called, current isRecording:', isRecording);
    
    if (isRecording) {
      console.log('Stopping recording...');
      try {
        setIsLoading(true);
        
        const audioUri = await AudioRecordingService.stopRecording();
        console.log('Audio stopped, URI:', audioUri);
        
        if (audioUri) {
          const base64Audio = await AudioRecordingService.getRecordingBase64();
          console.log('Base64 audio length:', base64Audio?.length);
          console.log('Audio URI:', audioUri);
          
          if (base64Audio) {
            // Save recording to organized storage
            const now = new Date();
            const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const recordingsDir = `${FileSystem.documentDirectory}recordings/`;
            const monthDir = `${recordingsDir}${yearMonth}/`;
            
            // Ensure directories exist
            const recordingsDirInfo = await FileSystem.getInfoAsync(recordingsDir);
            if (!recordingsDirInfo.exists) {
              await FileSystem.makeDirectoryAsync(recordingsDir, { intermediates: true });
            }
            
            const monthDirInfo = await FileSystem.getInfoAsync(monthDir);
            if (!monthDirInfo.exists) {
              await FileSystem.makeDirectoryAsync(monthDir, { intermediates: true });
            }
            
            // Save m4a file locally
            const timestamp = now.toISOString().replace(/[:.]/g, '-');
            const fileName = `recording_${timestamp}.m4a`;
            const localAudioPath = `${monthDir}${currentRecordingId}_${fileName}`;
            
            await FileSystem.writeAsStringAsync(
              localAudioPath,
              base64Audio,
              { encoding: FileSystem.EncodingType.Base64 }
            );
            
            console.log(`Audio saved locally to: ${localAudioPath}`);
            console.log('Sending to API...');
            
            try {
              const response = await APIService.sendAudioBase64(base64Audio, currentRecordingId, 'm4a');
              console.log('API Response:', response);
              
              if (response.transcription) {
                console.log('Transcription received:', response.transcription);
                
                // Immediately add the new transcript to the UI with local audio path
                const newTranscript = {
                  id: currentRecordingId,
                  text: response.transcription,
                  title: response.title,
                  summary: response.summary,
                  timestamp: new Date(response.timestamp),
                  aiTitle: response.title,
                  aiSummary: response.summary,
                  localAudioPath: localAudioPath, // Store local audio path
                  remoteAudioUrl: response.audioUrl, // Store remote URL if provided
                  source: 'recording' as const, // Mark as recording source
                };
                
                console.log('Adding transcript to UI:', newTranscript);
                setTranscripts(prev => [newTranscript as any, ...prev]);
                
                // Refresh from backend after a shorter delay
                setTimeout(() => {
                  console.log('Refreshing transcripts from backend after recording...');
                  loadTranscriptsFromBackend();
                }, 3000); // Reduced delay to 3 seconds
              } else {
                console.log('No transcription in response');
              }
            } catch (apiError) {
              console.error('API call failed:', apiError);
              Alert.alert('Transcription Error', 'Failed to transcribe audio. Check backend connection.');
            }
          } else {
            console.log('No base64 audio data available');
          }
        } else {
          console.log('No audio URI from recording');
        }
      } catch (error) {
        console.error('Failed to stop recording:', error);
        Alert.alert('Error', 'Failed to process recording');
      } finally {
        setIsLoading(false);
        setIsRecording(false);
        setCurrentRecordingId('');
        console.log('Recording stopped, isRecording set to false');
      }
    } else {
      console.log('Starting recording...');
      try {
        const recordingId = uuid.v4() as string;
        setCurrentRecordingId(recordingId);
        console.log('Generated recording ID:', recordingId);
        
        console.log('Calling AudioRecordingService.startRecording()...');
        await AudioRecordingService.startRecording();
        setIsRecording(true);
        console.log('Audio recording started successfully, isRecording set to true');
      } catch (error) {
        console.error('Failed to start recording:', error);
        Alert.alert('Recording Error', 'Failed to start recording. Please check microphone permissions.');
        setIsRecording(false);
        console.log('Recording failed, isRecording set to false');
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

  // BLE Functions
  const scanForDevices = async () => {
    try {
      setIsScanning(true);
      console.log('Starting scan for XIAO-REC devices...');
      
      const devices = await BLEFileTransferService.scanForDevices(10000);
      setAvailableDevices(devices);
      
      if (devices.length === 0) {
        Alert.alert('No devices found', 'Make sure your XIAO device finished recording and is advertising (switch is in LOW position)');
      } else if (devices.length === 1) {
        // Auto-select if only one device
        setSelectedDevice(devices[0]);
        console.log(`Auto-selected device: ${devices[0].name}`);
      }
      
      console.log(`Found ${devices.length} XIAO-REC devices`);
    } catch (error) {
      console.error('Device scan failed:', error);
      Alert.alert('Scan Failed', 'Failed to scan for devices. Make sure Bluetooth is enabled.');
    } finally {
      setIsScanning(false);
    }
  };

  const autoSyncFromDevice = async () => {
    try {
      setIsScanning(true);
      setIsSyncing(false);
      setSyncProgress(0);
      console.log('Auto-sync: Starting scan for XIAO devices...');
      
      // Scan for devices
      const devices = await BLEFileTransferService.scanForDevices(10000); // 10 second scan
      setAvailableDevices(devices);
      
      if (devices.length === 0) {
        Alert.alert(
          'No XIAO Device Found', 
          'Make sure your XIAO device finished recording and switch is in LOW position to start advertising.'
        );
        return;
      }
      
      // Auto-select first XIAO device found
      const xiaoDevice = devices[0];
      setSelectedDevice(xiaoDevice);
      console.log(`Auto-sync: Found ${devices.length} devices, connecting to: ${xiaoDevice.name} (${xiaoDevice.id})`);
      
      // Immediately start syncing
      setIsScanning(false);
      setIsSyncing(true);
      
      await performSync(xiaoDevice);
      
    } catch (error) {
      console.error('Auto-sync failed:', error);
      Alert.alert('Auto-Sync Failed', `Failed to sync: ${error.message}`);
    } finally {
      setIsScanning(false);
      setIsSyncing(false);
      setSyncProgress(0);
    }
  };

  const performSync = async (device: any) => {
    console.log(`Syncing from device: ${device.name} (${device.id})`);
    
    // Connect to device
    const connected = await BLEFileTransferService.connect(device);
    if (!connected) {
      Alert.alert('Connection Failed', 'Could not connect to device. Make sure it is in range and advertising.');
      return;
    }
    
    console.log('Connected to device, reading file info...');
    
    try {
      // Download and process audio file (handles ADPCM/WAV automatically)
      const result = await BLEFileTransferService.downloadAndProcessAudioFile((percent) => {
        setSyncProgress(percent);
      });
      
      if (!result) {
        Alert.alert('Download Failed', 'Could not download or process audio file from device.');
        return;
      }
      
      const { audioData, format, fileInfo, audioInfo } = result;
      
      console.log(`🎵 Downloaded and processed ${fileInfo.name}:`);
      console.log(`   - Format: ${format}`);
      console.log(`   - Original size: ${audioInfo.originalSize} bytes`);
      console.log(`   - Processed size: ${audioInfo.processedSize} bytes`);
      console.log(`   - Duration: ${audioInfo.duration.toFixed(1)}s`);
      if (format === 'ADPCM') {
        console.log(`   - Compression ratio: ${(audioInfo.originalSize / audioInfo.processedSize * 100).toFixed(1)}%`);
      }
      
      // Validate processed audio file size
      if (audioData.length < 1000) {
        Alert.alert('Transfer Incomplete', `Audio file too small: ${audioData.length} bytes. Expected at least 10KB for audio recording.`);
        console.warn(`Audio transfer may be incomplete: ${audioData.length} bytes`);
      } else {
        console.log(`Audio file size looks good: ${(audioData.length / 1024).toFixed(1)} KB`);
      }
      
      // Create organized storage structure
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const recordingsDir = `${FileSystem.documentDirectory}recordings/`;
      const monthDir = `${recordingsDir}${yearMonth}/`;
      
      // Ensure directories exist
      const recordingsDirInfo = await FileSystem.getInfoAsync(recordingsDir);
      if (!recordingsDirInfo.exists) {
        await FileSystem.makeDirectoryAsync(recordingsDir, { intermediates: true });
      }
      
      const monthDirInfo = await FileSystem.getInfoAsync(monthDir);
      if (!monthDirInfo.exists) {
        await FileSystem.makeDirectoryAsync(monthDir, { intermediates: true });
      }
      
      // Generate unique filename
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      const recordingId = uuid.v4() as string;
      const fileName = fileInfo.name || `XIAO_${timestamp}.wav`;
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const wavPath = `${monthDir}${recordingId}_${sanitizedFileName}`;
      
      // Save processed audio file to organized location
      await FileSystem.writeAsStringAsync(
        wavPath,
        Buffer.from(audioData).toString('base64'),
        { encoding: FileSystem.EncodingType.Base64 }
      );
      
      console.log(`Audio file saved to: ${wavPath}`);
      
      // Process through transcription pipeline
      const formData = new FormData();
      formData.append('audio', {
        uri: wavPath,
        name: sanitizedFileName,
        type: 'audio/wav'
      } as any);
      formData.append('recordingId', recordingId);
      
      console.log('Starting transcription...');
      const transcriptionResult = await APIService.transcribeAudio(formData);
      
      // Add to transcripts list with local audio path
      const newTranscript: Transcript = {
        id: recordingId,
        text: transcriptionResult.text || '[No speech detected]',
        timestamp: new Date(),
        title: transcriptionResult.aiTitle,
        summary: transcriptionResult.aiSummary,
        aiTitle: transcriptionResult.aiTitle,
        aiSummary: transcriptionResult.aiSummary,
        durationSeconds: transcriptionResult.durationSeconds,
        path: transcriptionResult.path,
        localAudioPath: wavPath, // Store local WAV path
        remoteAudioUrl: transcriptionResult.audioUrl, // Store remote URL if provided
        source: 'ble', // Mark as BLE source
      };
      
      setTranscripts(prev => [newTranscript, ...prev]);
      
      // Also update filtered transcripts if search is active
      if (searchQuery) {
        setFilteredTranscripts(prev => [newTranscript, ...prev]);
      }
      
      Alert.alert('Success', `File synced and transcribed successfully!\n\n${sanitizedFileName}\n${format} format, ${audioData.length} bytes`);
      
      // Clear selection after successful sync
      setSelectedDevice(null);
      setAvailableDevices([]);
      
      // Refresh from backend after a short delay to get complete metadata
      setTimeout(() => {
        console.log('Refreshing transcripts from backend after BLE sync...');
        loadTranscriptsFromBackend();
      }, 3000);
      
    } catch (error) {
      console.error('Sync failed:', error);
      Alert.alert('Sync Failed', `Failed to sync from device: ${error.message}`);
    } finally {
      setIsSyncing(false);
      setSyncProgress(0);
      // Always disconnect when done
      try {
        await BLEFileTransferService.disconnect();
      } catch (e) {
        console.error('Disconnect error:', e);
      }
    }
  };

  // Auto-scan functions
  const loadAutoScanPreference = async () => {
    try {
      const storedValue = await SecureStorageService.getItemAsync(AUTO_SCAN_STORAGE_KEY);
      if (storedValue !== null) {
        const enabled = JSON.parse(storedValue);
        setAutoScanEnabled(enabled);
        console.log('Loaded auto-scan preference:', enabled);
      }
    } catch (error) {
      console.error('Failed to load auto-scan preference:', error);
    }
  };

  const saveAutoScanPreference = async (enabled: boolean) => {
    try {
      await SecureStorageService.setItemAsync(AUTO_SCAN_STORAGE_KEY, JSON.stringify(enabled));
      console.log('Saved auto-scan preference:', enabled);
    } catch (error) {
      console.error('Failed to save auto-scan preference:', error);
    }
  };

  const toggleAutoScan = async (enabled: boolean) => {
    setAutoScanEnabled(enabled);
    await saveAutoScanPreference(enabled);
    
    if (enabled && appState === 'active') {
      console.log('Auto-scan enabled, starting...');
      startAutoScan();
    } else {
      console.log('Auto-scan disabled, stopping...');
      stopAutoScan();
    }
  };

  const startAutoScan = () => {
    if (autoScanInterval || isScanning || isSyncing) {
      console.log('Auto-scan already running or manual operations in progress');
      return;
    }

    console.log('Starting auto-scan with', AUTO_SCAN_INTERVAL_MS / 1000, 'second intervals');
    
    // Run initial scan immediately
    performAutoScan();
    
    // Set up recurring scans
    const interval = setInterval(() => {
      performAutoScan();
    }, AUTO_SCAN_INTERVAL_MS);
    
    setAutoScanInterval(interval);
  };

  const stopAutoScan = () => {
    if (autoScanInterval) {
      console.log('Stopping auto-scan interval');
      clearInterval(autoScanInterval);
      setAutoScanInterval(null);
    }
    setIsAutoScanning(false);
  };

  const performAutoScan = async () => {
    // Don't auto-scan if manual operations are in progress
    if (isScanning || isSyncing || isRecording) {
      return;
    }

    // Don't auto-scan if app is not in foreground
    if (appState !== 'active') {
      return;
    }

    try {
      setIsAutoScanning(true);
      setLastAutoScanTime(new Date());
      
      // Scan with shorter timeout for battery efficiency
      const devices = await BLEFileTransferService.scanForDevices(AUTO_SCAN_TIMEOUT_MS);
      
      if (devices.length > 0) {
        // Only log when XIAO devices are found
        console.log(`🎙️ XIAO Device Found: ${devices[0].name} - Starting automatic sync...`);
        
        // Auto-connect to first device found
        const xiaoDevice = devices[0];
        setSelectedDevice(xiaoDevice);
        setAvailableDevices(devices);
        
        // Stop auto-scanning and start sync
        stopAutoScan();
        setIsAutoScanning(false);
        
        // Auto-sync without showing popup
        performSyncFromAutoScan(xiaoDevice);
      }
    } catch (error) {
      console.error('Auto-scan failed:', error);
    } finally {
      setIsAutoScanning(false);
    }
  };

  const performSyncFromAutoScan = async (device: any) => {
    try {
      setIsSyncing(true);
      await performSync(device);
      
      // Clear device selection after sync
      setSelectedDevice(null);
      setAvailableDevices([]);
      
      // Resume auto-scanning after successful sync (with delay)
      if (autoScanEnabled && appState === 'active') {
        setTimeout(() => {
          console.log('Resuming auto-scan after successful sync');
          startAutoScan();
        }, 10000); // Wait 10 seconds before resuming
      }
    } catch (error) {
      console.error('Auto-sync failed:', error);
      Alert.alert('Auto-Sync Failed', `Failed to sync: ${error.message}`);
      
      // Resume auto-scanning after failed sync
      if (autoScanEnabled && appState === 'active') {
        setTimeout(() => {
          console.log('Resuming auto-scan after failed sync');
          startAutoScan();
        }, 5000); // Wait 5 seconds before resuming
      }
    } finally {
      setIsSyncing(false);
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
          {isRecording && (
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>{formatTime(recordingTime)}</Text>
            </View>
          )}
        </View>

        <View style={styles.recordContainer}>
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
          
          <Text style={styles.recordHint}>
            {isRecording ? 'Tap to stop' : 'Tap to record'}
          </Text>

          {/* Action Buttons Row */}
          <View style={styles.actionButtonsContainer}>
            {/* Bluetooth Section */}
            <View style={styles.actionSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="bluetooth" size={14} color={colors.primary.main} />
                <Text style={styles.deviceUploadTitle}>Device</Text>
                {/* Auto-scan always enabled - no toggle needed */}
                <Text style={styles.statusText}>Auto-scan enabled</Text>
              </View>
              
              <TouchableOpacity
                style={styles.actionButton}
                onPress={autoSyncFromDevice}
                disabled={isScanning || isSyncing}
              >
                <LinearGradient
                  colors={[colors.primary.main, colors.primary.dark]}
                  style={styles.actionButtonGradient}
                >
                  {isScanning || isSyncing ? (
                    <>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.actionButtonText}>
                        {isScanning ? 'Scanning' : `${syncProgress.toFixed(0)}%`}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="sync" size={12} color="#fff" />
                      <Text style={styles.actionButtonText}>Sync</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              {autoScanEnabled && (
                <Text style={styles.statusText}>
                  {isAutoScanning ? 'Auto-scanning...' : 'Auto enabled'}
                </Text>
              )}
            </View>

            {/* Upload Section */}
            <View style={styles.actionSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="cloud-upload" size={14} color={colors.primary.main} />
                <Text style={styles.deviceUploadTitle}>Upload</Text>
              </View>
              
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => setShowUploadOptions(!showUploadOptions)}
              >
                <LinearGradient
                  colors={[colors.primary.light, colors.primary.main]}
                  style={styles.actionButtonGradient}
                >
                  <Text style={styles.actionButtonText}>File Type</Text>
                  <Ionicons 
                    name={showUploadOptions ? "chevron-up" : "chevron-down"} 
                    size={10} 
                    color="#fff" 
                  />
                </LinearGradient>
              </TouchableOpacity>
            </View>

          </View>
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
  recordContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
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
    top: 320, // Positioned right below the File Type button
    left: '52%', // Positioned under the right side (upload section)  
    width: 100, // Same width as the File Type button
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
  transcriptText: {
    ...typography.bodySecondary,
    color: colors.text.primary,
    lineHeight: 22,
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
  transcriptTime: {
    ...typography.micro,
    color: colors.text.secondary,
    marginLeft: spacing.xs,
    textTransform: 'none',
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
    fontWeight: '450',
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
    fontWeight: '450',
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
    fontWeight: '450',
    marginBottom: spacing.xs,
    color: colors.text.primary,
  },
  reportMeta: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: 2,
  },
  reportSection: {
    marginTop: spacing.sm,
    fontWeight: '450',
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

}); // End of createStyles function