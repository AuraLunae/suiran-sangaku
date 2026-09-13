/**
 * functions/api/tracker.ts
 *
 * Cloudflare Pages Functions版。
 * このファイルのパス自体が「/api/tracker」というルートになるため、
 * (以前のworker.jsにあった) url.pathname === "/collect" のような
 * 手動でのパス判定は不要 ―― というより、それが原因で保存処理に
 * 一度も入っていなかった。
 *
 * GET  /api/tracker  → onRequestGet が処理(動作確認用にサーバー情報を返す)
 * POST /api/tracker  → onRequestPost が処理(クライアント情報を受けてSupabaseへ保存)
 *
 * 必要な環境変数(Cloudflare Pages > Settings > Environment variables):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

function corsHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function collectServerInfo(request: Request) {
  const headers: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }
  // Pages FunctionsでもWorkerと同様、request.cf でCloudflareの付加情報が取れる
  const cf = (request as any).cf || {};

  return {
    method: request.method,
    url: request.url,
    referrer: request.headers.get("referer") || null,
    userAgent: request.headers.get("user-agent") || null,
    acceptLanguage: request.headers.get("accept-language") || null,
    secChUa: request.headers.get("sec-ch-ua") || null,
    secChUaPlatform: request.headers.get("sec-ch-ua-platform") || null,
    ip: request.headers.get("cf-connecting-ip") || null,
    trueClientIp: request.headers.get("true-client-ip") || null,
    cf: {
      country: cf.country || null,
      city: cf.city || null,
      region: cf.region || null,
      postalCode: cf.postalCode || null,
      latitude: cf.latitude || null,
      longitude: cf.longitude || null,
      timezone: cf.timezone || null,
      colo: cf.colo || null,
      asn: cf.asn || null,
      asOrganization: cf.asOrganization || null,
      httpProtocol: cf.httpProtocol || null,
      tlsVersion: cf.tlsVersion || null,
    },
    allHeaders: headers,
  };
}

function buildRecord(serverInfo: any, clientInfo: any) {
  return {
    ip: serverInfo.ip,
    true_client_ip: serverInfo.trueClientIp,
    user_agent: serverInfo.userAgent,
    accept_language: serverInfo.acceptLanguage,
    referrer: serverInfo.referrer,
    sec_ch_ua: serverInfo.secChUa,
    sec_ch_ua_platform: serverInfo.secChUaPlatform,
    cf: serverInfo.cf,
    all_headers: serverInfo.allHeaders,
    client_info: clientInfo,
  };
}

async function saveToSupabase(record: unknown, env: Env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log("Supabaseの環境変数が未設定です");
    return;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/visitor_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(record),
    });

    if (!res.ok) {
      console.log("Supabase保存エラー:", res.status, await res.text());
    }
  } catch (err) {
    console.log("Supabase接続エラー:", err);
  }
}

// --- GET /api/tracker : 動作確認用(サーバー側情報のみ表示) ---
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const serverInfo = collectServerInfo(context.request);
  return new Response(JSON.stringify(serverInfo, null, 2), {
    headers: corsHeaders("application/json"),
  });
};

// --- POST /api/tracker : client-tracker.js(analysis.js)からのデータを保存 ---
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env, waitUntil } = context;
  const serverInfo = collectServerInfo(request);

  let clientInfo: unknown = {};
  try {
    clientInfo = await request.json();
  } catch {
    // JSONで無い/空でも処理は続行(サーバー情報だけでも保存する)
  }

  const record = buildRecord(serverInfo, clientInfo);
  waitUntil(saveToSupabase(record, env));

  return new Response(JSON.stringify({ status: "ok" }), {
    headers: corsHeaders("application/json"),
  });
};

// --- OPTIONS /api/tracker : ブラウザのCORSプリフライト対応 ---
export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { headers: corsHeaders("text/plain") });
};
