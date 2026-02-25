import { NextResponse } from 'next/server';

export function jsonError(status: number, code: string, message: string, requestId?: string) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(requestId ? { requestId } : {}),
      },
    },
    { status },
  );
}
