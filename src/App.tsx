import { useState, useEffect, useMemo, useCallback } from 'react';
import { QUESTIONS } from './data/questions';
import type { Question, Topic, Difficulty } from './types/quiz';
import { TOPIC_LABELS, DIFFICULTY_COLORS } from './types/quiz';
import {
  Shield, ChevronRight, ChevronLeft, Check, X, RotateCcw,
  Trophy, Target, BookOpen, Filter, Shuffle, Home, BarChart3,
} from 'lucide-react';

type Screen = 'home' | 'quiz' | 'results';
type QuizMode = 'all' | 'topic' | 'weak' | 'missed';

interface SessionState {
  questions: Question[];
  currentIndex: number;
  answers: (number | null)[]; // selected option index per question
  showExplanation: boolean;
}

const STORAGE_KEY = 'cpsa-quiz-stats-v1';

interface PersistentStats {
  attempts: number;
  totalCorrect: number;
  totalAnswered: number;
  perTopic: Record<string, { correct: number; answered: number }>;
  perQuestion: Record<string, { correct: boolean; lastSeen: number }>;
}

const loadStats = (): PersistentStats => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    attempts: 0,
    totalCorrect: 0,
    totalAnswered: 0,
    perTopic: {},
    perQuestion: {},
  };
};

const saveStats = (stats: PersistentStats) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
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

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [stats, setStats] = useState<PersistentStats>(() => loadStats());
  const [selectedTopic, setSelectedTopic] = useState<Topic | 'all'>('all');
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | 'all'>('all');
  const [session, setSession] = useState<SessionState | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<number>(0);

  useEffect(() => { saveStats(stats); }, [stats]);

  // ============== QUIZ LOGIC ==============

  const buildQuestionSet = (mode: QuizMode): Question[] => {
    let pool = QUESTIONS.slice();
    if (mode === 'topic' && selectedTopic !== 'all') {
      pool = pool.filter((q) => q.topic === selectedTopic);
    }
    if (selectedDifficulty !== 'all') {
      pool = pool.filter((q) => q.difficulty === selectedDifficulty);
    }
    if (mode === 'weak') {
      // Questions answered wrong before, prioritized
      const wrong = pool.filter((q) => stats.perQuestion[q.id]?.correct === false);
      const other = pool.filter((q) => stats.perQuestion[q.id]?.correct !== false);
      return shuffleArray([...shuffleArray(wrong), ...shuffleArray(other)]);
    }
    if (mode === 'missed') {
      pool = pool.filter((q) => stats.perQuestion[q.id]?.correct === false);
    }
    return shuffleArray(pool);
  };

  const startQuiz = (mode: QuizMode) => {
    const set = buildQuestionSet(mode);
    if (set.length === 0) {
      alert('No questions match those filters. Try different topic/difficulty.');
      return;
    }
    setSession({
      questions: set,
      currentIndex: 0,
      answers: new Array(set.length).fill(null),
      showExplanation: false,
    });
    setSessionStartTime(Date.now());
    setScreen('quiz');
  };

  const answer = (optionIdx: number) => {
    if (!session) return;
    if (session.answers[session.currentIndex] !== null) return; // already answered

    const updated = { ...session, answers: [...session.answers] };
    updated.answers[updated.currentIndex] = optionIdx;
    updated.showExplanation = true;
    setSession(updated);

    // Update persistent stats
    const q = session.questions[session.currentIndex];
    const correct = optionIdx === q.answerIndex;
    setStats((prev) => ({
      ...prev,
      perQuestion: {
        ...prev.perQuestion,
        [q.id]: { correct, lastSeen: Date.now() },
      },
      perTopic: {
        ...prev.perTopic,
        [q.topic]: {
          correct: (prev.perTopic[q.topic]?.correct || 0) + (correct ? 1 : 0),
          answered: (prev.perTopic[q.topic]?.answered || 0) + 1,
        },
      },
    }));
  };

  const next = () => {
    if (!session) return;
    if (session.currentIndex < session.questions.length - 1) {
      setSession({
        ...session,
        currentIndex: session.currentIndex + 1,
        showExplanation: false,
      });
    } else {
      finishQuiz();
    }
  };

  const prev = () => {
    if (!session) return;
    if (session.currentIndex > 0) {
      setSession({
        ...session,
        currentIndex: session.currentIndex - 1,
        showExplanation: false,
      });
    }
  };

  const finishQuiz = () => {
    if (!session) return;
    const correct: number = session.answers.reduce<number>((acc, ans, idx) => {
      return acc + (ans === session.questions[idx].answerIndex ? 1 : 0);
    }, 0);
    setStats((prev) => ({
      ...prev,
      attempts: prev.attempts + 1,
      totalCorrect: prev.totalCorrect + correct,
      totalAnswered: prev.totalAnswered + session.answers.length,
    }));
    setScreen('results');
  };

  const review = (qIdx: number) => {
    if (!session) return;
    setSession({
      ...session,
      currentIndex: qIdx,
      showExplanation: true,
    });
    setScreen('quiz');
  };

  const resetAll = () => {
    if (!confirm('Reset all stats and progress?')) return;
    setStats({
      attempts: 0,
      totalCorrect: 0,
      totalAnswered: 0,
      perTopic: {},
      perQuestion: {},
    });
  };

  // ============== SCREENS ==============

  if (screen === 'home') {
    return (
      <HomeScreen
        stats={stats}
        selectedTopic={selectedTopic}
        selectedDifficulty={selectedDifficulty}
        onTopicChange={setSelectedTopic}
        onDifficultyChange={setSelectedDifficulty}
        onStart={startQuiz}
        onReset={resetAll}
      />
    );
  }

  if (screen === 'quiz' && session) {
    return (
      <QuizScreen
        session={session}
        onAnswer={answer}
        onNext={next}
        onPrev={prev}
        onQuit={() => setScreen('home')}
      />
    );
  }

  if (screen === 'results' && session) {
    const correct: number = session.answers.reduce<number>(
      (acc, ans, idx) => acc + (ans === session.questions[idx].answerIndex ? 1 : 0),
      0,
    );
    return (
      <ResultsScreen
        session={session}
        correct={correct}
        elapsedMs={Date.now() - sessionStartTime}
        onHome={() => setScreen('home')}
        onRetry={() => startQuiz('all')}
        onReview={(idx) => review(idx)}
      />
    );
  }

  // Fallback
  return <HomeScreen
    stats={stats}
    selectedTopic={selectedTopic}
    selectedDifficulty={selectedDifficulty}
    onTopicChange={setSelectedTopic}
    onDifficultyChange={setSelectedDifficulty}
    onStart={startQuiz}
    onReset={resetAll}
  />;
}

// ============== HOME SCREEN ==============

interface HomeScreenProps {
  stats: PersistentStats;
  selectedTopic: Topic | 'all';
  selectedDifficulty: Difficulty | 'all';
  onTopicChange: (t: Topic | 'all') => void;
  onDifficultyChange: (d: Difficulty | 'all') => void;
  onStart: (mode: QuizMode) => void;
  onReset: () => void;
}

function HomeScreen({ stats, selectedTopic, selectedDifficulty, onTopicChange, onDifficultyChange, onStart, onReset }: HomeScreenProps) {
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
  onAnswer: (idx: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onQuit: () => void;
}

function QuizScreen({ session, onAnswer, onNext, onPrev, onQuit }: QuizScreenProps) {
  const q = session.questions[session.currentIndex];
  const selected = session.answers[session.currentIndex];
  const progress = ((session.currentIndex + 1) / session.questions.length) * 100;

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
        <div className="topic-badge" style={{ borderColor: DIFFICULTY_COLORS[q.difficulty] }}>
          <span>{TOPIC_LABELS[q.topic]}</span>
          <span className="difficulty-dot" style={{ background: DIFFICULTY_COLORS[q.difficulty] }}>
            {q.difficulty}
          </span>
        </div>

        {q.scenario && (
          <div className="scenario-card">
            <pre>{q.scenario}</pre>
          </div>
        )}

        <h2 className="question-text">{q.question}</h2>

        <div className="options">
          {q.options.map((opt, idx) => {
            let className = 'option';
            if (selected !== null) {
              if (idx === q.answerIndex) className += ' correct';
              else if (idx === selected) className += ' incorrect';
              else className += ' dimmed';
            }
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

        {session.showExplanation && (
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
  correct: number;
  elapsedMs: number;
  onHome: () => void;
  onRetry: () => void;
  onReview: (idx: number) => void;
}

function ResultsScreen({ session, correct, elapsedMs, onHome, onRetry, onReview }: ResultsScreenProps) {
  const total = session.questions.length;
  const pct = Math.round((correct / total) * 100);
  const elapsedSec = Math.round(elapsedMs / 1000);
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;

  let message = '';
  let emoji = '';
  if (pct >= 90) { message = 'Outstanding!'; emoji = '🏆'; }
  else if (pct >= 75) { message = 'Solid work!'; emoji = '🔥'; }
  else if (pct >= 60) { message = 'Good progress.'; emoji = '💪'; }
  else if (pct >= 40) { message = 'Keep practicing.'; emoji = '📚'; }
  else { message = 'Lots to learn — and that\'s okay!'; emoji = '🌱'; }

  return (
    <div className="app-container">
      <header className="app-header compact">
        <div className="header-inner">
          <button onClick={onHome} className="quit-btn">
            <Home size={16} /> Home
          </button>
          <div className="progress-bar"><div className="progress-fill" style={{ width: '100%' }} /></div>
          <div className="counter">{total}/{total}</div>
        </div>
      </header>

      <main className="results-main">
        <div className="results-hero">
          <div className="results-emoji">{emoji}</div>
          <h1>{message}</h1>
          <div className="score-display">
            <div className="score-big">{pct}%</div>
            <div className="score-detail">{correct} of {total} correct</div>
            <div className="score-detail">{minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}</div>
          </div>
        </div>

        <div className="review-list">
          <h3><BarChart3 size={18} /> Review your answers</h3>
          {session.questions.map((q, idx) => {
            const ans = session.answers[idx];
            const isCorrect = ans === q.answerIndex;
            return (
              <button
                key={q.id}
                className={`review-item ${isCorrect ? 'correct' : 'incorrect'}`}
                onClick={() => onReview(idx)}
              >
                <div className="review-num">{idx + 1}</div>
                <div className="review-body">
                  <p className="review-q">{q.question}</p>
                  <p className="review-meta">
                    {TOPIC_LABELS[q.topic]} · {q.difficulty}
                    {!isCorrect && ans !== null && (
                      <span className="wrong-answer"> · You: {String.fromCharCode(65 + ans!)}</span>
                    )}
                    {!isCorrect && (
                      <span className="right-answer"> · Correct: {String.fromCharCode(65 + q.answerIndex)}</span>
                    )}
                  </p>
                </div>
                <div className="review-icon">
                  {isCorrect ? <Check size={20} color="#10B981" /> : <X size={20} color="#EF4444" />}
                </div>
              </button>
            );
          })}
        </div>

        <div className="results-actions">
          <button className="nav-btn secondary" onClick={onHome}>
            <Home size={18} /> Home
          </button>
          <button className="nav-btn primary" onClick={onRetry}>
            <RotateCcw size={18} /> Try Again
          </button>
        </div>
      </main>
    </div>
  );
}
