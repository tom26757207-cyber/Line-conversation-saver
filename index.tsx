import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import { 
  MessageSquare, 
  Users, 
  Clock, 
  Sparkles, 
  Upload, 
  FileText, 
  History,
  Trash2,
  Calendar,
  Zap,
  BrainCircuit,
  PieChart,
  ShieldCheck,
  Download,
  Search,
  AlertCircle,
  Banknote,
  Stethoscope,
  CalendarCheck,
  ChevronRight,
  Filter,
  Info,
  ExternalLink,
  CheckCircle2,
  User,
  Building2,
  Quote,
  ShieldAlert
} from 'lucide-react';

// --- Types ---

interface ChatMessage {
  id: string;
  date: string;
  time: string;
  datetime: string;
  sender: string;
  content: string;
  isSystem: boolean;
  isImportant: boolean;
  tags: string[];
}

interface CaseEvent {
  id: string;
  title: string;
  summary: string;
  riskLevel: '低' | '中' | '高';
  riskAssessment: string;
  remarks: string;
  dateRange: string;
  relatedMessageIds: string[];
  familyExcerpts: string[]; // 關鍵原文摘錄: 家屬/案主說過的話
  staffExcerpts: string[];  // 關鍵原文摘錄: 單位/機構說過的話
}

interface AnalysisResult {
  summary: string;
  sentiment: string;
  topics: string[];
  relationshipDynamic: string;
  events: CaseEvent[];
  statistics: {
    paymentCount: number;
    serviceCount: number;
    scheduleCount: number;
    issueCount: number;
  };
}

interface ChatSession {
  id: string;
  fileName: string;
  timestamp: number;
  fileHash: string;
  fileSize: number;
  messages: ChatMessage[];
  participants: string[];
  analysis?: AnalysisResult;
}

// --- Constants & Config ---

const MODEL_NAME = 'gemini-3-pro-preview';

const TAG_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  payment: { icon: <Banknote className="w-3 h-3" />, color: 'bg-orange-100 text-orange-700 border-orange-200', label: '費用' },
  service: { icon: <Stethoscope className="w-3 h-3" />, color: 'bg-blue-100 text-blue-700 border-blue-200', label: '服務' },
  schedule: { icon: <CalendarCheck className="w-3 h-3" />, color: 'bg-purple-100 text-purple-700 border-purple-200', label: '排程' },
  issue: { icon: <AlertCircle className="w-3 h-3" />, color: 'bg-red-100 text-red-700 border-red-200', label: '問題' },
};

// --- Utilities ---

const calculateSHA256 = async (text: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const classifyMessage = (content: string): { tags: string[]; isImportant: boolean } => {
  const tags: string[] = [];
  let isImportant = false;
  const c = content.toLowerCase();

  if (c.match(/[$元]|繳費|自付額|費用|薪資|匯款/)) {
    tags.push('payment');
    isImportant = true;
  }
  if (c.match(/服務|照護|居服|協助|喘息|就醫|家訪|評估/)) {
    tags.push('service');
  }
  if (c.match(/時間|星期|禮拜|調動|排程|日期|幾點|暫停|更換/)) {
    tags.push('schedule');
  }
  if (c.match(/問題|抱歉|不好意思|協商|抱怨|受傷|跌倒|緊急|受傷|衝突/)) {
    tags.push('issue');
    isImportant = true;
  }
  return { tags, isImportant };
};

// --- Main App Component ---

const App = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('line_intel_pro_sessions');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<'analysis' | 'navigator'>('analysis');
  
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeSession = useMemo(() => 
    sessions.find(s => s.id === activeSessionId), 
    [sessions, activeSessionId]
  );

  const messagesByDate = useMemo<Record<string, ChatMessage[]>>(() => {
    if (!activeSession) return {};
    const groups: Record<string, ChatMessage[]> = {};
    activeSession.messages.forEach(m => {
      if (!groups[m.date]) groups[m.date] = [];
      groups[m.date].push(m);
    });
    return groups;
  }, [activeSession]);

  const filteredMessages = useMemo(() => {
    if (!activeSession) return [];
    let results = activeSession.messages;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      results = results.filter(m => 
        m.content.toLowerCase().includes(s) || 
        m.sender.toLowerCase().includes(s)
      );
    }
    if (filterTag) {
      results = results.filter(m => m.tags.includes(filterTag));
    }
    return results;
  }, [activeSession, searchTerm, filterTag]);

  const isOnline = useMemo(() => !!process.env.API_KEY, []);

  const saveSessions = (updated: ChatSession[]) => {
    setSessions(updated);
    localStorage.setItem('line_intel_pro_sessions', JSON.stringify(updated));
  };

  const jumpToDate = (date: string) => {
    const element = document.getElementById(`date-${date}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | null = null;
    const target = e.target as HTMLInputElement;
    if (target && target.files && target.files.length > 0) {
      file = target.files[0];
    } else if ('dataTransfer' in e) {
      file = (e as React.DragEvent).dataTransfer.files[0];
    }

    if (!file) return;

    if (file.name.endsWith('.json')) {
      const text = await file.text();
      try {
        const session: ChatSession = JSON.parse(text);
        if (session.id && session.messages) {
          const updated = [session, ...sessions.filter(s => s.id !== session.id)];
          saveSessions(updated);
          setActiveSessionId(session.id);
        }
      } catch (err) {
        alert("無法讀取 JSON 封存，檔案格式可能不正確。");
      }
    } else if (file.name.endsWith('.txt')) {
      const text = await file.text();
      const hash = await calculateSHA256(text);
      const lines = text.split('\n');
      const messages: ChatMessage[] = [];
      const participants = new Set<string>();
      let currentDate = '';

      const datePattern = /^(\d{4}\/\d{2}\/\d{2})[（(](.)[)）]$/;
      const messagePattern = /^([上下]午\d{2}:\d{2})\s+([^\s]+)\s+(.*)$/;

      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('[LINE]') || trimmed.startsWith('儲存日期')) return;

        const dateMatch = trimmed.match(datePattern);
        if (dateMatch) {
          currentDate = dateMatch[1];
          return;
        }

        const msgMatch = trimmed.match(messagePattern);
        if (msgMatch && currentDate) {
          const [, time, sender, content] = msgMatch;
          const { tags, isImportant } = classifyMessage(content);
          messages.push({
            id: `msg-${idx}`,
            date: currentDate,
            time,
            datetime: `${currentDate} ${time}`,
            sender,
            content,
            isSystem: content.includes('已新增') || content.includes('至群組') || content.includes('通話時間'),
            isImportant,
            tags
          });
          participants.add(sender);
        }
      });

      const newSession: ChatSession = {
        id: Math.random().toString(36).substring(7),
        fileName: file.name,
        timestamp: Date.now(),
        fileHash: hash,
        fileSize: file.size,
        messages,
        participants: Array.from(participants),
      };

      const updated = [newSession, ...sessions];
      saveSessions(updated);
      setActiveSessionId(newSession.id);
    }
  };

  const analyzeWithGemini = async () => {
    if (!activeSession || isAnalyzing || !isOnline) return;
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const sampleLimit = 400; 
      const sampledMessages = activeSession.messages.length > sampleLimit
        ? activeSession.messages.slice(0, sampleLimit / 2).concat(activeSession.messages.slice(-sampleLimit / 2))
        : activeSession.messages;

      const chatContext = sampledMessages.map(m => `[ID: ${m.id}][${m.datetime}] ${m.sender}: ${m.content}`).join('\n');

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `你是一位資深的居家長照證據保全分析專家。請分析以下 LINE 對話紀錄。
        你的任務是將對話整理成「獨立事件 (Events/Cases)」，一個事件可能跨越數天。
        
        對每個事件，請提供：
        1. 事件標題 (Title)
        2. 事件摘要 (Summary)
        3. 風險評估 (Risk Level: 低/中/高)
        4. 風險具體說明 (Risk Assessment)
        5. 備註 (Remarks) - 長照留證據所需的專業註解
        6. 日期範圍 (Date Range)
        7. 相關對話段 ID (Related Message IDs) - 必須是 context 中標註的 ID
        8. 家屬說過的話 (Family Excerpts) - 摘錄家屬或案主具備關鍵性、代表性的原文摘要。
        9. 單位說過的話 (Staff Excerpts) - 摘錄機構同仁、督導或主任的回應或承諾原文摘要。
        
        對話紀錄：
        ${chatContext}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              sentiment: { type: Type.STRING },
              topics: { type: Type.ARRAY, items: { type: Type.STRING } },
              relationshipDynamic: { type: Type.STRING },
              events: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    riskLevel: { type: Type.STRING, enum: ['低', '中', '高'] },
                    riskAssessment: { type: Type.STRING },
                    remarks: { type: Type.STRING },
                    dateRange: { type: Type.STRING },
                    relatedMessageIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                    familyExcerpts: { type: Type.ARRAY, items: { type: Type.STRING } },
                    staffExcerpts: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["title", "summary", "riskLevel", "riskAssessment", "remarks", "dateRange", "relatedMessageIds", "familyExcerpts", "staffExcerpts"]
                }
              },
              statistics: {
                type: Type.OBJECT,
                properties: {
                  paymentCount: { type: Type.NUMBER },
                  serviceCount: { type: Type.NUMBER },
                  scheduleCount: { type: Type.NUMBER },
                  issueCount: { type: Type.NUMBER }
                }
              }
            },
            required: ["summary", "sentiment", "events", "statistics"]
          }
        }
      });

      const analysis = JSON.parse(response.text || '{}') as AnalysisResult;
      const updatedSessions = sessions.map(s => 
        s.id === activeSession.id ? { ...s, analysis } : s
      );
      saveSessions(updatedSessions);
    } catch (error) {
      console.error("AI Analysis failed", error);
      alert("AI 分析失敗。請確認 API 金鑰是否有效。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportArchive = () => {
    if (!activeSession) return;
    const blob = new Blob([JSON.stringify(activeSession, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Evidence_Archive_${activeSession.fileName.replace('.txt', '')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('確定要刪除此封存紀錄嗎？')) return;
    const updated = sessions.filter(s => s.id !== id);
    saveSessions(updated);
    if (activeSessionId === id) setActiveSessionId(null);
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case '高': return 'text-red-600 bg-red-50 border-red-100';
      case '中': return 'text-orange-600 bg-orange-50 border-orange-100';
      case '低': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
      default: return 'text-slate-600 bg-slate-50 border-slate-100';
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 border-r border-slate-200 bg-white flex flex-col z-20 shadow-sm shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-100">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-slate-800 leading-tight">長照 Intel</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">證據保全工具 v2.6</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 px-2">
            <History className="w-3 h-3" />
            <span>歷史記錄</span>
          </div>

          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center opacity-30">
              <FileText className="w-8 h-8 mb-3" />
              <p className="text-xs font-medium">尚無記錄</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  className={`w-full text-left p-4 rounded-2xl transition-all group relative border ${
                    activeSessionId === s.id 
                      ? 'bg-slate-900 border-slate-900 text-white shadow-xl' 
                      : 'bg-white border-slate-100 hover:border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold truncate pr-6">{s.fileName.replace('.txt', '')}</span>
                    <div className="flex items-center gap-2 text-[10px] opacity-60">
                      <Calendar className="w-3 h-3" />
                      <span>{new Date(s.timestamp).toLocaleDateString()}</span>
                      {s.analysis && <ShieldCheck className="w-3 h-3 text-emerald-400" />}
                    </div>
                  </div>
                  <button 
                    onClick={(e) => deleteSession(s.id, e)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500 hover:text-white rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50">
          <label className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-emerald-600 text-white rounded-xl font-bold cursor-pointer hover:bg-emerald-700 transition-all active:scale-95 shadow-md shadow-emerald-50">
            <Upload className="w-4 h-4" />
            <span>匯入 (.txt/.json)</span>
            <input type="file" accept=".txt,.json" className="hidden" onChange={handleFileUpload} />
          </label>
          <p className="mt-3 text-[9px] text-center text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
            所有數據皆在本機處理<br/>保障個資隱私安全
          </p>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-100">
        {activeSession ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 px-8 py-5 flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight truncate">
                    {activeSession.fileName.replace('.txt', '')}
                  </h2>
                  {activeSession.analysis ? (
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-bold border border-emerald-100 whitespace-nowrap flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> 證據已分析
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded text-[10px] font-bold border border-slate-200 whitespace-nowrap">
                      原始資料
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs font-bold text-slate-400">
                  <div className="flex items-center gap-1"><Users className="w-3 h-3" /> {activeSession.participants.length} 人</div>
                  <div className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {activeSession.messages.length} 則</div>
                  <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(activeSession.timestamp).toLocaleDateString()}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button 
                  onClick={exportArchive}
                  className="flex items-center gap-2 bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>下載封存 (JSON)</span>
                </button>
                {isOnline && !activeSession.analysis && (
                  <button 
                    onClick={analyzeWithGemini}
                    disabled={isAnalyzing}
                    className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-50 disabled:opacity-50"
                  >
                    {isAnalyzing ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <BrainCircuit className="w-4 h-4" />
                        <span>AI 證據分析</span>
                      </>
                    )}
                  </button>
                )}
                {!isOnline && !activeSession.analysis && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-600 rounded-xl text-xs font-bold border border-amber-100">
                    <ShieldAlert className="w-4 h-4" />
                    <span>離線模式：無法執行 AI 分析</span>
                  </div>
                )}
              </div>
            </header>

            {/* Filter Bar */}
            <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 px-8 py-3 flex items-center gap-4 shrink-0">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="搜尋關鍵字..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setFilterTag(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${!filterTag ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
                >
                  全部
                </button>
                {Object.entries(TAG_CONFIG).map(([key, cfg]) => (
                  <button 
                    key={key}
                    onClick={() => setFilterTag(key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${filterTag === key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
                  >
                    {cfg.icon}
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar" ref={scrollRef}>
              {Object.entries(messagesByDate).map(([date, msgs]) => {
                const dayFiltered = msgs.filter(m => {
                  const matchesSearch = !searchTerm || m.content.toLowerCase().includes(searchTerm.toLowerCase()) || m.sender.toLowerCase().includes(searchTerm.toLowerCase());
                  const matchesTag = !filterTag || m.tags.includes(filterTag);
                  return matchesSearch && matchesTag;
                });

                if (dayFiltered.length === 0) return null;

                return (
                  <div key={date} id={`date-${date}`} className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="h-px flex-1 bg-slate-200" />
                      <div className="px-4 py-1 bg-white border border-slate-200 rounded-full text-xs font-black text-slate-400">
                        {date}
                      </div>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                    
                    <div className="space-y-3">
                      {dayFiltered.map((msg) => (
                        <div 
                          key={msg.id}
                          id={msg.id}
                          className={`flex flex-col group ${msg.isSystem ? 'items-center' : 'items-start'}`}
                        >
                          {!msg.isSystem ? (
                            <div className="max-w-[80%] flex flex-col gap-1">
                              <div className="flex items-center gap-2 ml-3">
                                <span className="text-[10px] font-black text-slate-500 uppercase">{msg.sender}</span>
                                <span className="text-[9px] font-bold text-slate-300">{msg.time}</span>
                              </div>
                              <div className={`p-4 rounded-2xl border shadow-sm transition-all ${msg.isImportant ? 'bg-rose-50 border-rose-100' : 'bg-white border-slate-100'}`}>
                                <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap font-medium">
                                  {msg.content}
                                </p>
                                {msg.tags.length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    {msg.tags.map(tag => (
                                      <span key={tag} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${TAG_CONFIG[tag].color}`}>
                                        {TAG_CONFIG[tag].icon}
                                        {TAG_CONFIG[tag].label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="px-4 py-1 bg-slate-100/50 rounded-lg text-[10px] text-slate-400 font-medium italic">
                              {msg.content}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div 
            className={`flex-1 flex flex-col items-center justify-center transition-all duration-300 ${
              isDragging ? 'bg-emerald-50/50' : 'bg-slate-50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e); }}
          >
            <div className="max-w-md w-full p-12 text-center">
              <div className={`w-28 h-28 mx-auto mb-10 rounded-[40px] bg-emerald-600 flex items-center justify-center shadow-2xl shadow-emerald-100 transition-all transform ${isDragging ? 'scale-110' : ''}`}>
                <Upload className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-4xl font-black text-slate-900 mb-4 tracking-tight">長照對話 Intel</h2>
              <p className="text-slate-500 mb-10 leading-relaxed font-bold text-sm">
                拖放 LINE 匯出的 <span className="text-emerald-600 underline">.txt</span> 檔案<br/>
                或開啟先前分析過的 <span className="text-emerald-600 underline">.json</span> 證據封存
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="p-6 bg-white rounded-[32px] shadow-sm border border-slate-100 flex flex-col items-center gap-3">
                  <ShieldCheck className="w-6 h-6 text-blue-500" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">證據驗證</span>
                </div>
                <div className="p-6 bg-white rounded-[32px] shadow-sm border border-slate-100 flex flex-col items-center gap-3">
                  <BrainCircuit className="w-6 h-6 text-emerald-500" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">事件化分析</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Right Panel: Analysis & Navigator */}
      {activeSession && (
        <aside className="w-[480px] border-l border-slate-200 bg-white flex flex-col shrink-0">
          <div className="flex border-b border-slate-100">
            <button 
              onClick={() => setRightPanel('analysis')}
              className={`flex-1 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all border-b-2 ${rightPanel === 'analysis' ? 'border-emerald-600 text-slate-900 bg-slate-50/50' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              <div className="flex items-center justify-center gap-2">
                <BrainCircuit className="w-4 h-4" />
                <span>事件分析報告</span>
              </div>
            </button>
            <button 
              onClick={() => setRightPanel('navigator')}
              className={`flex-1 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all border-b-2 ${rightPanel === 'navigator' ? 'border-emerald-600 text-slate-900 bg-slate-50/50' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              <div className="flex items-center justify-center gap-2">
                <Calendar className="w-4 h-4" />
                <span>時間跳轉</span>
              </div>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            {rightPanel === 'analysis' ? (
              activeSession.analysis ? (
                <div className="space-y-8 animate-in fade-in duration-500">
                  <section>
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">綜合評述</h3>
                    <div className="p-6 bg-slate-900 rounded-[32px] text-white shadow-xl relative overflow-hidden group">
                      <p className="text-sm text-slate-200 leading-relaxed font-medium mb-4">
                        {activeSession.analysis.summary}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-emerald-400">情緒基調：</span>
                        <span className="px-2 py-0.5 bg-emerald-500/20 rounded text-[10px] font-bold text-emerald-100">
                          {activeSession.analysis.sentiment}
                        </span>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-6">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">證據保全事件清單</h3>
                    {activeSession.analysis.events.map((event, i) => (
                      <div key={i} className="group bg-white border border-slate-100 rounded-[32px] p-6 shadow-sm hover:shadow-md transition-all">
                        <div className="flex items-start justify-between mb-3">
                          <h4 className="text-base font-black text-slate-900 leading-tight pr-4">
                            {event.title}
                          </h4>
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border uppercase tracking-widest ${getRiskColor(event.riskLevel)}`}>
                            風險 {event.riskLevel}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold mb-4 uppercase">
                          <Calendar className="w-3 h-3" /> {event.dateRange}
                        </div>

                        <div className="space-y-4">
                          <div>
                            <span className="text-[10px] font-black text-slate-400 uppercase block mb-1">事件摘要</span>
                            <p className="text-xs text-slate-600 font-medium leading-relaxed">{event.summary}</p>
                          </div>

                          {/* 關鍵原文摘錄 */}
                          <div className="space-y-3">
                            <span className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase">
                              <Quote className="w-3 h-3" /> 關鍵原文摘錄
                            </span>
                            
                            <div className="space-y-2">
                              {event.familyExcerpts?.length > 0 && (
                                <div className="p-3 bg-blue-50 rounded-2xl border border-blue-100">
                                  <span className="flex items-center gap-1.5 text-[9px] font-black text-blue-700 uppercase mb-1">
                                    <User className="w-2.5 h-2.5" /> 家屬/案主口述
                                  </span>
                                  <ul className="list-disc list-inside space-y-1">
                                    {event.familyExcerpts.map((txt, idx) => (
                                      <li key={idx} className="text-[11px] text-blue-900 font-medium italic">「{txt}」</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              
                              {event.staffExcerpts?.length > 0 && (
                                <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-100">
                                  <span className="flex items-center gap-1.5 text-[9px] font-black text-emerald-700 uppercase mb-1">
                                    <Building2 className="w-2.5 h-2.5" /> 單位/機構回應
                                  </span>
                                  <ul className="list-disc list-inside space-y-1">
                                    {event.staffExcerpts.map((txt, idx) => (
                                      <li key={idx} className="text-[11px] text-emerald-900 font-medium italic">「{txt}」</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                            <span className="flex items-center gap-2 text-[10px] font-black text-amber-700 uppercase mb-1">
                              <AlertCircle className="w-3 h-3" /> 具體風險說明
                            </span>
                            <p className="text-xs text-amber-800 font-medium leading-relaxed">{event.riskAssessment}</p>
                          </div>

                          <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                            <span className="flex items-center gap-2 text-[10px] font-black text-emerald-700 uppercase mb-1">
                              <Info className="w-3 h-3" /> 專業備註
                            </span>
                            <p className="text-xs text-emerald-800 font-medium leading-relaxed">{event.remarks}</p>
                          </div>

                          {event.relatedMessageIds?.length > 0 && (
                            <div className="pt-2">
                              <span className="text-[10px] font-black text-slate-400 uppercase block mb-2">相關證據定位</span>
                              <div className="flex flex-wrap gap-2">
                                {event.relatedMessageIds.slice(0, 6).map(mid => (
                                  <button 
                                    key={mid}
                                    onClick={() => {
                                      const el = document.getElementById(mid);
                                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                      el?.classList.add('ring-2', 'ring-emerald-400', 'ring-offset-4');
                                      setTimeout(() => el?.classList.remove('ring-2', 'ring-emerald-400', 'ring-offset-4'), 2000);
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-600 transition-all"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    定位
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </section>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                  <BrainCircuit className="w-10 h-10 mb-4" />
                  <p className="text-xs font-bold leading-relaxed">
                    載入 .json 證據封存<br/>或點擊 AI 分析生成報告
                  </p>
                </div>
              )
            ) : (
              <div className="space-y-6 animate-in fade-in duration-500">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">快速跳转日期</h3>
                <div className="grid grid-cols-1 gap-2">
                  {Object.keys(messagesByDate).map(date => (
                    <button 
                      key={date}
                      onClick={() => jumpToDate(date)}
                      className="group flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl hover:border-emerald-300 hover:bg-emerald-50 transition-all text-left"
                    >
                      <div className="text-xs font-black text-slate-700">{date}</div>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 transition-all group-hover:translate-x-1" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          <div className="p-6 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-slate-100">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-900 uppercase leading-none mb-1">封存檢視就緒</div>
                <div className="text-[9px] font-bold text-slate-400 uppercase">報告已完整包含 AI 分析數據</div>
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);