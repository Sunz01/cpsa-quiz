import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { QUESTIONS } from './data/questions';
import type { Question, Topic, Difficulty } from './types/quiz';
import { TOPIC_LABELS, DIFFICULTY_COLORS } from './types/quiz';
import {
  Shield, ChevronRight, ChevronLeft, Check, X, RotateCcw,
  Trophy, Target, BookOpen, Filter, Shuffle, Home, BarChart3,
  Zap, Heart, Skull, Award, Clock, Timer, AlertTriangle,
} from 'lucide-react';
import confetti from 'canvas-confetti';

type Screen = 'home' | 'quiz' | 'results' | 'achievements';
type QuizMode = 'all' | 'topic' | 'weak' | 'missed' | 'speed' | 'lives';

interface SessionState {
  questions: Question[];
  currentIndex: number;
  answers: (number | null)[];
  showExplanation: boolean;
  // Speed mode
  timeStarted?: number; // ms timestamp for current question (speed mode)
  // Lives mode
  lives?: number;
  // Boss battle (every 10th question in non-trivial runs)
  isBoss?: boolean;
  bossHP?: number; // current HP of the boss (10 max for hard question)
}

const STORAGE_KEY = 'cpsa-quiz-stats-v2';
const ACHIEVEMENTS_KEY = 'cpsa-quiz-achievements-v1';
const QUESTIONS_PER_BOSS = 5; // Every Nth question, you fight a boss

// ============== ACHIEVEMENTS ==============

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  condition: (stats: PersistentStats, sessionStats?: SessionResult) => boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-blood',
    name: 'First Blood',
    description: 'Answer your first question correctly',
    icon: '🩸',
    condition: (s) => s.totalCorrect >= 1,
  },
  {
    id: 'perfect-run',
    name: 'Flawless',
    description: 'Complete a 5+ question run with 100% accuracy',
    icon: '💎',
    condition: (s, sr) => (sr?.correct === sr?.total && (sr?.total || 0) >= 5),
  },
  {
    id: 'streak-5',
    name: 'On Fire',
    description: 'Get 5 questions right in a row',
    icon: '🔥',
    condition: (s, sr) => (sr?.longestStreak || 0) >= 5,
  },
  {
    id: 'streak-10',
    name: 'Unstoppable',
    description: 'Get 10 questions right in a row',
    icon: '⚡',
    condition: (s, sr) => (sr?.longestStreak || 0) >= 10,
  },
  {
    id: 'speed-demon',
    name: 'Speed Demon',
    description: 'Complete speed mode with 80%+ accuracy',
    icon: '⚡',
    condition: (s, sr) => sr?.mode === 'speed' && (sr?.accuracy || 0) >= 80,
  },
  {
    id: 'survivor',
    name: 'Survivor',
    description: 'Complete lives mode without losing all lives',
    icon: '💀',
    condition: (s, sr) => sr?.mode === 'lives' && (sr?.total || 0) >= 5 && sr?.survived === true,
  },
  {
    id: 'boss-slayer',
    name: 'Boss Slayer',
    description: 'Defeat 3 bosses',
    icon: '🐉',
    condition: (s) => s.bossesDefeated >= 3,
  },
  {
    id: 'boss-killer',
    name: 'Boss Killer',
    description: 'Defeat a boss without missing it (HP > 0)',
    icon: '🏆',
    condition: (s) => s.bossesPerfect >= 1,
  },
  {
    id: 'topic-master-nmap',
    name: 'Nmap Master',
    description: 'Get 10/10 in nmap questions',
    icon: '🎯',
    condition: (s) => (s.perTopic['nmap']?.correct || 0) >= 10 && (s.perTopic['nmap']?.answered || 0) >= 10,
  },
  {
    id: 'centurion',
    name: 'Centurion',
    description: 'Answer 100 questions total',
    icon: '💯',
    condition: (s) => s.totalAnswered >= 100,
  },
  {
    id: 'comeback-kid',
    name: 'Comeback Kid',
    description: 'Get a weak question right (after missing it before)',
    icon: '🔄',
    condition: (s) => (s.comebacks || 0) >= 1,
  },
];

interface SessionResult {
  mode: QuizMode;
  total: number;
  correct: number;
  accuracy: number;
  longestStreak: number;
  survived?: boolean;
}

// ============== PERSISTENT STATE ==============

interface PersistentStats {
  attempts: number;
  totalCorrect: number;
  totalAnswered: number;
  perTopic: Record<string, { correct: number; answered: number }>;
  perQuestion: Record<string, { correct: boolean; lastSeen: number }>;
  bossesDefeated: number;
  bossesPerfect: number;
  comebacks: number;
  unlockedAchievements: string[];
}

const DEFAULT_STATS: PersistentStats = {
  attempts: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  perTopic: {},
  perQuestion: {},
  bossesDefeated: 0,
  bossesPerfect: 0,
  comebacks: 0,
  unlockedAchievements: [],
};

const loadStats = (): PersistentStats => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults for new fields
      return { ...DEFAULT_STATS, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_STATS };
};

const saveStats = (stats: PersistentStats) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {}
};

const loadAchievements = (): string[] => {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
};

const saveAchievements = (ids: string[]) => {
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(ids));
  } catch {}
};

const shuffleArray = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Confetti helper
const fireConfetti = () => {
  const duration = 2000;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };
  
  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) return clearInterval(interval);
    const particleCount = 50 * (timeLeft / duration);
    confetti({ ...defaults, particleCount, origin: { x: Math.random(), y: Math.random() - 0.2 } });
  }, 250);
};

// ============== MAIN APP ==============

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [stats, setStats] = useState<PersistentStats>(() => loadStats());
  const [unlocked, setUnlocked] = useState<string[]>(() => loadAchievements());
  const [selectedTopic, setSelectedTopic] = useState<Topic | 'all'>('all');
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | 'all'>('all');
  const [session, setSession] = useState<SessionState | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<number>(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [toastQueue, setToastQueue] = useState<Achievement[]>([]);
  const [pendingResult, setPendingResult] = useState<SessionResult | null>(null);

  useEffect(() => { saveStats(stats); }, [stats]);
  useEffect(() => { saveAchievements(unlocked); }, [unlocked]);

  const checkAchievements = useCallback((sessionResult?: SessionResult) => {
    const newlyUnlocked: Achievement[] = [];
    for (const ach of ACHIEVEMENTS) {
      if (unlocked.includes(ach.id)) continue;
      if (ach.condition(stats, sessionResult)) {
        newlyUnlocked.push(ach);
      }
    }
    if (newlyUnlocked.length > 0) {
      const newIds = newlyUnlocked.map(a => a.id);
      setUnlocked(prev => [...prev, ...newIds]);
      setToastQueue(prev => [...prev, ...newlyUnlocked]);
    }
  }, [stats, unlocked]);

  const dismissToast = useCallback(() => {
    setToastQueue(prev => prev.slice(1));
  }, []);

  useEffect(() => {
    if (toastQueue.length > 0) {
      const t = setTimeout(dismissToast, 4500);
      return () => clearTimeout(t);
    }
  }, [toastQueue, dismissToast]);

  // ============== QUIZ LOGIC ==============

  const buildQuestionSet = (mode: QuizMode): { questions: Question[]; bossIndices: Set<number> } => {
    let pool = QUESTIONS.slice();
    if (mode === 'topic' && selectedTopic !== 'all') {
      pool = pool.filter((q) => q.topic === selectedTopic);
    }
    if (selectedDifficulty !== 'all') {
      pool = pool.filter((q) => q.difficulty === selectedDifficulty);
    }
    if (mode === 'weak') {
      const wrong = pool.filter((q) => stats.perQuestion[q.id]?.correct === false);
      const other = pool.filter((q) => stats.perQuestion[q.id]?.correct !== false);
      pool = [...shuffleArray(wrong), ...shuffleArray(other)];
    }
    if (mode === 'missed') {
      pool = pool.filter((q) => stats.perQuestion[q.id]?.correct === false);
    }
    if (mode === 'speed' || mode === 'all') {
      pool = shuffleArray(pool);
    }
    // mode === 'lives' uses same pool as 'all' but unlimited

    // Mark boss positions
    const bossIndices = new Set<number>();
    for (let i = QUESTIONS_PER_BOSS - 1; i < pool.length; i += QUESTIONS_PER_BOSS) {
      bossIndices.add(i);
    }

    return { questions: pool, bossIndices };
  };

  const startQuiz = (mode: QuizMode) => {
    const { questions, bossIndices } = buildQuestionSet(mode);
    if (questions.length === 0) {
      alert('No questions match those filters. Try different topic/difficulty.');
      return;
    }
    
    setCurrentStreak(0);
    setLongestStreak(0);
    
    const lives = mode === 'lives' ? 3 : undefined;
    
    setSession({
      questions,
      currentIndex: 0,
      answers: new Array(questions.length).fill(null),
      showExplanation: false,
      timeStarted: mode === 'speed' ? Date.now() : undefined,
      lives,
      isBoss: bossIndices.has(0),
      bossHP: bossIndices.has(0) ? 10 : undefined,
    });
    setSessionStartTime(Date.now());
    setScreen('quiz');
  };

  const answer = (optionIdx: number) => {
    if (!session) return;
    if (session.answers[session.currentIndex] !== null) return;

    const q = session.questions[session.currentIndex];
    const correct = optionIdx === q.answerIndex;
    const updated = { ...session, answers: [...session.answers], showExplanation: true };
    updated.answers[updated.currentIndex] = optionIdx;

    // Boss battle: hit takes damage, miss = full damage
    if (updated.isBoss && updated.bossHP !== undefined) {
      if (correct) {
        updated.bossHP = Math.max(0, updated.bossHP - 3);
      } else {
        updated.bossHP = 0; // missed -> boss kills you instantly
      }
    }

    // Lives mode: lose a life on wrong answer
    if (!correct && updated.lives !== undefined) {
      updated.lives = updated.lives - 1;
    }

    setSession(updated);

    // Update streak
    if (correct) {
      const newStreak = currentStreak + 1;
      setCurrentStreak(newStreak);
      if (newStreak > longestStreak) {
        setLongestStreak(newStreak);
      }
    } else {
      setCurrentStreak(0);
    }

    // Update stats
    setStats((prev) => {
      const next: PersistentStats = { ...prev, perTopic: { ...prev.perTopic }, perQuestion: { ...prev.perQuestion } };
      next.totalAnswered += 1;
      if (correct) next.totalCorrect += 1;
      
      const topicStats = next.perTopic[q.topic] || { correct: 0, answered: 0 };
      next.perTopic[q.topic] = {
        correct: topicStats.correct + (correct ? 1 : 0),
        answered: topicStats.answered + 1,
      };
      
      const wasPreviouslyWrong = prev.perQuestion[q.id]?.correct === false;
      next.perQuestion[q.id] = { correct, lastSeen: Date.now() };
      
      // Comeback: previously wrong, now right
      if (correct && wasPreviouslyWrong) {
        next.comebacks = (next.comebacks || 0) + 1;
      }

      // Boss tracking
      if (updated.isBoss && correct) {
        next.bossesDefeated = (next.bossesDefeated || 0) + 1;
      }
      return next;
    });
  };

  // Speed mode timeout - if time runs out, count as wrong
  useEffect(() => {
    if (!session || !session.timeStarted || screen !== 'quiz') return;
    const q = session.questions[session.currentIndex];
    if (session.answers[session.currentIndex] !== null) return;
    
    // Just visual - we'll handle actual timeout in a separate hook
  }, [session?.currentIndex, session?.timeStarted]);

  // Speed mode timer (separate effect)
  useEffect(() => {
    if (!session?.timeStarted || screen !== 'quiz') return;
    if (session.answers[session.currentIndex] !== null) return;
    
    const SPEED_LIMIT_MS = 15000;
    const remaining = SPEED_LIMIT_MS - (Date.now() - session.timeStarted);
    
    if (remaining <= 0) {
      // Time's up! Auto-mark as wrong and advance
      const updated = { ...session, answers: [...session.answers], showExplanation: true };
      updated.answers[updated.currentIndex] = -1; // sentinel for timeout
      if (updated.isBoss && updated.bossHP !== undefined) {
        updated.bossHP = 0;
      }
      if (updated.lives !== undefined) {
        updated.lives = updated.lives - 1;
      }
      setSession(updated);
      setCurrentStreak(0);
      setStats((prev) => ({
        ...prev,
        perTopic: { ...prev.perTopic },
        perQuestion: { ...prev.perQuestion },
        totalAnswered: prev.totalAnswered + 1,
      }));
      return;
    }
    
    const t = setTimeout(() => { /* triggers re-render */ }, Math.min(remaining, 500));
    return () => clearTimeout(t);
  }, [session?.currentIndex, session?.answers, session?.timeStarted, screen]);

  const next = () => {
    if (!session) return;
    if (session.currentIndex === session.questions.length - 1) {
      finishQuiz();
      return;
    }
    const nextIdx = session.currentIndex + 1;
    const updated = { ...session, currentIndex: nextIdx, showExplanation: false };
    // Mark boss state on next question
    const bossEveryN = QUESTIONS_PER_BOSS;
    const isNextBoss = nextIdx > 0 && (nextIdx % bossEveryN === bossEveryN - 1);
    // Reset boss info
    updated.isBoss = isNextBoss;
    updated.bossHP = isNextBoss ? 10 : undefined;
    updated.timeStarted = updated.timeStarted ? Date.now() : undefined;
    setSession(updated);
  };

  const prev = () => {
    if (!session) return;
    const prevIdx = Math.max(0, session.currentIndex - 1);
    setSession({ ...session, currentIndex: prevIdx, showExplanation: session.answers[prevIdx] !== null });
  };

  const finishQuiz = useCallback(() => {
    if (!session) return;
    const correct = session.answers.reduce<number>((sum: number, a, i) => 
      sum + (a !== null && a === session.questions[i].answerIndex ? 1 : 0), 0);
    
    // Lives mode: if lives reached 0, score = 0 effectively  
    const survived = session.lives === undefined || (session.lives || 0) > 0;
    const finalCorrect: number = survived ? correct : 0;
    
    const result: SessionResult = {
      mode: currentMode || 'all',
      total: session.questions.length,
      correct: finalCorrect,
      accuracy: session.questions.length > 0 ? Math.round((finalCorrect / session.questions.length) * 100) : 0,
      longestStreak: longestStreak,
      survived,
    };
    setPendingResult(result);
    
    // Stats: increment attempts
    setStats((prev) => {
      const next = { ...prev, attempts: prev.attempts + 1 };
      checkAchievementsInResult(next, result);
      return next;
    });
    
    // Confetti on perfect or near-perfect
    if (result.accuracy === 100 && result.total >= 5) {
      fireConfetti();
    }
    
    setScreen('results');
  }, [session, longestStreak]);

  const checkAchievementsInResult = (currentStats: PersistentStats, result: SessionResult) => {
    const newlyUnlocked: Achievement[] = [];
    for (const ach of ACHIEVEMENTS) {
      if (unlocked.includes(ach.id)) continue;
      if (ach.condition(currentStats, result)) {
        newlyUnlocked.push(ach);
      }
    }
    if (newlyUnlocked.length > 0) {
      const newIds = newlyUnlocked.map(a => a.id);
      setUnlocked(prev => [...prev, ...newIds]);
      setToastQueue(prev => [...prev, ...newlyUnlocked]);
    }
  };

  const [currentMode, setCurrentMode] = useState<QuizMode | null>(null);
  
  const handleStart = (mode: QuizMode) => {
    setCurrentMode(mode);
    startQuiz(mode);
  };

  const reset = () => {
    if (!confirm('Reset all your progress and achievements?')) return;
    setStats({ ...DEFAULT_STATS });
    setUnlocked([]);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACHIEVEMENTS_KEY);
  };

  // Lives lost all → game over early
  useEffect(() => {
    if (session?.lives !== undefined && session.lives <= 0 && screen === 'quiz') {
      // Wait for them to see the explanation, then end
      if (session.showExplanation) {
        const t = setTimeout(finishQuiz, 1500);
        return () => clearTimeout(t);
      }
    }
  }, [session?.lives, session?.showExplanation, screen]);

  return (
    <div className="app-shell">
      {screen === 'home' && (
        <HomeScreen
          stats={stats}
          unlocked={unlocked}
          selectedTopic={selectedTopic}
          selectedDifficulty={selectedDifficulty}
          onTopicChange={setSelectedTopic}
          onDifficultyChange={setSelectedDifficulty}
          onStart={handleStart}
          onReset={reset}
          onAchievements={() => setScreen('achievements')}
        />
      )}
      {screen === 'quiz' && session && (
        <QuizScreen
          session={session}
          currentStreak={currentStreak}
          onAnswer={answer}
          onNext={next}
          onPrev={prev}
          onQuit={() => setScreen('home')}
        />
      )}
      {screen === 'results' && session && (
        <ResultsScreen
          session={session}
          result={pendingResult}
          onHome={() => setScreen('home')}
          onRetry={() => handleStart(currentMode || 'all')}
        />
      )}
      {screen === 'achievements' && (
        <AchievementsScreen
          stats={stats}
          unlocked={unlocked}
          onHome={() => setScreen('home')}
        />
      )}

      {toastQueue.length > 0 && (
        <div className="achievement-toast">
          <div className="achievement-toast-inner">
            <div className="achievement-icon-big">{toastQueue[0].icon}</div>
            <div>
              <div className="achievement-toast-label">Achievement Unlocked!</div>
              <div className="achievement-toast-name">{toastQueue[0].name}</div>
              <div className="achievement-toast-desc">{toastQueue[0].description}</div>
            </div>
            <button onClick={dismissToast} className="achievement-dismiss">×</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============== HOME SCREEN ==============

interface HomeScreenProps {
  stats: PersistentStats;
  unlocked: string[];
  selectedTopic: Topic | 'all';
  selectedDifficulty: Difficulty | 'all';
  onTopicChange: (t: Topic | 'all') => void;
  onDifficultyChange: (d: Difficulty | 'all') => void;
  onStart: (mode: QuizMode) => void;
  onReset: () => void;
  onAchievements: () => void;
}

function HomeScreen({ stats, unlocked, selectedTopic, selectedDifficulty, onTopicChange, onDifficultyChange, onStart, onReset, onAchievements }: HomeScreenProps) {
  const topics = Object.keys(TOPIC_LABELS) as Topic[];
  const overallAccuracy = stats.totalAnswered > 0
    ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100)
    : 0;

  const weakCount = QUESTIONS.filter((q) => stats.perQuestion[q.id]?.correct === false).length;

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <Shield size={28} color="#FF6B35" />
            <div>
              <h1>CPSA Practice</h1>
              <p className="subtitle">Penetration testing fundamentals</p>
            </div>
          </div>
          <div className="header-stats">
            <div className="stat-pill">
              <Trophy size={14} />
              <span>{overallAccuracy}%</span>
            </div>
            <div className="stat-pill">
              <Target size={14} />
              <span>{stats.totalAnswered}</span>
            </div>
            <button className="stat-pill achievement-link" onClick={onAchievements}>
              <Award size={14} />
              <span>{unlocked.length}/{ACHIEVEMENTS.length}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="home-main">
        <div className="welcome-card">
          <BookOpen size={32} color="#FF6B35" />
          <h2>Pick a quiz mode</h2>
          <p>{QUESTIONS.length} questions across {topics.length} topics</p>
        </div>

        <div className="mode-grid">
          <button className="mode-card primary" onClick={() => onStart('all')}>
            <Shuffle size={24} />
            <h3>Mixed Practice</h3>
            <p>Random selection from all topics</p>
          </button>

          <button className="mode-card" onClick={() => onStart('topic')} disabled={selectedTopic === 'all'}>
            <Filter size={24} />
            <h3>By Topic</h3>
            <p>{selectedTopic === 'all' ? 'Pick a topic below' : TOPIC_LABELS[selectedTopic]}</p>
          </button>

          <button className="mode-card" onClick={() => onStart('weak')} disabled={weakCount === 0}>
            <Target size={24} />
            <h3>Weak Spots</h3>
            <p>{weakCount === 0 ? 'No misses yet — nice' : `${weakCount} to revisit`}</p>
          </button>

          <button className="mode-card" onClick={() => onStart('missed')} disabled={weakCount === 0}>
            <RotateCcw size={24} />
            <h3>Missed Only</h3>
            <p>{weakCount === 0 ? 'No misses yet' : `${weakCount} questions`}</p>
          </button>

          <button className="mode-card highlight" onClick={() => onStart('speed')}>
            <Zap size={24} />
            <h3>Speed Run</h3>
            <p>15 sec per question — fast = bonus ✨</p>
          </button>

          <button className="mode-card highlight" onClick={() => onStart('lives')}>
            <Heart size={24} />
            <h3>Survival</h3>
            <p>3 lives, lose them all and you're out 💀</p>
          </button>
        </div>

        <div className="filter-section">
          <h3>Filter by topic</h3>
          <div className="topic-grid">
            <button
              className={`topic-chip ${selectedTopic === 'all' ? 'active' : ''}`}
              onClick={() => onTopicChange('all')}
            >
              All topics
            </button>
            {topics.map((t) => (
              <button
                key={t}
                className={`topic-chip ${selectedTopic === t ? 'active' : ''}`}
                onClick={() => onTopicChange(t)}
              >
                {TOPIC_LABELS[t]}
                <span className="topic-count">{QUESTIONS.filter((q) => q.topic === t).length}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="filter-section">
          <h3>Difficulty</h3>
          <div className="difficulty-row">
            {(['all', 'easy', 'medium', 'hard'] as const).map((d) => (
              <button
                key={d}
                className={`diff-chip ${selectedDifficulty === d ? 'active' : ''}`}
                style={selectedDifficulty === d && d !== 'all' ? { background: DIFFICULTY_COLORS[d as Difficulty] } : {}}
                onClick={() => onDifficultyChange(d)}
              >
                {d === 'all' ? 'All' : d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="danger-zone">
          <button onClick={onReset} className="reset-btn">
            <RotateCcw size={14} /> Reset progress
          </button>
        </div>
      </main>
    </div>
  );
}

// ============== QUIZ SCREEN ==============

interface QuizScreenProps {
  session: SessionState;
  currentStreak: number;
  onAnswer: (idx: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onQuit: () => void;
}

function QuizScreen({ session, currentStreak, onAnswer, onNext, onPrev, onQuit }: QuizScreenProps) {
  const q = session.questions[session.currentIndex];
  const selected = session.answers[session.currentIndex];
  const progress = ((session.currentIndex + 1) / session.questions.length) * 100;
  const [now, setNow] = useState(Date.now());
  
  // Speed mode: re-render every 500ms while unanswered
  useEffect(() => {
    if (!session.timeStarted || selected !== null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [session.timeStarted, selected, session.currentIndex]);

  let remainingMs = 0;
  if (session.timeStarted && selected === null) {
    remainingMs = Math.max(0, 15000 - (now - session.timeStarted));
  }
  const remainingSec = Math.ceil(remainingMs / 1000);

  return (
    <div className="app-container">
      <header className="app-header compact">
        <div className="header-inner">
          <button onClick={onQuit} className="quit-btn">
            <Home size={16} /> Quit
          </button>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="counter">
            {session.currentIndex + 1}/{session.questions.length}
          </div>
        </div>
      </header>

      <main className="quiz-main">
        <div className="quiz-meta-row">
          <div className="topic-badge" style={{ borderColor: DIFFICULTY_COLORS[q.difficulty] }}>
            <span>{TOPIC_LABELS[q.topic]}</span>
            <span className="difficulty-dot" style={{ background: DIFFICULTY_COLORS[q.difficulty] }}>
              {q.difficulty}
            </span>
          </div>
          
          {currentStreak >= 3 && (
            <div className="streak-badge">
              <Zap size={14} /> {currentStreak} streak
            </div>
          )}
          
          {session.lives !== undefined && (
            <div className="lives-display">
              {Array.from({ length: 3 }).map((_, i) => (
                <Heart
                  key={i}
                  size={18}
                  color={i < (session.lives || 0) ? '#FF6B35' : '#444'}
                  fill={i < (session.lives || 0) ? '#FF6B35' : 'none'}
                />
              ))}
            </div>
          )}
        </div>

        {session.isBoss && (
          <div className="boss-banner">
            <Skull size={20} />
            <div className="boss-banner-text">
              <strong>BOSS BATTLE</strong>
              <span>Defeat the boss to claim your prize</span>
            </div>
            <div className="boss-hp">
              <div className="boss-hp-label">HP</div>
              <div className="boss-hp-bar">
                <div className="boss-hp-fill" style={{ width: `${(session.bossHP || 0) * 10}%` }} />
              </div>
              <div className="boss-hp-num">{session.bossHP || 0}/10</div>
            </div>
          </div>
        )}

        {q.scenario && (
          <div className="scenario-card">
            <pre>{q.scenario}</pre>
          </div>
        )}

        <h2 className="question-text">{q.question}</h2>

        {session.timeStarted && selected === null && (
          <div className={`speed-timer ${remainingMs < 5000 ? 'speed-timer-low' : ''}`}>
            <Timer size={16} />
            <span>{remainingSec}s</span>
            <div className="speed-timer-bar">
              <div 
                className="speed-timer-fill" 
                style={{ width: `${Math.max(0, (remainingMs / 15000) * 100)}%` }} 
              />
            </div>
          </div>
        )}

        <div className="options">
          {q.options.map((opt, idx) => {
            let className = 'option';
            if (selected !== null) {
              if (idx === q.answerIndex) className += ' correct';
              else if (idx === selected) className += ' incorrect';
              else className += ' dimmed';
            }
            if (selected === -1 && idx === q.answerIndex) className += ' timed-out-correct';
            return (
              <button
                key={idx}
                className={className}
                onClick={() => onAnswer(idx)}
                disabled={selected !== null}
              >
                <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
                <span className="option-text">{opt}</span>
                {selected !== null && idx === q.answerIndex && (
                  <Check size={20} className="option-icon" />
                )}
                {selected !== null && idx === selected && idx !== q.answerIndex && (
                  <X size={20} className="option-icon" />
                )}
              </button>
            );
          })}
        </div>

        {selected === -1 && (
          <div className="explanation-card timed-out">
            <div className="explanation-header">
              <Clock size={20} /> Time's up! — answer was {String.fromCharCode(65 + q.answerIndex)}
            </div>
            <p>{q.explanation}</p>
          </div>
        )}

        {session.showExplanation && selected !== -1 && (
          <div className={`explanation-card ${selected === q.answerIndex ? 'correct' : 'incorrect'}`}>
            <div className="explanation-header">
              {selected === q.answerIndex ? (
                <><Check size={20} /> Correct!</>
              ) : (
                <><X size={20} /> Not quite — answer was {String.fromCharCode(65 + q.answerIndex)}</>
              )}
            </div>
            <p>{q.explanation}</p>
          </div>
        )}

        {session.lives !== undefined && (session.lives || 0) <= 0 && session.showExplanation && (
          <div className="game-over-banner">
            <Skull size={24} />
            <span>Game Over! All lives lost.</span>
          </div>
        )}

        <div className="nav-buttons">
          <button
            className="nav-btn secondary"
            onClick={onPrev}
            disabled={session.currentIndex === 0}
          >
            <ChevronLeft size={18} /> Previous
          </button>
          {session.showExplanation && (
            <button className="nav-btn primary" onClick={onNext}>
              {session.currentIndex === session.questions.length - 1 ? 'Finish' : 'Next'}
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

// ============== RESULTS SCREEN ==============

interface ResultsScreenProps {
  session: SessionState;
  result: SessionResult | null;
  onHome: () => void;
  onRetry: () => void;
}

function ResultsScreen({ session, result, onHome, onRetry }: ResultsScreenProps) {
  let localResult: SessionResult;
  if (result) {
    localResult = result;
  } else {
    const correct = session.answers.reduce<number>((sum: number, a, i) => 
      sum + (a !== null && a === session.questions[i].answerIndex ? 1 : 0), 0);
    localResult = {
      mode: 'all',
      total: session.questions.length,
      correct,
      accuracy: session.questions.length > 0 ? Math.round((correct / session.questions.length) * 100) : 0,
      longestStreak: 0,
    };
  }
  const finalResult = localResult;
  
  const isPerfect = finalResult.accuracy === 100 && finalResult.total >= 5;
  const isSurvivor = finalResult.mode === 'lives' && finalResult.survived && finalResult.total >= 5;
  
  return (
    <div className="app-container">
      <main className="results-main">
        <div className="results-card">
          {isPerfect && (
            <div className="results-perfect">
              <Trophy size={64} color="#FFD700" />
              <h1>Perfect Score!</h1>
            </div>
          )}
          {isSurvivor && !isPerfect && (
            <div className="results-survivor">
              <Skull size={48} color="#FF6B35" />
              <h1>Survivor!</h1>
              <p>You made it through with lives to spare 💪</p>
            </div>
          )}
          {!isPerfect && !isSurvivor && (
            <Trophy size={48} color="#FF6B35" />
          )}
          <h1>Session Complete</h1>
          <div className="big-stat">
            <span className="big-stat-num">{finalResult.correct}</span>
            <span className="big-stat-total">/{finalResult.total}</span>
          </div>
          <p className="results-subtitle">You got {finalResult.accuracy}% correct</p>
          
          <div className="results-stats">
            <div className="result-stat">
              <div className="result-stat-num">{finalResult.longestStreak}</div>
              <div className="result-stat-label">Best Streak</div>
            </div>
            <div className="result-stat">
              <div className="result-stat-num">{finalResult.total - finalResult.correct}</div>
              <div className="result-stat-label">Missed</div>
            </div>
          </div>
          
          {finalResult.longestStreak >= 5 && (
            <div className="streak-celebrate">
              <Zap size={16} /> {finalResult.longestStreak}-streak — feisty!
            </div>
          )}
          
          <div className="results-actions">
            <button className="nav-btn secondary" onClick={onHome}>
              <Home size={16} /> Home
            </button>
            <button className="nav-btn primary" onClick={onRetry}>
              <RotateCcw size={16} /> Try Again
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

// ============== ACHIEVEMENTS SCREEN ==============

interface AchievementsScreenProps {
  stats: PersistentStats;
  unlocked: string[];
  onHome: () => void;
}

function AchievementsScreen({ stats, unlocked, onHome }: AchievementsScreenProps) {
  const sorted = [...ACHIEVEMENTS].sort((a, b) => {
    const aU = unlocked.includes(a.id);
    const bU = unlocked.includes(b.id);
    if (aU !== bU) return aU ? -1 : 1; // unlocked first
    return 0;
  });
  
  return (
    <div className="app-container">
      <header className="app-header compact">
        <div className="header-inner">
          <button onClick={onHome} className="quit-btn">
            <Home size={16} /> Home
          </button>
          <h1 className="header-title">Achievements</h1>
          <div className="counter">
            {unlocked.length}/{ACHIEVEMENTS.length}
          </div>
        </div>
      </header>
      
      <main className="achievements-main">
        <div className="achievements-grid">
          {sorted.map((ach) => {
            const isUnlocked = unlocked.includes(ach.id);
            return (
              <div key={ach.id} className={`achievement-card ${isUnlocked ? 'unlocked' : 'locked'}`}>
                <div className="achievement-card-icon">
                  {isUnlocked ? ach.icon : '🔒'}
                </div>
                <div className="achievement-card-body">
                  <h3>{isUnlocked ? ach.name : '???'}</h3>
                  <p>{ach.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
