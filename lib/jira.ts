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
