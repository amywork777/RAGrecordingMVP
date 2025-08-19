import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import APIService from '../services/APIService';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  results?: SearchResult[];
}

interface SearchResult {
  id: string;
  text: string;
  timestamp: string;
  recordingId: string;
  score: number;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadRecentTranscripts();
  }, []);

  const loadRecentTranscripts = async () => {
    try {
      console.log('Loading recent transcripts...');
      const recent = await APIService.getRecentTranscripts(5);
      console.log('Received transcripts:', recent);
      
      const welcomeMessage: Message = {
        id: 'welcome',
        text: 'Welcome! I have access to your recorded conversations and can help you find information. Try asking questions like:\n\n• "What do I know about octopuses?"\n• "Which animals can regenerate?"\n• "Tell me about unique defense mechanisms"\n\nI\'ll search through your recordings and provide helpful answers!',
        isUser: false,
        timestamp: new Date(),
        // Don't show raw transcripts in welcome message
      };
      setMessages([welcomeMessage]);
    } catch (error) {
      console.error('Error loading recent transcripts:', error);
      // Show error message to user
      const errorMessage: Message = {
        id: 'error',
        text: `Could not connect to backend. Make sure the backend is running on http://172.16.3.245:3000`,
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

    try {
      const searchResponse = await APIService.searchTranscripts(inputText);
      
      const responseMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: searchResponse.answer || 'Here are the relevant recordings I found:',
        isUser: false,
        timestamp: new Date(),
        // Don't show raw results if we have a GPT answer
        results: searchResponse.answer ? undefined : searchResponse.results,
      };

      setMessages(prev => [...prev, responseMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: 'Sorry, I encountered an error while searching. Please try again.',
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = (message: Message) => {
    return (
      <View
        key={message.id}
        style={[
          styles.messageContainer,
          message.isUser ? styles.userMessage : styles.assistantMessage,
        ]}
      >
        <Text style={[styles.messageText, message.isUser && styles.userMessageText]}>
          {message.text}
        </Text>
        {message.results && message.results.length > 0 && (
          <View style={styles.resultsContainer}>
            {message.results.map((result) => (
              <View key={result.id} style={styles.resultItem}>
                <Text style={styles.resultTime}>
                  {new Date(result.timestamp).toLocaleString()}
                </Text>
                <Text style={styles.resultText}>{result.text}</Text>
                <Text style={styles.resultScore}>
                  Relevance: {Math.round(result.score * 100)}%
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Memory Search</Text>
      </View>

      <ScrollView style={styles.messagesContainer}>
        {messages.map(renderMessage)}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#2196F3" />
            <Text style={styles.loadingText}>Searching your memories...</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask about your recordings..."
          placeholderTextColor="#999"
          multiline
          maxHeight={100}
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || isLoading}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#2196F3',
    padding: 20,
    paddingTop: 50,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  messagesContainer: {
    flex: 1,
    padding: 15,
  },
  messageContainer: {
    marginBottom: 15,
    padding: 12,
    borderRadius: 15,
    maxWidth: '80%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#2196F3',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
  },
  messageText: {
    fontSize: 16,
    color: '#333',
  },
  userMessageText: {
    color: '#fff',
  },
  resultsContainer: {
    marginTop: 10,
  },
  resultItem: {
    backgroundColor: '#f0f0f0',
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  resultTime: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  resultText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  resultScore: {
    fontSize: 12,
    color: '#2196F3',
    fontWeight: 'bold',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  loadingText: {
    marginLeft: 10,
    color: '#666',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 15,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});