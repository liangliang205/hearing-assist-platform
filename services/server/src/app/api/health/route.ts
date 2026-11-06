import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    code: 0,
    message: 'ok',
    data: {
      service: 'backend',
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
  });
}
