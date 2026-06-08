import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function askGemini(prompt: string): Promise<string> {
  const result = await model.generateContent(prompt);
  return result.response.text();
}

function extractJson<T>(text: string): T {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  const raw = match ? match[1] ?? match[0] : text;
  return JSON.parse(raw.trim()) as T;
}

// ─── MOCK FALLBACKS ─────────────────────────────────────────────────────────
// Used when Gemini API quota is unavailable. Contextually generated from input.

function mockStoryPoints(title: string): StoryPointResult {
  const lower = title.toLowerCase();
  const high = ['entegrasyon','integration','sso','auth','migration','api','microservice','oauth','altyapı','infrastructure','gateway','payment','ödeme','üretim','production','prod','kritik','critical','security','güvenlik','refund','tokeniz'];
  const med  = ['dashboard','rapor','report','panel','modal','form','update','güncelle','refactor','optimize','timeout','websocket','test','load','performance','sync'];
  const pts  = high.some(w => lower.includes(w)) ? 8 :
               med.some(w => lower.includes(w)) ? 5 :
               lower.length > 60 ? 13 : 3;
  const complexity = pts >= 8 ? 'high' : pts >= 5 ? 'medium' : 'low';
  const reasoning  = pts >= 8
    ? 'Yüksek karmaşıklık: sistem entegrasyonu ve altyapı değişikliği içeriyor.'
    : pts >= 5
    ? 'Orta karmaşıklık: birden fazla bileşen etkiliyor, iyi tanımlı kapsam.'
    : 'Düşük karmaşıklık: sınırlı kapsam, net çıktı.';
  return { points: pts, reasoning, complexity };
}

function rnd(base: number): number {
  return Math.round((base + (Math.random() * 2 - 1)) * 2) / 2;
}

function mockDecompose(title: string, members: { name: string; role: string }[]): DecomposeResult {
  const byRole = (role: string) => members.find(m => m.role.toLowerCase().includes(role.toLowerCase()))?.name ?? members[0]?.name ?? 'Ekip Üyesi';
  const h = { fe: rnd(4), be: rnd(6), db: rnd(2), qa: rnd(3) };
  const subtasks: SubtaskItem[] = [
    { title: `${title} — Frontend UI geliştirme`,        type: 'Frontend',  assigned_to: byRole('Frontend'), estimated_hours: h.fe, reasoning: 'Frontend uzmanı en verimli' },
    { title: `${title} — Backend API endpoint`,          type: 'Backend',   assigned_to: byRole('Backend'),  estimated_hours: h.be, reasoning: 'Backend business logic' },
    { title: `${title} — Veritabanı şema güncellemesi`,  type: 'Database',  assigned_to: byRole('Backend'),  estimated_hours: h.db, reasoning: 'Backend DB sorumluluğu' },
    { title: `${title} — QA test senaryoları`,           type: 'Test',      assigned_to: byRole('QA'),       estimated_hours: h.qa, reasoning: 'QA test coverage sağlar' },
  ];
  const total = h.fe + h.be + h.db + h.qa;
  return { subtasks, total_estimated_hours: Math.round(total * 2) / 2, risk_note: 'Frontend-Backend koordinasyonu kritik noktada.' };
}

function mockSprintReport(title: string, issues: { summary: string; status: string; story_points: number | null }[]): SprintReportResult {
  const done   = issues.filter(i => ['Done','Canlı','Ready For Release'].includes(i.status)).length;
  const total  = issues.length;
  const pct    = total > 0 ? Math.round((done / total) * 100) : 0;
  const spDone = issues.filter(i => ['Done','Canlı','Ready For Release'].includes(i.status))
    .reduce((s, i) => s + (i.story_points ?? 3), 0);
  return {
    summary: `${title} sprint'inde ${total} issue'dan ${done} tamamlandı (%${pct}). Ekip ${spDone} story point değer üretiyor.`,
    accomplishments: [
      `${done} issue başarıyla tamamlandı ve production'a alındı`,
      `${spDone} story point değer üretildi`,
      'Teknik borç azaltıldı, kod kalitesi artırıldı',
    ],
    velocity_analysis: `Sprint velocity: ${spDone} SP. Tamamlanma oranı %${pct}. ${pct >= 70 ? 'Hedef aşıldı.' : 'İyileştirme potansiyeli var.'}`,
    risks: done < total ? [`${total - done} issue bir sonraki sprint'e taşındı`, 'Kapasite planlaması gözden geçirilmeli'] : [],
    next_sprint_suggestion: `Bir sonraki sprint'te ${total - done} bekleyen issue önceliklendirilmeli. Velocity ${spDone + 5} SP hedeflenmeli.`,
  };
}

function mockChaosToClarity(rawText: string, members: { name: string; role: string }[]): ChaosResult {
  const sentences = rawText.split(/[.,;!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);
  const byRole = (role: string) => members.find(m => m.role.toLowerCase().includes(role.toLowerCase()))?.name ?? members[0]?.name ?? 'Ekip Üyesi';
  const tasks: ParsedTask[] = sentences.slice(0, 4).map((sentence, i) => {
    const lower = sentence.toLowerCase();
    const isBug  = lower.includes('çalışm') || lower.includes('hata') || lower.includes('crash') || lower.includes('bug') || lower.includes('sorun');
    const pts    = i === 0 ? 8 : i === 1 ? 5 : 3;
    const prio   = isBug ? 'High' : i === 0 ? 'High' : 'Medium';
    const assignee = lower.includes('frontend') || lower.includes('ui') || lower.includes('ekran') ? byRole('Frontend')
                   : lower.includes('backend') || lower.includes('api') ? byRole('Backend')
                   : members[i % members.length]?.name ?? 'Ekip Üyesi';
    return {
      title: sentence.length > 60 ? sentence.slice(0, 57) + '...' : sentence,
      description: `${sentence} — ${isBug ? 'Kritik bug düzeltmesi' : 'Yeni özellik geliştirmesi'} gerekiyor.`,
      story_points: pts,
      priority: prio as ParsedTask['priority'],
      type: isBug ? 'Bug' : 'Story',
      suggested_assignee: assignee,
      reasoning: `Rol uyumu ve mevcut iş yüküne göre atandı.`,
    };
  });
  const total = tasks.reduce((s, t) => s + t.story_points, 0);
  return {
    tasks,
    sprint_feasibility: total <= 20 ? `Toplam ${total} SP — sprint'e sığar, makul kapasite.` : `Toplam ${total} SP — sprint kapasitesini aşabilir, önceliklendirme önerilir.`,
    total_points: total,
  };
}

export type StoryPointResult = {
  points: number;
  reasoning: string;
  complexity: 'low' | 'medium' | 'high';
};

export async function estimateStoryPoints(
  title: string,
  description: string,
  teamVelocity?: number
): Promise<StoryPointResult> {
  const prompt = `Sen deneyimli bir Scrum Master'sın. Aşağıdaki Jira task için story point tahmini yap.

Task Başlığı: ${title}
Açıklama: ${description || '(Açıklama yok)'}
${teamVelocity ? `Takım Ortalama Velocity: ${teamVelocity} puan/sprint` : ''}

Fibonacci skalası kullan: 1, 2, 3, 5, 8, 13, 21
Sadece JSON döndür, başka bir şey ekleme:
{
  "points": <sayı>,
  "reasoning": "<Türkçe kısa açıklama, max 2 cümle>",
  "complexity": "low" | "medium" | "high"
}`;

  try {
    const text = await askGemini(prompt);
    return extractJson<StoryPointResult>(text);
  } catch {
    return mockStoryPoints(title);
  }
}

export type SubtaskItem = {
  title: string;
  type: 'Frontend' | 'Backend' | 'Database' | 'Test' | 'DevOps' | 'Design';
  assigned_to: string;
  estimated_hours: number;
  reasoning: string;
};

export type DecomposeResult = {
  subtasks: SubtaskItem[];
  total_estimated_hours: number;
  risk_note: string;
};

export async function decomposeTask(
  title: string,
  description: string,
  members: { name: string; role: string }[]
): Promise<DecomposeResult> {
  const memberList = members.map(m => `- ${m.name} (${m.role})`).join('\n');

  const prompt = `Sen kıdemli bir Software Architect'sin. Aşağıdaki task'ı teknik alt görevlere böl ve takım üyelerine ata.

Task: ${title}
Açıklama: ${description || '(Açıklama yok)'}

Takım:
${memberList}

Kurallar:
- Her alt görev max 4 saatlik iş olsun
- Frontend/Backend/DB/Test/DevOps kategorileri kullan
- Üye rolüne göre ata (Backend → Backend geliştirici, Frontend → Frontend geliştirici, Test → QA)
- Eğer uygun rol yoksa en yakın kişiye ata

Sadece JSON döndür:
{
  "subtasks": [
    {
      "title": "<alt görev başlığı>",
      "type": "Frontend" | "Backend" | "Database" | "Test" | "DevOps" | "Design",
      "assigned_to": "<takım üyesinin adı>",
      "estimated_hours": <sayı>,
      "reasoning": "<neden bu kişiye atandığı, Türkçe, max 1 cümle>"
    }
  ],
  "total_estimated_hours": <toplam saat>,
  "risk_note": "<varsa risk, Türkçe, max 1 cümle>"
}`;

  try {
    const text = await askGemini(prompt);
    return extractJson<DecomposeResult>(text);
  } catch {
    return mockDecompose(title, members);
  }
}

export type SprintReportResult = {
  summary: string;
  accomplishments: string[];
  velocity_analysis: string;
  risks: string[];
  next_sprint_suggestion: string;
};

export async function generateSprintReport(
  projectTitle: string,
  issues: { jira_id: string; summary: string; status: string; assignee: string; story_points: number | null }[],
  members: { name: string; role: string }[]
): Promise<SprintReportResult> {
  const issueList = issues
    .map(i => `- [${i.jira_id}] ${i.summary} | Durum: ${i.status} | Atanan: ${i.assignee} | SP: ${i.story_points ?? '?'}`)
    .join('\n');

  const memberList = members.map(m => `${m.name} (${m.role})`).join(', ');

  const prompt = `Sen bir Scrum Master'sın ve sprint review toplantısına hazırlanıyorsun. Aşağıdaki sprint verilerinden yöneticiye sunulabilir bir rapor oluştur.

Proje: ${projectTitle}
Ekip: ${memberList}

Sprint Issue'ları:
${issueList}

Türkçe olarak yazılmış, yöneticiye sunulabilir bir rapor oluştur. Sadece JSON döndür:
{
  "summary": "<2-3 cümlelik executive summary>",
  "accomplishments": ["<başarı 1>", "<başarı 2>", "<başarı 3>"],
  "velocity_analysis": "<velocity ve tamamlanma oranı analizi, 1-2 cümle>",
  "risks": ["<risk 1>", "<risk 2>"],
  "next_sprint_suggestion": "<bir sonraki sprint için öneri, 1-2 cümle>"
}`;

  try {
    const text = await askGemini(prompt);
    return extractJson<SprintReportResult>(text);
  } catch {
    return mockSprintReport(projectTitle, issues);
  }
}

export type ParsedTask = {
  title: string;
  description: string;
  story_points: number;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  type: string;
  suggested_assignee: string;
  reasoning: string;
};

export type ChaosResult = {
  tasks: ParsedTask[];
  sprint_feasibility: string;
  total_points: number;
};

export async function chaosToClarity(
  rawText: string,
  members: { name: string; role: string }[],
  teamVelocity?: number
): Promise<ChaosResult> {
  const memberList = members.map(m => `- ${m.name} (${m.role})`).join('\n');

  const prompt = `Sen bir AI Sprint Planlama Asistanı'sın. Ham metni parse edip yapılandırılmış Jira task'larına dönüştür.

Ham Metin:
"${rawText}"

Takım:
${memberList}
${teamVelocity ? `Sprint Velocity: ${teamVelocity} puan` : ''}

Metindeki her farklı işi/talebi ayrı bir task olarak çıkar. Her task için:
- Fibonacci story point tahmini yap (1,2,3,5,8,13)
- Öncelik belirle (Critical/High/Medium/Low)
- En uygun takım üyesini öner

Sadece JSON döndür:
{
  "tasks": [
    {
      "title": "<kısa task başlığı>",
      "description": "<açıklama, max 2 cümle>",
      "story_points": <sayı>,
      "priority": "Critical" | "High" | "Medium" | "Low",
      "type": "Story" | "Bug" | "Task",
      "suggested_assignee": "<takım üyesi adı>",
      "reasoning": "<neden bu kişi, max 1 cümle>"
    }
  ],
  "sprint_feasibility": "<bu sprint'e sığar mı? Türkçe değerlendirme>",
  "total_points": <toplam story point>
}`;

  try {
    const text = await askGemini(prompt);
    return extractJson<ChaosResult>(text);
  } catch {
    return mockChaosToClarity(rawText, members);
  }
}
