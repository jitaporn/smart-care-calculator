import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 90000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("Request timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseJsonContent(content: string) {
  const cleaned = content.replace(/^```json\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      patient_name: null,
      bed: null,
      weight_kg: null,
      age: null,
      drug_name: null,
      dose: null,
      dose_unit: null,
      frequency: null,
      route: null,
      stock_drug: null,
      stock_unit: null,
      stock_volume_ml: null,
      confidence: 0,
      uncertain_fields: ["llm_json_parse"],
    };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return json({ error: "Unauthorized" }, 401);

    const { file_name, mime_type, file_base64 } = await request.json();
    if (!file_base64 || !mime_type) return json({ error: "Missing document" }, 400);

    const apiKey = Deno.env.get("TYPHOON_API_KEY");
    const apiUrl = Deno.env.get("TYPHOON_API_URL");
    const ocrModel = Deno.env.get("TYPHOON_OCR_MODEL");
    const llmModel = Deno.env.get("TYPHOON_LLM_MODEL");
    if (!apiKey || !apiUrl || !ocrModel || !llmModel) {
      return json({ error: "Typhoon secrets are not configured" }, 500);
    }

    const prompt = `Read this medical prescription image carefully.
Extract the visible Thai and English text exactly as written.
Preserve numbers, units, drug names, tables, line breaks, and dosing instructions.
Do not infer or add information that is not visible.`;

    const ocrResponse = await fetchWithTimeout(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ocrModel,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mime_type};base64,${file_base64}` } },
          ],
        }],
      }),
    });
    if (!ocrResponse.ok) {
      const detail = await ocrResponse.text();
      throw new Error(`Typhoon OCR failed: ${ocrResponse.status} ${detail.slice(0, 300)}`);
    }
    const ocrPayload = await ocrResponse.json();
    const rawText = ocrPayload.choices?.[0]?.message?.content || "";

    const schemaPrompt = `Convert the following prescription OCR text into JSON only.
Do not calculate a final medication dose.
Do not infer missing data; use null for missing or uncertain values.
Return this exact schema:
{"patient_name":string|null,"bed":string|null,"weight_kg":number|null,"age":string|null,
"drug_name":string|null,"dose":number|null,"dose_unit":"mg"|"mcg"|"g"|"unit"|null,
"frequency":string|null,"route":string|null,"stock_drug":number|null,
"stock_unit":"mg"|"mcg"|"g"|"unit"|null,"stock_volume_ml":number|null,
"confidence":number,"uncertain_fields":string[]}

OCR text:
${rawText}`;

    const warnings: string[] = [];
    const llmResponse = await fetchWithTimeout(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: llmModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: schemaPrompt }],
      }),
    });
    let extracted;
    if (!llmResponse.ok) {
      const detail = await llmResponse.text();
      warnings.push(`LLM extraction skipped: ${llmResponse.status} ${detail.slice(0, 180)}`);
      extracted = parseJsonContent("{}");
    } else {
      const llmPayload = await llmResponse.json();
      const content = llmPayload.choices?.[0]?.message?.content || "{}";
      extracted = parseJsonContent(content);
    }
    const path = `${auth.user.id}/${crypto.randomUUID()}-${file_name || "prescription"}`;
    const bytes = Uint8Array.from(atob(file_base64), c => c.charCodeAt(0));
    const upload = await supabase.storage.from("prescriptions").upload(path, bytes, { contentType: mime_type });
    if (upload.error) warnings.push(`Storage upload skipped: ${upload.error.message}`);

    const scanInsert = await supabase.from("prescription_scans").insert({
      user_id: auth.user.id,
      storage_path: upload.error ? null : path,
      raw_ocr_text: rawText,
      extracted_data: extracted,
      confidence: extracted.confidence,
    });
    if (scanInsert.error) warnings.push(`Scan history skipped: ${scanInsert.error.message}`);

    return json({ raw_text: rawText, ...extracted, warnings });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
