/**
 * Cloudflare Worker: サーバー側(リクエストヘッダー/cfオブジェクト)と
 * クライアント側(client-tracker.jsが送ってくるJSON)の情報を統合し、
 * Supabaseに保存するサンプル。
 *
 * ルート:
 *   GET  /         : サーバー側で取得できる情報をJSONで確認用に返す
 *   POST /collect  : クライアントJSONを受け取り、サーバー情報と合体させてSupabaseへ保存
 *
 * 必要な環境変数(Cloudflare Dashboard > Settings > Variables で設定):
 *   SUPABASE_URL          例: https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role キー(RLSをバイパスして挿入するため。Secretとして登録)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const serverInfo = collectServerInfo(request);

    if (url.pathname === "/collect" && request.method === "POST") {
      let clientInfo = {};
      try {
        clientInfo = await request.json();
      } catch (e) {
        // JSONで無い/空でも処理は続行(サーバー情報だけでも保存する)
      }

      const record = buildRecord(serverInfo, clientInfo);

      // Supabaseへの保存は待たずにレスポンスを返してもよいが、
      // 失敗を把握したい場合は await して結果を見る
      ctx.waitUntil(saveToSupabase(record, env));

      return new Response(JSON.stringify({ status: "ok" }), {
        headers: corsHeaders("application/json"),
      });
    }

    // 動作確認用: サーバー側情報のみ表示
    return new Response(JSON.stringify(serverInfo, null, 2), {
      headers: corsHeaders("application/json"),
    });
  },
};

function corsHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function collectServerInfo(request) {
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }
  const cf = request.cf || {};

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

function buildRecord(serverInfo, clientInfo) {
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

async function saveToSupabase(record, env) {
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
