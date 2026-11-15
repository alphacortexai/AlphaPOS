import { NextResponse } from 'next/server';
import { firebaseMcpConfig, respondToMcp } from '../../../lib/pos/grokLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, x-alphapos-token',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export function GET() {
  return NextResponse.json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32601, message: 'Send MCP requests with POST. The address is this shop’s /api/mcp.' },
  }, { status: 405, headers: { ...cors, Allow: 'POST, OPTIONS' } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const config = firebaseMcpConfig();
  const result = await respondToMcp({
    authorization: request.headers.get('authorization'),
    tokenHeader: request.headers.get('x-alphapos-token'),
    queryToken: url.searchParams.get('token'),
    accept: request.headers.get('accept'),
    protocolHeader: request.headers.get('mcp-protocol-version'),
    body: await request.text(),
    projectId: config.projectId,
    apiKey: config.apiKey,
    referer: config.referer,
  });
  return new NextResponse(result.body, { status: result.status, headers: { ...cors, ...result.headers } });
}
