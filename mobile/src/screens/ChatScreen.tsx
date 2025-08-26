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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import APIService from '../services/APIService';
import { colors, spacing, borderRadius, typography } from '../theme/colors';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  results?: SearchResult[];
  sources?: Array<{
    id?: string;
    text: string;
    timestamp: string;
    topic: string;
    score: number;
  }>;
}

interface SearchResult {
  id: string;
  text: string;
  timestamp: string;
  recordingId: string;
  score: number;
}

export default function ChatScreen({ navigation }: any) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadRecentTranscripts();
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  const loadRecentTranscripts = async () => {
    try {
      console.log('Loading recent transcripts...');
      const recent = await APIService.getRecentTranscripts(5);
      console.log('Received transcripts:', recent);
      
      const welcomeMessage: Message = {
        id: 'welcome',
        text: 'Ask me anything about your recordings.',
        isUser: false,
        timestamp: new Date(),
      };
      setMessages([welcomeMessage]);
    } catch (error) {
      console.error('Error loading recent transcripts:', error);
      const errorMessage: Message = {
        id: 'error',
        text: `Could not connect to backend.`,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages([errorMessage]);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputText,
      isUser: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);

    try {
      const searchResponse = await APIService.searchTranscripts(inputText);
      
      const responseMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: searchResponse.answer || 'Here are the relevant recordings I found:',
        isUser: false,
        timestamp: new Date(),
        results: searchResponse.answer ? undefined : searchResponse.results,
        sources: searchResponse.sources,
      };

      setMessages(prev => [...prev, responseMessage]);
      
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: 'Sorry, I encountered an error while searching.',
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([{
      id: 'welcome',
      text: 'Chat cleared. Ask me anything about your recordings.',
      isUser: false,
      timestamp: new Date(),
    }]);
  };

  const renderMessage = (message: Message) => {
    return (
      <Animated.View
        key={message.id}
        style={[
          styles.messageWrapper,
          message.isUser ? styles.userMessageWrapper : styles.assistantMessageWrapper,
          { opacity: fadeAnim },
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
            styles.messageContainer,
            message.isUser ? styles.userMessage : styles.assistantMessage,
          ]}
        >
          <Text style={[styles.messageText, message.isUser && styles.userMessageText]}>
            {message.text}
          </Text>
          
          {message.sources && message.sources.length > 0 && !message.isUser && (
            <View style={styles.sourcesContainer}>
              <TouchableOpacity 
                style={styles.sourceChip}
                onPress={() => {
                  if (message.sources && message.sources[0]?.id) {
                    navigation.navigate('Record', { 
                      transcriptId: message.sources[0].id 
                    });
                  }
                }}
              >
                <Ionicons 
                  name="link" 
                  size={10} 
                  color={colors.primary.main} 
                />
                <Text style={styles.sourceText} numberOfLines={1}>
                  "{message.sources[0].text}"
                </Text>
              </TouchableOpacity>
            </View>
          )}
          
          {message.results && message.results.length > 0 && (
            <View style={styles.resultsContainer}>
              {message.results.map((result) => (
                <TouchableOpacity 
                  key={result.id} 
                  style={styles.resultItem}
                  onPress={() => {
                    console.log('=== RESULT CLICKED ===');
                    console.log('Result ID:', result.id);
                    console.log('Result text preview:', result.text.substring(0, 100));
                    
                    const transcriptionData = {
                      id: result.id,
                      text: result.text,
                      timestamp: result.timestamp,
                      recordingId: result.recordingId,
                      // Use actual data from the result if available
                      aiTitle: (result as any).aiTitle || (result as any).title || `Transcription ${result.recordingId}`,
                      aiSummary: (result as any).aiSummary || (result as any).summary || '',
                      topic: (result as any).topic || '',
                    };
                    
                    console.log('Navigating to TranscriptionDetail with data:', transcriptionData);
                    navigation.navigate('TranscriptionDetail', { transcription: transcriptionData });
                  }}
                >
                  <Text style={styles.resultText} numberOfLines={3}>
                    {result.text}
                  </Text>
                  <View style={styles.resultFooter}>
                    <Text style={styles.resultScore}>
                      Score: {Math.round(result.score * 100)}%
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.text.secondary} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
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
        <View style={styles.header}>
          <Text style={styles.title}>Ask Tai</Text>
          <TouchableOpacity 
            style={styles.clearButton}
            onPress={clearChat}
          >
            <Ionicons name="trash-outline" size={20} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.chatContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <ScrollView 
            ref={scrollViewRef}
            style={styles.messagesContainer}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.messagesContent}
          >
            {messages.map(renderMessage)}
            {isLoading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary.main} />
                <Text style={styles.loadingText}>Searching...</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.inputWrapper}>
            <LinearGradient
              colors={[`${colors.background.elevated}CC`, `${colors.background.card}CC`]}
              style={styles.inputContainer}
            >
              <TextInput
                style={styles.input}
                value={inputText}
                onChangeText={setInputText}
                placeholder="Ask about your recordings..."
                placeholderTextColor={colors.text.secondary}
                multiline
                maxHeight={100}
                onSubmitEditing={handleSend}
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  !inputText.trim() && styles.sendButtonDisabled
                ]}
                onPress={handleSend}
                disabled={!inputText.trim() || isLoading}
              >
                <LinearGradient
                  colors={
                    inputText.trim() 
                      ? [colors.primary.main, colors.secondary.main]
                      : [colors.background.card, colors.background.card]
                  }
                  style={styles.sendButtonGradient}
                >
                  <Ionicons 
                    name="send" 
                    size={20} 
                    color={inputText.trim() ? '#fff' : colors.text.disabled} 
                  />
                </LinearGradient>
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.text.primary,
  },
  clearButton: {
    padding: spacing.sm,
    backgroundColor: `${colors.accent.error}20`,
    borderRadius: borderRadius.md,
  },
  chatContainer: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  messagesContent: {
    paddingVertical: spacing.md,
  },
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    alignItems: 'flex-end',
  },
  userMessageWrapper: {
    justifyContent: 'flex-end',
  },
  assistantMessageWrapper: {
    justifyContent: 'flex-start',
  },
  avatarContainer: {
    marginHorizontal: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${colors.primary.main}20`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageContainer: {
    maxWidth: '75%',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
  },
  userMessage: {
    backgroundColor: colors.primary.main,
    borderBottomRightRadius: 4,
  },
  assistantMessage: {
    backgroundColor: colors.background.elevated,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  messageText: {
    ...typography.body,
    color: colors.text.primary,
  },
  userMessageText: {
    color: '#fff',
  },
  sourcesContainer: {
    marginTop: spacing.sm,
    flexDirection: 'row',
  },
  sourcesTitle: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.primary.main}08`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: `${colors.primary.main}20`,
  },
  sourceText: {
    ...typography.caption,
    color: colors.text.secondary,
    marginLeft: 4,
    fontSize: 10,
    fontStyle: 'italic',
  },
  resultsContainer: {
    marginTop: spacing.sm,
  },
  resultItem: {
    backgroundColor: colors.background.card,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: `${colors.primary.main}20`,
  },
  resultText: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  resultFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  resultScore: {
    ...typography.caption,
    color: colors.primary.main,
    fontWeight: '600',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  loadingText: {
    marginLeft: spacing.sm,
    color: colors.text.secondary,
    ...typography.body,
  },
  inputWrapper: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: borderRadius.xl,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text.primary,
    maxHeight: 100,
  },
  sendButton: {
    marginLeft: spacing.sm,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});