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
import { useTheme, spacing, borderRadius, typography, shadows } from '../theme/colors';

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

// Helper function to generate intelligent responses from search results
const generateIntelligentResponse = (query: string, results: SearchResult[], sources?: any[]): string => {
  if (!results || results.length === 0) return "I couldn't find anything about that in your recordings.";
  
  const queryLower = query.toLowerCase();
  const isQuestion = queryLower.includes('what') || queryLower.includes('how') || queryLower.includes('when') || 
                   queryLower.includes('where') || queryLower.includes('why') || queryLower.includes('?');
  const isSummary = queryLower.includes('summarize') || queryLower.includes('summary') || queryLower.includes('main points');
  
  // Get results and create intelligent summary
  const topResult = results[0];
  const resultCount = results.length;
  const score = topResult.score || 0;
  
  // Use the actual transcript text
  let content = topResult.text.trim();
  
  // If content is very short and repetitive (like "hello hello"), be more conversational
  const words = content.toLowerCase().split(/\s+/);
  const uniqueWords = [...new Set(words)];
  const isShortAndRepetitive = content.length < 100 && uniqueWords.length < words.length / 2;
  
  if (isShortAndRepetitive) {
    // For short/repetitive content, be more conversational
    const mentionedTopics = uniqueWords.filter(word => 
      !['hello', 'hi', 'yeah', 'ok', 'okay', 'um', 'uh'].includes(word) && word.length > 2
    );
    
    if (mentionedTopics.length > 0) {
      const topics = mentionedTopics.join(', ');
      return resultCount === 1
        ? `I found a recording where you mentioned: ${topics}`
        : `I found ${resultCount} recordings where you mentioned: ${topics}`;
    }
  }
  
  // For longer or more substantial content
  let preview = content;
  if (content.length > 200) {
    // Try to cut at sentence or natural break
    const sentences = content.split(/[.!?]+/);
    if (sentences.length > 1) {
      preview = sentences[0].trim() + '.';
      if (preview.length < 50 && sentences[1]) {
        preview += ' ' + sentences[1].trim() + '.';
      }
    } else {
      preview = content.substring(0, 200) + '...';
    }
  }
  
  // Generate natural, conversational responses
  if (isSummary) {
    return resultCount === 1
      ? `Here's what you recorded: "${preview}"`
      : `You have ${resultCount} recordings about this. Here's the main one: "${preview}"`;
  } else if (isQuestion) {
    return resultCount === 1
      ? `From your recording: "${preview}"`
      : `I found ${resultCount} recordings that might help. Here's what you said: "${preview}"`;
  } else {
    // Default - more natural language
    const confidenceLevel = score > 1.5 ? "You definitely mentioned" : "You talked about";
    return resultCount === 1
      ? `${confidenceLevel} this! Here's what you said: "${preview}"`
      : `${confidenceLevel} this in ${resultCount} recordings. Here's the most relevant: "${preview}"`;
  }
};

export default function ChatScreen({ navigation }: any) {
  const colors = useTheme();
  const styles = createStyles(colors);
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
        text: 'Hi! I can help you search through your recordings. Try searching for:\n\n• Specific topics or keywords\n• "What did I say about [topic]?"\n• "Summarize my notes"\n• Key phrases from your recordings\n\nI\'ll find the most relevant content and show you what you said!',
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
      console.log('=== CHAT DEBUG ===');
      console.log('Query:', inputText);
      console.log('Search response:', JSON.stringify(searchResponse, null, 2));
      
      let responseText = '';
      
      if (searchResponse.answer) {
        // Use AI-generated answer if available from the search API
        responseText = searchResponse.answer;
      } else if (searchResponse.results && searchResponse.results.length > 0) {
        // Generate intelligent response from search results
        responseText = generateIntelligentResponse(inputText, searchResponse.results, searchResponse.sources);
      } else if (searchResponse.sources && searchResponse.sources.length > 0) {
        // Use sources as fallback
        const source = searchResponse.sources[0];
        responseText = `Based on your recordings, here's what I found:\n\n"${source.text}"`;
      } else {
        // No results found - check if we actually have any transcripts
        console.log('No results found for query:', inputText);
        responseText = "I couldn't find any recordings matching your query. This might be because:\n\n• No recordings contain those keywords\n• Try using different or more general terms\n• Check if you have transcripts uploaded\n\nWhat else would you like to search for?";
      }
      
      const responseMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: responseText,
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
      text: 'Chat cleared! I\'m ready to help you search and analyze your recordings again. What would you like to know?',
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
                  console.log('=== SOURCE CLICKED ===');
                  console.log('Source:', message.sources?.[0]);
                  
                  if (message.sources && message.sources[0]) {
                    const source = message.sources[0];
                    const transcriptionData = {
                      id: source.id || 'source-' + Date.now(),
                      text: source.text,
                      timestamp: source.timestamp || new Date().toISOString(),
                      recordingId: source.id || 'unknown',
                      aiTitle: source.topic || 'Source Document',
                      aiSummary: source.text.length > 200 ? source.text.substring(0, 200) + '...' : source.text,
                      topic: source.topic || 'Source Document',
                      title: source.topic || 'Source Document',
                      summary: source.text.length > 200 ? source.text.substring(0, 200) + '...' : source.text,
                    };
                    
                    console.log('Navigating to TranscriptionDetail with source data:', transcriptionData);
                    navigation.navigate('TranscriptionDetail', { transcription: transcriptionData });
                  }
                }}
              >
                <Ionicons 
                  name="link" 
                  size={10} 
                  color={colors.primary.main} 
                />
                <Text style={styles.sourceText} numberOfLines={2}>
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
                    console.log('Result:', JSON.stringify(result, null, 2));
                    
                    const transcriptionData = {
                      id: result.id,
                      text: result.text,
                      timestamp: result.timestamp,
                      recordingId: result.recordingId,
                      // Use enhanced result data from backend
                      aiTitle: (result as any).aiTitle || (result as any).title || 'Search Result',
                      aiSummary: (result as any).aiSummary || (result as any).summary || result.text.substring(0, 200) + '...',
                      topic: (result as any).topic || (result as any).aiTitle || 'Search Result',
                      title: (result as any).title || (result as any).aiTitle || 'Search Result',
                      summary: (result as any).summary || (result as any).aiSummary || result.text.substring(0, 200) + '...',
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
    maxWidth: '80%',
    padding: 8,
    borderRadius: borderRadius.xl,
    ...shadows.card,
  },
  userMessage: {
    backgroundColor: colors.primary.main,
    borderBottomRightRadius: spacing.sm,
  },
  assistantMessage: {
    backgroundColor: colors.background.card,
    borderBottomLeftRadius: spacing.sm,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  messageText: {
    ...typography.bodySecondary,
    color: colors.text.primary,
    lineHeight: 22,
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
    backgroundColor: `${colors.primary.main}15`,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: `${colors.primary.main}30`,
    marginTop: spacing.xs,
  },
  sourceText: {
    ...typography.caption,
    color: colors.primary.main,
    marginLeft: 6,
    marginRight: 4,
    fontSize: 11,
    fontWeight: '500',
  },
  resultsContainer: {
    marginTop: spacing.sm,
  },
  resultItem: {
    backgroundColor: colors.background.card,
    padding: 8,
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
    fontFamily: 'General Sans',
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
}); // End of createStyles function