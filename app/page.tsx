import { getProjects, getProjectStats } from '@/actions/actions';
import ProjectsBoard from './ProjectsBoard';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [projects, stats] = await Promise.all([getProjects(), getProjectStats()]);

  return <ProjectsBoard initialProjects={projects} stats={stats} />;
}
