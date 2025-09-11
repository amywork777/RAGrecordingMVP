import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, typography } from '../theme/colors';
import OmiBluetoothService from '../services/OmiBluetoothService';
import OmiAudioStreamService from '../services/OmiAudioStreamService';

interface OmiStreamingStatusProps {
  onStartStreaming?: () => void;
  onStopStreaming?: () => void;
  style?: any;
}

export default function OmiStreamingStatus({ 
  onStartStreaming, 
  onStopStreaming, 
  style 
}: OmiStreamingStatusProps) {
  const colors = useTheme();
  const styles = createStyles(colors);
  
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState({
    isBuffering: false,
    bufferDuration: 0,
    totalBytes: 0,
    chunksCount: 0,
    currentTranscript: ''
  });
  const [realtimeTranscript, setRealtimeTranscript] = useState('');
  const [audioStats, setAudioStats] = useState({
    totalBytes: 0,
    duration: 0,
    codec: 'PCM16' as 'PCM16' | 'PCM8' | 'Opus'
  });

  useEffect(() => {
    setupEventListeners();
    
    // Check initial states
    setIsConnected(OmiBluetoothService.isDeviceConnected());
    setIsStreaming(OmiBluetoothService.isStreamActive());
    
    return () => {
      OmiBluetoothService.removeAllListeners();
      OmiAudioStreamService.removeAllListeners();
    };
  }, []);

  const setupEventListeners = () => {
    // Bluetooth connection events
    OmiBluetoothService.on('deviceConnected', () => setIsConnected(true));
    OmiBluetoothService.on('deviceDisconnected', () => {
      setIsConnected(false);
      setIsStreaming(false);
      setRealtimeTranscript('');
      setAudioStats({ totalBytes: 0, duration: 0, codec: 'PCM16' });
    });
    
    OmiBluetoothService.on('streamStarted', () => setIsStreaming(true));
    OmiBluetoothService.on('streamStopped', () => setIsStreaming(false));

    // Audio stream events
    OmiAudioStreamService.on('streamingStarted', () => {
      console.log('🎵 Audio streaming started');
      if (onStartStreaming) onStartStreaming();
    });
    
    OmiAudioStreamService.on('streamingStopped', () => {
      console.log('⏹️ Audio streaming stopped');
      if (onStopStreaming) onStopStreaming();
    });

    OmiAudioStreamService.on('liveAudioData', (data) => {
      setAudioStats(data);
    });

    OmiAudioStreamService.on('realtimeTranscription', (data) => {
      setRealtimeTranscript(data.text);
    });

    OmiAudioStreamService.on('finalTranscription', (data) => {
      console.log('📝 Final transcription:', data.text);
    });

    // Update streaming status periodically
    const statusInterval = setInterval(() => {
      const status = OmiAudioStreamService.getStreamingStatus();
      setStreamingStatus(status);
    }, 1000);

    return () => clearInterval(statusInterval);
  };

  const toggleStreaming = async () => {
    if (!isConnected) {
      return;
    }

    try {
      if (isStreaming) {
        await OmiBluetoothService.stopAudioStream();
      } else {
        await OmiBluetoothService.startAudioStream();
      }
    } catch (error) {
      console.error('Failed to toggle streaming:', error);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isConnected) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.disconnectedState}>
          <Ionicons name="bluetooth-outline" size={32} color={colors.text.secondary} />
          <Text style={styles.disconnectedText}>No Omi device connected</Text>
          <Text style={styles.disconnectedSubtext}>
            Connect an Omi device to start streaming
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {/* Main Streaming Control */}
      <TouchableOpacity
        style={styles.streamingControl}
        onPress={toggleStreaming}
        disabled={!isConnected}
      >
        <LinearGradient
          colors={
            isStreaming 
              ? [colors.accent.error, '#DC2626']
              : [colors.primary.main, colors.secondary.main]
          }
          style={styles.controlGradient}
        >
          <View style={styles.controlContent}>
            <Ionicons 
              name={isStreaming ? 'stop' : 'play'} 
              size={24} 
              color="#fff" 
            />
            <Text style={styles.controlText}>
              {isStreaming ? 'Stop Streaming' : 'Start Streaming'}
            </Text>
          </View>
          
          {isStreaming && (
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>

      {/* Streaming Stats */}
      {isStreaming && (
        <View style={styles.statsContainer}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="time" size={16} color={colors.primary.main} />
              <Text style={styles.statLabel}>Duration</Text>
              <Text style={styles.statValue}>
                {formatDuration(audioStats.duration)}
              </Text>
            </View>
            
            <View style={styles.statItem}>
              <Ionicons name="analytics" size={16} color={colors.primary.main} />
              <Text style={styles.statLabel}>Data</Text>
              <Text style={styles.statValue}>
                {formatBytes(audioStats.totalBytes)}
              </Text>
            </View>
            
            <View style={styles.statItem}>
              <Ionicons name="radio" size={16} color={colors.primary.main} />
              <Text style={styles.statLabel}>Codec</Text>
              <Text style={styles.statValue}>{audioStats.codec}</Text>
            </View>
          </View>

          {/* Buffer Status */}
          <View style={styles.bufferStatus}>
            <View style={styles.bufferHeader}>
              <Text style={styles.bufferTitle}>Audio Buffer</Text>
              <Text style={styles.bufferInfo}>
                {streamingStatus.chunksCount} chunks, {formatDuration(streamingStatus.bufferDuration)}
              </Text>
            </View>
            
            <View style={styles.bufferBar}>
              <View 
                style={[
                  styles.bufferFill, 
                  { 
                    width: `${Math.min(100, (streamingStatus.bufferDuration / 3) * 100)}%` 
                  }
                ]} 
              />
            </View>
          </View>

          {/* Live Transcription */}
          {realtimeTranscript && (
            <View style={styles.transcriptionContainer}>
              <View style={styles.transcriptionHeader}>
                <Ionicons name="mic" size={16} color={colors.primary.main} />
                <Text style={styles.transcriptionTitle}>Live Transcription</Text>
                <ActivityIndicator size="small" color={colors.primary.main} />
              </View>
              
              <View style={styles.transcriptionContent}>
                <Text style={styles.transcriptionText}>
                  {realtimeTranscript}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    backgroundColor: `${colors.primary.main}05`,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: `${colors.primary.main}20`,
  },
  disconnectedState: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  disconnectedText: {
    ...typography.body,
    color: colors.text.secondary,
    fontSize: 16,
    fontWeight: '500',
    marginTop: spacing.sm,
  },
  disconnectedSubtext: {
    ...typography.caption,
    color: colors.text.disabled,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  streamingControl: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  controlGradient: {
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  controlContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  controlText: {
    ...typography.button,
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  liveIndicator: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  liveText: {
    ...typography.micro,
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  statsContainer: {
    gap: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  statItem: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  statLabel: {
    ...typography.caption,
    color: colors.text.secondary,
    fontSize: 11,
  },
  statValue: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  bufferStatus: {
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  bufferHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  bufferTitle: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  bufferInfo: {
    ...typography.caption,
    color: colors.text.secondary,
    fontSize: 11,
  },
  bufferBar: {
    height: 6,
    backgroundColor: `${colors.primary.main}20`,
    borderRadius: 3,
    overflow: 'hidden',
  },
  bufferFill: {
    height: '100%',
    backgroundColor: colors.primary.main,
    borderRadius: 3,
  },
  transcriptionContainer: {
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary.main,
  },
  transcriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  transcriptionTitle: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  transcriptionContent: {
    backgroundColor: `${colors.primary.main}08`,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
  },
  transcriptionText: {
    ...typography.body,
    color: colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
});