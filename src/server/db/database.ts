import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_MIGRATIONS_SQL } from './migrations';
import { hashPassword } from '../domain/rules';
import { storePrivateObject } from '../storage/storageAdapter';

const DB_PATH = path.resolve(
  process.cwd(),
  process.env.DATABASE_PATH || './data/recruitment_messenger.db'
);

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_MIGRATIONS_SQL);
  ensureAdditiveMigrations(db);

  dbInstance = db;
  seedInitialData(db);
  seedSampleComplaintsIfEmpty(db);
  return db;
}

function ensureAdditiveMigrations(db: Database.Database): void {
  const convCols = db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>;
  if (!convCols.some((c) => c.name === 'thread_type')) {
    db.exec(
      `ALTER TABLE conversations ADD COLUMN thread_type TEXT NOT NULL DEFAULT 'candidate_recruiter'`
    );
  }
}

function seedSampleComplaintsIfEmpty(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) as count FROM complaints').get() as { count: number };
  if (existing.count > 0) return;

  const candExists = db.prepare('SELECT id FROM users WHERE id = ?').get('usr_cand_1');
  const recExists = db.prepare('SELECT id FROM users WHERE id = ?').get('usr_rec_1');
  if (!candExists || !recExists) return;

  db.prepare(
    `INSERT INTO complaints (
      id, candidate_id, recruiter_id, category, priority, subject, description,
      status, visible_to_recruiter, team_lead_response, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now', '-3 hours'), datetime('now', '-2 hours'))`
  ).run(
    'cmp_1',
    'usr_cand_1',
    'usr_rec_1',
    'scheduling',
    'normal',
    'Short notice on technical interview reschedule',
    'I received a same-day reschedule request for the Crestline FinTech round with less than two hours notice. Requesting at least 24 hours notice for upcoming client technical panels.',
    'in_review',
    'Reviewed with Marcus Vance. We have added a 24-hour advance notice requirement on your upcoming Vanguard Capital Tech panel.'
  );
}

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(baseDateStr: string, days: number): string {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function createSamplePdfBuffer(title: string, lines: string[]): Buffer {
  // Minimal valid single-page PDF document for realistic private resume downloads
  const safeLines = [title, ...lines].map((l) =>
    l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  );
  const textOps = safeLines
    .map((line, i) => `BT /F1 ${i === 0 ? 15 : 11} Tf 54 ${740 - i * 22} Td (${line}) Tj ET`)
    .join('\n');

  const objects: string[] = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${Buffer.byteLength(textOps, 'utf8')} >> stream\n${textOps}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${obj}\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function seedInitialData(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (existing.count > 0) return;

  const today = getTodayDateString();
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const threeDays = addDays(today, 3);
  const yesterday = addDays(today, -1);

  const defaultPassHash = hashPassword(process.env.ADMIN_PASSCODE?.trim() || 'RecruitSafe!2026');

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, password_hash, role, full_name, phone, avatar_url, timezone, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', ?))
  `);

  const seedTx = db.transaction(() => {
    // 1. Team Lead
    insertUser.run(
      'usr_lead_1',
      'sarah.jenkins@benchbridge.io',
      defaultPassHash,
      'team_lead',
      'Sarah Jenkins',
      '+1 (469) 555-0101',
      '/src/assets/images/avatar_team_lead_1795291910622.jpg',
      'America/Chicago',
      '-45 days'
    );

    // 2. Recruiters
    insertUser.run(
      'usr_rec_1',
      'marcus.vance@benchbridge.io',
      defaultPassHash,
      'recruiter',
      'Marcus Vance',
      '+1 (469) 555-0142',
      '/src/assets/images/avatar_recruiter_a_1795291904416.jpg',
      'America/New_York',
      '-38 days'
    );
    insertUser.run(
      'usr_rec_2',
      'priya.nair@benchbridge.io',
      defaultPassHash,
      'recruiter',
      'Priya Nair',
      '+1 (408) 555-0188',
      '/src/assets/images/avatar_recruiter_b_1795291906065.jpg',
      'America/Los_Angeles',
      '-32 days'
    );

    const insertRecruiterProfile = db.prepare(`
      INSERT INTO recruiter_profiles (user_id, title, department, location, bio)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertRecruiterProfile.run(
      'usr_rec_1',
      'Senior Bench Sales Recruiter',
      'Cloud & Backend Practice',
      'New York, NY',
      'Specializes in senior Java, Go, and AWS cloud architecture placements for Fortune 500 financial clients.'
    );
    insertRecruiterProfile.run(
      'usr_rec_2',
      'Lead Technical Recruiter',
      'DevOps, Data & Frontend Practice',
      'San Jose, CA',
      'Focuses on Kubernetes, Snowflake data engineering, and React staff-level contract engagements.'
    );

    // 3. Candidates
    insertUser.run(
      'usr_cand_1',
      'arjun.mehta@cloudtalent.io',
      defaultPassHash,
      'candidate',
      'Arjun Mehta',
      '+1 (732) 555-0194',
      '/src/assets/images/avatar_candidate_a_1795291907619.jpg',
      'America/New_York',
      '-21 days'
    );
    insertUser.run(
      'usr_cand_2',
      'elena.rostova@cloudtalent.io',
      defaultPassHash,
      'candidate',
      'Elena Rostova',
      '+1 (512) 555-0177',
      '/src/assets/images/avatar_candidate_b_1795291907911.jpg',
      'America/Chicago',
      '-18 days'
    );
    insertUser.run(
      'usr_cand_3',
      'devon.brooks@cloudtalent.io',
      defaultPassHash,
      'candidate',
      'Devon Brooks',
      '+1 (206) 555-0123',
      '',
      'America/Los_Angeles',
      '-14 days'
    );
    insertUser.run(
      'usr_cand_4',
      'kavya.reddy@cloudtalent.io',
      defaultPassHash,
      'candidate',
      'Kavya Reddy',
      '+1 (303) 555-0165',
      '',
      'America/Denver',
      '-11 days'
    );
    insertUser.run(
      'usr_cand_5',
      'carlos.mendez@cloudtalent.io',
      defaultPassHash,
      'candidate',
      'Carlos Mendez',
      '+1 (404) 555-0151',
      '',
      'America/New_York',
      '-9 days'
    );

    const insertCandProfile = db.prepare(`
      INSERT INTO candidate_profiles (user_id, location, technology, experience_years, visa_status, hourly_rate, availability_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertCandProfile.run(
      'usr_cand_1',
      'Edison, NJ',
      'Java, Spring Boot, AWS, Kafka',
      9.5,
      'H-1B',
      '$88/hr C2C',
      'Available for technical rounds today'
    );
    insertCandProfile.run(
      'usr_cand_2',
      'Austin, TX',
      'Kubernetes, Terraform, AWS, CI/CD',
      8.0,
      'Green Card',
      '$95/hr C2C',
      'Available Mon–Fri CST'
    );
    insertCandProfile.run(
      'usr_cand_3',
      'Seattle, WA',
      'React, TypeScript, Next.js, GraphQL',
      7.0,
      'US Citizen',
      '$92/hr W2',
      'Available mornings PST'
    );
    insertCandProfile.run(
      'usr_cand_4',
      'Denver, CO',
      'Snowflake, Python, dbt, Spark',
      6.5,
      'H4-EAD',
      '$82/hr C2C',
      'Available afternoon MST'
    );
    insertCandProfile.run(
      'usr_cand_5',
      'Atlanta, GA',
      'SAP S/4HANA, FICO, ABAP',
      11.0,
      'US Citizen',
      '$105/hr C2C',
      'Unavailable today — client transition'
    );

    // Default notification preferences for all users
    const insertPref = db.prepare(`
      INSERT INTO notification_preferences (user_id, browser_push, email_alerts, message_alerts, interview_alerts, availability_alerts, call_alerts)
      VALUES (?, 1, 1, 1, 1, 1, 1)
    `);
    ['usr_lead_1', 'usr_rec_1', 'usr_rec_2', 'usr_cand_1', 'usr_cand_2', 'usr_cand_3', 'usr_cand_4', 'usr_cand_5'].forEach(
      (id) => insertPref.run(id)
    );

    // 4. Assignments (including one historical reassignment for audit demo)
    const insertAssign = db.prepare(`
      INSERT INTO assignments (id, candidate_id, recruiter_id, is_active, assigned_by, reason, assigned_at, unassigned_at)
      VALUES (?, ?, ?, ?, 'usr_lead_1', ?, datetime('now', ?), ?)
    `);
    insertAssign.run('asg_hist_1', 'usr_cand_2', 'usr_rec_1', 0, 'Initial onboarding assignment', '-18 days', new Date(Date.now() - 10 * 86400_000).toISOString());
    insertAssign.run('asg_1', 'usr_cand_1', 'usr_rec_1', 1, 'Backend Java & AWS bench alignment', '-21 days', null);
    insertAssign.run('asg_2', 'usr_cand_2', 'usr_rec_2', 1, 'Aligned with DevOps practice lead', '-10 days', null);
    insertAssign.run('asg_3', 'usr_cand_3', 'usr_rec_2', 1, 'Frontend & TypeScript client pipeline', '-14 days', null);
    insertAssign.run('asg_4', 'usr_cand_4', 'usr_rec_1', 1, 'Data engineering client demand', '-11 days', null);
    insertAssign.run('asg_5', 'usr_cand_5', 'usr_rec_1', 1, 'Enterprise SAP account coverage', '-9 days', null);

    // 5. Conversations
    const insertConv = db.prepare(`
      INSERT INTO conversations (id, candidate_id, recruiter_id, is_active, last_message_at, created_at)
      VALUES (?, ?, ?, 1, datetime('now', ?), datetime('now', ?))
    `);
    insertConv.run('conv_1', 'usr_cand_1', 'usr_rec_1', '-12 minutes', '-21 days');
    insertConv.run('conv_2', 'usr_cand_2', 'usr_rec_2', '-38 minutes', '-10 days');
    insertConv.run('conv_3', 'usr_cand_3', 'usr_rec_2', '-3 hours', '-14 days');
    insertConv.run('conv_4', 'usr_cand_4', 'usr_rec_1', '-1 day', '-11 days');
    insertConv.run('conv_5', 'usr_cand_5', 'usr_rec_1', '-2 days', '-9 days');

    // 6. Private Attachments + real stored PDFs
    const arjunPdf = createSamplePdfBuffer('Arjun Mehta — Senior Java & AWS Cloud Architect', [
      'Location: Edison, NJ  |  Work Authorization: H-1B  |  Experience: 9.5 Years',
      'Core Skills: Java 21, Spring Boot, Apache Kafka, AWS EKS, Microservices, PostgreSQL',
      'Recent Engagement: Principal Backend Engineer — Meridian Financial Services (2023–2026)',
      'Led event-driven payment settlement platform processing 18,000 TPS at 99.99% uptime.',
      'Education: B.Tech Computer Science — Verified Candidate Document',
    ]);
    storePrivateObject('att_resume_arjun_v3.pdf', arjunPdf);

    const elenaPdf = createSamplePdfBuffer('Elena Rostova — Lead DevOps & Kubernetes Engineer', [
      'Location: Austin, TX  |  Work Authorization: Green Card  |  Experience: 8.0 Years',
      'Core Skills: Kubernetes, Terraform, AWS, GitHub Actions, Prometheus, Istio',
      'Recent Engagement: Staff Platform Engineer — Northstar Health Cloud (2022–2026)',
      'Designed multi-region EKS infrastructure with SOC 2 automated compliance checks.',
    ]);
    storePrivateObject('att_resume_elena_v2.pdf', elenaPdf);

    const devonPdf = createSamplePdfBuffer('Devon Brooks — Staff React & TypeScript Engineer', [
      'Location: Seattle, WA  |  Work Authorization: US Citizen  |  Experience: 7.0 Years',
      'Core Skills: React 19, TypeScript, Next.js, GraphQL, Design Systems, WebSockets',
      'Recent Engagement: Senior Frontend Architect — Cascade Commerce (2023–2026)',
    ]);
    storePrivateObject('att_resume_devon_v1.pdf', devonPdf);

    const insertAtt = db.prepare(`
      INSERT INTO attachments (id, candidate_id, uploaded_by, storage_key, original_name, mime_type, size_bytes, category, version_label, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, 'verified', datetime('now', ?))
    `);
    insertAtt.run('att_1', 'usr_cand_1', 'usr_cand_1', 'att_resume_arjun_v3.pdf', 'Arjun_Mehta_Java_AWS_Resume_v3.pdf', arjunPdf.length, 'resume', 'v3 (Current)', '-4 days');
    insertAtt.run('att_2', 'usr_cand_2', 'usr_cand_2', 'att_resume_elena_v2.pdf', 'Elena_Rostova_DevOps_Resume_v2.pdf', elenaPdf.length, 'resume', 'v2 (Current)', '-6 days');
    insertAtt.run('att_3', 'usr_cand_3', 'usr_cand_3', 'att_resume_devon_v1.pdf', 'Devon_Brooks_Frontend_Resume.pdf', devonPdf.length, 'resume', 'v1 (Current)', '-9 days');

    // 7. Messages
    const insertMsg = db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, message_type, body, attachment_id, reply_to_id, reactions_json, delivered_at, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ?, datetime('now', ?))
    `);
    insertMsg.run(
      'msg_1', 'conv_1', 'usr_rec_1', 'text',
      'Hi Arjun, Vanguard Capital reviewed your updated Spring Boot + Kafka profile and wants to schedule a 45-minute technical round tomorrow.',
      null, null, '{"👍":["usr_cand_1"]}', '-2 hours', new Date(Date.now() - 110 * 60_000).toISOString(), '-2 hours'
    );
    insertMsg.run(
      'msg_2', 'conv_1', 'usr_cand_1', 'document',
      'Thanks Marcus! I also attached my latest v3 resume highlighting the Kafka throughput benchmarks.',
      'att_1', 'msg_1', '{}', '-95 minutes', new Date(Date.now() - 80 * 60_000).toISOString(), '-95 minutes'
    );
    insertMsg.run(
      'msg_3', 'conv_1', 'usr_rec_1', 'text',
      'Got it — I sent over the interview request for tomorrow at 10:30 AM ET. Please confirm once you check your calendar.',
      null, null, '{}', '-12 minutes', null, '-12 minutes'
    );

    insertMsg.run(
      'msg_4', 'conv_2', 'usr_rec_2', 'text',
      'Elena, Apex Cloud Systems loved your Kubernetes multi-region background. Are you open for a final panel on Thursday afternoon CST?',
      null, null, '{}', '-1 hour', new Date(Date.now() - 50 * 60_000).toISOString(), '-1 hour'
    );
    insertMsg.run(
      'msg_5', 'conv_2', 'usr_cand_2', 'text',
      'Yes Priya, Thursday between 1:00 PM and 4:00 PM CST works well. I updated my availability calendar just now.',
      null, 'msg_4', '{"✅":["usr_rec_2"]}', '-38 minutes', null, '-38 minutes'
    );

    insertMsg.run(
      'msg_6', 'conv_3', 'usr_cand_3', 'text',
      'Hi Priya, confirming I am available for React/TypeScript screening calls tomorrow morning PT.',
      null, null, '{}', '-3 hours', null, '-3 hours'
    );

    insertMsg.run(
      'msg_7', 'conv_4', 'usr_rec_1', 'text',
      'Hi Kavya, checking if your Snowflake + dbt portfolio deck is ready before we schedule the Horizon Retail screen.',
      null, null, '{}', '-1 day', new Date(Date.now() - 20 * 3600_000).toISOString(), '-1 day'
    );

    // 8. Weekly Availability Rules (Mon-Fri defaults + Sat/Sun unavailable)
    const insertRule = db.prepare(`
      INSERT INTO availability_rules (id, candidate_id, day_of_week, is_available, slots_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const weekdayStandard = JSON.stringify([
      { start: '09:00', end: '12:00' },
      { start: '14:00', end: '17:30' },
    ]);
    const weekdayMorning = JSON.stringify([{ start: '09:00', end: '12:30' }]);
    const weekdayAfternoon = JSON.stringify([{ start: '13:00', end: '17:00' }]);

    const candidateList = [
      { id: 'usr_cand_1', slots: weekdayStandard },
      { id: 'usr_cand_2', slots: weekdayStandard },
      { id: 'usr_cand_3', slots: weekdayMorning },
      { id: 'usr_cand_4', slots: weekdayAfternoon },
      { id: 'usr_cand_5', slots: weekdayStandard },
    ];

    for (const c of candidateList) {
      for (let dow = 0; dow <= 6; dow++) {
        // Make Sat(6) available for Arjun & Elena if today happens to be Saturday so "Available Today" has rich data
        const isWeekend = dow === 0 || dow === 6;
        const avail = !isWeekend ? 1 : (c.id === 'usr_cand_1' || c.id === 'usr_cand_2') && dow === 6 ? 1 : 0;
        const slots = avail ? c.slots : '[]';
        insertRule.run(`rule_${c.id}_${dow}`, c.id, dow, avail, slots);
      }
    }

    // 9. Daily Availability Exceptions (override examples)
    const insertExc = db.prepare(`
      INSERT INTO availability_exceptions (id, candidate_id, exception_date, is_unavailable, slots_json, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertExc.run(
      'exc_1',
      'usr_cand_1',
      today,
      0,
      JSON.stringify([
        { start: '10:00', end: '13:00' },
        { start: '15:00', end: '18:00' },
      ]),
      'Available for Interview Today'
    );
    insertExc.run(
      'exc_2',
      'usr_cand_5',
      today,
      1,
      '[]',
      'Final handoff with previous project — unavailable today'
    );
    insertExc.run(
      'exc_3',
      'usr_cand_2',
      tomorrow,
      0,
      JSON.stringify([{ start: '13:00', end: '16:30' }]),
      'Afternoon interview window only'
    );

    // 10. Interviews
    const insertInterview = db.prepare(`
      INSERT INTO interviews (id, candidate_id, recruiter_id, company_name, job_position, start_utc, end_utc, timezone, interview_type, meeting_link, instructions, status, outcome, feedback)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertInterview.run(
      'iv_1',
      'usr_cand_1',
      'usr_rec_1',
      'Vanguard Capital Tech',
      'Senior Java / Kafka Architect',
      `${tomorrow}T15:30:00.000Z`,
      `${tomorrow}T16:15:00.000Z`,
      'America/New_York',
      'video',
      'https://meet.example.com/vanguard-java-round1',
      'Expect live system design on high-throughput Kafka partitioning and Spring Boot resilience.',
      'requested',
      '',
      ''
    );
    insertInterview.run(
      'iv_2',
      'usr_cand_2',
      'usr_rec_2',
      'Apex Cloud Systems',
      'Staff Kubernetes Platform Engineer',
      `${dayAfter}T19:00:00.000Z`,
      `${dayAfter}T20:00:00.000Z`,
      'America/Chicago',
      'video',
      'https://meet.example.com/apex-k8s-panel',
      'Panel with VP of Infrastructure and Principal SRE. Screen-share Terraform architecture diagram.',
      'confirmed',
      '',
      ''
    );
    insertInterview.run(
      'iv_3',
      'usr_cand_3',
      'usr_rec_2',
      'Northwind Digital',
      'Lead React / TypeScript Engineer',
      `${threeDays}T17:00:00.000Z`,
      `${threeDays}T17:45:00.000Z`,
      'America/Los_Angeles',
      'phone',
      '',
      'Hiring manager intro call covering TypeScript architecture and design system ownership.',
      'confirmed',
      '',
      ''
    );
    insertInterview.run(
      'iv_4',
      'usr_cand_1',
      'usr_rec_1',
      'Crestline FinTech',
      'Principal Backend Engineer',
      `${yesterday}T16:00:00.000Z`,
      `${yesterday}T16:45:00.000Z`,
      'America/New_York',
      'video',
      'https://meet.example.com/crestline-tech',
      'Completed technical screening.',
      'completed',
      'Advanced to Final Round',
      'Strong distributed systems depth; client requested references.'
    );

    // 11. Internal Recruiter Notes (STRICTLY PRIVATE — NEVER VISIBLE TO CANDIDATES)
    const insertNote = db.prepare(`
      INSERT INTO internal_notes (id, candidate_id, author_id, content, created_at)
      VALUES (?, ?, ?, ?, datetime('now', ?))
    `);
    insertNote.run(
      'note_1',
      'usr_cand_1',
      'usr_rec_1',
      'Floor rate confirmed internally at $85/hr C2C; target client submission at $96/hr. H-1B transfer paperwork verified.',
      '-3 days'
    );
    insertNote.run(
      'note_2',
      'usr_cand_1',
      'usr_lead_1',
      'Priority bench placement for Q4 financial accounts. Follow up immediately after Vanguard technical screen.',
      '-1 day'
    );
    insertNote.run(
      'note_3',
      'usr_cand_2',
      'usr_rec_2',
      'Strong communication skills; prefers Austin hybrid or 100% remote DevOps roles.',
      '-5 days'
    );

    // 12. Calls History
    const insertCall = db.prepare(`
      INSERT INTO calls (id, conversation_id, caller_id, callee_id, call_type, status, started_at, ended_at, duration_sec, outcome)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), ?, ?)
    `);
    insertCall.run(
      'call_1', 'conv_1', 'usr_rec_1', 'usr_cand_1', 'audio', 'ended',
      '-1 day', '-1 day', 482, 'Pre-interview prep completed'
    );
    insertCall.run(
      'call_2', 'conv_2', 'usr_cand_2', 'usr_rec_2', 'video', 'ended',
      '-2 days', '-2 days', 735, 'Reviewed Apex panel expectations'
    );
    insertCall.run(
      'call_3', 'conv_4', 'usr_cand_4', 'usr_rec_1', 'audio', 'missed',
      '-4 hours', '-4 hours', 0, 'Missed call — callback pending'
    );

    // 13. Notifications
    const insertNotif = db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body, link_tab, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `);
    insertNotif.run(
      'notif_1', 'usr_cand_1', 'interview_request',
      'New Interview Request: Vanguard Capital Tech',
      'Marcus Vance scheduled a Video interview for Senior Java / Kafka Architect.',
      'interviews', 0, '-12 minutes'
    );
    insertNotif.run(
      'notif_2', 'usr_rec_1', 'missed_call',
      'Missed Audio Call from Kavya Reddy',
      'Kavya Reddy tried reaching you 4 hours ago.',
      'calls', 0, '-4 hours'
    );
    insertNotif.run(
      'notif_3', 'usr_rec_2', 'availability_change',
      'Availability Updated: Elena Rostova',
      'Elena added a custom afternoon window for tomorrow (CST).',
      'availability', 0, '-38 minutes'
    );
    insertNotif.run(
      'notif_4', 'usr_lead_1', 'assignment',
      'Assignment Record Verified',
      'Elena Rostova reassigned from Marcus Vance to Priya Nair with full audit history.',
      'assignments', 1, '-10 days'
    );

    // 14. Recruiter Reminders
    const insertReminder = db.prepare(`
      INSERT INTO reminders (id, user_id, candidate_id, title, due_at, is_completed)
      VALUES (?, ?, ?, ?, ?, 0)
    `);
    insertReminder.run(
      'rem_1', 'usr_rec_1', 'usr_cand_1',
      'Send Vanguard Capital interview prep checklist to Arjun Mehta',
      `${tomorrow}T14:00:00.000Z`
    );
    insertReminder.run(
      'rem_2', 'usr_rec_1', 'usr_cand_4',
      'Return Kavya Reddy missed call regarding Horizon Retail',
      `${today}T22:00:00.000Z`
    );
    insertReminder.run(
      'rem_3', 'usr_rec_2', 'usr_cand_2',
      'Confirm panel meeting link with Apex Cloud Systems',
      `${dayAfter}T16:00:00.000Z`
    );

    // 15. Audit Logs
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details_json, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '127.0.0.1', datetime('now', ?))
    `);
    insertAudit.run(
      'aud_1', 'usr_lead_1', 'candidate.reassigned', 'assignment', 'asg_2',
      JSON.stringify({ candidate: 'Elena Rostova', fromRecruiter: 'Marcus Vance', toRecruiter: 'Priya Nair', reason: 'Aligned with DevOps practice lead' }),
      '-10 days'
    );
    insertAudit.run(
      'aud_2', 'usr_cand_1', 'file.uploaded', 'attachment', 'att_1',
      JSON.stringify({ filename: 'Arjun_Mehta_Java_AWS_Resume_v3.pdf', category: 'resume' }),
      '-4 days'
    );
    insertAudit.run(
      'aud_3', 'usr_rec_1', 'interview.created', 'interview', 'iv_1',
      JSON.stringify({ candidate: 'Arjun Mehta', company: 'Vanguard Capital Tech', type: 'video' }),
      '-12 minutes'
    );
  });

  seedTx();
}

export function getActiveAssignedRecruiterId(db: Database.Database, candidateId: string): string | null {
  const row = db
    .prepare('SELECT recruiter_id FROM assignments WHERE candidate_id = ? AND is_active = 1 LIMIT 1')
    .get(candidateId) as { recruiter_id: string } | undefined;
  return row?.recruiter_id ?? null;
}

export function writeAuditLog(
  db: Database.Database,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
  ipAddress = ''
): void {
  const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, actorId, action, entityType, entityId, JSON.stringify(details), ipAddress);
}

export function createNotification(
  db: Database.Database,
  userId: string,
  type: string,
  title: string,
  body: string,
  linkTab = 'dashboard'
) {
  const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, link_tab)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, type, title, body, linkTab);
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
}
