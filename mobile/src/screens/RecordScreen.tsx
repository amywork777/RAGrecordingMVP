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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import BLEService from '../services/BLEService';
import APIService from '../services/APIService';
import AudioRecordingService from '../services/AudioRecordingService';
import DeepLinkService from '../services/DeepLinkService';
import uuid from 'react-native-uuid';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { colors, spacing, borderRadius, typography } from '../theme/colors';

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
}

export default function RecordScreen({ route }: any) {
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
        const backendTranscripts: Transcript[] = recentTranscripts.map((t: any) => {
          const fallbackTitle = (t.title && t.title.trim().length > 0)
            ? t.title
            : (t.text ? (t.text.split('\n')[0] || t.text).slice(0, 50) : 'Untitled');
          const fallbackSummary = (t.summary && t.summary.trim().length > 0)
            ? t.summary
            : (t.text ? (t.text.slice(0, 160) + (t.text.length > 160 ? '…' : '')) : '');
          return {
            id: t.id,
            text: t.text,
            title: t.title,
            summary: t.summary,
            timestamp: new Date(t.timestamp),
            path: t.path,
            aiTitle: t.aiTitle || fallbackTitle,
            aiSummary: t.aiSummary || fallbackSummary,
            // @ts-ignore
            durationSeconds: t.durationSeconds ?? t.duration_seconds ?? null,
          } as any;
        });

        // Merge with existing local transcripts that might not be in backend yet
        const localTranscripts = transcripts.filter(localT => {
          // Keep local transcripts that aren't found in backend (by recording ID)
          const foundInBackend = backendTranscripts.some(backendT => backendT.id === localT.id);
          if (!foundInBackend) {
            console.log(`Preserving local transcript not yet in backend: ${localT.id}`);
          }
          return !foundInBackend;
        });
        
        // Combine and sort by timestamp (newest first)
        const mergedTranscripts = [...localTranscripts, ...backendTranscripts]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        
        console.log(`Merging transcripts: ${localTranscripts.length} local + ${backendTranscripts.length} backend = ${mergedTranscripts.length} total`);
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
            console.log('Sending to API...');
            try {
              const response = await APIService.sendAudioBase64(base64Audio, currentRecordingId, 'm4a');
              console.log('API Response:', response);
              
              if (response.transcription) {
                console.log('Transcription received:', response.transcription);
                
                // Immediately add the new transcript to the UI
                const newTranscript = {
                  id: currentRecordingId,
                  text: response.transcription,
                  title: response.title,
                  summary: response.summary,
                  timestamp: new Date(response.timestamp),
                  aiTitle: response.title,
                  aiSummary: response.summary,
                };
                
                console.log('Adding transcript to UI:', newTranscript);
                setTranscripts(prev => [newTranscript as any, ...prev]);
                
                // Refresh from backend after a longer delay to allow ZeroEntropy indexing
                setTimeout(() => {
                  console.log('Refreshing transcripts from backend after recording...');
                  loadTranscriptsFromBackend();
                }, 10000); // Increased delay to 10 seconds to ensure ZeroEntropy indexing completes
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
                  size={32} 
                  color="#fff" 
                />
              )}
            </LinearGradient>
          </TouchableOpacity>
          
          <Text style={styles.recordHint}>
            {isRecording ? 'Tap to stop' : 'Tap to record'}
          </Text>

          {/* Upload Buttons Container */}
          <View style={styles.uploadButtonsContainer}>
            {/* Upload Text Button */}
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={handleUploadText}
              disabled={isUploading}
            >
              <LinearGradient
                colors={[colors.secondary.dark, colors.secondary.main]}
                style={styles.uploadGradient}
              >
                {isUploading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="document-text" size={18} color="#fff" />
                    <Text style={styles.uploadText}>Text File</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Upload WAV Button */}
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={handleUploadAudio}
              disabled={isUploadingAudio}
            >
              <LinearGradient
                colors={[colors.primary.dark, colors.primary.main]}
                style={styles.uploadGradient}
              >
                {isUploadingAudio ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="musical-notes" size={18} color="#fff" />
                    <Text style={styles.uploadText}>Audio File</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.transcriptsSection}>
          <View style={styles.transcriptsHeader}>
            <Text style={styles.sectionTitle}>Recent Transcripts</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={loadTranscriptsFromBackend}
            >
              <Ionicons name="refresh" size={18} color={colors.primary.main} />
            </TouchableOpacity>
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
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <TouchableOpacity
                          style={styles.iconButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            toggleExpand(transcript.id);
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons 
                            name={transcript.isExpanded ? "eye-off-outline" : "eye-outline"} 
                            size={16} 
                            color={colors.text.secondary} 
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.iconButton}
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
                            navigation.navigate('TranscriptionDetail', { transcription: transcriptionData });
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons name="chatbubbles-outline" size={16} color={colors.secondary.main} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.iconButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            copyReport(transcript);
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons name="copy-outline" size={16} color={colors.primary.main} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.deleteButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            deleteTranscript(transcript);
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.accent.error} />
                        </TouchableOpacity>
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

      {/* Modal removed; full report shown inline on expand */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  gradient: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text.primary,
  },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent.error,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  recordingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
    marginRight: spacing.xs,
  },
  recordingTime: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  recordContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  recordButtonWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseCircle: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.accent.error,
  },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: colors.primary.main,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  recordHint: {
    marginTop: spacing.md,
    ...typography.body,
    color: colors.text.secondary,
    fontSize: 14,
  },
  uploadButtonsContainer: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    gap: spacing.md,
    justifyContent: 'center',
  },
  uploadButton: {
    flex: 1,
    maxWidth: 140,
  },
  uploadGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: borderRadius.xl,
    gap: spacing.xs,
  },
  uploadText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
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
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text.primary,
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
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text.primary,
  },
  searchResults: {
    fontSize: 12,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    marginLeft: spacing.sm,
  },
  transcriptsList: {
    flex: 1,
  },
  transcriptCard: {
    marginBottom: spacing.sm,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  highlightedCard: {
    transform: [{ scale: 1.02 }],
  },
  cardGradient: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surface.border,
    borderRadius: borderRadius.lg,
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
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 2,
  },
  transcriptSummary: {
    fontSize: 14,
    color: colors.text.secondary,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  transcriptText: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
  },
  aiTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 4,
  },
  aiSummary: {
    ...typography.body,
    color: colors.text.secondary,
    fontSize: 14,
  },
  transcriptTime: {
    ...typography.caption,
    color: colors.text.secondary,
    fontSize: 12,
    marginLeft: spacing.xs,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
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
    fontWeight: '700',
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
    fontWeight: '700',
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
    fontWeight: '700',
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
    fontWeight: '700',
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
});