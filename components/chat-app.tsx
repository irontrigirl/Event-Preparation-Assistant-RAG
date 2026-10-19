'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Bot,
  User,
  FileText,
  ChevronDown,
  ChevronUp,
  Calendar,
  Users,
  ClipboardList,
  Sparkles,
  Loader2,
  Search,
  X,
  ArrowRight,
  Zap,
  Database,
  Brain,
} from 'lucide-react';

interface Source {
  file: string;
  record_id: string;
  section_title: string;
  score: number;
  text: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  transformed_query?: string;
  isStreaming?: boolean;
}

interface DocumentInfo {
  name: string;
  label: string;
  record_count: number;
  description: string;
}

const STARTER_QUESTIONS = [
  'Who is speaking at the opening keynote?',
  'What is the cancellation policy?',
  'Which sessions require pre-registration?',
  'What are the dietary options for speakers?',
  'What time does the afternoon break start?',
];

const DOC_ICONS: Record<string, React.ReactNode> = {
  'event_schedule.csv': <Calendar className="w-5 h-5" />,
  'speaker_directory.csv': <Users className="w-5 h-5" />,
  'attendance_policies.json': <ClipboardList className="w-5 h-5" />,
};

export function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
  const [healthStatus, setHealthStatus] = useState<{ status: string; total_chunks: number } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/documents')
      .then((r) => r.json())
      .then((data: any) => {
        setDocuments(data?.documents ?? []);
        setPreviews(data?.previews ?? {});
      })
      .catch(() => {});

    fetch('/api/health')
      .then((r) => r.json())
      .then((data: any) => setHealthStatus(data ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(
    async (queryText?: string) => {
      const query = queryText ?? input.trim();
      if (!query || isLoading) return;
      setInput('');

      const userMsg: ChatMessage = { role: 'user', content: query };
      const assistantMsg: ChatMessage = { role: 'assistant', content: '', isStreaming: true };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);

      try {
        const historyForAPI = messages.slice(-6).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, messages: historyForAPI }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData?.error ?? `API error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let partialRead = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          partialRead += decoder.decode(value, { stream: true });
          const lines = partialRead.split('\n');
          partialRead = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;
              try {
                const parsed = JSON.parse(data);
                if (parsed?.status === 'streaming') {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last) {
                      updated[updated.length - 1] = {
                        ...last,
                        content: parsed?.partial ?? '',
                        isStreaming: true,
                      };
                    }
                    return updated;
                  });
                } else if (parsed?.status === 'completed') {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last) {
                      updated[updated.length - 1] = {
                        ...last,
                        content: parsed?.answer ?? '',
                        sources: parsed?.sources ?? [],
                        transformed_query: parsed?.transformed_query ?? '',
                        isStreaming: false,
                      };
                    }
                    return updated;
                  });
                } else if (parsed?.status === 'error') {
                  throw new Error(parsed?.message ?? 'Generation failed');
                }
              } catch (e: any) {
                if (e?.message && e.message !== 'Generation failed') {
                  // skip JSON parse errors
                }
              }
            }
          }
        }
      } catch (error: any) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last) {
            updated[updated.length - 1] = {
              ...last,
              content: `Error: ${error?.message ?? 'Something went wrong. Please try again.'}`,
              isStreaming: false,
            };
          }
          return updated;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [input, isLoading, messages]
  );

  const toggleSources = (index: number) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const formatMarkdown = (text: string) => {
    let html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n- /g, '\n<li>')
      .replace(/\n\d+\. /g, '\n<li>')
      .replace(/\[(.*?)\]/g, '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono bg-primary/15 text-primary border border-primary/20">$1</span>');
    html = html.replace(/\n/g, '<br/>');
    return html;
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-xl z-20">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight text-foreground">Event Preparation Assistant</h1>
              <p className="text-xs text-muted-foreground">BeaconComms Annual Comms Summit 2026 · RAG Demo</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            {healthStatus?.status === 'ok' ? (
              <div className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span>{healthStatus?.total_chunks ?? 0} chunks indexed</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Initializing...</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden max-w-[1200px] mx-auto w-full">
        {/* Sidebar */}
        <aside className="hidden md:flex flex-col w-72 border-r border-border bg-card/40 p-4 gap-4 overflow-y-auto">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1">
            <Database className="w-4 h-4 text-primary" />
            Knowledge Base
          </div>

          {documents.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            documents.map((doc) => (
              <button
                key={doc.name}
                onClick={() => setShowPreview(showPreview === doc.name ? null : doc.name)}
                className={`w-full text-left p-3 rounded-lg border transition-all duration-200 ${
                  showPreview === doc.name
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border hover:border-primary/30 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-primary">{DOC_ICONS[doc.name]}</span>
                  <span className="text-sm font-medium text-foreground">{doc?.label ?? doc.name}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{doc?.description ?? ''}</p>
                <div className="mt-1.5 text-xs text-primary/70 font-mono">{doc?.record_count ?? 0} records</div>
              </button>
            ))
          )}

          {/* Architecture info */}
          <div className="mt-auto pt-4 border-t border-border">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-2">
              <Brain className="w-3.5 h-3.5" />
              RAG Pipeline
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-primary/60" />
                BM25 lexical retrieval
              </div>
              <div className="flex items-center gap-1.5">
                <Search className="w-3 h-3 text-primary/60" />
                Query transformation
              </div>
              <div className="flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-primary/60" />
                Source-cited generation
              </div>
            </div>
          </div>
        </aside>

        {/* Main chat area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Document Preview Overlay */}
          <AnimatePresence>
            {showPreview && previews[showPreview] && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="border-b border-border bg-card p-4 max-h-64 overflow-y-auto chat-scroll"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {documents.find((d) => d.name === showPreview)?.label ?? showPreview}
                  </h3>
                  <button onClick={() => setShowPreview(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all leading-relaxed">
                  {(previews[showPreview] ?? '').slice(0, 2000)}
                  {(previews[showPreview]?.length ?? 0) > 2000 ? '\n... (truncated)' : ''}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto chat-scroll px-4 sm:px-6 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
                    <Sparkles className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="font-display text-2xl font-bold tracking-tight mb-2">Event Preparation Assistant</h2>
                  <p className="text-sm text-muted-foreground max-w-md mb-8">
                    Ask anything about the BeaconComms Annual Comms Summit 2026 — schedule, speakers, policies, and more.
                    Answers are grounded in the knowledge base with source citations.
                  </p>
                </motion.div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
                  {STARTER_QUESTIONS.map((q, i) => (
                    <motion.button
                      key={q}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 * i, duration: 0.3 }}
                      onClick={() => sendMessage(q)}
                      className="group flex items-center gap-2 text-left text-sm text-muted-foreground bg-card border border-border rounded-lg px-3 py-2.5 hover:border-primary/40 hover:text-foreground hover:bg-primary/5 transition-all duration-200"
                    >
                      <ArrowRight className="w-3.5 h-3.5 text-primary/50 group-hover:text-primary flex-shrink-0 transition-colors" />
                      <span>{q}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.map((msg, idx) => (
                  <div key={idx}>
                    {msg.role === 'user' ? (
                      <div className="flex justify-end gap-2">
                        <div className="max-w-[85%]">
                          <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
                            {msg.content}
                          </div>
                          {idx + 1 < messages.length && messages[idx + 1]?.transformed_query && (
                            <p className="text-xs text-muted-foreground mt-1 text-right font-mono">
                              <Search className="w-3 h-3 inline mr-1" />
                              Query transformed to: &quot;{messages[idx + 1]?.transformed_query}&quot;
                            </p>
                          )}
                        </div>
                        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <User className="w-3.5 h-3.5 text-primary" />
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <div className="w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Bot className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="max-w-[85%]">
                          <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3 text-sm">
                            {msg.isStreaming && !msg.content ? (
                              <div className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-primary pulse-dot" />
                                <span className="w-2 h-2 rounded-full bg-primary pulse-dot" />
                                <span className="w-2 h-2 rounded-full bg-primary pulse-dot" />
                              </div>
                            ) : (
                              <div
                                className="chat-markdown leading-relaxed"
                                dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content ?? '') }}
                              />
                            )}
                            {msg.isStreaming && msg.content && (
                              <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
                            )}
                          </div>

                          {/* Sources */}
                          {!msg.isStreaming && (msg.sources?.length ?? 0) > 0 && (
                            <div className="mt-2">
                              <button
                                onClick={() => toggleSources(idx)}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                              >
                                <FileText className="w-3 h-3" />
                                {msg.sources?.length ?? 0} sources used
                                {expandedSources.has(idx) ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>
                              <AnimatePresence>
                                {expandedSources.has(idx) && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-1.5 space-y-1">
                                      {(msg.sources ?? []).map((src: Source, si: number) => (
                                        <div
                                          key={si}
                                          className="flex items-start gap-2 text-xs bg-muted/40 rounded-md px-2.5 py-1.5 border border-border/50"
                                        >
                                          <span className="text-primary flex-shrink-0 mt-0.5">
                                            {DOC_ICONS[src?.file ?? ''] ?? <FileText className="w-3.5 h-3.5" />}
                                          </span>
                                          <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                              <span className="font-mono text-primary font-medium">{src?.record_id ?? ''}</span>
                                              <span className="text-muted-foreground">·</span>
                                              <span className="text-muted-foreground truncate">{src?.file ?? ''}</span>
                                              <span className="ml-auto text-muted-foreground font-mono flex-shrink-0">
                                                {((src?.score ?? 0) * 100).toFixed(0)}%
                                              </span>
                                            </div>
                                            <p className="text-muted-foreground mt-0.5 line-clamp-2">{src?.text ?? ''}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="border-t border-border bg-card/60 backdrop-blur-lg px-4 sm:px-6 py-3">
            <div className="max-w-3xl mx-auto">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Ask about the event schedule, speakers, or policies..."
                  rows={1}
                  className="flex-1 resize-none bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all max-h-32"
                  style={{ minHeight: '42px' }}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={isLoading || !input.trim()}
                  className="h-[42px] w-[42px] flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex-shrink-0"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 text-center">
                Answers are generated from the knowledge base using RAG with source citations.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
