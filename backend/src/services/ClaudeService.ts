class ClaudeService {
  private apiKey?: string;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
  }

  async generateSummary(transcriptText: string): Promise<string> {
    const trimmed = (transcriptText || '').trim();
    if (!this.apiKey) {
      // Fallback lightweight heuristic summary if no API key configured
      if (trimmed.length === 0) {
        return 'The recording did not contain any speech or detectable audio content.';
      }
      const snippet = trimmed.slice(0, 220);
      return `Summary (fallback): ${snippet}${trimmed.length > 220 ? '…' : ''}`;
    }

    try {
      const body = {
        model: 'claude-3-haiku-20240307',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Summarize the following transcript in 1-2 sentences. If there is no speech or the content is empty, say: "The recording did not contain any speech or detectable audio content."\n\nTranscript:\n${trimmed}`,
              },
            ],
          },
        ],
      };

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        throw new Error(`Anthropic API error: ${resp.status} ${resp.statusText}`);
      }

      const data: any = await resp.json();
      const content = Array.isArray(data?.content) && data.content[0]?.text ? data.content[0].text : '';
      if (content) return content.trim();
      // Fallback if unexpected shape
      return trimmed.length === 0
        ? 'The recording did not contain any speech or detectable audio content.'
        : `Summary (fallback): ${trimmed.slice(0, 220)}${trimmed.length > 220 ? '…' : ''}`;
    } catch (err) {
      // Network/API errors → fallback
      if (trimmed.length === 0) {
        return 'The recording did not contain any speech or detectable audio content.';
      }
      return `Summary (fallback): ${trimmed.slice(0, 220)}${trimmed.length > 220 ? '…' : ''}`;
    }
  }

  async generateTitleAndSummary(transcriptText: string): Promise<{ title: string; summary: string }> {
    const trimmed = (transcriptText || '').trim();
    const fallback = () => {
      if (trimmed.length === 0) {
        return {
          title: 'No Speech Detected',
          summary: 'The recording did not contain any speech or detectable audio content.',
        };
      }
      const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0] || trimmed.slice(0, 60);
      const title = (firstSentence.length > 60 ? firstSentence.slice(0, 57) + '…' : firstSentence).replace(/\n+/g, ' ');
      const summary = `Summary (fallback): ${trimmed.slice(0, 220)}${trimmed.length > 220 ? '…' : ''}`;
      return { title, summary };
    };

    if (!this.apiKey) {
      return fallback();
    }

    try {
      const body = {
        model: 'claude-3-haiku-20240307',
        max_tokens: 350,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are generating a short title and a brief summary for a voice transcription. Return strictly a JSON object with keys \"title\" and \"summary\". If there is no speech or the content is empty, use title: "No Speech Detected" and summary: "The recording did not contain any speech or detectable audio content."\n\nTranscript:\n${trimmed}`,
              },
            ],
          },
        ],
      };

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        throw new Error(`Anthropic API error: ${resp.status} ${resp.statusText}`);
      }

      const data: any = await resp.json();
      const text = Array.isArray(data?.content) && data.content[0]?.text ? data.content[0].text : '';
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.title === 'string' && typeof parsed.summary === 'string') {
          return { title: parsed.title.trim(), summary: parsed.summary.trim() };
        }
      } catch {}
      // If not parseable, fallback to single summary path
      const summary = await this.generateSummary(trimmed);
      const { title } = fallback();
      return { title, summary };
    } catch (err) {
      return fallback();
    }
  }
}

export default new ClaudeService();

