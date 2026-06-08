import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

type TaskTypeCandidate = {
  type: SubtaskItem['type'];
  label: string;
  roleHint: string;
  hours: number;
  reasoning: string;
  keywords: string[];
};

const ALL_TASK_TYPES: TaskTypeCandidate[] = [
  { type: 'Frontend',  label: 'Frontend UI geliştirme',       roleHint: 'frontend',  hours: 4,   reasoning: 'Frontend uzmanı en verimli',             keywords: ['ui','arayüz','ekran','sayfa','form','modal','component','button','responsive','css','html','react','tasarım','görsel','display','render','kullanıcı arayüzü'] },
  { type: 'Backend',   label: 'Backend API geliştirme',        roleHint: 'backend',   hours: 6,   reasoning: 'Backend business logic ve API sorumluluğu', keywords: ['api','servis','endpoint','rest','http','request','response','controller','service','business logic','sunucu','server','microservice','entegrasyon','integration','webhook','auth','token'] },
  { type: 'Database',  label: 'Veritabanı şema güncellemesi',  roleHint: 'backend',   hours: 2,   reasoning: 'Backend DB şema sorumluluğu',             keywords: ['veritabanı','database','db','tablo','şema','schema','migration','sorgu','query','index','sql','nosql','redis','cache','data model'] },
  { type: 'Test',      label: 'Test senaryoları ve QA',        roleHint: 'qa',        hours: 3,   reasoning: 'QA test coverage sağlar',                keywords: ['test','qa','senaryo','scenario','coverage','birim','unit','entegrasyon','regresyon','regression','doğrulama','validasyon','verification'] },
  { type: 'DevOps',    label: 'CI/CD ve altyapı yapılandırması', roleHint: 'devops', hours: 3,   reasoning: 'DevOps altyapı ve deployment sorumluluğu', keywords: ['deploy','deployment','ci','cd','pipeline','docker','kubernetes','k8s','altyapı','infrastructure','ortam','environment','helm','nginx','cloud','aws','azure','monitoring','log'] },
  { type: 'Design',    label: 'UI/UX tasarım ve prototipleme', roleHint: 'designer',  hours: 3,   reasoning: 'Tasarım spesifikasyonu gerekli',          keywords: ['tasarım','design','ux','prototip','prototype','figma','wireframe','mockup','akış','flow','kullanıcı deneyimi','user experience'] },
];

function selectTaskTypes(description: string): TaskTypeCandidate[] {
  if (!description.trim()) {
    // Rastgele 2-4 alan seç
    const shuffled = [...ALL_TASK_TYPES].sort(() => Math.random() - 0.5);
    const count = 2 + Math.floor(Math.random() * 3); // 2, 3 veya 4
    return shuffled.slice(0, count);
  }
  const lower = description.toLowerCase();
  const matched = ALL_TASK_TYPES.filter(t => t.keywords.some(kw => lower.includes(kw)));
  // En az 2 alan garantile
  if (matched.length >= 2) return matched;
  const extras = ALL_TASK_TYPES.filter(t => !matched.includes(t)).sort(() => Math.random() - 0.5);
  return [...matched, ...extras].slice(0, Math.max(2, matched.length));
}

function randomMember(members: { name: string; role: string }[]): string {
  if (members.length === 0) return 'Ekip Üyesi';
  return members[Math.floor(Math.random() * members.length)].name;
}

function mockDecompose(title: string, description: string, members: { name: string; role: string }[]): DecomposeResult {
  const selected = selectTaskTypes(description);
  const subtasks: SubtaskItem[] = selected.map(t => ({
    title: `${title} — ${t.label}`,
    type: t.type,
    assigned_to: randomMember(members),
    estimated_hours: rnd(t.hours),
    reasoning: t.reasoning,
  }));
  const total = subtasks.reduce((s, st) => s + st.estimated_hours, 0);
  const riskNote = description
    ? 'Geliştirme alanları description analizi ile belirlendi; bağımlılıklar sprint boyunca takip edilmeli.'
    : 'Description bulunmadığından alanlar rastgele atandı; sprint planlamasında gözden geçirilmeli.';
  return { subtasks, total_estimated_hours: Math.round(total * 2) / 2, risk_note: riskNote };
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
- Task başlığını ve açıklamasını dikkatlice analiz et; hangi teknik alanların gerçekten gerekli olduğuna karar ver.
- Açıklamada Frontend söz konusu değilse Frontend alt görevi oluşturma. Backend, DB, Test, DevOps, Design için de aynı kural.
- Açıklama yoksa mantıklı varsayımlarla 2-3 alan seç; 4 alanı zorla doldurma.
- Her alt görev max 4 saatlik iş olsun.
- Üye rolüne göre ata; uygun rol yoksa en yakın kişiye ata.

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
    return mockDecompose(title, description, members);
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

export type BlokCozum = {
  baslik: string;
  aciklama: string;
};

export type BlokCozumResult = {
  ozet: string;
  oneriler: BlokCozum[];
};

function mockBlokCozum(blokNedeni: string): BlokCozumResult {
  const map: Record<string, BlokCozumResult> = {
    'Dış Bağımlılık / Ekip Bekleme': {
      ozet: 'Dış bağımlılık kaynaklı gecikmeler için proaktif takip ve eskalasyon mekanizması kurulmalı.',
      oneriler: [
        { baslik: 'Bağımlılık Matrisi Oluştur', aciklama: 'Tüm dış bağımlılıkları ve beklenen teslim tarihlerini görünür bir matrise taşı.' },
        { baslik: 'Haftalık Senkronizasyon Toplantısı', aciklama: 'Bağımlı ekiplerle haftalık durum toplantısı koy, gecikme erken tespit edilsin.' },
        { baslik: 'Eskalasyon Yolu Belirle', aciklama: '48 saat yanıt gelmezse yönetici seviyesinde eskalasyon protokolü devreye girsin.' },
        { baslik: 'Paralel Çalışma Planı', aciklama: 'Bağımlılık çözülene kadar bağımsız alt görevleri öne al, boş beklemeyi önle.' },
      ],
    },
    'Öncelikli Aktif Proje': {
      ozet: 'Kaynak çakışması yönetilmeli; sprint planlamasında kapasite gerçekçi ayrılmalı.',
      oneriler: [
        { baslik: 'Kapasite Planlaması Güncelle', aciklama: 'Aktif projenin kaplama oranını sprint planına yansıt, over-commitment önle.' },
        { baslik: 'Öncelik Sıralaması Netleştir', aciklama: 'Product Owner ile hangi projenin önde geldiğini yazılı olarak belgele.' },
        { baslik: 'Kısmi Teslim Stratejisi', aciklama: 'Büyük görevi parçala; bir kısmını mevcut sprint\'te teslim et.' },
        { baslik: 'Kaynak Takviyesi Talep Et', aciklama: 'Sürekli çakışma varsa ek kaynak veya deadline revizyonu için yönetimi bilgilendir.' },
      ],
    },
    'Defect / Bug Çözümü': {
      ozet: 'Bug kaynaklı blokajlar için teknik borç yönetimi ve root-cause analizi önceliklendirilmeli.',
      oneriler: [
        { baslik: 'Root Cause Analizi Yap', aciklama: 'Aynı bug tekrarlanıyorsa altta yatan tasarım sorununu tespit et ve teknik borç olarak kaydet.' },
        { baslik: 'Bug Triaj Süreci Kur', aciklama: 'Her sprint başında açık bug\'ları öncelik sırasına göre sırala, kritiklere önce girilsin.' },
        { baslik: 'Test Otomasyonu Kapsamını Genişlet', aciklama: 'Kritik iş akışlarına regresyon testi ekle, aynı bug\'ın tekrarlanmasını önle.' },
        { baslik: 'Hotfix Branching Stratejisi', aciklama: 'Üretim etkileyen bug\'lar için hotfix süreci belgele ve hızlandır.' },
      ],
    },
    'Toplantı / Planlama': {
      ozet: 'Toplantı yükü geliştirme kapasitesini azaltıyor; zaman optimizasyonu yapılmalı.',
      oneriler: [
        { baslik: 'Toplantı Denetimi Yap', aciklama: 'Haftalık toplantıların zorunluluk/katılım kriterlerini gözden geçir, gereksizleri iptal et.' },
        { baslik: 'Asenkron İletişimi Teşvik Et', aciklama: 'Durum güncellemeleri için Slack/Confluence tercih et, toplantı sayısını düşür.' },
        { baslik: 'Geliştirici Bloğu Koru', aciklama: 'Günde en az 4 saatlik kesintisiz geliştirme zamanı garantile.' },
        { baslik: 'Sprint Kapasitesini Gerçekçi Hesapla', aciklama: 'Toplantı süresini sprint kapasitesine dahil ederek story point taahhüdünü ayarla.' },
      ],
    },
    'Ortam / Altyapı / Entegrasyon': {
      ozet: 'Altyapı sorunları tekrarlanıyorsa kalıcı çözüm üretilmeli, geçici yamalardan kaçınılmalı.',
      oneriler: [
        { baslik: 'Ortam Sağlık Kontrol Listesi', aciklama: 'Sprint başında ortam hazırlık kontrolü yap; eksikler önceden tespit edilsin.' },
        { baslik: 'Infrastructure as Code Uygula', aciklama: 'Ortam kurulumunu otomasyona al; her seferinde sıfırdan kurulum riskini ortadan kaldır.' },
        { baslik: 'Entegrasyon Test Ortamı Ayır', aciklama: 'Entegrasyon testleri için izole bir sandbox ortamı oluştur.' },
        { baslik: 'SLA Takibi Başlat', aciklama: 'Altyapı olayları için SLA tanımla, yinelenen sorunları metriklerle izle.' },
      ],
    },
    'Operasyon Destek': {
      ozet: 'Geliştirme kapasitesini erode eden operasyon yükü için yapısal önlemler alınmalı.',
      oneriler: [
        { baslik: 'Operasyon Rotasyonu Kur', aciklama: 'Destek görevlerini takım içinde döngüsel paylaştır; tek kişi sürekli kesilmesin.' },
        { baslik: 'Runbook Oluştur', aciklama: 'Tekrarlayan operasyon görevlerini dokümante et; herkes kılavuza bakarak çözebilsin.' },
        { baslik: 'Otomasyon Önceliği Ver', aciklama: 'Manuel tekrarlayan operasyon adımlarını otomasyona al, uzun vadede efor azalt.' },
        { baslik: 'Operasyon Süresini Sprint\'e Yansıt', aciklama: 'Tarihsel operasyon yükünü ölç ve sprint kapasitesini buna göre planla.' },
      ],
    },
    'Kişisel / İdari': {
      ozet: 'Kişisel ve idari nedenli gecikmeler için önceden bildirim ve yedekleme planı kritik.',
      oneriler: [
        { baslik: 'Bilgi Paylaşımı Artır', aciklama: 'Kritik görevlerde ikinci bir kişiyi teknik olarak hazırla; tek nokta bağımlılığı ortadan kalksın.' },
        { baslik: 'Önceden Bildirim Kültürü', aciklama: 'Planlı izin ve idari görevler sprint planlamasında önceden görünür olsun.' },
        { baslik: 'Yedekleme Planı Belirle', aciklama: 'Her kritik görev için bir yedek atanan kişi tanımla.' },
        { baslik: 'Kapasite Tampon Bırak', aciklama: 'Sprint kapasitesine %10-15 tampon ekle; beklenmedik kişisel durumlara esneklik sağla.' },
      ],
    },
  };
  return map[blokNedeni] ?? {
    ozet: 'Bu blokaj türü için genel çözüm önerileri aşağıda listelenmiştir.',
    oneriler: [
      { baslik: 'Kök Neden Analizi', aciklama: 'Blokajın temel nedenini ekip ile birlikte tespit et.' },
      { baslik: 'Eskalasyon Değerlendirmesi', aciklama: 'Gerekiyorsa yöneticiye durumu ilet, destek al.' },
      { baslik: 'Plan Revizyonu', aciklama: 'Sprint planını gerçek duruma göre güncelle.' },
    ],
  };
}

export async function suggestBlokCozum(blokNedeni: string, taskNo: string): Promise<BlokCozumResult> {
  const prompt = `Sen bir Agile Coach'sun. Bir Scrum ekibinde "${taskNo}" numaralı task şu nedenle bloklanmış: "${blokNedeni}".

Bu blokaj için somut, uygulanabilir çözüm önerileri üret. Türkçe yaz. Sadece JSON döndür:
{
  "ozet": "<blokajın neden önemli olduğu ve genel yaklaşım, 1-2 cümle>",
  "oneriler": [
    { "baslik": "<kısa eylem başlığı>", "aciklama": "<uygulanabilir açıklama, 1-2 cümle>" },
    { "baslik": "...", "aciklama": "..." },
    { "baslik": "...", "aciklama": "..." },
    { "baslik": "...", "aciklama": "..." }
  ]
}`;

  try {
    const text = await askGemini(prompt);
    return extractJson<BlokCozumResult>(text);
  } catch {
    return mockBlokCozum(blokNedeni);
  }
}

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
