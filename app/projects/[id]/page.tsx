import { notFound } from 'next/navigation';
import {
  getProject,
  getTeamMembers,
  getProjectNotes,
  getJiraIssues,
} from '@/actions/actions';
import ProjectDetail from './ProjectDetail';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (isNaN(projectId)) notFound();

  const [project, members, notes, issues] = await Promise.all([
    getProject(projectId),
    getTeamMembers(projectId),
    getProjectNotes(projectId),
    getJiraIssues(projectId),
  ]);

  if (!project) notFound();

  return (
    <ProjectDetail
      project={project}
      members={members}
      notes={notes}
      issues={issues}
    />
  );
}
