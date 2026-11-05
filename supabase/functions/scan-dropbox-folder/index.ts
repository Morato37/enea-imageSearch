import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ── Dropbox auth ──────────────────────────────────────────────────────────────

async function getDropboxAccessToken(appKey: string, appSecret: string, refreshToken: string): Promise<string> {
  const credentials = btoa(`${appKey}:${appSecret}`);
  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function getRootNamespaceId(token: string): Promise<string | null> {
  const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data?.root_info?.root_namespace_id ?? null;
}

function buildDropboxHeaders(token: string, rootNamespaceId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (rootNamespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: rootNamespaceId });
  }
  return headers;
}

async function getOrCreateSharedLink(token: string, path: string, rootNamespaceId: string | null): Promise<string | null> {
  const res = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method: "POST",
    headers: buildDropboxHeaders(token, rootNamespaceId),
    body: JSON.stringify({ path }),
  });
  const data = await res.json();
  if (data.url) return data.url.replace("dl=0", "raw=1");
  if (data.error_summary?.startsWith("shared_link_already_exists")) {
    const existing = data.error?.["shared_link_already_exists"]?.metadata?.url;
    return existing ? existing.replace("dl=0", "raw=1") : null;
  }
  return null;
}

// ── List all files in a folder ─────────────────────────────────────────────

interface DropboxEntry {
  ".tag": string;
  path_lower: string;
  path_display: string;
  name: string;
  property_groups?: Array<{ template_id: string; fields: Array<{ name: string; value: string }> }>;
}

async function listAllFiles(
  folderPath: string,
  token: string,
  rootNamespaceId: string | null
): Promise<DropboxEntry[]> {
  const allEntries: DropboxEntry[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    let url: string;
    let body: Record<string, unknown>;

    if (cursor) {
      url = "https://api.dropboxapi.com/2/files/list_folder/continue";
      body = { cursor };
    } else {
      url = "https://api.dropboxapi.com/2/files/list_folder";
      body = { path: folderPath, recursive: true, include_media_info: false };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: buildDropboxHeaders(token, rootNamespaceId),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`list_folder failed (${res.status}): ${await res.text()}`);
    const page = await res.json();
    if (page.error) throw new Error(`list_folder error: ${JSON.stringify(page.error)}`);

    for (const entry of page.entries) {
      if (entry[".tag"] === "file" && /\.(jpe?g|png|webp|heic|tiff?)$/i.test(entry.name)) {
        allEntries.push(entry);
      }
    }
    hasMore = page.has_more;
    cursor = page.cursor;
  }

  return allEntries;
}

async function getFileMetadataWithProperties(
  path: string,
  token: string,
  rootNamespaceId: string | null
): Promise<DropboxEntry | null> {
  const res = await fetch("https://api.dropboxapi.com/2/files/get_metadata", {
    method: "POST",
    headers: buildDropboxHeaders(token, rootNamespaceId),
    body: JSON.stringify({
      path,
      include_media_info: false,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.error || data[".tag"] !== "file") return null;
  return data as DropboxEntry;
}

async function getAlreadyIndexedPaths(
  paths: string[],
  supabase: ReturnType<typeof createClient>
): Promise<Set<string>> {
  const CHUNK = 200;
  const result = new Set<string>();
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("dropbox_images_index")
      .select("dropbox_path")
      .in("dropbox_path", chunk);
    for (const row of data ?? []) result.add(row.dropbox_path);
  }
  return result;
}

// ── action: list_files ────────────────────────────────────────────────────────

async function handleListFiles(
  folderPath: string,
  token: string,
  rootNamespaceId: string | null,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const entries = await listAllFiles(folderPath, token, rootNamespaceId);
  const allPaths = entries.map((e) => e.path_display ?? e.path_lower);
  const alreadyIndexed = await getAlreadyIndexedPaths(allPaths, supabase);
  const paths = allPaths.filter((p) => !alreadyIndexed.has(p));

  return new Response(
    JSON.stringify({ success: true, paths, totalFound: allPaths.length, skippedCount: alreadyIndexed.size }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleListFilesForTagImport(
  folderPath: string,
  token: string,
  rootNamespaceId: string | null
): Promise<Response> {
  const entries = await listAllFiles(folderPath, token, rootNamespaceId);
  const paths = entries.map((e) => e.path_display ?? e.path_lower);
  return new Response(
    JSON.stringify({ success: true, paths, total: paths.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── action: import_dropbox_tags_page ─────────────────────────────────────────

async function handleImportDropboxTagsPage(
  folderPath: string | undefined,
  cursor: string | undefined,
  token: string,
  rootNamespaceId: string | null,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  let url: string;
  let body: Record<string, unknown>;

  if (cursor) {
    url = "https://api.dropboxapi.com/2/files/list_folder/continue";
    body = { cursor };
  } else {
    if (!folderPath) throw new Error("folderPath required for first page");
    url = "https://api.dropboxapi.com/2/files/list_folder";
    body = {
      path: folderPath,
      recursive: true,
      include_media_info: false,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: buildDropboxHeaders(token, rootNamespaceId),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`list_folder failed (${res.status}): ${await res.text()}`);
  const page = await res.json();
  if (page.error) throw new Error(`list_folder error: ${JSON.stringify(page.error)}`);

  const now = new Date().toISOString();
  const upsertRows: Array<Record<string, unknown>> = [];
  let imported = 0;
  let noTags = 0;

  for (const entry of page.entries) {
    if (entry[".tag"] !== "file" || !/\.(jpe?g|png|webp|heic|tiff?)$/i.test(entry.name)) continue;

    const tags: string[] = [];
    if (entry.property_groups) {
      for (const group of entry.property_groups) {
        for (const field of group.fields) {
          const vals = (field.value as string)
            .split(/[,;]+/)
            .map((v: string) => v.trim().toLowerCase())
            .filter(Boolean);
          tags.push(...vals);
        }
      }
    }

    if (tags.length > 0) {
      upsertRows.push({ dropbox_path: entry.path_display ?? entry.path_lower, tags, last_scanned_at: now, status: "scanned" });
      imported++;
    } else {
      upsertRows.push({ dropbox_path: entry.path_display ?? entry.path_lower, tags: [], last_scanned_at: now, status: "pending" });
      noTags++;
    }
  }

  if (upsertRows.length > 0) {
    const { error: dbError } = await supabase
      .from("dropbox_images_index")
      .upsert(upsertRows, { onConflict: "dropbox_path" });
    if (dbError) throw new Error(dbError.message);
  }

  return new Response(
    JSON.stringify({
      success: true,
      hasMore: page.has_more,
      nextCursor: page.cursor,
      imported,
      noTags,
      pageTotal: upsertRows.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── action: import_single_file_tags ──────────────────────────────────────────

async function handleImportSingleFileTags(
  imagePath: string,
  token: string,
  rootNamespaceId: string | null,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const meta = await getFileMetadataWithProperties(imagePath, token, rootNamespaceId);

  const tags: string[] = [];
  if (meta?.property_groups) {
    for (const group of meta.property_groups) {
      for (const field of group.fields) {
        const vals = field.value
          .split(/[,;]+/)
          .map((v: string) => v.trim().toLowerCase())
          .filter(Boolean);
        tags.push(...vals);
      }
    }
  }

  if (tags.length === 0) {
    return new Response(
      JSON.stringify({ success: true, noTags: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const sharedLink = await getOrCreateSharedLink(token, imagePath, rootNamespaceId);

  const { error: dbError } = await supabase
    .from("dropbox_images_index")
    .upsert(
      { dropbox_path: imagePath, tags, dropbox_shared_link: sharedLink, last_scanned_at: new Date().toISOString(), status: "scanned" },
      { onConflict: "dropbox_path" }
    );
  if (dbError) throw new Error(dbError.message);

  return new Response(
    JSON.stringify({ success: true, noTags: false, tagCount: tags.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── action: batch_create_shared_links ────────────────────────────────────────

async function handleBatchCreateSharedLinks(
  token: string,
  rootNamespaceId: string | null,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const BATCH = 50;
  const { data: rows, error } = await supabase
    .from("dropbox_images_index")
    .select("id, dropbox_path")
    .is("dropbox_shared_link", null)
    .neq("tags", "{}")
    .limit(BATCH);

  if (error) throw new Error(error.message);

  if (!rows || rows.length === 0) {
    return new Response(
      JSON.stringify({ success: true, processed: 0, hasMore: false, remaining: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const linkResults = await Promise.allSettled(
    rows.map((row) => getOrCreateSharedLink(token, row.dropbox_path, rootNamespaceId))
  );

  await Promise.allSettled(
    rows.map((row, i) => {
      const result = linkResults[i];
      if (result.status === "fulfilled" && result.value) {
        return supabase
          .from("dropbox_images_index")
          .update({ dropbox_shared_link: result.value })
          .eq("id", row.id);
      }
    }).filter(Boolean)
  );

  const processed = linkResults.filter((r) => r.status === "fulfilled" && r.value).length;

  const { count } = await supabase
    .from("dropbox_images_index")
    .select("*", { count: "exact", head: true })
    .is("dropbox_shared_link", null)
    .neq("tags", "{}");

  return new Response(
    JSON.stringify({ success: true, processed, hasMore: (count ?? 0) > 0, remaining: count ?? 0 }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── action: process_single_image (AI tagging) ─────────────────────────────────

async function tagImageWithGeminiRest(base64: string, mimeType: string, apiKey: string): Promise<string[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: "Analyze this image. Respond ONLY with a comma-separated list of 10 relevant keywords (materials, plants, mood, color). No introduction." },
          { inlineData: { mimeType, data: base64 } },
        ],
      }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Gemini API Error: ${JSON.stringify(data)}`);
  if (!data.candidates?.length) throw new Error("Gemini hat keine Antwort generiert.");
  const text: string = data.candidates[0].content.parts[0].text;
  return text.trim().split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean);
}

async function handleProcessSingleImage(
  imagePath: string,
  token: string,
  rootNamespaceId: string | null,
  geminiApiKey: string,
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const dlHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Dropbox-API-Arg": JSON.stringify({ path: imagePath }),
  };
  if (rootNamespaceId) {
    dlHeaders["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: rootNamespaceId });
  }

  const dlRes = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: dlHeaders,
  });
  if (!dlRes.ok) throw new Error(`Download failed for ${imagePath}: ${dlRes.status}`);

  const reader = dlRes.body!.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
    if (totalLen > 4 * 1024 * 1024) break;
  }
  reader.cancel();

  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }

  let binary = "";
  for (let i = 0; i < merged.length; i++) binary += String.fromCharCode(merged[i]);
  const base64 = btoa(binary);

  const ext = imagePath.split(".").pop()?.toLowerCase() ?? "jpg";
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  const tags = await tagImageWithGeminiRest(base64, mimeType, geminiApiKey);
  const sharedLink = await getOrCreateSharedLink(token, imagePath, rootNamespaceId);

  const { error: dbError } = await supabase
    .from("dropbox_images_index")
    .upsert(
      { dropbox_path: imagePath, tags, dropbox_shared_link: sharedLink, last_scanned_at: new Date().toISOString(), status: "scanned" },
      { onConflict: "dropbox_path" }
    );
  if (dbError) throw new Error(dbError.message);

  return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    const dropboxAppKey = Deno.env.get("DROPBOX_APP_KEY")!;
    const dropboxAppSecret = Deno.env.get("DROPBOX_APP_SECRET")!;
    const dropboxRefreshToken = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, folderPath, imagePath, cursor } = body;

    const dropboxToken = await getDropboxAccessToken(dropboxAppKey, dropboxAppSecret, dropboxRefreshToken);
    const rootNamespaceId = await getRootNamespaceId(dropboxToken);

    if (action === "list_files") {
      if (!folderPath) return new Response(JSON.stringify({ error: "folderPath required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return await handleListFiles(folderPath, dropboxToken, rootNamespaceId, supabase);
    }

    if (action === "import_dropbox_tags_page") {
      if (!folderPath && !cursor) return new Response(JSON.stringify({ error: "folderPath or cursor required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return await handleImportDropboxTagsPage(folderPath, cursor, dropboxToken, rootNamespaceId, supabase);
    }

    if (action === "list_files_for_tag_import") {
      if (!folderPath) return new Response(JSON.stringify({ error: "folderPath required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return await handleListFilesForTagImport(folderPath, dropboxToken, rootNamespaceId);
    }

    if (action === "import_single_file_tags") {
      if (!imagePath) return new Response(JSON.stringify({ error: "imagePath required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return await handleImportSingleFileTags(imagePath, dropboxToken, rootNamespaceId, supabase);
    }

    if (action === "batch_create_shared_links") {
      return await handleBatchCreateSharedLinks(dropboxToken, rootNamespaceId, supabase);
    }

    if (action === "process_single_image") {
      if (!imagePath) return new Response(JSON.stringify({ error: "imagePath required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return await handleProcessSingleImage(imagePath, dropboxToken, rootNamespaceId, geminiApiKey, supabase);
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
