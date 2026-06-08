const JIRA_BASE_URL = process.env.JIRA_BASE_URL ?? 'https://jira.turkcell.com.tr';
const JIRA_TOKEN = process.env.JIRA_TOKEN ?? '';

export type JiraIssueRaw = {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    assignee: { displayName: string } | null;
    priority: { name: string };
  };
};

export type JiraProject = {
  key: string;
  name: string;
};

export async function fetchJiraIssues(projectKey: string): Promise<JiraIssueRaw[]> {
  if (!JIRA_TOKEN) throw new Error('JIRA_TOKEN not configured');

  const jql = encodeURIComponent(
    `project = "${projectKey}" AND status != Done ORDER BY created DESC`
  );
  const url = `${JIRA_BASE_URL}/rest/api/2/search?jql=${jql}&maxResults=5&fields=summary,status,assignee,priority`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${JIRA_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`Jira API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.issues ?? [];
}

export type BoardIssueRaw = {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    assignee: { displayName: string; key?: string } | null;
    priority: { name: string } | null;
    issuetype: { name: string };
  };
};

export async function fetchBoardIssues(boardId: number): Promise<BoardIssueRaw[]> {
  if (!JIRA_TOKEN) throw new Error('JIRA_TOKEN not configured');

  const url = `${JIRA_BASE_URL}/rest/agile/1.0/board/${boardId}/issue?maxResults=100&fields=summary,status,assignee,priority,issuetype`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${JIRA_TOKEN}`, Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`Board fetch error: ${res.status}`);
  const data = await res.json();
  return data.issues ?? [];
}

export async function fetchJiraProjects(): Promise<JiraProject[]> {
  if (!JIRA_TOKEN) throw new Error('JIRA_TOKEN not configured');

  const url = `${JIRA_BASE_URL}/rest/api/2/project`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${JIRA_TOKEN}`,
      Accept: 'application/json',
    },
    next: { revalidate: 600 },
  });

  if (!res.ok) throw new Error(`Jira projects error: ${res.status}`);
  return res.json();
}

export type CreateJiraProjectResult = {
  key: string;
  id: string;
  self: string;
};

export function generateJiraKey(title: string): string {
  const words = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  let key = '';
  if (words.length === 1) {
    key = words[0].slice(0, 6);
  } else {
    key = words.map((w) => w[0]).join('').slice(0, 6);
    if (key.length < 2) key = words[0].slice(0, 6);
  }
  return key.padEnd(2, 'X');
}

export async function createJiraProject(
  title: string,
  description: string,
  keyHint?: string
): Promise<CreateJiraProjectResult> {
  if (!JIRA_TOKEN) throw new Error('JIRA_TOKEN not configured');

  const myself = await fetch(`${JIRA_BASE_URL}/rest/api/2/myself`, {
    headers: { Authorization: `Bearer ${JIRA_TOKEN}`, Accept: 'application/json' },
  }).then((r) => r.json());

  const lead: string = myself.name ?? myself.key ?? 'TCEKUCUKKILIC';
  const baseKey = (keyHint || generateJiraKey(title))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

  const tryCreate = async (key: string): Promise<Response> =>
    fetch(`${JIRA_BASE_URL}/rest/api/2/project`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JIRA_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        key,
        name: title,
        description: description || '',
        projectTypeKey: 'software',
        lead,
      }),
    });

  let res = await tryCreate(baseKey);

  if (res.status === 400) {
    // Key zaten varsa 2 karakterlik timestamp suffix ile tekrar dene
    const altKey = (baseKey.slice(0, 4) + Date.now().toString().slice(-2)).toUpperCase();
    res = await tryCreate(altKey);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jira proje oluşturulamadı: ${res.status} — ${err}`);
  }

  return res.json() as Promise<CreateJiraProjectResult>;
}

export type BacklogIssueRaw = {
  key: string;
  fields: {
    summary: string;
    description?: string;
    status: { name: string };
    assignee: { displayName: string } | null;
    priority: { name: string } | null;
    issuetype: { name: string };
    [key: string]: unknown; // customfield_XXXXX story points
  };
};

export async function fetchProjectBacklog(
  projectKey: string,
  startAt = 0,
  maxResults = 50
): Promise<{ issues: BacklogIssueRaw[]; total: number; spField: string | null }> {
  if (!JIRA_TOKEN) throw new Error('JIRA_TOKEN not configured');

  // Önce story point field ID'yi bul
  let spField: string | null = null;
  try {
    const fieldsRes = await fetch(`${JIRA_BASE_URL}/rest/api/2/field`, {
      headers: { Authorization: `Bearer ${JIRA_TOKEN}`, Accept: 'application/json' },
    });
    if (fieldsRes.ok) {
      const fields = await fieldsRes.json() as { id: string; name: string }[];
      const spCandidate = fields.find(f =>
        f.name.toLowerCase() === 'story points' ||
        f.name.toLowerCase() === 'story point' ||
        f.name.toLowerCase() === 'sp'
      );
      spField = spCandidate?.id ?? 'customfield_10014';
    }
  } catch { spField = 'customfield_10014'; }

  const fields = `summary,status,assignee,priority,issuetype${spField ? `,${spField}` : ''}`;
  const jql = encodeURIComponent(`project = "${projectKey}" AND sprint is EMPTY ORDER BY priority ASC, created DESC`);
  const url = `${JIRA_BASE_URL}/rest/api/2/search?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${JIRA_TOKEN}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Backlog fetch error: ${res.status}`);
  const data = await res.json();
  return { issues: data.issues ?? [], total: data.total ?? 0, spField };
}

export async function fetchBoardBacklog(
  boardId: number,
  startAt = 0,
  maxResults = 50
): Promise<{ issues: BacklogIssueRaw[]; total: number }> {
  if (!JIRA_TOKEN) throw new Error('JIRA_TOKEN not configured');
  const url = `${JIRA_BASE_URL}/rest/agile/1.0/board/${boardId}/backlog?startAt=${startAt}&maxResults=${maxResults}&fields=summary,status,assignee,priority,issuetype,customfield_10014,customfield_10016`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${JIRA_TOKEN}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Board backlog error: ${res.status}`);
  const data = await res.json();
  return { issues: data.issues ?? [], total: data.total ?? 0 };
}

export type BacklogItem = {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  priority: string;
  issueType: string;
  storyPoints: number | null;
};

export function normalizeBacklogIssues(issues: BacklogIssueRaw[], spField: string | null): BacklogItem[] {
  return issues.map(i => {
    const sp = spField
      ? (i.fields[spField] as number | null) ?? (i.fields['customfield_10014'] as number | null) ?? (i.fields['customfield_10016'] as number | null)
      : null;
    return {
      key: i.key,
      summary: i.fields.summary,
      status: i.fields.status.name,
      assignee: i.fields.assignee?.displayName ?? 'Atanmamış',
      priority: i.fields.priority?.name ?? 'None',
      issueType: i.fields.issuetype.name,
      storyPoints: sp ?? null,
    };
  });
}

export function getMockBacklog(projectKey: string): { items: BacklogItem[]; total: number } {
  const items: BacklogItem[] = [
    { key: `${projectKey}-201`, summary: 'Kullanıcı profil sayfası yeniden tasarımı',          priority: 'High',     issueType: 'Story',   storyPoints: 8,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-202`, summary: 'Push notification altyapısı entegrasyonu',            priority: 'High',     issueType: 'Story',   storyPoints: 13,   status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-203`, summary: 'Onboarding akışı A/B test implementasyonu',           priority: 'Medium',   issueType: 'Story',   storyPoints: 5,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-204`, summary: 'Dark mode desteği eklenmeli',                         priority: 'Low',      issueType: 'Story',   storyPoints: 3,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-205`, summary: 'Arama fonksiyonu debounce optimizasyonu',             priority: 'Medium',   issueType: 'Task',    storyPoints: 2,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-206`, summary: 'API rate limiting implementasyonu',                   priority: 'High',     issueType: 'Task',    storyPoints: 8,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-207`, summary: 'Unit test coverage %80\'e çıkarılmalı',               priority: 'Medium',   issueType: 'Task',    storyPoints: null, status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-208`, summary: 'Database index optimizasyonu — yavaş sorgular',       priority: 'High',     issueType: 'Bug',     storyPoints: 5,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-209`, summary: 'Çoklu dil desteği (i18n) altyapısı',                  priority: 'Low',      issueType: 'Story',   storyPoints: 13,   status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-210`, summary: 'WebSocket bağlantısı yeniden bağlanma mekanizması',   priority: 'High',     issueType: 'Bug',     storyPoints: null, status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-211`, summary: 'Raporlama modülü CSV export özelliği',                priority: 'Medium',   issueType: 'Story',   storyPoints: 3,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-212`, summary: 'Login sayfası accessibility (WCAG 2.1 AA) uyumu',     priority: 'Medium',   issueType: 'Task',    storyPoints: 5,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-213`, summary: 'Microservice arası circuit breaker pattern',          priority: 'High',     issueType: 'Story',   storyPoints: null, status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-214`, summary: 'Cache invalidation stratejisi güncellenmeli',         priority: 'Medium',   issueType: 'Task',    storyPoints: 5,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-215`, summary: 'Müşteri segmentasyon API\'si dökümantasyonu',          priority: 'Low',      issueType: 'Task',    storyPoints: 2,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-216`, summary: 'E-posta şablonları responsive hale getirilmeli',      priority: 'Low',      issueType: 'Story',   storyPoints: 3,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-217`, summary: 'OAuth2 PKCE flow implementasyonu',                    priority: 'Critical', issueType: 'Story',   storyPoints: null, status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-218`, summary: 'Audit log servisi tüm CRUD operasyonlarını kaydetmeli',priority: 'High',    issueType: 'Story',   storyPoints: 8,    status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-219`, summary: 'Admin panel kullanıcı yönetimi sayfası',              priority: 'Medium',   issueType: 'Story',   storyPoints: null, status: 'Open',       assignee: 'Atanmamış' },
    { key: `${projectKey}-220`, summary: 'Performans monitoring Grafana dashboard entegrasyonu', priority: 'Low',     issueType: 'Task',    storyPoints: 5,    status: 'Open',       assignee: 'Atanmamış' },
  ];
  return { items, total: items.length };
}

export function getMockIssues(projectKey: string): JiraIssueRaw[] {
  return [
    {
      key: `${projectKey}-101`,
      fields: {
        summary: 'API entegrasyonu tamamlanmadı — sprint backlog\'da',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Ahmet Yılmaz' },
        priority: { name: 'High' },
      },
    },
    {
      key: `${projectKey}-98`,
      fields: {
        summary: 'Performance testleri çalıştırılmalı — prod öncesi',
        status: { name: 'Open' },
        assignee: { displayName: 'Fatma Kaya' },
        priority: { name: 'Medium' },
      },
    },
    {
      key: `${projectKey}-95`,
      fields: {
        summary: 'Teknik dokümantasyon Confluence\'a eklenmeli',
        status: { name: 'Open' },
        assignee: null,
        priority: { name: 'Low' },
      },
    },
    {
      key: `${projectKey}-92`,
      fields: {
        summary: 'Security review bulguları kapatılmalı',
        status: { name: 'Open' },
        assignee: { displayName: 'Mehmet Demir' },
        priority: { name: 'High' },
      },
    },
  ];
}
