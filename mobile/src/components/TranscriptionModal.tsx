import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Dimensions,
  Share,
  Modal,
  Animated,
  PanResponder,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import APIService from '../services/APIService';
import { colors, spacing, borderRadius, typography } from '../theme/colors';

const { height: screenHeight } = Dimensions.get('window');

interface TranscriptionModalProps {
  visible: boolean;
  onClose: () => void;
  transcription: {
    id: string;
    text: string;
    aiTitle?: string;
    aiSummary?: string;
    timestamp: string;
    topic?: string;
    recordingId: string;
  };
}

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

export default function TranscriptionModal({ visible, onClose, transcription }: TranscriptionModalProps) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  
  // Animation values
  const translateY = useRef(new Animated.Value(screenHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Pan responder for swipe-down gesture
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return gestureState.dy > 0 && gestureState.dy > Math.abs(gestureState.dx * 2);
      },
      onPanResponderMove: (evt, gestureState) => {
        const newTranslateY = Math.max(0, gestureState.dy);
        translateY.setValue(newTranslateY);
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > screenHeight * 0.3) {
          closeModal();
        } else {
          // Snap back to position
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 65,
            friction: 7,
          }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      // Reset modal state when opened
      setShowChat(false);
      setChatMessages([{
        id: 'welcome',
        text: `Ask me anything about this transcription: "${transcription.aiTitle || 'Untitled'}"`,
        isUser: false,
        timestamp: new Date(),
      }]);

      // Show modal with slide up animation
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 7,
        })
      ]).start();
    }
  }, [visible, transcription]);

  const closeModal = () => {
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: screenHeight,
        duration: 250,
        useNativeDriver: true,
      })
    ]).start(() => {
      onClose();
    });
  };

  const handleChatSend = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: inputText,
      isUser: true,
      timestamp: new Date(),
    };

    setChatMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);

    try {
      console.log('=== CHAT DEBUG ===');
      console.log('Transcription ID:', transcription.id);
      console.log('User message:', inputText);
      console.log('Making API call...');
      
      const response = await APIService.chatWithTranscription(transcription.id, inputText);
      
      console.log('API response:', response);
      
      const responseMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: response.answer || 'I apologize, but I couldn\'t generate a response.',
        isUser: false,
        timestamp: new Date(),
      };

      setChatMessages(prev => [...prev, responseMessage]);
      
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error('=== CHAT ERROR ===');
      console.error('Full error:', error);
      console.error('Error message:', (error as any)?.message);
      
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: `Sorry, I encountered an error: ${(error as any)?.message || 'Unknown error'}`,
        isUser: false,
        timestamp: new Date(),
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${transcription.aiTitle || 'Transcription'}\n\n${transcription.text}`,
        title: transcription.aiTitle || 'Transcription',
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderChatMessage = (message: ChatMessage) => {
    return (
      <View
        key={message.id}
        style={[
          styles.chatMessageWrapper,
          message.isUser ? styles.userChatMessageWrapper : styles.assistantChatMessageWrapper,
        ]}
      >
        {!message.isUser && (
          <View style={styles.avatarContainer}>
            <LinearGradient
              colors={[colors.primary.main, colors.secondary.main]}
              style={styles.avatar}
            >
              <Ionicons name="sparkles" size={12} color="#fff" />
            </LinearGradient>
          </View>
        )}
        
        <View
          style={[
            styles.chatMessageContainer,
            message.isUser ? styles.userChatMessage : styles.assistantChatMessage,
          ]}
        >
          <Text style={[styles.chatMessageText, message.isUser && styles.userChatMessageText]}>
            {message.text}
          </Text>
        </View>
        
        {message.isUser && (
          <View style={styles.avatarContainer}>
            <View style={styles.userAvatar}>
              <Ionicons name="person" size={12} color={colors.primary.main} />
            </View>
          </View>
        )}
      </View>
    );
  };

  if (!visible) return null;

  return (
    <Modal
      transparent={true}
      visible={true}
      animationType="none"
      onRequestClose={closeModal}
    >
      {/* Backdrop */}
      <Animated.View 
        style={[styles.backdrop, { opacity: backdropOpacity }]}
      >
        <TouchableOpacity 
          style={styles.backdropTouchable}
          activeOpacity={1}
          onPress={closeModal}
        />
      </Animated.View>

      {/* Modal Content */}
      <Animated.View
        style={[
          styles.modalWrapper,
          {
            transform: [{ translateY }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.modalContainer}>
          <LinearGradient
            colors={[colors.background.primary, colors.background.secondary]}
            style={styles.gradient}
          >
            {/* Drag Handle */}
            <View style={styles.dragHandle} />
            
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity 
                  style={styles.backButton}
                  onPress={closeModal}
                >
                  <Ionicons name="close" size={24} color={colors.text.primary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {transcription.aiTitle || 'Transcription'}
                </Text>
                <View style={styles.headerActions}>
                  <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
                    <Ionicons name="share-outline" size={20} color={colors.text.secondary} />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.actionButton, showChat && styles.actionButtonActive]}
                    onPress={() => setShowChat(!showChat)}
                  >
                    <Ionicons 
                      name={showChat ? "chatbubbles" : "chatbubbles-outline"} 
                      size={20} 
                      color={showChat ? colors.primary.main : colors.text.secondary} 
                    />
                  </TouchableOpacity>
                </View>
            </View>

            {!showChat ? (
              /* Transcription Content */
              <ScrollView 
                style={styles.contentContainer}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.content}>
                  {/* Summary Card */}
                  {transcription.aiSummary && (
                    <View style={styles.summaryCard}>
                      <Text style={styles.summaryTitle}>Summary</Text>
                      <Text style={styles.summaryText}>{transcription.aiSummary}</Text>
                    </View>
                  )}

                  {/* Metadata */}
                  <View style={styles.metadataCard}>
                    <View style={styles.metadataRow}>
                      <Ionicons name="time-outline" size={16} color={colors.text.secondary} />
                      <Text style={styles.metadataText}>{formatDate(transcription.timestamp)}</Text>
                    </View>
                    {transcription.topic && (
                      <View style={styles.metadataRow}>
                        <Ionicons name="pricetag-outline" size={16} color={colors.text.secondary} />
                        <Text style={styles.metadataText}>{transcription.topic}</Text>
                      </View>
                    )}
                    <View style={styles.metadataRow}>
                      <Ionicons name="document-text-outline" size={16} color={colors.text.secondary} />
                      <Text style={styles.metadataText}>ID: {transcription.recordingId}</Text>
                    </View>
                  </View>

                  {/* Full Transcription */}
                  <View style={styles.transcriptionCard}>
                    <Text style={styles.transcriptionTitle}>Full Transcription</Text>
                    <Text style={styles.transcriptionText} selectable>
                      {transcription.text}
                    </Text>
                  </View>
                </View>
              </ScrollView>
            ) : (
              /* Chat Interface */
              <KeyboardAvoidingView
                style={styles.chatContainer}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
              >
                <ScrollView 
                  ref={scrollViewRef}
                  style={styles.chatMessagesContainer}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.chatMessagesContent}
                >
                  {chatMessages.map(renderChatMessage)}
                  {isLoading && (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="small" color={colors.primary.main} />
                      <Text style={styles.loadingText}>Thinking...</Text>
                    </View>
                  )}
                </ScrollView>

                <View style={styles.chatInputWrapper}>
                  <LinearGradient
                    colors={[`${colors.background.elevated}CC`, `${colors.background.card}CC`]}
                    style={styles.chatInputContainer}
                  >
                    <TextInput
                      style={styles.chatInput}
                      value={inputText}
                      onChangeText={setInputText}
                      placeholder="Ask about this transcription..."
                      placeholderTextColor={colors.text.secondary}
                      multiline
                      onSubmitEditing={handleChatSend}
                    />
                    <TouchableOpacity
                      style={[
                        styles.chatSendButton,
                        !inputText.trim() && styles.chatSendButtonDisabled
                      ]}
                      onPress={handleChatSend}
                      disabled={!inputText.trim() || isLoading}
                    >
                      <LinearGradient
                        colors={
                          inputText.trim() 
                            ? [colors.primary.main, colors.secondary.main]
                            : [colors.background.card, colors.background.card]
                        }
                        style={styles.chatSendButtonGradient}
                      >
                        <Ionicons 
                          name="send" 
                          size={16} 
                          color={inputText.trim() ? '#fff' : colors.text.disabled} 
                        />
                      </LinearGradient>
                    </TouchableOpacity>
                  </LinearGradient>
                </View>
              </KeyboardAvoidingView>
            )}
          </LinearGradient>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  backdropTouchable: {
    flex: 1,
  },
  modalWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: screenHeight * 0.95,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.text.secondary,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    opacity: 0.5,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface.border,
    width: '100%',
  },
  backButton: {
    padding: spacing.sm,
    marginRight: spacing.sm,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.text.primary,
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
  },
  actionButton: {
    padding: spacing.sm,
    backgroundColor: `${colors.background.elevated}80`,
    borderRadius: borderRadius.md,
    marginLeft: spacing.sm,
  },
  actionButtonActive: {
    backgroundColor: `${colors.primary.main}20`,
  },
  contentContainer: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
  summaryCard: {
    backgroundColor: colors.background.elevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  summaryTitle: {
    ...typography.h3,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  summaryText: {
    ...typography.body,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  metadataCard: {
    backgroundColor: colors.background.card,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  metadataText: {
    ...typography.body,
    color: colors.text.secondary,
    marginLeft: spacing.sm,
  },
  transcriptionCard: {
    backgroundColor: colors.background.elevated,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  transcriptionTitle: {
    ...typography.h3,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  transcriptionText: {
    ...typography.body,
    color: colors.text.primary,
    lineHeight: 24,
  },
  // Chat styles
  chatContainer: {
    flex: 1,
  },
  chatMessagesContainer: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  chatMessagesContent: {
    paddingVertical: spacing.md,
  },
  chatMessageWrapper: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
    alignItems: 'flex-end',
  },
  userChatMessageWrapper: {
    justifyContent: 'flex-end',
  },
  assistantChatMessageWrapper: {
    justifyContent: 'flex-start',
  },
  avatarContainer: {
    marginHorizontal: spacing.xs,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: `${colors.primary.main}20`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatMessageContainer: {
    maxWidth: '75%',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
  },
  userChatMessage: {
    backgroundColor: colors.primary.main,
    borderBottomRightRadius: 4,
  },
  assistantChatMessage: {
    backgroundColor: colors.background.elevated,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  chatMessageText: {
    ...typography.caption,
    fontSize: 14,
    color: colors.text.primary,
  },
  userChatMessageText: {
    color: '#fff',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  loadingText: {
    marginLeft: spacing.sm,
    color: colors.text.secondary,
    ...typography.caption,
  },
  chatInputWrapper: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  chatInput: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 14,
    fontFamily: 'General Sans',
    color: colors.text.primary,
    maxHeight: 80,
  },
  chatSendButton: {
    marginLeft: spacing.sm,
  },
  chatSendButtonDisabled: {
    opacity: 0.5,
  },
  chatSendButtonGradient: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});