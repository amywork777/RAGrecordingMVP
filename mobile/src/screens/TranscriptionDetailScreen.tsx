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
  SafeAreaView,
  Animated,
  Share,
  Keyboard,
} from 'react-native';
import { PanGestureHandler, GestureHandlerRootView } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import APIService from '../services/APIService';
import { useTheme, spacing, borderRadius, typography, shadows } from '../theme/colors';

interface TranscriptionDetailProps {
  route: {
    params: {
      transcription: {
        id: string;
        text: string;
        aiTitle?: string;
        aiSummary?: string;
        timestamp: string;
        topic?: string;
        recordingId: string;
      };
      openChat?: boolean;
    };
  };
  navigation: any;
}

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

export default function TranscriptionDetailScreen({ route, navigation }: TranscriptionDetailProps) {
  const colors = useTheme();
  const styles = createStyles(colors);
  const { transcription, openChat } = route.params;
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showChat, setShowChat] = useState(openChat || false);
  const scrollViewRef = useRef<ScrollView>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const messageAnimations = useRef<{ [key: string]: Animated.Value }>({});
  const chatTransitionAnim = useRef(new Animated.Value(showChat ? 1 : 0)).current;

  useEffect(() => {
    // Initialize with a welcome message
    const welcomeMessage = {
      id: 'welcome',
      text: `Ask me anything about this transcription: "${transcription.aiTitle || 'Untitled'}"`,
      isUser: false,
      timestamp: new Date(),
    };
    
    setChatMessages([welcomeMessage]);
    
    // Initialize animation for welcome message
    messageAnimations.current[welcomeMessage.id] = new Animated.Value(0);

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Animate welcome message
    setTimeout(() => {
      Animated.spring(messageAnimations.current[welcomeMessage.id], {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    }, 200);
  }, []);

  // Handle chat mode transitions
  useEffect(() => {
    Animated.timing(chatTransitionAnim, {
      toValue: showChat ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [showChat]);

  // Keyboard handling
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });

    return () => {
      keyboardDidShowListener?.remove();
    };
  }, []);

  const dismissKeyboard = () => {
    Keyboard.dismiss();
  };

  const onPanGestureEvent = (event: any) => {
    const { translationY, velocityY } = event.nativeEvent;
    
    // If user swipes down with sufficient velocity, dismiss keyboard
    if (translationY > 50 && velocityY > 500) {
      dismissKeyboard();
    }
  };

  const handleChatSend = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: inputText,
      isUser: true,
      timestamp: new Date(),
    };

    // Initialize animation for user message
    messageAnimations.current[userMessage.id] = new Animated.Value(0);

    setChatMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    // Animate user message
    setTimeout(() => {
      Animated.spring(messageAnimations.current[userMessage.id], {
        toValue: 1,
        useNativeDriver: true,
        tension: 120,
        friction: 8,
      }).start();
      
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 50);

    try {
      console.log('=== CHAT DEBUG ===');
      console.log('Transcription ID:', transcription.id);
      console.log('User message:', inputText);
      console.log('Making API call...');
      
      // Call the new chat API endpoint with the transcription context
      const response = await APIService.chatWithTranscription(transcription.id, inputText);
      
      console.log('API response:', response);
      
      const responseMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: response.answer || 'I apologize, but I couldn\'t generate a response.',
        isUser: false,
        timestamp: new Date(),
      };

      // Initialize animation for response message
      messageAnimations.current[responseMessage.id] = new Animated.Value(0);

      setChatMessages(prev => [...prev, responseMessage]);
      
      // Animate response message
      setTimeout(() => {
        Animated.spring(messageAnimations.current[responseMessage.id], {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 8,
        }).start();
        
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
      
      // Initialize animation for error message
      messageAnimations.current[errorMessage.id] = new Animated.Value(0);
      
      setChatMessages(prev => [...prev, errorMessage]);
      
      // Animate error message
      setTimeout(() => {
        Animated.spring(messageAnimations.current[errorMessage.id], {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 8,
        }).start();
      }, 100);
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
    // Ensure animation exists for message
    if (!messageAnimations.current[message.id]) {
      messageAnimations.current[message.id] = new Animated.Value(1);
    }

    const slideAnimation = {
      opacity: messageAnimations.current[message.id],
      transform: [
        {
          translateY: messageAnimations.current[message.id].interpolate({
            inputRange: [0, 1],
            outputRange: [20, 0],
          }),
        },
        {
          scale: messageAnimations.current[message.id].interpolate({
            inputRange: [0, 1],
            outputRange: [0.95, 1],
          }),
        },
      ],
    };

    return (
      <Animated.View
        key={message.id}
        style={[
          styles.chatMessageWrapper,
          message.isUser ? styles.userChatMessageWrapper : styles.assistantChatMessageWrapper,
          slideAnimation,
        ]}
      >
        {!message.isUser && (
          <View style={styles.avatarContainer}>
            <LinearGradient
              colors={[colors.primary.main, colors.secondary.main]}
              style={styles.avatar}
            >
              <Ionicons name="sparkles" size={16} color="#fff" />
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
              <Ionicons name="person" size={16} color={colors.primary.main} />
            </View>
          </View>
        )}
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[colors.background.primary, colors.background.secondary]}
        style={styles.gradient}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
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
            <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
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
              </View>

              {/* Full Transcription */}
              <View style={styles.transcriptionCard}>
                <Text style={styles.transcriptionTitle}>Full Transcription</Text>
                <Text style={styles.transcriptionText} selectable>
                  {transcription.text}
                </Text>
              </View>
            </Animated.View>
          </ScrollView>
        ) : (
          /* Chat Interface */
          <GestureHandlerRootView style={styles.chatContainer}>
            <PanGestureHandler onGestureEvent={onPanGestureEvent}>
              <Animated.View style={[styles.chatContainer, { opacity: chatTransitionAnim }]}>
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
                      size={18} 
                      color={inputText.trim() ? '#fff' : colors.text.disabled} 
                    />
                  </LinearGradient>
                </TouchableOpacity>
              </LinearGradient>
            </View>
                </KeyboardAvoidingView>
              </Animated.View>
            </PanGestureHandler>
          </GestureHandlerRootView>
        )}
      </LinearGradient>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface.border,
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
    padding: 8,
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
    padding: 8,
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
    padding: 8,
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
    paddingBottom: spacing.lg,
  },
  chatMessageWrapper: {
    flexDirection: 'row',
    marginBottom: spacing.md,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${colors.primary.main}20`,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: `${colors.primary.main}30`,
  },
  chatMessageContainer: {
    maxWidth: '78%',
    padding: 6,
    borderRadius: borderRadius.lg,
    ...shadows.card,
  },
  userChatMessage: {
    backgroundColor: colors.primary.main,
    borderBottomRightRadius: spacing.xs,
  },
  assistantChatMessage: {
    backgroundColor: colors.background.card,
    borderBottomLeftRadius: spacing.xs,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  chatMessageText: {
    ...typography.body,
    fontSize: 15,
    color: colors.text.primary,
    lineHeight: 22,
  },
  userChatMessageText: {
    color: '#fff',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginLeft: 40, // Align with assistant messages (avatar + smaller margin)
  },
  loadingText: {
    marginLeft: spacing.sm,
    color: colors.text.secondary,
    ...typography.body,
    fontStyle: 'italic',
  },
  chatInputWrapper: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surface.border,
    backgroundColor: colors.background.elevated,
    ...shadows.card,
  },
  chatInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    fontFamily: 'General Sans',
    color: colors.text.primary,
    lineHeight: 20,
    minHeight: 40,
  },
  chatSendButton: {
    marginLeft: spacing.md,
  },
  chatSendButtonDisabled: {
    opacity: 0.5,
  },
  chatSendButtonGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  },
}); // End of createStyles function