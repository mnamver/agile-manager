'use server';

import { revalidatePath } from 'next/cache';
import { getDb, type Project, type TeamMember, type ProjectNote, type JiraIssue, type Subtask, type AiReport, type SprintTask } from '@/lib/db';
import { fetchJiraIssues, getMockIssues, createJiraProject, generateJiraKey, fetchBoardIssues } from '@/lib/jira';
import {
  estimateStoryPoints,
  decomposeTask,
  generateSprintReport,
  chaosToClarity,
  suggestBlokCozum,
  type DecomposeResult,
  type SprintReportResult,
  type ChaosResult,
  type BlokCozumResult,
} from '@/lib/gemini';
import {
  fetchProjectBacklog,
  fetchBoardBacklog,
  normalizeBacklogIssues,
  getMockBacklog,
  type BacklogItem,
} from '@/lib/jira';

export async function getProjects(): Promise<(Project & { open_issues: number })[]> {
  const db = getDb();
  return db
    .prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM jira_issues_cache j WHERE j.project_id = p.id AND j.status != 'Done') AS open_issues
      FROM projects p
      ORDER BY
        CASE p.status WHEN 'at_risk' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
        p.created_at DESC
    `)
    .all() as (Project & { open_issues: number })[];
}

export async function getProject(id: number): Promise<Project | null> {
  const db = getDb();
  return (db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project) ?? null;
}

export async function getTeamMembers(projectId: number): Promise<TeamMember[]> {
  const db = getDb();
  return db
    .prepare('SELECT * FROM team_members WHERE project_id = ? ORDER BY role, name')
    .all(projectId) as TeamMember[];
}

export async function getProjectNotes(projectId: number): Promise<ProjectNote[]> {
  const db = getDb();
  return db
    .prepare('SELECT * FROM project_notes WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as ProjectNote[];
}

export async function getJiraIssues(projectId: number): Promise<JiraIssue[]> {
  const db = getDb();
  return db
    .prepare('SELECT * FROM jira_issues_cache WHERE project_id = ? ORDER BY fetched_at DESC')
    .all(projectId) as JiraIssue[];
}

export async function refreshBoardIssues(projectId: number, boardId: number): Promise<JiraIssue[]> {
  const db = getDb();

  let rawIssues;
  try {
    rawIssues = await fetchBoardIssues(boardId);
  } catch {
    revalidatePath(`/projects/${projectId}`);
    return getJiraIssues(projectId);
  }

  db.prepare('DELETE FROM jira_issues_cache WHERE project_id = ?').run(projectId);

  const insert = db.prepare(`
    INSERT INTO jira_issues_cache (project_id, jira_id, summary, status, assignee, priority, issue_type)
    VALUES (@project_id, @jira_id, @summary, @status, @assignee, @priority, @issue_type)
  `);

  db.transaction(() => {
    for (const issue of rawIssues) {
      insert.run({
        project_id: projectId,
        jira_id: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName ?? 'Atanmamış',
        priority: issue.fields.priority?.name ?? 'None',
        issue_type: issue.fields.issuetype?.name ?? 'Task',
      });
    }
  })();

  revalidatePath(`/projects/${projectId}`);
  return getJiraIssues(projectId);
}

export async function refreshJiraIssues(projectId: number, jiraKey: string): Promise<JiraIssue[]> {
  const db = getDb();

  let rawIssues;
  try {
    rawIssues = await fetchJiraIssues(jiraKey);
  } catch {
    rawIssues = getMockIssues(jiraKey);
  }

  db.prepare('DELETE FROM jira_issues_cache WHERE project_id = ?').run(projectId);

  const insert = db.prepare(`
    INSERT INTO jira_issues_cache (project_id, jira_id, summary, status, assignee, priority)
    VALUES (@project_id, @jira_id, @summary, @status, @assignee, @priority)
  `);

  const insertAll = db.transaction(() => {
    for (const issue of rawIssues) {
      insert.run({
        project_id: projectId,
        jira_id: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName ?? 'Atanmamış',
        priority: issue.fields.priority.name,
      });
    }
  });
  insertAll();

  revalidatePath(`/projects/${projectId}`);
  return getJiraIssues(projectId);
}

export async function createProject(formData: FormData): Promise<{ id: number; jiraKey: string | null; jiraError: string | null }> {
  const db = getDb();

  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const target_date = formData.get('target_date') as string;
  const jira_key_input = (formData.get('jira_key') as string)?.toUpperCase().trim() || null;
  const membersJson = formData.get('members') as string;

  if (!title?.trim()) throw new Error('Proje adı zorunludur');

  const members: { name: string; role: string }[] = membersJson ? JSON.parse(membersJson) : [];

  // Jira'da proje oluştur — key girilmişse onu kullan, girilmemişse başlıktan üret
  let finalJiraKey: string | null = null;
  let jiraCreateError: string | null = null;
  try {
    const keyHint = jira_key_input || generateJiraKey(title);
    const jiraProject = await createJiraProject(title.trim(), description?.trim() || '', keyHint);
    finalJiraKey = jiraProject.key;
  } catch (err) {
    jiraCreateError = (err as Error).message;
    // Jira başarısız olursa girilen key'i sakla, uygulama yine çalışır
    finalJiraKey = jira_key_input;
  }

  const insertProject = db.prepare(`
    INSERT INTO projects (title, description, status, team_size, target_date, jira_key, ai_generated)
    VALUES (@title, @description, 'active', @team_size, @target_date, @jira_key, 0)
  `);
  const insertMember = db.prepare(`
    INSERT INTO team_members (project_id, name, role) VALUES (@project_id, @name, @role)
  `);

  let projectId!: number;
  const run = db.transaction(() => {
    const res = insertProject.run({
      title: title.trim(),
      description: description?.trim() || null,
      team_size: members.length,
      target_date: target_date || null,
      jira_key: finalJiraKey,
    });
    projectId = res.lastInsertRowid as number;
    for (const m of members) {
      if (m.name?.trim()) {
        insertMember.run({ project_id: projectId, name: m.name.trim(), role: m.role || 'Developer' });
      }
    }
  });
  run();

  if (finalJiraKey) {
    try {
      const rawIssues = await fetchJiraIssues(finalJiraKey).catch(() => getMockIssues(finalJiraKey!));
      const ins = db.prepare(`
        INSERT INTO jira_issues_cache (project_id, jira_id, summary, status, assignee, priority)
        VALUES (@project_id, @jira_id, @summary, @status, @assignee, @priority)
      `);
      const bulk = db.transaction(() => {
        for (const issue of rawIssues) {
          ins.run({
            project_id: projectId,
            jira_id: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status.name,
            assignee: issue.fields.assignee?.displayName ?? 'Atanmamış',
            priority: issue.fields.priority.name,
          });
        }
      });
      bulk();
    } catch {
      // Issue cache isteğe bağlı
    }
  }

  revalidatePath('/');
  return { id: projectId, jiraKey: finalJiraKey, jiraError: jiraCreateError };
}

export async function updateProjectStatus(
  id: number,
  status: 'active' | 'at_risk' | 'done'
): Promise<void> {
  const db = getDb();
  db.prepare('UPDATE projects SET status = ? WHERE id = ?').run(status, id);
  revalidatePath('/');
  revalidatePath(`/projects/${id}`);
}

export async function addNote(projectId: number, content: string): Promise<ProjectNote> {
  const db = getDb();
  if (!content?.trim()) throw new Error('Not içeriği boş olamaz');

  const res = db
    .prepare('INSERT INTO project_notes (project_id, content) VALUES (?, ?)')
    .run(projectId, content.trim());

  revalidatePath(`/projects/${projectId}`);
  return db
    .prepare('SELECT * FROM project_notes WHERE id = ?')
    .get(res.lastInsertRowid) as ProjectNote;
}

export async function deleteNote(noteId: number, projectId: number): Promise<void> {
  const db = getDb();
  db.prepare('DELETE FROM project_notes WHERE id = ?').run(noteId);
  revalidatePath(`/projects/${projectId}`);
}

export async function getProjectStats(): Promise<{
  total: number;
  active: number;
  at_risk: number;
  done: number;
  total_members: number;
}> {
  const db = getDb();
  const stats = db
    .prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'at_risk' THEN 1 ELSE 0 END) as at_risk,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(team_size) as total_members
      FROM projects
    `)
    .get() as { total: number; active: number; at_risk: number; done: number; total_members: number };
  return stats;
}

// ─── BACKLOG ACTIONS ──────────────────────────────────────────────────────────

export async function loadBacklog(
  projectId: number,
  startAt = 0,
  maxResults = 50
): Promise<{ items: BacklogItem[]; total: number; source: 'jira' | 'mock' }> {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Project;
  if (!project) throw new Error('Proje bulunamadı');

  try {
    if (project.board_id) {
      const { issues, total } = await fetchBoardBacklog(project.board_id, startAt, maxResults);
      return { items: normalizeBacklogIssues(issues, null), total, source: 'jira' };
    }
    if (project.jira_key) {
      const { issues, total, spField } = await fetchProjectBacklog(project.jira_key, startAt, maxResults);
      return { items: normalizeBacklogIssues(issues, spField), total, source: 'jira' };
    }
    throw new Error('Proje Jira key veya board ID içermiyor');
  } catch {
    const mock = getMockBacklog(project.jira_key ?? 'MOCK');
    const page = mock.items.slice(startAt, startAt + maxResults);
    return { items: page, total: mock.total, source: 'mock' };
  }
}

export async function estimateBacklogItem(
  key: string,
  summary: string
): Promise<{ points: number; reasoning: string }> {
  const result = await estimateStoryPoints(summary, '', undefined);
  return { points: result.points, reasoning: result.reasoning };
}

// ─── AI ACTIONS ───────────────────────────────────────────────────────────────

export async function estimateIssuePoints(
  issueId: number,
  projectId: number
): Promise<{ points: number; reasoning: string; complexity: string }> {
  const db = getDb();
  const issue = db.prepare('SELECT * FROM jira_issues_cache WHERE id = ?').get(issueId) as JiraIssue;
  if (!issue) throw new Error('Issue bulunamadı');

  const result = await estimateStoryPoints(issue.summary, '', undefined);

  db.prepare('UPDATE jira_issues_cache SET story_points = ? WHERE id = ?').run(result.points, issueId);
  revalidatePath(`/projects/${projectId}`);

  return result;
}

export async function estimateAllIssuePoints(projectId: number): Promise<void> {
  const db = getDb();
  const issues = db
    .prepare('SELECT * FROM jira_issues_cache WHERE project_id = ?')
    .all(projectId) as JiraIssue[];

  for (const issue of issues) {
    try {
      const result = await estimateStoryPoints(issue.summary, '', undefined);
      db.prepare('UPDATE jira_issues_cache SET story_points = ? WHERE id = ?').run(result.points, issue.id);
    } catch {
      // skip failed estimates
    }
  }
  revalidatePath(`/projects/${projectId}`);
}

export async function decomposeIssue(
  issueId: number,
  projectId: number
): Promise<DecomposeResult> {
  const db = getDb();
  const issue = db.prepare('SELECT * FROM jira_issues_cache WHERE id = ?').get(issueId) as JiraIssue;
  if (!issue) throw new Error('Issue bulunamadı');

  const members = db
    .prepare('SELECT * FROM team_members WHERE project_id = ?')
    .all(projectId) as { id: number; name: string; role: string }[];

  const result = await decomposeTask(issue.summary, '', members);

  db.prepare('DELETE FROM subtasks WHERE issue_id = ?').run(issueId);
  const insert = db.prepare(
    'INSERT INTO subtasks (issue_id, project_id, title, type, assigned_to, estimated_hours) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (const st of result.subtasks) {
      insert.run(issueId, projectId, st.title, st.type, st.assigned_to, st.estimated_hours);
    }
  })();

  revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function getSubtasks(issueId: number): Promise<Subtask[]> {
  const db = getDb();
  return db.prepare('SELECT * FROM subtasks WHERE issue_id = ? ORDER BY id').all(issueId) as Subtask[];
}

export async function generateProjectReport(projectId: number): Promise<SprintReportResult> {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Project;
  if (!project) throw new Error('Proje bulunamadı');

  const issues = db
    .prepare('SELECT * FROM jira_issues_cache WHERE project_id = ? ORDER BY fetched_at DESC LIMIT 30')
    .all(projectId) as JiraIssue[];
  const members = db
    .prepare('SELECT * FROM team_members WHERE project_id = ?')
    .all(projectId) as TeamMember[];

  const result = await generateSprintReport(project.title, issues, members);

  db.prepare('INSERT INTO ai_reports (project_id, summary) VALUES (?, ?)').run(
    projectId,
    JSON.stringify(result)
  );

  revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function getLatestReport(projectId: number): Promise<AiReport | null> {
  const db = getDb();
  return (
    db
      .prepare('SELECT * FROM ai_reports WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(projectId) as AiReport | undefined
  ) ?? null;
}

export type SprintMetrics = {
  totalIssues: number;
  byStatus: { status: string; count: number; points: number }[];
  plannedSP: number;
  doneSP: number;
  inProgressSP: number;
  remaining: number;
  completionRate: number;
  byAssignee: { name: string; total: number; done: number; points: number; donePoints: number }[];
  byPriority: { priority: string; count: number; doneCount: number }[];
};

export async function getSprintMetrics(projectId: number): Promise<SprintMetrics> {
  const db = getDb();
  const issues = db.prepare('SELECT * FROM jira_issues_cache WHERE project_id = ?').all(projectId) as JiraIssue[];

  const DONE = new Set(['Done', 'Canlı', 'Ready For Release', 'Closed', 'Resolved']);
  const IN_PROG = new Set(['In Progress', 'Development', 'Development Done', 'Test', 'Ready to Test', 'Analysis Done']);

  const statusMap = new Map<string, { count: number; points: number }>();
  const assigneeMap = new Map<string, { total: number; done: number; points: number; donePoints: number }>();
  const priorityMap = new Map<string, { count: number; doneCount: number }>();
  let plannedSP = 0, doneSP = 0, inProgressSP = 0;

  for (const issue of issues) {
    const sp = issue.story_points ?? 0;
    plannedSP += sp;
    if (DONE.has(issue.status)) doneSP += sp;
    else if (IN_PROG.has(issue.status)) inProgressSP += sp;

    const s = statusMap.get(issue.status) ?? { count: 0, points: 0 };
    s.count++; s.points += sp;
    statusMap.set(issue.status, s);

    const assignee = issue.assignee || 'Atanmamış';
    const a = assigneeMap.get(assignee) ?? { total: 0, done: 0, points: 0, donePoints: 0 };
    a.total++; a.points += sp;
    if (DONE.has(issue.status)) { a.done++; a.donePoints += sp; }
    assigneeMap.set(assignee, a);

    const prio = issue.priority || 'None';
    const p = priorityMap.get(prio) ?? { count: 0, doneCount: 0 };
    p.count++;
    if (DONE.has(issue.status)) p.doneCount++;
    priorityMap.set(prio, p);
  }

  return {
    totalIssues: issues.length,
    byStatus: [...statusMap.entries()].map(([status, v]) => ({ status, ...v })).sort((a, b) => b.count - a.count),
    plannedSP,
    doneSP,
    inProgressSP,
    remaining: Math.max(0, plannedSP - doneSP - inProgressSP),
    completionRate: plannedSP > 0 ? Math.round((doneSP / plannedSP) * 100) : 0,
    byAssignee: [...assigneeMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
    byPriority: [...priorityMap.entries()].map(([priority, v]) => ({ priority, ...v })),
  };
}

export async function parseChaosText(
  rawText: string,
  projectId: number
): Promise<ChaosResult> {
  const db = getDb();
  const members = db
    .prepare('SELECT * FROM team_members WHERE project_id = ?')
    .all(projectId) as TeamMember[];

  const result = await chaosToClarity(rawText, members, undefined);

  const insert = db.prepare(`
    INSERT INTO jira_issues_cache (project_id, jira_id, summary, status, assignee, priority, issue_type, story_points)
    VALUES (@project_id, @jira_id, @summary, @status, @assignee, @priority, @issue_type, @story_points)
  `);

  db.transaction(() => {
    for (const task of result.tasks) {
      const jiraId = `AI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      insert.run({
        project_id: projectId,
        jira_id: jiraId,
        summary: task.title,
        status: 'Open',
        assignee: task.suggested_assignee,
        priority: task.priority,
        issue_type: task.type,
        story_points: task.story_points,
      });
    }
  })();

  revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function getBlokCozumOnerisi(blokNedeni: string, taskNo: string): Promise<BlokCozumResult> {
  return suggestBlokCozum(blokNedeni, taskNo);
}

export async function getSprintTasks(projectId: number): Promise<SprintTask[]> {
  const db = getDb();
  return db
    .prepare('SELECT * FROM sprint_tasks WHERE project_id = ? ORDER BY sprint_no ASC NULLS LAST, no ASC')
    .all(projectId) as SprintTask[];
}

export async function importSprintTasksFromJson(projectId: number): Promise<{ imported: number }> {
  const db = getDb();
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const xlsx = require('xlsx') as typeof import('xlsx');

  const jsonPath = path.join(process.cwd(), 'Overvibe_Tasklar_Enriched.json');
  if (!fs.existsSync(jsonPath)) return { imported: 0 };

  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
    no: string;
    backlog_giris_tarihi: string | null;
    sprint_no: number | null;
    sprint_baslangic: string | null;
    sprint_bitis: string | null;
    tamamlanma_tarihi: string | null;
  }[];

  // Load Sizing Tarihi overrides from Overvibe_Tasklar_now_2.xlsx
  const sizingMap = new Map<string, string | null>();
  const xlsxPath = path.join(process.cwd(), 'Overvibe_Tasklar_now_2.xlsx');
  if (fs.existsSync(xlsxPath)) {
    const wb = xlsx.readFile(xlsxPath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const xlRows = xlsx.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
    for (const xlRow of xlRows) {
      const no = String(xlRow['No'] ?? '').trim();
      if (!no) continue;
      const raw = xlRow['Sizing Tarihi'];
      let date: string | null = null;
      if (typeof raw === 'number') {
        const d = xlsx.SSF.parse_date_code(raw);
        if (d) date = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      } else if (raw instanceof Date) {
        date = raw.toISOString().slice(0, 10);
      } else if (typeof raw === 'string' && raw.trim()) {
        const s = raw.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) date = s.slice(0, 10);
        else {
          const m = s.match(/^(\d{2})[./](\d{2})[./](\d{4})/);
          if (m) date = `${m[3]}-${m[2]}-${m[1]}`;
        }
      }
      sizingMap.set(no, date);
    }
  }

  db.prepare('DELETE FROM sprint_tasks WHERE project_id = ?').run(projectId);

  const BLOK_KATEGORILER = [
    'Dış Bağımlılık / Ekip Bekleme',
    'Öncelikli Aktif Proje',
    'Defect / Bug Çözümü',
    'Toplantı / Planlama',
    'Ortam / Altyapı / Entegrasyon',
    'Operasyon Destek',
    'Kişisel / İdari',
  ];

  const insert = db.prepare(`
    INSERT INTO sprint_tasks (project_id, no, backlog_giris_tarihi, sprint_no, sprint_baslangic, sprint_bitis, tamamlanma_tarihi, blok_nedeni)
    VALUES (@project_id, @no, @backlog_giris_tarihi, @sprint_no, @sprint_baslangic, @sprint_bitis, @tamamlanma_tarihi, @blok_nedeni)
  `);

  db.transaction(() => {
    for (const row of rows) {
      if (!row.no) continue;
      const backlogDate = sizingMap.has(row.no) ? sizingMap.get(row.no) ?? null : row.backlog_giris_tarihi ?? null;
      const sprintBitis = row.sprint_bitis ?? null;
      const tamamlanma = row.tamamlanma_tarihi ?? null;
      const isLate = tamamlanma && sprintBitis ? tamamlanma > sprintBitis : false;
      const blokNedeni = isLate
        ? BLOK_KATEGORILER[Math.floor(Math.random() * BLOK_KATEGORILER.length)]
        : null;
      insert.run({
        project_id: projectId,
        no: row.no,
        backlog_giris_tarihi: backlogDate,
        sprint_no: row.sprint_no ?? null,
        sprint_baslangic: row.sprint_baslangic ?? null,
        sprint_bitis: sprintBitis,
        tamamlanma_tarihi: tamamlanma,
        blok_nedeni: blokNedeni,
      });
    }
  })();

  return { imported: rows.filter(r => r.no).length };
}
