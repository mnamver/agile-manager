'use server';

import { revalidatePath } from 'next/cache';
import { getDb, type Project, type TeamMember, type ProjectNote, type JiraIssue, type Subtask, type AiReport } from '@/lib/db';
import { fetchJiraIssues, getMockIssues, createJiraProject, generateJiraKey, fetchBoardIssues } from '@/lib/jira';
import {
  estimateStoryPoints,
  decomposeTask,
  generateSprintReport,
  chaosToClarity,
  type DecomposeResult,
  type SprintReportResult,
  type ChaosResult,
} from '@/lib/gemini';

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
    .prepare('SELECT * FROM jira_issues_cache WHERE project_id = ? ORDER BY fetched_at DESC LIMIT 10')
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
    .prepare('SELECT * FROM jira_issues_cache WHERE project_id = ? AND story_points IS NULL')
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
