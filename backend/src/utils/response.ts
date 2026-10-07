import { NextResponse } from 'next/server';

export function success<T>(data: T, message = 'ok') {
  return NextResponse.json({ code: 0, message, data });
}

export function failure(code: string, message: string, status = 400) {
  return NextResponse.json({ code, message, data: null }, { status });
}
