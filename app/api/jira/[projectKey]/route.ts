import { NextRequest, NextResponse } from 'next/server';
import { fetchJiraIssues, getMockIssues } from '@/lib/jira';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectKey: string }> }
) {
  const { projectKey } = await params;

  try {
    const issues = await fetchJiraIssues(projectKey);
    return NextResponse.json({ issues, source: 'jira' });
  } catch {
    const issues = getMockIssues(projectKey);
    return NextResponse.json({ issues, source: 'mock' });
  }
}
