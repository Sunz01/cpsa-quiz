// CREST CPSA Practice Question Bank
// All questions written from scratch to cover the same topic areas as CPSA.
// Topic areas modeled after CREST's published syllabus:
//   - Network fundamentals (TCP/IP, routing, DNS, ARP, ICMP, IPv6)
//   - Network scanning (nmap flags, scan types, OS fingerprinting)
//   - OS internals (Windows + Linux files, processes, services)
//   - Application protocols (HTTP, DNS, SMTP, SMB, NetBIOS, SNMP, FTP)
//   - Web application security (XSS, SQLi, CSRF, auth)
//   - Cryptography basics (symmetric, asymmetric, hashing, WEP/WPA)
//   - Penetration testing methodology & legal/ethical
//   - Common vulnerabilities (buffer overflow, format string, race conditions)
//   - Wireless security (WEP, WPA, 802.11)
//   - Logging & forensics (syslog, Windows event logs)

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Topic =
  | 'nmap'
  | 'networking'
  | 'os-windows'
  | 'os-linux'
  | 'protocols'
  | 'web'
  | 'crypto'
  | 'wireless'
  | 'methodology'
  | 'exploitation'
  | 'logging';

export interface Question {
  id: string;
  topic: Topic;
  difficulty: Difficulty;
  question: string;
  options: string[]; // length 4 or 5
  answerIndex: number;
  explanation: string;
  // optional: scenario prompt before question
  scenario?: string;
}

export const TOPIC_LABELS: Record<Topic, string> = {
  'nmap': 'Nmap & Scanning',
  'networking': 'TCP/IP Networking',
  'os-windows': 'Windows Internals',
  'os-linux': 'Linux/Unix',
  'protocols': 'Application Protocols',
  'web': 'Web App Security',
  'crypto': 'Cryptography',
  'wireless': 'Wireless Security',
  'methodology': 'Pentest Methodology',
  'exploitation': 'Exploitation Concepts',
  'logging': 'Logging & Forensics',
};

export const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  easy: '#10B981',
  medium: '#F59E0B',
  hard: '#EF4444',
};
