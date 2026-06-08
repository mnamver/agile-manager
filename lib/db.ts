import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'planning.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
    seedIfEmpty(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT    NOT NULL,
      description  TEXT,
      status       TEXT    DEFAULT 'active',
      team_size    INTEGER DEFAULT 0,
      target_date  TEXT,
      jira_key     TEXT,
      board_id     INTEGER,
      ai_generated INTEGER DEFAULT 0,
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      role       TEXT    DEFAULT 'Developer'
    );

    CREATE TABLE IF NOT EXISTS project_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      content    TEXT    NOT NULL,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      epics        TEXT,
      sprint_plan  TEXT,
      risks        TEXT,
      dod_criteria TEXT,
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jira_issues_cache (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      jira_id     TEXT,
      summary     TEXT,
      status      TEXT,
      assignee    TEXT,
      priority    TEXT    DEFAULT 'Medium',
      issue_type  TEXT    DEFAULT 'Task',
      fetched_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id        INTEGER NOT NULL REFERENCES jira_issues_cache(id) ON DELETE CASCADE,
      project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      type            TEXT DEFAULT 'Task',
      assigned_to     TEXT,
      estimated_hours REAL,
      status          TEXT DEFAULT 'todo',
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_reports (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      summary    TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sprint_tasks (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      no                   TEXT    NOT NULL,
      backlog_giris_tarihi TEXT,
      sprint_no            INTEGER,
      sprint_baslangic     TEXT,
      sprint_bitis         TEXT,
      tamamlanma_tarihi    TEXT,
      blok_nedeni          TEXT,
      ict_buyukluk         TEXT,
      ict_sp               INTEGER,
      description          TEXT,
      imported_at          TEXT    DEFAULT (datetime('now'))
    );
  `);

  // Migrations — mevcut DB'ye yeni kolonları ekle
  const cols = (db.prepare(`PRAGMA table_info(projects)`).all() as {name:string}[]).map(c=>c.name);
  if (!cols.includes('board_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN board_id INTEGER`);
  }
  const sprintTaskCols = (db.prepare(`PRAGMA table_info(sprint_tasks)`).all() as {name:string}[]).map(c=>c.name);
  if (!sprintTaskCols.includes('blok_nedeni')) {
    db.exec(`ALTER TABLE sprint_tasks ADD COLUMN blok_nedeni TEXT`);
  }
  if (!sprintTaskCols.includes('ict_buyukluk')) {
    db.exec(`ALTER TABLE sprint_tasks ADD COLUMN ict_buyukluk TEXT`);
  }
  if (!sprintTaskCols.includes('ict_sp')) {
    db.exec(`ALTER TABLE sprint_tasks ADD COLUMN ict_sp INTEGER`);
  }
  if (!sprintTaskCols.includes('description')) {
    db.exec(`ALTER TABLE sprint_tasks ADD COLUMN description TEXT`);
  }

  const issueCols = (db.prepare(`PRAGMA table_info(jira_issues_cache)`).all() as {name:string}[]).map(c=>c.name);
  if (!issueCols.includes('issue_type')) {
    db.exec(`ALTER TABLE jira_issues_cache ADD COLUMN issue_type TEXT DEFAULT 'Task'`);
  }
  if (!issueCols.includes('story_points')) {
    db.exec(`ALTER TABLE jira_issues_cache ADD COLUMN story_points INTEGER`);
  }
}

function seedIfEmpty(db: Database.Database) {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
  if (count > 0) return;

  const insertProject = db.prepare(`
    INSERT INTO projects (title, description, status, team_size, target_date, jira_key, ai_generated)
    VALUES (@title, @description, @status, @team_size, @target_date, @jira_key, @ai_generated)
  `);
  const insertMember = db.prepare(`
    INSERT INTO team_members (project_id, name, role) VALUES (@project_id, @name, @role)
  `);
  const insertNote = db.prepare(`
    INSERT INTO project_notes (project_id, content) VALUES (@project_id, @content)
  `);
  const insertJiraCache = db.prepare(`
    INSERT INTO jira_issues_cache (project_id, jira_id, summary, status, assignee, priority)
    VALUES (@project_id, @jira_id, @summary, @status, @assignee, @priority)
  `);

  const projects = [
    {
      title: 'Mobile Payment Infrastructure Renewal',
      description: 'Mobil ödeme altyapısının yenilenmesi ve PCI DSS uyumluluğunun sağlanması. Legacy sistemden modern microservice mimarisine geçiş.',
      status: 'active', team_size: 6, target_date: '2024-06-30', jira_key: 'MPI', ai_generated: 1,
      members: [
        { name: 'Ahmet Yılmaz', role: 'Tech Lead' }, { name: 'Fatma Kaya', role: 'Backend' },
        { name: 'Mehmet Demir', role: 'Backend' }, { name: 'Ayşe Çelik', role: 'Frontend' },
        { name: 'Emre Şahin', role: 'QA' }, { name: 'Elif Arslan', role: 'Backend' },
      ],
      notes: ['PCI DSS Level 1 sertifikası Mayıs\'a kadar alınmalı.', 'Garanti Bankası entegrasyonu için API dökümantasyonu istendi.'],
      issues: [
        { jira_id: 'MPI-142', summary: 'Payment gateway timeout hatası üretimde tekrarlıyor', status: 'In Progress', assignee: 'Fatma Kaya', priority: 'High' },
        { jira_id: 'MPI-139', summary: 'Refund akışında double charge riski tespit edildi', status: 'Open', assignee: 'Mehmet Demir', priority: 'Critical' },
        { jira_id: 'MPI-135', summary: 'Tokenizasyon servisi load test başarısız', status: 'In Progress', assignee: 'Ahmet Yılmaz', priority: 'High' },
        { jira_id: 'MPI-128', summary: '3DS v2 entegrasyonu tamamlanmadı', status: 'Open', assignee: 'Elif Arslan', priority: 'Medium' },
        { jira_id: 'MPI-120', summary: 'Transaction logları GDPR uyumlu hale getirilmeli', status: 'Open', assignee: 'Emre Şahin', priority: 'Medium' },
      ],
    },
    {
      title: '5G Network Monitoring Dashboard',
      description: '5G baz istasyonu performans metriklerinin gerçek zamanlı izlenmesi ve anomali tespiti.',
      status: 'active', team_size: 4, target_date: '2024-04-15', jira_key: 'NMD', ai_generated: 0,
      members: [
        { name: 'Burak Öztürk', role: 'Tech Lead' }, { name: 'Selin Yıldız', role: 'Frontend' },
        { name: 'Can Aydın', role: 'Backend' }, { name: 'Zeynep Kılıç', role: 'QA' },
      ],
      notes: ['İstanbul Anadolu yakası pilot 23 Mart\'ta başlıyor.'],
      issues: [
        { jira_id: 'NMD-88', summary: 'Websocket bağlantı kopması 100+ concurrent user sonrası', status: 'In Progress', assignee: 'Can Aydın', priority: 'High' },
        { jira_id: 'NMD-85', summary: 'Harita üzerinde baz istasyonu cluster görünümü', status: 'Open', assignee: 'Selin Yıldız', priority: 'Medium' },
        { jira_id: 'NMD-79', summary: 'Alert threshold konfigürasyonu UI eksik', status: 'Open', assignee: 'Selin Yıldız', priority: 'Low' },
      ],
    },
    {
      title: 'Customer Self-Service Portal',
      description: 'Müşterilerin fatura, tarife değişikliği ve teknik destek işlemlerini self-servis yapabilmesi için web ve mobil portal.',
      status: 'at_risk', team_size: 8, target_date: '2024-03-31', jira_key: 'CSS', ai_generated: 0,
      members: [
        { name: 'Hasan Koç', role: 'Tech Lead' }, { name: 'Merve Aksoy', role: 'Frontend' },
        { name: 'Ali Güler', role: 'Frontend' }, { name: 'Nur Erdoğan', role: 'Backend' },
        { name: 'Oğuz Çetin', role: 'Backend' }, { name: 'Pınar Doğan', role: 'QA' },
        { name: 'Tarık Kara', role: 'Backend' }, { name: 'Ümit Yalçın', role: 'DevOps' },
      ],
      notes: ['⚠️ Deadline riski: Frontend 2 sprint geride. Ek kaynak talep edildi.', 'CRM entegrasyonu SOAP→REST geçişi beklenenden uzun sürdü.'],
      issues: [
        { jira_id: 'CSS-201', summary: 'Fatura PDF indirme iOS Safari\'de çalışmıyor', status: 'Open', assignee: 'Merve Aksoy', priority: 'High' },
        { jira_id: 'CSS-198', summary: 'Tarife değişikliği onay e-postası gönderilmiyor', status: 'In Progress', assignee: 'Nur Erdoğan', priority: 'Critical' },
        { jira_id: 'CSS-195', summary: 'Accessibility (WCAG 2.1 AA) eksiklikleri', status: 'Open', assignee: 'Ali Güler', priority: 'Medium' },
        { jira_id: 'CSS-190', summary: 'Session timeout sonrası form verisi kaybı', status: 'Open', assignee: 'Oğuz Çetin', priority: 'High' },
        { jira_id: 'CSS-185', summary: 'CRM senkronizasyonu gecikme 45 sn üzerine çıkıyor', status: 'In Progress', assignee: 'Tarık Kara', priority: 'High' },
      ],
    },
    {
      title: 'AI-Powered Customer Support Bot',
      description: 'LLM tabanlı müşteri destek chatbotu. 7/24 otomatik çözüm, canlı destek\'e akıllı yönlendirme.',
      status: 'active', team_size: 5, target_date: '2024-05-30', jira_key: 'AIB', ai_generated: 1,
      members: [
        { name: 'Deniz Sarı', role: 'Tech Lead' }, { name: 'Gül Arslan', role: 'Backend' },
        { name: 'İbrahim Koç', role: 'ML Engineer' }, { name: 'Jale Yıldırım', role: 'Frontend' },
        { name: 'Kemal Özer', role: 'QA' },
      ],
      notes: ['GPT-4o ile Llama3 70B karşılaştırma testi yapıldı. GPT-4o seçildi.'],
      issues: [
        { jira_id: 'AIB-67', summary: 'Bot Türkçe argot ve argo ifadeleri anlayamıyor', status: 'In Progress', assignee: 'İbrahim Koç', priority: 'High' },
        { jira_id: 'AIB-64', summary: 'Handoff trigger doğruluğu %72\'de, hedef %90', status: 'Open', assignee: 'İbrahim Koç', priority: 'High' },
        { jira_id: 'AIB-60', summary: 'Konuşma geçmişi 4k token sınırını aşıyor', status: 'Open', assignee: 'Gül Arslan', priority: 'Medium' },
      ],
    },
    {
      title: 'API Gateway Modernization',
      description: 'Legacy SOAP servislerinin REST ve GraphQL mimarisine taşınması. 200+ endpoint\'in modernizasyonu.',
      status: 'active', team_size: 7, target_date: '2024-07-31', jira_key: 'AGM', ai_generated: 0,
      members: [
        { name: 'Onur Demirci', role: 'Tech Lead' }, { name: 'Pelin Güneş', role: 'Backend' },
        { name: 'Rıza Toprak', role: 'Backend' }, { name: 'Sedef Kaya', role: 'Backend' },
        { name: 'Tolga Aydın', role: 'QA' }, { name: 'Ufuk Yıldız', role: 'Backend' },
        { name: 'Vildan Şahin', role: 'DevOps' },
      ],
      notes: ['Phase 1 (billing servisleri) tamamlandı. Phase 2 başlıyor.'],
      issues: [
        { jira_id: 'AGM-155', summary: 'Rate limiting konfigürasyonu prod\'a yansıtılmadı', status: 'Open', assignee: 'Onur Demirci', priority: 'High' },
        { jira_id: 'AGM-150', summary: 'OpenAPI spec oluşturma otomasyonu kurulmalı', status: 'In Progress', assignee: 'Pelin Güneş', priority: 'Medium' },
      ],
    },
    {
      title: 'Digital Identity Verification System',
      description: 'e-Devlet entegrasyonlu dijital kimlik doğrulama ve eKYC süreçleri. NFC bazlı kimlik okuma.',
      status: 'at_risk', team_size: 5, target_date: '2024-03-20', jira_key: 'DIV', ai_generated: 0,
      members: [
        { name: 'Yusuf Özdemir', role: 'Tech Lead' }, { name: 'Zehra Kılıç', role: 'Backend' },
        { name: 'Adnan Polat', role: 'Backend' }, { name: 'Bahar Çelik', role: 'QA' },
        { name: 'Cem Yılmaz', role: 'Frontend' },
      ],
      notes: ['⚠️ BTK onayı hala bekleniyor. 1 haftalık gecikme.'],
      issues: [
        { jira_id: 'DIV-93', summary: 'e-Devlet API sandbox erişimi kesildi', status: 'Open', assignee: 'Zehra Kılıç', priority: 'Critical' },
        { jira_id: 'DIV-89', summary: 'NFC okuma Samsung cihazlarda başarısız', status: 'In Progress', assignee: 'Cem Yılmaz', priority: 'High' },
        { jira_id: 'DIV-85', summary: 'OCR doğruluğu eski kimlik kartlarında düşük', status: 'Open', assignee: 'Adnan Polat', priority: 'Medium' },
      ],
    },
    {
      title: 'Smart Home IoT Integration',
      description: 'Turkcell Superbox ile akıllı ev cihazlarının Matter protokolü üzerinden entegrasyonu.',
      status: 'active', team_size: 4, target_date: '2024-08-31', jira_key: 'IOT', ai_generated: 1,
      members: [
        { name: 'Dila Arslan', role: 'Tech Lead' }, { name: 'Emir Kaya', role: 'Embedded' },
        { name: 'Figen Demir', role: 'Frontend' }, { name: 'Görkem Şen', role: 'QA' },
      ],
      notes: ['Matter 1.3 spec finalleşti, geçiş yapılacak.'],
      issues: [
        { jira_id: 'IOT-44', summary: 'Zigbee cihaz keşfi 30 saniyeyi aşıyor', status: 'In Progress', assignee: 'Emir Kaya', priority: 'Medium' },
        { jira_id: 'IOT-40', summary: 'Amazon Alexa skill entegrasyonu', status: 'Open', assignee: 'Dila Arslan', priority: 'Low' },
      ],
    },
    {
      title: 'Data Lake & Analytics Pipeline',
      description: 'Müşteri davranış verilerinin merkezi Snowflake data lake altyapısına taşınması ve real-time analytics.',
      status: 'active', team_size: 6, target_date: '2024-09-30', jira_key: 'DLA', ai_generated: 0,
      members: [
        { name: 'Haluk Çetin', role: 'Tech Lead' }, { name: 'İnci Yıldız', role: 'Data Engineer' },
        { name: 'Jülide Kara', role: 'Data Engineer' }, { name: 'Koray Güler', role: 'QA' },
        { name: 'Lale Öztürk', role: 'Data Engineer' }, { name: 'Mert Aksoy', role: 'Frontend' },
      ],
      notes: ['Kafka cluster kurulumu tamamlandı. Flink job\'ları yazılıyor.'],
      issues: [
        { jira_id: 'DLA-78', summary: 'CDC pipeline Oracle\'dan Kafka\'ya gecikiyor (avg 8sn)', status: 'In Progress', assignee: 'İnci Yıldız', priority: 'High' },
        { jira_id: 'DLA-74', summary: 'PII maskeleme pipeline\'a entegre edilmeli', status: 'Open', assignee: 'Jülide Kara', priority: 'High' },
      ],
    },
    {
      title: 'TV+ Content Recommendation Engine',
      description: 'AI tabanlı kişiselleştirilmiş içerik öneri motoru. Collaborative filtering + LLM hibrit yaklaşım.',
      status: 'active', team_size: 5, target_date: '2024-06-15', jira_key: 'CRE', ai_generated: 1,
      members: [
        { name: 'Nazan Erdoğan', role: 'Tech Lead' }, { name: 'Ozan Yılmaz', role: 'ML Engineer' },
        { name: 'Perihan Koç', role: 'Backend' }, { name: 'Rüya Çelik', role: 'Frontend' },
        { name: 'Selim Arslan', role: 'QA' },
      ],
      notes: ['A/B test: Öneri motoru CTR\'ı %23 artırdı.'],
      issues: [
        { jira_id: 'CRE-56', summary: 'Cold start problemi yeni kullanıcılarda öneri kalitesi düşük', status: 'In Progress', assignee: 'Ozan Yılmaz', priority: 'High' },
        { jira_id: 'CRE-52', summary: 'Model inference süresi 200ms hedefi aşılıyor', status: 'Open', assignee: 'Perihan Koç', priority: 'Medium' },
      ],
    },
    {
      title: 'Internal HR Automation Platform',
      description: 'İzin, bordro ve performans değerlendirme süreçlerinin otomasyonu. SAP entegrasyonu.',
      status: 'done', team_size: 3, target_date: '2024-01-15', jira_key: 'HRP', ai_generated: 0,
      members: [
        { name: 'Leyla Şen', role: 'Tech Lead' }, { name: 'Murat Acar', role: 'Backend' },
        { name: 'Nil Çelik', role: 'Frontend' },
      ],
      notes: ['✅ Tüm 4200 çalışan platforma geçiş yaptı. Başarılı!'],
      issues: [],
    },
  ];

  const insertAll = db.transaction(() => {
    for (const p of projects) {
      const res = insertProject.run({
        title: p.title, description: p.description, status: p.status,
        team_size: p.team_size, target_date: p.target_date,
        jira_key: p.jira_key, ai_generated: p.ai_generated,
      });
      const pid = res.lastInsertRowid;
      for (const m of p.members) insertMember.run({ project_id: pid, name: m.name, role: m.role });
      for (const n of p.notes) insertNote.run({ project_id: pid, content: n });
      for (const i of p.issues) insertJiraCache.run({ project_id: pid, ...i });
    }
  });

  insertAll();
}

export type Project = {
  id: number;
  title: string;
  description: string | null;
  status: 'active' | 'at_risk' | 'done';
  team_size: number;
  target_date: string | null;
  jira_key: string | null;
  board_id: number | null;
  ai_generated: number;
  created_at: string;
  open_issues?: number;
};

export type TeamMember = {
  id: number;
  project_id: number;
  name: string;
  role: string;
};

export type ProjectNote = {
  id: number;
  project_id: number;
  content: string;
  created_at: string;
};

export type JiraIssue = {
  id: number;
  project_id: number;
  jira_id: string;
  summary: string;
  status: string;
  assignee: string;
  priority: string;
  issue_type: string;
  story_points: number | null;
  fetched_at: string;
};

export type Subtask = {
  id: number;
  issue_id: number;
  project_id: number;
  title: string;
  type: string;
  assigned_to: string | null;
  estimated_hours: number | null;
  status: string;
  created_at: string;
};

export type AiReport = {
  id: number;
  project_id: number;
  summary: string;
  created_at: string;
};

export type SprintTask = {
  id: number;
  project_id: number;
  no: string;
  backlog_giris_tarihi: string | null;
  sprint_no: number | null;
  sprint_baslangic: string | null;
  sprint_bitis: string | null;
  tamamlanma_tarihi: string | null;
  blok_nedeni: string | null;
  ict_buyukluk: string | null;
  ict_sp: number | null;
  description: string | null;
  imported_at: string;
};
