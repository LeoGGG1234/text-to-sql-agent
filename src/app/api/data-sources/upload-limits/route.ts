import { NextResponse } from 'next/server';
import { getUploadLimits } from '@/lib/data-sources/upload-limits';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { maxFileMb, maxRows } = getUploadLimits();
  return NextResponse.json({ maxFileMb, maxRows });
}
